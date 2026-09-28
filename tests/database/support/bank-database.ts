import { readFile } from "node:fs/promises";
import { Client } from "pg";

const TEST_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
const BANK_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_bank_test";
export type BankTestDatabase = { admin: Client; close(): Promise<void> };
export type BankTestRole = "app_api" | "app_session_bff" | "anon" | "authenticated" | "service_role";

/**
 * 고정된 로컬 폐기용 DB에서만 별도 은행 테스트 DB를 생성한다.
 * @param environment 테스트 전용 URL과 DISPOSABLE=true. 다른 환경은 연결 전 거부한다.
 * @returns 관리자 연결과 이 호출이 생성한 DB만 삭제하는 close 함수.
 * @throws 기존 은행 DB·잘못된 관리자·migration 오류. 기존 DB를 삭제/덮어쓰지 않는다.
 */
export async function openBankDatabase(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<BankTestDatabase> {
  if (environment.TEST_DATABASE_URL !== TEST_URL || environment.TEST_DATABASE_DISPOSABLE !== "true") {
    throw new Error("BANK_TEST_DATABASE_CONFIGURATION_INVALID");
  }
  const control = new Client({ connectionString: TEST_URL });
  const admin = new Client({ connectionString: BANK_URL });
  let created = false;
  /** @returns 모든 연결을 닫고 이번 호출이 만든 고정 DB만 삭제한다. FORCE 삭제는 사용하지 않는다. */
  async function close(): Promise<void> {
    try {
      await admin.end();
      if (created) {
        await control.query("drop database account_book_bank_test");
        created = false;
      }
    } finally {
      await control.end();
    }
  }
  try {
    await control.connect();
    const identity = await control.query("select current_user, current_database()");
    if (identity.rows[0]?.current_user !== "postgres" || identity.rows[0]?.current_database !== "account_book_test") {
      throw new Error("BANK_TEST_DATABASE_ADMIN_REQUIRED");
    }
    const existing = await control.query("select 1 from pg_database where datname = 'account_book_bank_test'");
    if (existing.rowCount !== 0) throw new Error("BANK_TEST_DATABASE_ALREADY_EXISTS");
    await control.query("create database account_book_bank_test");
    created = true;
    await admin.connect();
    await admin.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$`);
    for (const name of ["202607200001_security_auth_foundation.sql", "202607230001_delegated_jwt_replay.sql"]) {
      await admin.query(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    for (const name of ["202609280001_bank_connection_storage.sql", "202609280002_bank_connection_access.sql"]) {
      // RED에서 아직 없는 migration만 건너뛴다. 실제 테이블·권한 assertion은 반드시 실패해야 한다.
      const migration = await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8")
        .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
      if (migration) await admin.query(migration);
    }
    return { admin, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * 실제 DB 세션 주체를 고정 역할로 바꾸고 트랜잭션 안에만 사용자 문맥을 설정한다.
 * @param admin 테스트 관리자 연결. 병렬로 공유하지 않는다.
 * @param role 테스트에서 고정한 역할.
 * @param userId 사용자 UUID, undefined이면 문맥을 설정하지 않는다.
 * @param operation 해당 권한으로 실행하는 검사.
 * @returns 검사 결과. 성공/오류 모두 rollback 후 권한을 복원한다.
 */
export async function asBankRole<T>(admin: Client, role: BankTestRole, userId: string | undefined, operation: () => Promise<T>): Promise<T> {
  await admin.query(`set session authorization ${role}`);
  try {
    await admin.query("begin");
    if (userId !== undefined) await admin.query("select set_config('app.user_id', $1, true)", [userId]);
    return await operation();
  } finally {
    await admin.query("rollback");
    await admin.query("reset session authorization");
  }
}
