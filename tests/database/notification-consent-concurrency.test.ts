import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { changeCollector, seedCollectorSession } from "./support/collector-fixtures.js";
import { changeConsent, collectionAllowed, consentClient, openNotificationConsentDatabase, withConsentClient } from "./support/notification-consent-fixtures.js";

describe("consent revocation with real PostgreSQL locks", () => {
  let db: CoreDatabase;
  beforeAll(async () => { db = await openNotificationConsentDatabase(); });
  afterAll(async () => { await db?.close(); });
  /** @param c 테스트 연결. @returns 관찰용 backend ID. */
  async function pid(c: Client): Promise<number> { return (await c.query("select pg_backend_pid() as id")).rows[0].id; }
  /** @param id 잠금 대기 backend. 임의 sleep 대신 실제 DB 대기를 관찰한다. */
  async function blocked(id: number) { await expect.poll(async () => (await db.admin.query("select cardinality(pg_blocking_pids($1)) as n",[id])).rows[0].n,{ timeout: 1500,interval: 10 }).toBeGreaterThan(0); }
  it.each([true,false])("orders withdrawal and automatic writes, writerFirst=%s", async writerFirst => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    await withConsentClient(user,c => changeCollector(c,sid,0)); await withConsentClient(user,c => changeConsent(c,sid,0));
    const writer = await consentClient(user), withdraw = await consentClient(user);
    try {
      const wp = await pid(writer), rp = await pid(withdraw);
      if (writerFirst) {
        expect(await collectionAllowed(writer,sid)).toBe(true);
        const pending = changeConsent(withdraw,sid,1,"withdraw"); await blocked(rp);
        await writer.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'expense',100,'2026-10-21')",[user]);
        await writer.query("commit"); expect(await pending).toMatchObject({ version: 2,state: "withdrawn" }); await withdraw.query("commit");
      } else {
        await changeConsent(withdraw,sid,1,"withdraw"); const pending = collectionAllowed(writer,sid); await blocked(wp);
        await withdraw.query("commit"); expect(await pending).toBe(false); await writer.query("commit");
      }
      expect(await withConsentClient(user,c => collectionAllowed(c,sid))).toBe(false);
      expect((await db.admin.query("select count(*)::int as n from finance.transaction_history where user_id=$1",[user])).rows[0].n).toBe(writerFirst ? 1 : 0);
    } finally { await writer.query("rollback"); await withdraw.query("rollback"); await writer.end(); await withdraw.end(); }
  });
  it("serializes first accept/withdrawal and rolls back the losing stale mutation", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    const a = await consentClient(user), b = await consentClient(user);
    try {
      const bp = await pid(b); await changeConsent(a,sid,0,"withdraw");
      const pending = changeConsent(b,sid,0).then(value => ({ value }),error => ({ error }));
      await blocked(bp); await a.query("commit"); expect(await pending).toMatchObject({ error: { message: "COLLECTOR_VERSION_CONFLICT" } });
      await b.query("rollback"); expect(await withConsentClient(user,c => collectionAllowed(c,sid))).toBe(false);
    } finally { await a.query("rollback"); await b.query("rollback"); await a.end(); await b.end(); }
  });
  it("checks session expiry again after waiting for consent lock", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    await withConsentClient(user,c => changeCollector(c,sid,0)); await withConsentClient(user,c => changeConsent(c,sid,0));
    await db.admin.query("update app_private.auth_sessions set access_token_expires_at=clock_timestamp()+interval '1 second' where id=$1",[sid]);
    const writer = await consentClient(user);
    await db.admin.query("begin; set local lock_timeout='3s'");
    try {
      await db.admin.query("select * from app_private.notification_consent where user_id=$1 for update",[user]);
      const wp = await pid(writer), pending = collectionAllowed(writer,sid); await blocked(wp);
      await expect.poll(async () => (await db.admin.query("select access_token_expires_at<clock_timestamp() as expired from app_private.auth_sessions where id=$1",[sid])).rows[0].expired,{ timeout: 1800,interval: 20 }).toBe(true);
      await db.admin.query("commit"); expect(await pending).toBe(false);
    } finally { await db.admin.query("rollback"); await writer.query("rollback"); await writer.end(); }
  });
});
