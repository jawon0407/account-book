import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { ENVELOPE } from "./support/bank-fixtures.js";
import { flowCall, flowInput, flowRow, startFlow } from "./support/bank-flow.js";

let database: BankTestDatabase;
beforeAll(async () => { database = await openBankDatabase(); });
afterAll(async () => { await database?.close(); });

describe("bank request intake", () => {
  it("creates a 300-second request and cancels the previous same-session wait", async () => {
    const a = flowInput();
    expect(await startFlow(database.admin, a)).toBe(a.id);
    const row = await flowRow(database.admin, a.id);
    expect(row.status).toBe("awaiting_callback");
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(300_000);
    const b = { ...flowInput(), session: a.session };
    await startFlow(database.admin, b);
    expect((await flowRow(database.admin, a.id)).status).toBe("cancelled");
    expect((await flowRow(database.admin, b.id)).status).toBe("awaiting_callback");
  });

  it("rejects absent identity and malformed digests without creating rows", async () => {
    const a = flowInput();
    await expect(flowCall(database.admin, null, () => database.admin.query("select app_bank.start_request($1,$2,'test',$3,$4)", [a.id, a.session, a.state, a.proof]))).rejects.toThrow("BANK_IDENTITY_REQUIRED");
    await expect(startFlow(database.admin, { ...a, proof: Buffer.alloc(1) })).rejects.toThrow();
    expect(await flowRow(database.admin, a.id)).toBeUndefined();
  });

  it("returns only live callback encryption context and never overwrites a received code", async () => {
    const a = flowInput();
    await startFlow(database.admin, a);
    const context = await flowCall(database.admin, null, () => database.admin.query("select * from app_bank.callback_context($1)", [a.state]));
    expect(context.rows).toEqual([{ id: a.id, user_id: a.user, environment: "test" }]);
    const receive = (code: unknown) => flowCall(database.admin, null, () => database.admin.query("select app_bank.receive_callback($1,$2,false) as id", [a.state, code]));
    expect((await receive(ENVELOPE)).rows[0].id).toBe(a.id);
    const row = await flowRow(database.admin, a.id);
    expect(row.status).toBe("awaiting_completion");
    expect(row.code_expires_at.getTime() - row.callback_received_at.getTime()).toBe(60_000);
    expect((await receive({ ...ENVELOPE, kid: "other" })).rows[0].id).toBeNull();
    expect((await flowRow(database.admin, a.id)).encrypted_code).toEqual(ENVELOPE);
    expect((await flowCall(database.admin, null, () => database.admin.query("select * from app_bank.callback_context($1)", [a.state]))).rowCount).toBe(0);
  });

  it("fails a denied callback and does not accept unknown state", async () => {
    const a = flowInput();
    await startFlow(database.admin, a);
    await flowCall(database.admin, null, () => database.admin.query("select app_bank.receive_callback($1,null,true)", [a.state]));
    expect((await flowRow(database.admin, a.id)).status).toBe("failed");
    expect((await flowRow(database.admin, a.id)).encrypted_code).toBeNull();
    const unknown = await flowCall(database.admin, null, () => database.admin.query("select app_bank.receive_callback($1,$2,false) as id", [randomBytes(32), ENVELOPE]));
    expect(unknown.rows[0].id).toBeNull();
  });

  it("expires old callbacks at use time without waiting for cleanup", async () => {
    const a = flowInput();
    await startFlow(database.admin, a);
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '301 seconds', expires_at=statement_timestamp()-interval '1 second' where id=$1", [a.id]);
    expect((await flowCall(database.admin, null, () => database.admin.query("select * from app_bank.callback_context($1)", [a.state]))).rowCount).toBe(0);
    expect((await flowCall(database.admin, null, () => database.admin.query("select app_bank.receive_callback($1,$2,false) as id", [a.state, ENVELOPE]))).rows[0].id).toBeNull();
    expect((await flowRow(database.admin, a.id)).status).toBe("expired");
  });

  it("rolls back malformed callback envelopes and refuses NULL denied flags", async () => {
    const a = flowInput();
    await startFlow(database.admin, a);
    await expect(flowCall(database.admin, null, () => database.admin.query("select app_bank.receive_callback($1,'{}',false)", [a.state]))).rejects.toThrow();
    expect((await flowRow(database.admin, a.id)).status).toBe("awaiting_callback");
    await expect(flowCall(database.admin, null, () => database.admin.query("select app_bank.receive_callback($1,$2,null)", [a.state, ENVELOPE]))).rejects.toThrow("BANK_CALLBACK_INVALID");
  });
});
