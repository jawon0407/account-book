import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreDatabase } from "./support/core-database.js";
import { seedUser } from "./support/core-fixtures.js";
import { changeCollector, seedCollectorSession } from "./support/collector-fixtures.js";
import { changeConsent, collectionAllowed, openNotificationConsentDatabase, withConsentClient as withCollectorClient } from "./support/notification-consent-fixtures.js";

const notice = { noticeVersion: "notification-access-v1" };
describe("private server notification consent", () => {
  let db: CoreDatabase;
  beforeAll(async () => { db = await openNotificationConsentDatabase(); });
  afterAll(async () => { await db?.close(); });
  it("isolates installations/accounts and preserves same-installation re-login", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user), otherDevice = await seedCollectorSession(db.admin,user);
    expect(await withCollectorClient(user,async c => (await c.query("select * from app_private.notification_consent_status($1)",[sid])).rows[0])).toEqual({ ...notice, version: 0, state: "not_granted" });
    expect(await withCollectorClient(user,c => changeConsent(c,sid,0))).toEqual({ ...notice, version: 1, state: "granted" });
    expect(await withCollectorClient(user,async c => (await c.query("select * from app_private.notification_consent_status($1)",[otherDevice])).rows[0])).toEqual({ ...notice, version: 0, state: "not_granted" });
    const relogin = await seedCollectorSession(db.admin,user);
    await db.admin.query("update app_private.auth_sessions set device_id=(select device_id from app_private.auth_sessions where id=$1) where id=$2",[sid,relogin]);
    expect(await withCollectorClient(user,async c => (await c.query("select * from app_private.notification_consent_status($1)",[relogin])).rows[0])).toEqual({ ...notice, version: 1, state: "granted" });
    const stranger = await seedUser(db.admin);
    await expect(withCollectorClient(stranger,c => changeConsent(c,sid,1,"withdraw"))).rejects.toMatchObject({ code: "28000" });
  });
  it("fences first-withdrawal, delayed accept, and old writes after reconsent", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,sid,0));
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid))).toBe(false);
    expect(await withCollectorClient(user,c => changeConsent(c,sid,0,"withdraw"))).toEqual({ ...notice, version: 1, state: "withdrawn" });
    await expect(withCollectorClient(user,c => changeConsent(c,sid,0))).rejects.toMatchObject({ message: "COLLECTOR_VERSION_CONFLICT" });
    await withCollectorClient(user,c => changeConsent(c,sid,1));
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid,2))).toBe(true);
    await withCollectorClient(user,c => changeConsent(c,sid,2,"withdraw"));
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid,2))).toBe(false);
    await withCollectorClient(user,c => changeConsent(c,sid,3));
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid,2))).toBe(false);
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid,4))).toBe(true);
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid,4,2))).toBe(false);
  });
  it("rejects web, revoked, pending and expired sessions", async () => {
    const user = await seedUser(db.admin);
    for (const mutation of ["web", "revoked_at=now()", "revocation_pending_at=now()", "access_token_expires_at=now()-interval '1 second'", "absolute_expires_at=now()-interval '1 second'"]) {
      const sid = await seedCollectorSession(db.admin,user,mutation === "web" ? "web" : "android");
      if (mutation !== "web") await db.admin.query(`update app_private.auth_sessions set ${mutation} where id=$1`,[sid]);
      await expect(withCollectorClient(user,c => changeConsent(c,sid,0))).rejects.toMatchObject({ code: "28000" });
      expect(await withCollectorClient(user,c => collectionAllowed(c,sid))).toBe(false);
    }
  });
  it("rejects old notice, invalid action/version, and unknown direct SQL arguments", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    for (const args of [[0,"accept","old"],[-1,"accept","notification-access-v1"],[null,"withdraw",null],[0,"unknown",null],[0,"withdraw","notification-access-v1"]]) {
      await expect(withCollectorClient(user,c => c.query("select * from app_private.notification_consent_change($1,$2,$3,$4)",[sid,...args]))).rejects.toMatchObject({ code: "22023" });
    }
  });
  it("fails closed for outdated stored notice and exhausted version", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeCollector(c,sid,0)); await withCollectorClient(user,c => changeConsent(c,sid,0));
    await db.admin.query("update app_private.notification_consent set notice_version='old' where user_id=$1",[user]);
    expect(await withCollectorClient(user,async c => (await c.query("select * from app_private.notification_consent_status($1)",[sid])).rows[0])).toEqual({ ...notice, version: 1, state: "outdated" });
    expect(await withCollectorClient(user,c => collectionAllowed(c,sid))).toBe(false);
    await db.admin.query("update app_private.notification_consent set version=2147483647 where user_id=$1",[user]);
    await expect(withCollectorClient(user,c => changeConsent(c,sid,2147483647))).rejects.toMatchObject({ message: "CONSENT_VERSION_EXHAUSTED" });
  });
  it("protects direct table/function access and records finite server timestamps", async () => {
    const user = await seedUser(db.admin), sid = await seedCollectorSession(db.admin,user);
    await withCollectorClient(user,c => changeConsent(c,sid,0));
    for (const role of ["anon","authenticated","service_role","app_session_bff","app_api"]) {
      expect((await db.admin.query("select has_table_privilege($1,'app_private.notification_consent','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed).toBe(false);
      expect((await db.admin.query("select has_function_privilege($1,'app_private.notification_consent_change(uuid,integer,text,text)','EXECUTE') as allowed",[role])).rows[0].allowed).toBe(role === "app_api");
    }
    const table = (await db.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app_private.notification_consent'::regclass")).rows[0];
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(withCollectorClient(user,c => c.query("select * from app_private.notification_consent"))).rejects.toMatchObject({ code: "42501" });
    const stored = (await db.admin.query("select accepted_at,withdrawn_at,updated_at from app_private.notification_consent where user_id=$1",[user])).rows[0];
    expect(stored.accepted_at).toBeInstanceOf(Date); expect(stored.withdrawn_at).toBeNull();
    await withCollectorClient(user,c => changeConsent(c,sid,1,"withdraw"));
    const withdrawn = (await db.admin.query("select accepted_at,withdrawn_at,updated_at from app_private.notification_consent where user_id=$1",[user])).rows[0];
    expect(withdrawn.accepted_at).toEqual(stored.accepted_at); expect(withdrawn.withdrawn_at).toBeInstanceOf(Date);
  });
});
