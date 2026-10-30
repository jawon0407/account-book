import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { CORE_MIGRATIONS, EXISTING_USER } from "./core-database.js";

const CONTROL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
export const CONSENT_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_consent_test";

/** @returns 새 폐기용 DB에 서버 동의 migration까지 적용한 테스트 경계. 운영 DB를 사용하지 않는다. */
export async function openNotificationConsentDatabase() {
  if (process.env.TEST_DATABASE_URL !== CONTROL || process.env.TEST_DATABASE_DISPOSABLE !== "true") throw new Error("CONSENT_TEST_DATABASE_CONFIGURATION_INVALID");
  const control = new Client({ connectionString: CONTROL }), admin = new Client({ connectionString: CONSENT_URL });
  let created = false, ownerCreated = false;
  /** 이번 호출에서 만든 DB/role만 정리한다. 기존 DB/role은 덮어쓰거나 제거하지 않는다. */
  async function close() {
    try {
      await admin.end();
      if (created) { await control.query("drop database account_book_consent_test"); created = false; }
      if (ownerCreated) { await control.query("drop role app_consent_test_owner"); ownerCreated = false; }
    } finally { await control.end(); }
  }
  try {
    await control.connect();
    const roles = (await control.query<{ rolname: string; rolcanlogin: boolean; unsafe: boolean }>(`select rolname,rolcanlogin,
      (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls or rolinherit
       or exists(select 1 from pg_auth_members where member=pg_roles.oid)) as unsafe
      from pg_roles where rolname in ('app_api','app_session_bff')`)).rows;
    if (roles.some(role => role.unsafe)) throw new Error("CONSENT_TEST_SHARED_ROLE_UNSAFE");
    await control.query("create database account_book_consent_test"); created = true;
    await control.query("create role app_consent_test_owner nologin nosuperuser nocreatedb nocreaterole bypassrls"); ownerCreated = true;
    await control.query("alter database account_book_consent_test owner to app_consent_test_owner"); await admin.connect();
    // 옛 migration의 전역 ALTER ROLE을 외부에 보이지 않는 transaction 안에서 실행하고 원상 복원한다.
    await admin.query("begin");
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$`);
    for (const name of ["202607200001_security_auth_foundation.sql","202607230001_delegated_jwt_replay.sql"]) await admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`,import.meta.url),"utf8"));
    await admin.query("set role app_consent_test_owner");
    await admin.query(`create schema auth; create table auth.users(id uuid primary key,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz not null default now()); insert into auth.users(id,raw_app_meta_data) values('${EXISTING_USER}','{"provider":"email"}')`);
    for (const name of CORE_MIGRATIONS) await admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`,import.meta.url),"utf8"));
    await admin.query("reset role");
    await admin.query(await readFile(new URL("../../../supabase/migrations/20261016040532_native_session_channel.sql",import.meta.url),"utf8"));
    await admin.query("grant usage,create on schema app_private to app_consent_test_owner; grant select,update,references on app_private.auth_sessions to app_consent_test_owner; set role app_consent_test_owner");
    for (const name of ["20261016053724_collector_lease.sql","20261021050645_notification_consent.sql"]) await admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`,import.meta.url),"utf8"));
    await admin.query("reset role");
    for (const role of roles) await admin.query(`alter role ${role.rolname} ${role.rolcanlogin ? "login" : "nologin"}`);
    await admin.query("commit"); return { admin, close };
  } catch (error) { await admin.query("rollback").catch(() => undefined); await close(); throw error; }
}

/** @param userId 합성 회원. @returns 동의 전용 DB의 API transaction. 호출자가 commit/rollback/end한다. */
export async function consentClient(userId: string): Promise<Client> {
  const client = new Client({ connectionString: CONSENT_URL }); await client.connect();
  await client.query("set session authorization app_api; begin; set local lock_timeout='3s'; set local statement_timeout='5s'");
  await client.query("select set_config('app.user_id',$1,true)",[userId]); return client;
}
/** @param userId 합성 회원. @param operation 동일 transaction 작업. @returns commit된 결과. */
export async function withConsentClient<T>(userId: string, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = await consentClient(userId);
  try { const result = await operation(client); await client.query("commit"); return result; }
  finally { await client.query("rollback"); await client.end(); }
}

/** @param client API 역할 transaction. @param sid 합성 세션. @param version 기대 버전. @param action 명시적 동의 또는 철회. */
export async function changeConsent(client: Client, sid: string, version: number, action = "accept") {
  return (await client.query("select * from app_private.notification_consent_change($1,$2,$3,$4)",
    [sid,version,action,action === "accept" ? "notification-access-v1" : null])).rows[0];
}

/** @param client API 역할 연결. @param sid 인증 세션. @param consent 동의 버전. @param lease 수집 지정 버전. @returns 같은 transaction 자동 기록 허용 여부. */
export async function collectionAllowed(client: Client, sid: string, consent = 1, lease = 1): Promise<boolean> {
  return (await client.query("select app_private.lock_notification_collector($1,$2,$3) as allowed", [sid,lease,consent])).rows[0].allowed;
}
