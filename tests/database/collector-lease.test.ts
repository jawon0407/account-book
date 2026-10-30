import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asCoreRole, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { changeCollector, openCollectorDatabase, seedCollectorSession, withCollectorClient } from "./support/collector-fixtures.js";

describe("single collector lease", () => {
  let db: CoreDatabase;
  beforeAll(async () => { db = await openCollectorDatabase(); });
  afterAll(async () => { await db?.close(); });

  it("starts inactive, activates once, replaces explicitly, and keeps a monotonic fence on revoke", async () => {
    const user = await seedUser(db.admin), a = await seedCollectorSession(db.admin,user), b = await seedCollectorSession(db.admin,user);
    expect(await withCollectorClient(user, async c => (await c.query("select * from app_private.collector_status($1)",[a])).rows)).toEqual([{ version: 0, state: "inactive" }]);
    expect(await withCollectorClient(user,c => changeCollector(c,a,0))).toEqual({ version: 1, state: "active_here" });
    expect(await withCollectorClient(user,c => changeCollector(c,a,1))).toEqual({ version: 1, state: "active_here" });
    expect(await withCollectorClient(user, async c => (await c.query("select * from app_private.collector_status($1)",[b])).rows[0])).toEqual({ version: 1, state: "active_elsewhere" });
    await expect(withCollectorClient(user,c => changeCollector(c,b,1))).rejects.toMatchObject({ message: "COLLECTOR_REPLACE_REQUIRED" });
    expect(await withCollectorClient(user,c => changeCollector(c,b,1,"activate",true))).toEqual({ version: 2, state: "active_here" });
    await expect(withCollectorClient(user,c => changeCollector(c,a,1,"activate",true))).rejects.toMatchObject({ message: "COLLECTOR_VERSION_CONFLICT" });
    expect(await withCollectorClient(user,c => changeCollector(c,a,2,"deactivate"))).toEqual({ version: 3, state: "inactive" });
    expect(await withCollectorClient(user,c => changeCollector(c,a,3,"deactivate"))).toEqual({ version: 3, state: "inactive" });
  });

  it.each(["revoked_at=now()", "revocation_pending_at=now()", "access_token_expires_at=now()", "absolute_expires_at=now()", "last_seen_at=now()-interval '8 days'"])("rejects stale sessions and reports inactive after %s", async update => {
    const user = await seedUser(db.admin), a = await seedCollectorSession(db.admin,user), b = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,a,0));
    await db.admin.query(`update app_private.auth_sessions set ${update} where id=$1`,[a]);
    await expect(withCollectorClient(user,c => changeCollector(c,a,1))).rejects.toMatchObject({ code: "28000" });
    expect(await withCollectorClient(user, async c => (await c.query("select * from app_private.collector_status($1)",[b])).rows[0])).toEqual({ version: 1, state: "inactive" });
    expect(await withCollectorClient(user,c => changeCollector(c,b,1))).toEqual({ version: 2, state: "active_here" });
    expect(await withCollectorClient(user, async c => (await c.query("select app_private.lock_active_collector($1,1) as allowed",[a])).rows[0].allowed)).toBe(false);
  });

  it("rejects other users, web sessions, missing context, unknown sessions and deleted profiles", async () => {
    const user = await seedUser(db.admin), other = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user), web = await seedCollectorSession(db.admin,user,"web");
    for (const [owner,session] of [[other,sid],[user,web],[user,randomUUID()]]) {
      await expect(withCollectorClient(owner!,c => changeCollector(c,session!,0))).rejects.toMatchObject({ code: "28000" });
    }
    await expect(asCoreRole(db.admin,"app_api",undefined,() => db.admin.query("select * from app_private.collector_status($1)",[sid]))).rejects.toMatchObject({ code: "28000" });
    await db.admin.query('update "user".users set deleted_at=now() where user_id=$1',[user]);
    await expect(withCollectorClient(user,c => changeCollector(c,sid,0))).rejects.toMatchObject({ code: "28000" });
  });

  it("fails closed for nullable/invalid commands and bounded generations", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    for (const args of [[sid,null,"activate",false],[sid,-1,"activate",false],[sid,0,null,false],[sid,0,"other",false],[sid,0,"activate",null]]) {
      await expect(withCollectorClient(user,c => c.query("select * from app_private.collector_change($1,$2,$3,$4)",args))).rejects.toMatchObject({ code: "22023" });
    }
    await withCollectorClient(user,c => changeCollector(c,sid,0));
    await db.admin.query("update app_private.collector_state set version=2147483647 where user_id=$1",[user]);
    await expect(withCollectorClient(user,c => changeCollector(c,sid,2147483647,"deactivate"))).rejects.toMatchObject({ message: "COLLECTOR_VERSION_EXHAUSTED" });
    for (const version of [null,-1,0]) expect(await withCollectorClient(user,async c => (await c.query("select app_private.lock_active_collector($1,$2) as allowed",[sid,version])).rows[0].allowed)).toBe(false);
  });

  it("does not leak session secrets or allow direct runtime mutation", async () => {
    const user = await seedUser(db.admin);
    for (const role of ["app_api","app_session_bff","anon","authenticated","service_role"] as const) {
      await expect(asCoreRole(db.admin,role,user,() => db.admin.query("select * from app_private.collector_state"))).rejects.toMatchObject({ code: "42501" });
      for (const fn of ["collector_status(uuid)","collector_change(uuid,integer,text,boolean)","lock_active_collector(uuid,integer)"]) {
        expect((await db.admin.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,`app_private.${fn}`])).rows[0].allowed).toBe(role === "app_api");
      }
      expect((await db.admin.query("select has_function_privilege($1,'app_private.collector_session_valid(uuid,boolean)','EXECUTE') as allowed",[role])).rows[0].allowed).toBe(false);
    }
    await expect(asCoreRole(db.admin,"app_api",user,() => db.admin.query("select encrypted_refresh_token from app_private.auth_sessions"))).rejects.toMatchObject({ code: "42501" });
    const table = (await db.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app_private.collector_state'::regclass")).rows[0];
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const functions = await db.admin.query("select p.proconfig,r.rolsuper,r.rolbypassrls from pg_proc p join pg_roles r on p.proowner=r.oid where p.pronamespace='app_private'::regnamespace and p.proname like '%collector%'");
    expect(functions.rows).toHaveLength(4);
    for (const f of functions.rows) expect(f).toEqual({ proconfig: ['search_path=""'], rolsuper: false, rolbypassrls: true });
  });

  it("preserves lease on credential rotation and requires reactivation for a new session", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user), next = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,sid,0));
    await db.admin.query("update app_private.auth_sessions set rotation_version=rotation_version+1 where id=$1",[sid]);
    expect(await withCollectorClient(user,async c => (await c.query("select app_private.lock_active_collector($1,1) as allowed",[sid])).rows[0].allowed)).toBe(true);
    expect(await withCollectorClient(user,async c => (await c.query("select app_private.lock_active_collector($1,1) as allowed",[next])).rows[0].allowed)).toBe(false);
    await db.admin.query("delete from app_private.auth_sessions where id=$1",[sid]);
    expect((await db.admin.query("select active_session_id,version from app_private.collector_state where user_id=$1",[user])).rows[0]).toEqual({ active_session_id: null, version: 1 });
    expect(await withCollectorClient(user,c => changeCollector(c,next,1))).toEqual({ version: 2, state: "active_here" });
  });
});
