import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { flowCall } from "./support/bank-flow.js";

let database: BankTestDatabase;
let first: Client;
let second: Client;
beforeAll(async () => { database = await openBankDatabase(); first = await database.connect(); second = await database.connect(); });
afterAll(async () => { await database?.close(); });

/** @param db 독립 연결. @param user 합성 principal. @returns 커밋한 시작 quota 결과. */
async function consume(db: Client, user: string | null) {
  return flowCall(db, user, async () => (await db.query("select * from app_bank.consume_start_limit()")).rows[0]);
}
/** @param db 독립 연결. @param digest 실제 주소가 아닌32바이트 fixture. @returns Callback quota 결과. */
async function callback(db: Client, digest: Buffer | null) {
  return flowCall(db, null, async () => (await db.query("select * from app_bank.consume_callback_limit($1)", [digest])).rows[0]);
}
/** @param user 합성 UUID. @returns DB 저장 key와 대조할 지문. */
function key(user: string) { return createHash("sha256").update(user).digest(); }

describe("shared sliding bank limits", () => {
  it("allows five starts then denies without extending the window", async () => {
    const user = randomUUID();
    for (let n = 0; n < 5; n++) expect(await consume(database.admin, user)).toEqual({ allowed: true, retry_after_seconds: 0 });
    const before = (await database.admin.query("select * from app_bank.bank_request_limits where scope='start' and key_digest=$1", [key(user)])).rows;
    const denied = await consume(database.admin, user);
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after_seconds).toBeGreaterThan(0);
    expect(denied.retry_after_seconds).toBeLessThanOrEqual(300);
    expect((await database.admin.query("select * from app_bank.bank_request_limits where scope='start' and key_digest=$1", [key(user)])).rows).toEqual(before);
    expect((await consume(database.admin, randomUUID())).allowed).toBe(true);
    expect((await callback(database.admin, key(user))).allowed).toBe(true);
  });

  it("allows sixty callbacks per digest and isolates another address", async () => {
    const digest = randomBytes(32);
    for (let n = 0; n < 60; n++) expect((await callback(database.admin, digest)).allowed).toBe(true);
    const denied = await callback(database.admin, digest);
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after_seconds).toBeGreaterThan(0);
    expect(denied.retry_after_seconds).toBeLessThanOrEqual(60);
    expect((await callback(database.admin, randomBytes(32))).allowed).toBe(true);
  });

  it.each([null, Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33)])("rejects malformed callback digest %#", async (digest) => {
    await expect(callback(database.admin, digest)).rejects.toThrow("BANK_LIMIT_KEY_INVALID");
  });
  it("requires identity before consuming the user quota", async () => {
    await expect(consume(database.admin, null)).rejects.toThrow("BANK_IDENTITY_REQUIRED");
  });

  it("removes only old hits in a rolling window without waiting for cleanup", async () => {
    const user = randomUUID();
    for (let n = 0; n < 5; n++) await consume(database.admin, user);
    await database.admin.query("update app_bank.bank_request_limits set accepted_at[1]=statement_timestamp()-interval '301 seconds' where scope='start' and key_digest=$1", [key(user)]);
    expect((await consume(database.admin, user)).allowed).toBe(true);
    expect((await consume(database.admin, user)).allowed).toBe(false);
    expect((await database.admin.query("select cardinality(accepted_at) as count from app_bank.bank_request_limits where scope='start' and key_digest=$1", [key(user)])).rows[0].count).toBe(5);
  });

  it("serializes the last slot across overlapping transactions", async () => {
    const user = randomUUID();
    for (let n = 0; n < 4; n++) await consume(database.admin, user);
    const pid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
    await first.query("set session authorization app_api");
    await first.query("begin");
    await first.query("select set_config('app.user_id',$1,true)", [user]);
    expect((await first.query("select * from app_bank.consume_start_limit()")).rows[0].allowed).toBe(true);
    const pending = consume(second, user);
    try {
      await expect.poll(async () => (await database.admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type).toBe("Lock");
      await first.query("commit");
      expect((await pending).allowed).toBe(false);
    } finally { await first.query("rollback"); await first.query("reset session authorization"); await pending; }
  });

  it("rechecks expiry after a real row-lock wait", async () => {
    const user = randomUUID();
    for (let n = 0; n < 5; n++) await consume(database.admin, user);
    const pid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
    await first.query("begin");
    await first.query("select * from app_bank.bank_request_limits where scope='start' and key_digest=$1 for update", [key(user)]);
    const pending = consume(second, user);
    try {
      await expect.poll(async () => (await database.admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type).toBe("Lock");
      await first.query("update app_bank.bank_request_limits set accepted_at=array_fill(statement_timestamp()-interval '300 seconds',array[5]),expires_at=statement_timestamp() where scope='start' and key_digest=$1", [key(user)]);
      await first.query("commit");
      expect((await pending).allowed).toBe(true);
      expect((await database.admin.query("select cardinality(accepted_at) as count from app_bank.bank_request_limits where scope='start' and key_digest=$1", [key(user)])).rows[0].count).toBe(1);
    } finally { await first.query("rollback"); await pending; }
  });
});
