import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_URL, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { changeCollector, collectorClient, openCollectorDatabase, seedCollectorSession, withCollectorClient } from "./support/collector-fixtures.js";

describe("collector write fencing with real PostgreSQL locks", () => {
  let db: CoreDatabase;
  beforeAll(async () => { db = await openCollectorDatabase(); });
  afterAll(async () => { await db?.close(); });

  /** @param client 별도 연결. @returns 관찰용 PostgreSQL backend ID. */
  async function pid(client: Client): Promise<number> { return (await client.query("select pg_backend_pid() as id")).rows[0].id; }
  /** @param id 대기 중인 backend ID. 시간 추측 대신 DB가 실제 잠금을 기다리는지 확인한다. */
  async function blocked(id: number): Promise<void> {
    await expect.poll(async () => (await db.admin.query("select cardinality(pg_blocking_pids($1)) as n",[id])).rows[0].n,{ timeout: 1500, interval: 10 }).toBeGreaterThan(0);
  }

  it("serializes simultaneous first activation and rejects the losing stale generation", async () => {
    const user = await seedUser(db.admin), a = await seedCollectorSession(db.admin,user), b = await seedCollectorSession(db.admin,user);
    const ca = await collectorClient(user), cb = await collectorClient(user);
    try {
      const bpid = await pid(cb);
      expect(await changeCollector(ca,a,0)).toEqual({ version: 1, state: "active_here" });
      const pending = changeCollector(cb,b,0).then(value => ({ value }),error => ({ error }));
      await blocked(bpid);
      await ca.query("commit");
      expect(await pending).toMatchObject({ error: { message: "COLLECTOR_VERSION_CONFLICT" } });
      expect((await db.admin.query("select active_session_id,version from app_private.collector_state where user_id=$1",[user])).rows).toEqual([{ active_session_id: a, version: 1 }]);
    } finally { await ca.query("rollback"); await cb.query("rollback"); await ca.end(); await cb.end(); }
  });

  it("lets a locked write commit before replacement acknowledges, then fences the old writer", async () => {
    const user = await seedUser(db.admin), a = await seedCollectorSession(db.admin,user), b = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,a,0));
    const ca = await collectorClient(user), cb = await collectorClient(user);
    try {
      const bpid = await pid(cb);
      expect((await ca.query("select app_private.lock_active_collector($1,1) as allowed",[a])).rows[0].allowed).toBe(true);
      const pending = changeCollector(cb,b,1,"activate",true);
      await blocked(bpid);
      await ca.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'expense',100,'2026-10-16')",[user]);
      await ca.query("commit");
      expect(await pending).toEqual({ version: 2, state: "active_here" });
      await cb.query("commit");
      expect(await withCollectorClient(user,async c => (await c.query("select app_private.lock_active_collector($1,1) as allowed",[a])).rows[0].allowed)).toBe(false);
      expect((await db.admin.query("select count(*)::int as n from finance.transaction_history where user_id=$1",[user])).rows[0].n).toBe(1);
    } finally { await ca.query("rollback"); await cb.query("rollback"); await ca.end(); await cb.end(); }
  });

  it("rejects a writer already waiting behind a completed replacement", async () => {
    const user = await seedUser(db.admin), a = await seedCollectorSession(db.admin,user), b = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,a,0));
    const ca = await collectorClient(user), cb = await collectorClient(user);
    try {
      const apid = await pid(ca);
      await changeCollector(cb,b,1,"activate",true);
      const pending = ca.query("select app_private.lock_active_collector($1,1) as allowed",[a]);
      await blocked(apid); await cb.query("commit");
      expect((await pending).rows[0].allowed).toBe(false);
    } finally { await ca.query("rollback"); await cb.query("rollback"); await ca.end(); await cb.end(); }
  });

  it.each([true,false])("orders logout and collection without post-revoke writes, writerFirst=%s", async writerFirst => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,sid,0));
    const writer = await collectorClient(user), logout = new Client({ connectionString: CORE_URL });
    await logout.connect();
    await logout.query("set session authorization app_session_bff; begin; set local lock_timeout='3s'");
    try {
      const writerPid = await pid(writer), logoutPid = await pid(logout);
      if (writerFirst) {
        expect((await writer.query("select app_private.lock_active_collector($1,1) as allowed",[sid])).rows[0].allowed).toBe(true);
        const pending = logout.query("update app_private.auth_sessions set revoked_at=now() where id=$1",[sid]);
        await blocked(logoutPid);
        await writer.query("insert into finance.transaction_history(user_id,kind,amount_krw,occurred_on) values($1,'income',100,'2026-10-16')",[user]);
        await writer.query("commit"); await pending; await logout.query("commit");
      } else {
        await logout.query("update app_private.auth_sessions set revoked_at=now() where id=$1",[sid]);
        const pending = writer.query("select app_private.lock_active_collector($1,1) as allowed",[sid]);
        await blocked(writerPid); await logout.query("commit");
        expect((await pending).rows[0].allowed).toBe(false);
      }
      expect(await withCollectorClient(user,async c => (await c.query("select app_private.lock_active_collector($1,1) as allowed",[sid])).rows[0].allowed)).toBe(false);
      expect((await db.admin.query("select count(*)::int as n from finance.transaction_history where user_id=$1",[user])).rows[0].n).toBe(writerFirst ? 1 : 0);
    } finally { await writer.query("rollback"); await logout.query("rollback"); await writer.end(); await logout.end(); }
  });
});
