import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const DISPOSABLE_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
const migrations = [
  "202607200001_security_auth_foundation.sql",
  "202607200002_server_pkce_transactions.sql",
  "202607200003_user_security_state.sql",
  "202607230001_delegated_jwt_replay.sql",
] as const;

const prepareRoles = `
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    drop role anon;
  end if;
  create role anon nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    drop role authenticated;
  end if;
  create role authenticated nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    drop role service_role;
  end if;
  create role service_role nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

  if exists (select 1 from pg_roles where rolname = 'app_session_bff') then
    drop role app_session_bff;
  end if;
  create role app_session_bff nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

  if exists (select 1 from pg_roles where rolname = 'app_api') then
    drop role app_api;
  end if;
  create role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
end
$$;
`;

type DatabaseAdmin = Readonly<{
  connect(): Promise<unknown>;
  query(sql: string): Promise<Readonly<{ rows: Array<Record<string, unknown>> }>>;
  end(): Promise<void>;
}>;

type CreateAdmin = (connectionString: string) => DatabaseAdmin;

/**
 * 폐기용 DB 준비에 사용할 pg Client를 생성한다.
 * @param connectionString - prepareAuthE2e가 허용한 로컬 테스트 DB 접속 문자열이다.
 * @returns 아직 connect하지 않은 관리자 클라이언트. 실제 연결은 호출자가 시작한다.
 */
const createPostgresAdmin: CreateAdmin = (connectionString) => new Client({ connectionString });

/**
 * 정확히 지정된 폐기용 DB의 인증 schema·역할을 재생성하고 migration을 순서대로 적용한다.
 * @param environment - TEST_DATABASE_DISPOSABLE=true와 고정 로컬 TEST_DATABASE_URL이 필요하다.
 * @param createAdmin - DB 관리자 생성 함수. 기본 pg Client, 테스트에서는 대역을 주입한다.
 * @returns 준비 완료 Promise. 계정/DB 이름을 확인한 뒤 schema 삭제와 역할 재생성, 테스트 비밀번호 설정을 수행한다.
 * @throws 설정 불일치·postgres 소유자 불일치는 파괴적 작업 전에 거부한다. DB 오류를 전파하며 finally에서 연결을 닫는다.
 */
export async function prepareAuthE2e(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  createAdmin: CreateAdmin = createPostgresAdmin,
): Promise<void> {
  if (
    environment.TEST_DATABASE_DISPOSABLE !== "true" ||
    environment.TEST_DATABASE_URL !== DISPOSABLE_DATABASE_URL
  ) {
    throw new Error("E2E_DATABASE_CONFIGURATION_INVALID");
  }

  const admin = createAdmin(DISPOSABLE_DATABASE_URL);
  try {
    await admin.connect();
    const identity = await admin.query("select current_user, current_database()");
    const row = identity.rows[0];
    if (row?.current_user !== "postgres" || row.current_database !== "account_book_test") {
      throw new Error("E2E_DATABASE_ADMIN_REQUIRED");
    }

    await admin.query("drop schema if exists app_private cascade");
    await admin.query(prepareRoles);

    for (const migration of migrations) {
      const sql = await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), "utf8");
      await admin.query(sql);
    }
    await admin.query("alter role app_api password 'account-book-e2e-only'");
  } finally {
    await admin.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  prepareAuthE2e().catch(() => {
    process.stderr.write("[E2E_DATABASE_PREPARATION_FAILED]\n");
    process.exitCode = 1;
  });
}
