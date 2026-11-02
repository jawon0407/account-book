import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openBankDatabase, type BankTestDatabase } from "./support/bank-database.js";
import { claimFlow, endFlow, finishFlow, flowCall, flowInput, flowRow, readyFlow, startFlow } from "./support/bank-flow.js";

let database: BankTestDatabase;
let other: Client;
beforeAll(async () => { database = await openBankDatabase(); other = await database.connect(); });
beforeEach(async () => { await database.admin.query("truncate app_bank.bank_connection_requests,app_bank.bank_connection_credentials,app_bank.bank_connections,app_bank.bank_request_limits"); });
afterAll(async () => { await database?.close(); });

/** @param batch 종류별 정리 상한. @returns 실제 DB 함수가 처리한 수. */
async function cleanup(batch: number | null = 100) {
  return (await database.admin.query("select * from app_bank.cleanup_requests($1)", [batch])).rows[0];
}
/** @param id 합성 요청. @param codeOnly 요청은 유효하게 두고 임시 코드만 만료시킬지. */
async function age(id: string, codeOnly = false) {
  if (codeOnly) {
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '100 seconds',expires_at=statement_timestamp()+interval '200 seconds',callback_received_at=statement_timestamp()-interval '70 seconds',code_expires_at=statement_timestamp()-interval '10 seconds' where id=$1", [id]);
  } else {
    await database.admin.query("update app_bank.bank_connection_requests set created_at=statement_timestamp()-interval '400 seconds',expires_at=statement_timestamp()-interval '100 seconds',callback_received_at=case when callback_received_at is not null then statement_timestamp()-interval '350 seconds' end,code_expires_at=case when code_expires_at is not null then statement_timestamp()-interval '300 seconds' end where id=$1", [id]);
  }
}

describe("bounded expired bank request cleanup", () => {
  it("expires waiting, stored-code and abandoned-exchange requests without replay", async () => {
    const waiting = flowInput(); await startFlow(database.admin, waiting);
    const coded = await readyFlow(database.admin);
    const exchanging = await readyFlow(database.admin); await claimFlow(database.admin, exchanging);
    for (const a of [waiting, coded, exchanging]) await age(a.id);
    expect(await cleanup()).toEqual({ expired_requests: 3, removed_limits: 0 });
    for (const a of [waiting, coded, exchanging]) {
      expect(await flowRow(database.admin, a.id)).toMatchObject({ status: "expired", encrypted_code: null, code_expires_at: null });
      expect(await claimFlow(database.admin, a)).toBeNull();
    }
    expect(await cleanup()).toEqual({ expired_requests: 0, removed_limits: 0 });
  });

  it("erases expired code while the overall request is still valid", async () => {
    const a = await readyFlow(database.admin); await age(a.id, true);
    expect(await cleanup()).toEqual({ expired_requests: 1, removed_limits: 0 });
    expect(await flowRow(database.admin, a.id)).toMatchObject({ status: "expired", encrypted_code: null });
  });

  it("preserves unexpired requests, terminal states and connected credentials", async () => {
    const waiting = flowInput(); await startFlow(database.admin, waiting);
    const coded = await readyFlow(database.admin);
    const exchanging = await readyFlow(database.admin); await claimFlow(database.admin, exchanging);
    const connected = await readyFlow(database.admin); await claimFlow(database.admin, connected); await finishFlow(database.admin, connected);
    const cancelled = flowInput(); await startFlow(database.admin, cancelled); await endFlow(database.admin, cancelled, "cancel");
    await age(connected.id); await age(cancelled.id);
    const before = (await database.admin.query("select * from app_bank.bank_connection_credentials")).rows;
    expect(await cleanup()).toEqual({ expired_requests: 0, removed_limits: 0 });
    expect((await database.admin.query("select * from app_bank.bank_connection_credentials")).rows).toEqual(before);
    for (const [a, status] of [[waiting, "awaiting_callback"], [coded, "awaiting_completion"], [exchanging, "exchanging"], [connected, "connected"], [cancelled, "cancelled"]] as const) {
      expect((await flowRow(database.admin, a.id)).status).toBe(status);
    }
  });

  it.each([null, 0, -1, 501])( "rejects invalid batch %s", async (batch) => {
    await expect(cleanup(batch)).rejects.toThrow("BANK_CLEANUP_BATCH_INVALID");
  });

  it("respects per-kind batch and only removes expired quotas", async () => {
    for (let n = 0; n < 3; n++) { const a = flowInput(); await startFlow(database.admin, a); await age(a.id); }
    for (let n = 0; n < 3; n++) await flowCall(database.admin, null, () => database.admin.query("select * from app_bank.consume_callback_limit($1)", [randomBytes(32)]));
    await database.admin.query("update app_bank.bank_request_limits set accepted_at=array[statement_timestamp()-interval '61 seconds'],expires_at=statement_timestamp()-interval '1 second'");
    await flowCall(database.admin, null, () => database.admin.query("select * from app_bank.consume_callback_limit($1)", [randomBytes(32)]));
    expect(await cleanup(2)).toEqual({ expired_requests: 2, removed_limits: 2 });
    expect(await cleanup(2)).toEqual({ expired_requests: 1, removed_limits: 1 });
    expect((await database.admin.query("select count(*)::int as count from app_bank.bank_request_limits")).rows[0].count).toBe(1);
    expect(await cleanup(500)).toEqual({ expired_requests: 0, removed_limits: 0 });
  });

  it("skips locked expired requests and quotas without waiting", async () => {
    const a = flowInput(); await startFlow(database.admin, a); await age(a.id);
    await flowCall(database.admin, null, () => database.admin.query("select * from app_bank.consume_callback_limit($1)", [randomBytes(32)]));
    await database.admin.query("update app_bank.bank_request_limits set accepted_at=array[statement_timestamp()-interval '61 seconds'],expires_at=statement_timestamp()-interval '1 second'");
    await other.query("begin");
    await other.query("select id from app_bank.bank_connection_requests for update");
    await other.query("select scope from app_bank.bank_request_limits for update");
    try {
      await database.admin.query("set statement_timeout='500ms'");
      expect(await cleanup()).toEqual({ expired_requests: 0, removed_limits: 0 });
    } finally { await database.admin.query("reset statement_timeout"); await other.query("rollback"); }
    expect(await cleanup()).toEqual({ expired_requests: 1, removed_limits: 1 });
  });
});
