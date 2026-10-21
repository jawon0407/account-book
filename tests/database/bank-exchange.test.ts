import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { ENVELOPE, USER_B } from "./support/bank-fixtures.js";
import { claimFlow, endFlow, finishFlow, flowCall, flowInput, flowRow, readyFlow, startFlow } from "./support/bank-flow.js";

let database: BankTestDatabase;
beforeAll(async () => { database = await openBankDatabase(); });
afterAll(async () => { await database?.close(); });

describe("single-use bank exchange", () => {
  it("claims the code once, erases it, and refuses replacement while exchanging", async () => {
    const a = await readyFlow(database.admin);
    expect(await claimFlow(database.admin, a)).toEqual(ENVELOPE);
    expect(await claimFlow(database.admin, a)).toBeNull();
    expect(await flowRow(database.admin, a.id)).toMatchObject({ status: "exchanging", encrypted_code: null, code_expires_at: null });
    expect(await startFlow(database.admin, { ...flowInput(), session: a.session })).toBeNull();
  });

  it.each(["user", "session", "proof", "null-proof"])("denies a mismatched %s for claim, finish and end", async (kind) => {
    const a = await readyFlow(database.admin);
    const b = { ...a, ...(kind === "user" ? { user: USER_B } : kind === "session" ? { session: randomUUID() } : { proof: kind === "null-proof" ? null as unknown as typeof a.proof : randomBytes(32) }) };
    expect(await claimFlow(database.admin, b)).toBeNull();
    expect(await endFlow(database.admin, b, "cancel")).toBeNull();
    expect((await flowRow(database.admin, a.id)).status).toBe("awaiting_completion");
    await claimFlow(database.admin, a);
    expect(await finishFlow(database.admin, b)).toBe(false);
    expect((await flowRow(database.admin, a.id)).status).toBe("exchanging");
  });

  it("atomically saves connection and credentials without replaying completion", async () => {
    const a = await readyFlow(database.admin);
    const connection = randomUUID();
    expect(await finishFlow(database.admin, a, connection)).toBe(false);
    await claimFlow(database.admin, a);
    expect(await finishFlow(database.admin, a, connection)).toBe(true);
    expect(await finishFlow(database.admin, a, connection)).toBe(false);
    expect(await flowRow(database.admin, a.id)).toMatchObject({ status: "connected", connection_id: connection, encrypted_code: null });
    const saved = await database.admin.query("select c.user_id,c.environment,t.encrypted_access_token from app_bank.bank_connections c join app_bank.bank_connection_credentials t on c.id=t.connection_id where c.id=$1", [connection]);
    expect(saved.rows).toEqual([{ user_id: a.user, environment: "test", encrypted_access_token: ENVELOPE }]);
  });

  it("rolls back the whole save on malformed credentials and permits explicit failure", async () => {
    const a = await readyFlow(database.admin);
    await claimFlow(database.admin, a);
    const connection = randomUUID();
    await expect(finishFlow(database.admin, a, connection, {})).rejects.toThrow();
    expect((await database.admin.query("select 1 from app_bank.bank_connections where id=$1", [connection])).rowCount).toBe(0);
    expect((await flowRow(database.admin, a.id)).status).toBe("exchanging");
    expect(await endFlow(database.admin, a, "fail")).toBe("failed");
    expect(await claimFlow(database.admin, a)).toBeNull();
  });

  it("does not overwrite an existing connection ID", async () => {
    const a = await readyFlow(database.admin);
    const connection = randomUUID();
    await claimFlow(database.admin, a);
    await finishFlow(database.admin, a, connection);
    const b = await readyFlow(database.admin);
    await claimFlow(database.admin, b);
    await expect(finishFlow(database.admin, b, connection)).rejects.toMatchObject({ code: "23505" });
    expect((await flowRow(database.admin, b.id)).status).toBe("exchanging");
  });

  it("rejects missing identity and already-expired access tokens", async () => {
    const a = await readyFlow(database.admin);
    expect((await flowCall(database.admin, null, () => database.admin.query("select app_bank.claim_exchange($1,$2,$3) as code", [a.id, a.session, a.proof]))).rows[0].code).toBeNull();
    await claimFlow(database.admin, a);
    await expect(flowCall(database.admin, a.user, () => database.admin.query("select app_bank.finish_exchange($1,$2,$3,$4,$5,$5,null,clock_timestamp()-interval '1 second',null,null)", [a.id, a.session, a.proof, randomUUID(), ENVELOPE]))).rejects.toThrow();
  });

  it("erases expired codes even without a cleanup job", async () => {
    const a = await readyFlow(database.admin);
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '100 seconds',expires_at=statement_timestamp()+interval '200 seconds',callback_received_at=statement_timestamp()-interval '62 seconds',code_expires_at=statement_timestamp()-interval '2 seconds' where id=$1", [a.id]);
    expect(await claimFlow(database.admin, a)).toBeNull();
    expect(await flowRow(database.admin, a.id)).toMatchObject({ status: "expired", encrypted_code: null, code_expires_at: null });
  });

  it("refuses successful completion after request expiry", async () => {
    const a = await readyFlow(database.admin);
    await claimFlow(database.admin, a);
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '301 seconds',expires_at=statement_timestamp()-interval '1 second',callback_received_at=statement_timestamp()-interval '2 seconds' where id=$1", [a.id]);
    expect(await finishFlow(database.admin, a)).toBe(false);
    expect((await flowRow(database.admin, a.id)).status).toBe("expired");
  });
});

describe("bank request termination", () => {
  it("cancels waiting code and keeps terminal results immutable", async () => {
    const a = await readyFlow(database.admin);
    expect(await endFlow(database.admin, a, "cancel")).toBe("cancelled");
    expect(await endFlow(database.admin, a, "fail")).toBe("cancelled");
    expect(await flowRow(database.admin, a.id)).toMatchObject({ encrypted_code: null, code_expires_at: null });
    expect(await claimFlow(database.admin, a)).toBeNull();
  });

  it("does not cancel an exchange in flight or expire a live wait", async () => {
    const a = await readyFlow(database.admin);
    expect(await endFlow(database.admin, a, "expire")).toBe("awaiting_completion");
    expect(await endFlow(database.admin, a, "fail")).toBe("awaiting_completion");
    await claimFlow(database.admin, a);
    expect(await endFlow(database.admin, a, "cancel")).toBe("exchanging");
    expect(await endFlow(database.admin, a, "fail")).toBe("failed");
  });

  it("expires old waits and rejects arbitrary end actions", async () => {
    const a = flowInput();
    await startFlow(database.admin, a);
    await expect(endFlow(database.admin, a, "connected")).rejects.toThrow("BANK_END_ACTION_INVALID");
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '301 seconds',expires_at=statement_timestamp()-interval '1 second' where id=$1", [a.id]);
    expect(await endFlow(database.admin, a, "expire")).toBe("expired");
  });
});
