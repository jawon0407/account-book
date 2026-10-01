import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asCoreRole, EXISTING_USER, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";

let db: CoreDatabase;
beforeAll(async () => { db = await openCoreDatabase(); });
afterAll(async () => { await db?.close(); });

describe("identity schema on real disposable PostgreSQL", () => {
  it("creates the three private identity tables", async () => {
    const r = await db.admin.query("select tablename from pg_tables where schemaname='user' order by tablename");
    expect(r.rows.map(row => row.tablename)).toEqual(["role_history", "roles", "users"]);
  });
  it("backfills the existing user without changing its Auth ID", async () => {
    const r = await db.admin.query("select p.signup_provider,p.deleted_at,r.role from \"user\".users p join \"user\".roles r using(user_id) where p.user_id=$1", [EXISTING_USER]);
    expect(r.rows).toEqual([{ signup_provider: "email", deleted_at: null, role: "member" }]);
  });
  it.each([["email", "email"], ["google", "google"], ["kakao", "kakao"], ["custom:naver", "naver"], [null, "unknown"], ["bogus", "unknown"]])("bootstraps authoritative provider %s as %s", async (provider, expected) => {
    const id = await seedUser(db.admin, provider, { role: "admin", signup_provider: "google", deleted_at: "2000-01-01", nickname: "injected" });
    const r = await db.admin.query("select p.signup_provider,p.nickname,p.deleted_at,r.role from \"user\".users p join \"user\".roles r using(user_id) where p.user_id=$1", [id]);
    expect(r.rows).toEqual([{ signup_provider: expected, nickname: null, deleted_at: null, role: "member" }]);
    const events = await db.admin.query("select previous_role,new_role,reason from \"user\".role_history where target_user_id=$1", [id]);
    expect(events.rows).toEqual([{ previous_role: null, new_role: "member", reason: "bootstrap" }]);
  });
  it("keeps the first provider when Auth identities change", async () => {
    const id = await seedUser(db.admin);
    await db.admin.query("update auth.users set raw_app_meta_data=$2 where id=$1", [id, { provider: "google", providers: ["email", "google"] }]);
    expect((await db.admin.query("select signup_provider from \"user\".users where user_id=$1", [id])).rows[0].signup_provider).toBe("email");
  });
  it("allows only own nickname update and advances version", async () => {
    const id = await seedUser(db.admin);
    await asCoreRole(db.admin, "app_api", id, async () => {
      const r = await db.admin.query("update \"user\".users set nickname='나' where user_id=$1 and version=1 returning nickname,version", [id]);
      expect(r.rows).toEqual([{ nickname: "나", version: "2" }]);
      expect((await db.admin.query("update \"user\".users set nickname='stale' where user_id=$1 and version=1", [id])).rowCount).toBe(0);
      expect((await db.admin.query("select user_id from \"user\".users where user_id=$1", [EXISTING_USER])).rowCount).toBe(0);
    });
  });
  it.each(["signup_provider='google'", "deleted_at=now()", "version=9", "created_at=now()", `user_id='${randomUUID()}'`])("rejects runtime protected update %s", async (set) => {
    await expect(asCoreRole(db.admin, "app_api", EXISTING_USER, () => db.admin.query(`update "user".users set ${set} where user_id=$1`, [EXISTING_USER]))).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["anon", "authenticated", "service_role", "app_session_bff"] as const)("denies %s direct identity access", async role => {
    await expect(asCoreRole(db.admin, role, EXISTING_USER, () => db.admin.query("select * from \"user\".users"))).rejects.toMatchObject({ code: "42501" });
  });
  it("denies runtime role changes, audit access and bootstrap invocation", async () => {
    for (const sql of ["update \"user\".roles set role='admin'", "select * from \"user\".role_history", "select \"user\".bootstrap_user()", "delete from \"user\".users", "insert into \"user\".users(user_id) values(gen_random_uuid())"]) {
      await expect(asCoreRole(db.admin, "app_api", EXISTING_USER, () => db.admin.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
  it.each(["", " ", "x".repeat(51), " padded "])("rejects malformed nickname length/spacing %#", async nickname => {
    await expect(db.admin.query("update \"user\".users set nickname=$1 where user_id=$2", [nickname, EXISTING_USER])).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["https://example.test/a.png", "other/a.png", `${EXISTING_USER}/../x`, `${EXISTING_USER}/a\\b`, `${EXISTING_USER}/`])("rejects unsafe avatar path %#", async path => {
    await expect(db.admin.query("update \"user\".users set avatar_object_key=$1 where user_id=$2", [path, EXISTING_USER])).rejects.toMatchObject({ code: "23514" });
  });
  it("accepts an owned avatar path and nullable profile fields", async () => {
    await db.admin.query("update \"user\".users set avatar_object_key=$1,nickname=null where user_id=$2", [`${EXISTING_USER}/profile.png`, EXISTING_USER]);
  });
  it("rejects nonfinite or predating deletion timestamps", async () => {
    for (const value of ["infinity", "2000-01-01"]) await expect(db.admin.query("update \"user\".users set deleted_at=$1 where user_id=$2", [value, EXISTING_USER])).rejects.toMatchObject({ code: "23514" });
  });
  it("hides profiles and roles without context or after soft deletion", async () => {
    const id = await seedUser(db.admin);
    await db.admin.query("update \"user\".users set deleted_at=clock_timestamp() where user_id=$1", [id]);
    for (const user of [undefined, id]) await asCoreRole(db.admin, "app_api", user, async () => {
      expect((await db.admin.query("select * from \"user\".users")).rowCount).toBe(0);
      expect((await db.admin.query("select * from \"user\".roles")).rowCount).toBe(0);
    });
  });
  it("audits owner role changes atomically with session actor", async () => {
    const id = await seedUser(db.admin);
    await db.admin.query("update \"user\".roles set role='admin' where user_id=$1", [id]);
    const r = await db.admin.query("select previous_role,new_role,reason,db_actor from \"user\".role_history where target_user_id=$1 and previous_role='member'", [id]);
    expect(r.rows).toEqual([{ previous_role: "member", new_role: "admin", reason: "role_change", db_actor: "postgres" }]);
  });
  it("preserves edited/deleted profile, admin role and audit history on backfill retry", async () => {
    const id = await seedUser(db.admin);
    await db.admin.query("update \"user\".users set nickname='기존 프로필',deleted_at=clock_timestamp() where user_id=$1", [id]);
    await db.admin.query("update \"user\".roles set role='admin' where user_id=$1", [id]);
    const beforeProfile = (await db.admin.query("select * from \"user\".users where user_id=$1", [id])).rows;
    const beforeEvents = (await db.admin.query("select * from \"user\".role_history where target_user_id=$1 order by id", [id])).rows;
    await db.admin.query("insert into \"user\".users(user_id,signup_provider) select id,'google' from auth.users where id=$1 on conflict(user_id) do nothing", [id]);
    await db.admin.query("insert into \"user\".roles(user_id) select id from auth.users where id=$1 on conflict(user_id) do nothing", [id]);
    expect((await db.admin.query("select * from \"user\".users where user_id=$1", [id])).rows).toEqual(beforeProfile);
    expect((await db.admin.query("select role from \"user\".roles where user_id=$1", [id])).rows).toEqual([{ role: "admin" }]);
    expect((await db.admin.query("select * from \"user\".role_history where target_user_id=$1 order by id", [id])).rows).toEqual(beforeEvents);
  });
  it("revokes PUBLIC execute for every core function", async () => {
    const r = await db.admin.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname in ('user','finance') and a.grantee=0 and a.privilege_type='EXECUTE'`);
    expect(r.rows).toEqual([]);
  });
  it("forces RLS on all new identity tables and keeps runtime non-owner", async () => {
    const r = await db.admin.query("select c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='user' and c.relkind='r'");
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every(row => row.relrowsecurity && row.relforcerowsecurity && row.owner !== "app_api")).toBe(true);
  });
});
