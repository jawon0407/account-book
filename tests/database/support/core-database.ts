import { readFile } from "node:fs/promises";
import { Client } from "pg";

const CONTROL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
export const CORE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_core_test";
export const EXISTING_USER = "11111111-1111-4111-8111-111111111111";
export type CoreDatabase = { admin: Client; close(): Promise<void> };
export type CoreRole = "app_api" | "app_session_bff" | "anon" | "authenticated" | "service_role";
export const CORE_MIGRATIONS = [
  "202609290001_identity_storage.sql", "202609290002_identity_access.sql",
  "202609290003_ledger_storage.sql", "202609290004_ledger_integrity.sql",
  "202609290005_ledger_access.sql",
  "202609300001_readable_schema_names.sql",
];

/**
 * 고정된 loopback 폐기용 DB에서만 독립 DB를 만든다. 기존 DB는 절대 덮어쓰지 않는다.
 * @param environment 테스트 URL/폐기 동의. hosted URI는 접속 전에 거부한다.
 * @param applyRename false면 업그레이드 검사용 기존 이름 상태를 만든다.
 * @returns 관리자 연결과 이번 호출이 생성한 DB만 정리하는 close 함수.
 */
export async function openCoreDatabase(environment: NodeJS.ProcessEnv = process.env, applyRename = true): Promise<CoreDatabase> {
  if (environment.TEST_DATABASE_URL !== CONTROL || environment.TEST_DATABASE_DISPOSABLE !== "true") {
    throw new Error("CORE_TEST_DATABASE_CONFIGURATION_INVALID");
  }
  const control = new Client({ connectionString: CONTROL });
  const admin = new Client({ connectionString: CORE_URL });
  let created = false;
  let ownerCreated = false;
  /** 이번 호출의 연결·DB·테스트 소유 역할만 정리한다. FORCE/drop-existing은 사용하지 않는다. */
  async function close(): Promise<void> {
    try {
      await admin.end();
      if (created) { await control.query("drop database account_book_core_test"); created = false; }
      if (ownerCreated) { await control.query("drop role app_core_test_owner"); ownerCreated = false; }
    } finally { await control.end(); }
  }
  try {
    await control.connect();
    await control.query("create database account_book_core_test");
    created = true;
    await control.query("create role app_core_test_owner nologin nosuperuser nocreatedb nocreaterole bypassrls");
    ownerCreated = true;
    await control.query("alter database account_book_core_test owner to app_core_test_owner");
    await admin.connect();
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$`);
    for (const name of ["202607200001_security_auth_foundation.sql", "202607230001_delegated_jwt_replay.sql"]) {
      await admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    // 관리형 postgres처럼 migration owner는 비슈퍼유저이지만 BYPASSRLS다. runtime에는 부여하지 않는다.
    await admin.query("set role app_core_test_owner");
    await admin.query(`create schema auth; create table auth.users (
      id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      created_at timestamptz not null default now());
      insert into auth.users(id,raw_app_meta_data) values('${EXISTING_USER}','{"provider":"email"}');`);
    for (const name of CORE_MIGRATIONS) {
      if (!applyRename && name === "202609300001_readable_schema_names.sql") continue;
      const sql = await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8")
        .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
      if (sql) await admin.query(sql);
    }
    await admin.query("reset role");
    return { admin, close };
  } catch (error) { await close(); throw error; }
}

/**
 * 실제 runtime 세션 주체와 transaction-local 사용자 문맥으로 SQL을 검사한다.
 * @param admin 관리자 연결. 동일 연결을 병렬 공유하지 않는다.
 * @param role 고정된 테스트 역할. @param userId 검증된 사용자 UUID 또는 문맥 없음.
 * @param operation 실행할 검사. @returns 결과. 성공/실패 모두 rollback하여 fixture 보존.
 */
export async function asCoreRole<T>(admin: Client, role: CoreRole, userId: string | undefined, operation: () => Promise<T>): Promise<T> {
  await admin.query(`set session authorization ${role}`);
  try {
    await admin.query("begin");
    if (userId !== undefined) await admin.query("select set_config('app.user_id',$1,true)", [userId]);
    return await operation();
  } finally { await admin.query("rollback"); await admin.query("reset session authorization"); }
}
