import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { AT, ENVELOPE, seedConnection, seedCredentials, seedRequest, USER_A, USER_B } from "./support/bank-fixtures.js";

let database: BankTestDatabase;
beforeAll(async () => { database = await openBankDatabase(); });
afterAll(async () => { await database?.close(); });

describe("bank storage constraints on disposable PostgreSQL", () => {
  it("creates the three private storage tables", async () => {
    const result = await database.admin.query("select tablename from pg_tables where schemaname='app_bank' order by tablename");
    expect(result.rows.map((row) => row.tablename)).toEqual(["bank_connection_credentials", "bank_connection_requests", "bank_connections"]);
  });

  it("stores only bound encrypted credentials and permits no refresh token", async () => {
    const id = await seedConnection(database.admin);
    await seedCredentials(database.admin, id);
    const result = await database.admin.query("select encrypted_provider_subject,encrypted_access_token,encrypted_refresh_token from app_bank.bank_connection_credentials where connection_id=$1", [id]);
    expect(result.rows[0]).toEqual({ encrypted_provider_subject: ENVELOPE, encrypted_access_token: ENVELOPE, encrypted_refresh_token: null });
  });

  it.each([[USER_B, "fake"], [USER_A, "test"]])("rejects credentials bound to wrong owner/environment %s %s", async (user, environment) => {
    await expect(seedCredentials(database.admin, await seedConnection(database.admin), user, environment)).rejects.toMatchObject({ code: "23503" });
  });

  it("binds a connected request to the same owner's connection", async () => {
    const connectionId = await seedConnection(database.admin, USER_B);
    await expect(seedRequest(database.admin, { status: "connected", connection_id: connectionId, callback_received_at: "2026-09-28T00:01:00Z" })).rejects.toMatchObject({ code: "23503" });
  });

  it("accepts a connected request only with its own bound result", async () => {
    const connectionId = await seedConnection(database.admin);
    await expect(seedRequest(database.admin, { status: "connected", connection_id: connectionId, callback_received_at: "2026-09-28T00:01:00Z" })).resolves.toBeTypeOf("string");
    await expect(seedRequest(database.admin, { status: "cancelled", connection_id: connectionId })).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts the maximum request/code TTL and clears ciphertext after claim", async () => {
    const id = await seedRequest(database.admin, { status: "awaiting_completion", callback_received_at: "2026-09-28T00:04:00Z", code_expires_at: "2026-09-28T00:05:00Z", encrypted_code: ENVELOPE });
    await database.admin.query("update app_bank.bank_connection_requests set status='exchanging', encrypted_code=null,code_expires_at=null where id=$1", [id]);
    expect((await database.admin.query("select encrypted_code from app_bank.bank_connection_requests where id=$1", [id])).rows[0].encrypted_code).toBeNull();
  });

  it.each([
    { expires_at: AT }, { expires_at: "2026-09-28T00:05:00.001Z" }, { expires_at: "infinity" },
    { created_at: "-infinity" }, { state_digest: Buffer.alloc(31) }, { proof_digest: Buffer.alloc(33) },
    { provider: "unknown" }, { environment: "unknown" }, { channel: "unknown" }, { status: "unknown" },
    { status: "awaiting_completion" }, { status: "exchanging" }, { status: "connected" },
    { encrypted_code: ENVELOPE }, { callback_received_at: AT },
    { status: "failed", encrypted_code: ENVELOPE },
  ])("rejects invalid request fields %j", async (fields) => {
    await expect(seedRequest(database.admin, fields)).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    { callback_received_at: "2026-09-27T23:59:59Z" },
    { callback_received_at: "2026-09-28T00:05:00Z" },
    { code_expires_at: "2026-09-28T00:01:00Z" },
    { code_expires_at: "2026-09-28T00:02:00.001Z" },
    { code_expires_at: "infinity" },
  ])("rejects invalid callback/code times %j", async (fields) => {
    await expect(seedRequest(database.admin, { status: "awaiting_completion", callback_received_at: "2026-09-28T00:01:00Z", code_expires_at: "2026-09-28T00:02:00Z", encrypted_code: ENVELOPE, ...fields })).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["cancelled", "expired", "failed"])("accepts terminal %s only without temporary code", async (status) => {
    await expect(seedRequest(database.admin, { status })).resolves.toBeTypeOf("string");
    await expect(seedRequest(database.admin, { status, encrypted_code: ENVELOPE })).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces digest uniqueness and one unfinished request per owner/session", async () => {
    const session = randomUUID();
    const state = randomBytes(32);
    const proof = randomBytes(32);
    const first = await seedRequest(database.admin, { session_id: session, state_digest: state, proof_digest: proof });
    for (const fields of [{ state_digest: state }, { proof_digest: proof }, { session_id: session }]) {
      await expect(seedRequest(database.admin, fields)).rejects.toMatchObject({ code: "23505" });
    }
    await database.admin.query("update app_bank.bank_connection_requests set status='cancelled' where id=$1", [first]);
    await expect(seedRequest(database.admin, { session_id: session })).resolves.toBeTypeOf("string");
    await expect(seedRequest(database.admin, { user_id: USER_B, session_id: session })).resolves.toBeTypeOf("string");
  });

  it.each([
    null, [], "raw-token", {}, { ...ENVELOPE, version: "1" }, { ...ENVELOPE, version: 2 },
    { ...ENVELOPE, kid: null }, { ...ENVELOPE, kid: "" }, { ...ENVELOPE, extra: "raw" },
    { ...ENVELOPE, nonce: "YQ" }, { ...ENVELOPE, tag: "YQ" },
    { ...ENVELOPE, ciphertext: "YQ==" }, { ...ENVELOPE, ciphertext: "YR" },
    { ...ENVELOPE, ciphertext: "" }, { ...ENVELOPE, ciphertext: null },
    { ...ENVELOPE, ciphertext: Buffer.alloc(65_537).toString("base64url") },
  ])("rejects malformed envelope case %# without SQL null bypass", async (envelope) => {
    const result = await database.admin.query("select app_bank.valid_token_envelope($1::jsonb) as valid", [JSON.stringify(envelope)]);
    expect(result.rows[0].valid).toBe(false);
    const id = await seedConnection(database.admin);
    await expect(database.admin.query(`insert into app_bank.bank_connection_credentials
      (connection_id,user_id,provider,environment,encrypted_provider_subject,encrypted_access_token,access_expires_at,created_at,updated_at)
      values($1,$2,'kftc','fake',$3::jsonb,$4,'2026-09-28T01:00:00Z',$5,$5)`, [id, USER_A, JSON.stringify(envelope), ENVELOPE, AT])).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts a canonical maximum-size envelope and rejects absent SQL value", async () => {
    const max = { ...ENVELOPE, ciphertext: Buffer.alloc(65_536).toString("base64url") };
    expect((await database.admin.query("select app_bank.valid_token_envelope($1::jsonb) as valid", [max])).rows[0].valid).toBe(true);
    expect((await database.admin.query("select app_bank.valid_token_envelope(null) as valid")).rows[0].valid).toBe(false);
  });
});
