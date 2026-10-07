import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_URL, EXISTING_USER, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { BankDatabase } from "../../apps/api/src/bank-connections/bank-database.js";
import { BankRepository } from "../../apps/api/src/bank-connections/bank-repository.js";
import { encryptBankToken } from "../../apps/api/src/bank-connections/security/token-envelope.js";

let database: CoreDatabase, pool: Pool, repo: BankRepository;
const identity = { userId: EXISTING_USER, sessionId: randomUUID() };
const keys = { activeKid: "test", keys: new Map([["test", randomBytes(32)]]) };
beforeAll(async () => {
  database = await openCoreDatabase();
  for (const name of ["202609280001_bank_connection_storage.sql", "202609280002_bank_connection_access.sql", "202610010003_bank_request_intake.sql", "202610010004_bank_request_exchange.sql", "202610010005_bank_request_end.sql", "202610020001_bank_request_limits.sql", "202610020002_bank_request_cleanup.sql"]) {
    await database.admin.query(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  pool = new Pool({ connectionString: CORE_URL, max: 3 });
  repo = new BankRepository(new BankDatabase({ connect: async () => {
    const client = await pool.connect(); await client.query("set session authorization app_api"); return client;
  } }));
});
afterAll(async () => { await pool?.end(); await database?.close(); });

/** @returns 독립 state/proof로 만든 본인 fake 연결 요청. 은행에는 연결하지 않는다. */
async function request() {
  const id = randomUUID(), state = randomBytes(32), proof = randomBytes(32);
  const who = { ...identity, sessionId: randomUUID() };
  expect(await repo.start(who, id, "fake", state, proof)).toBe(id);
  return { id, state, proof, who };
}
describe("bank API repository with real least-privilege PostgreSQL", () => {
  it("keeps committed quota when the next operation rolls back", async () => {
    expect((await repo.consumeStart(identity)).allowed).toBe(true);
    await expect(repo.start(identity, randomUUID(), "fake", Buffer.alloc(1), randomBytes(32))).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    for (let i = 0; i < 4; i++) expect((await repo.consumeStart(identity)).allowed).toBe(true);
    expect(await repo.consumeStart(identity)).toMatchObject({ allowed: false });
  });
  it("hides a request from another session and missing owner", async () => {
    const r = await request();
    expect(await repo.context(r.who, r.id)).toMatchObject({ requestId: r.id, status: "awaiting_callback", environment: "fake" });
    expect(await repo.context({ ...r.who, sessionId: randomUUID() }, r.id)).toBeNull();
    await expect(repo.context({ ...r.who, userId: randomUUID() }, r.id)).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
  });
  it("commits one claim then atomically saves encrypted credentials", async () => {
    const r = await request();
    const context = { userId: identity.userId, resourceId: r.id, provider: "kftc" as const, environment: "fake" as const, purpose: "authorization_code" as const };
    const envelope = encryptBankToken("fake-code", context, keys);
    expect(await repo.callbackContext(r.state)).toMatchObject({ id: r.id, userId: identity.userId, environment: "fake" });
    expect(await repo.receiveCallback(r.state, envelope, false)).toBe(r.id);
    expect(await repo.claim(r.who, r.id, randomBytes(32))).toBeNull();
    expect(await repo.claim(r.who, r.id, r.proof)).toEqual(envelope);
    expect(await repo.claim(r.who, r.id, r.proof)).toBeNull();
    const connectionId = randomUUID();
    const token = (purpose: "access_token" | "provider_subject") => encryptBankToken(`fake-${purpose}`, { ...context, resourceId: connectionId, purpose }, keys);
    expect(await repo.finish(r.who, r.id, r.proof, { connectionId, subject: token("provider_subject"), access: token("access_token"), refresh: null, accessExpiresAt: new Date(Date.now() + 60_000), refreshExpiresAt: null, consentExpiresAt: null })).toBe(true);
    expect(await repo.context(r.who, r.id)).toMatchObject({ status: "connected" });
    const stored = (await database.admin.query("select encrypted_access_token from app_bank.bank_connection_credentials where connection_id=$1", [connectionId])).rows[0];
    expect(JSON.stringify(stored)).not.toContain("fake-access_token");
  });
  it("reports expiry using DB time even before cleanup runs", async () => {
    const r = await request();
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '301 seconds',expires_at=statement_timestamp()-interval '1 second' where id=$1", [r.id]);
    expect(await repo.context(r.who, r.id)).toMatchObject({ status: "expired" });
  });
  it("commits callback limits and failed exchange terminal state", async () => {
    expect(await repo.consumeCallback(randomBytes(32))).toEqual({ allowed: true, retryAfterSeconds: 0 });
    const r = await request();
    const code = encryptBankToken("fake", { userId: identity.userId, resourceId: r.id, provider: "kftc", environment: "fake", purpose: "authorization_code" }, keys);
    await repo.receiveCallback(r.state, code, false); await repo.claim(r.who, r.id, r.proof);
    await repo.fail(r.who, r.id, r.proof);
    expect(await repo.context(r.who, r.id)).toMatchObject({ status: "failed" });
  });
  it("denies a deleted member before creating a request", async () => {
    await database.admin.query('update "user".users set deleted_at=clock_timestamp() where user_id=$1', [identity.userId]);
    await expect(repo.consumeStart(identity)).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
  });
});
