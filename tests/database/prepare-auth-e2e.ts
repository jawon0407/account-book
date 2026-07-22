import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const DISPOSABLE_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
const migrations = [
  "202607200001_security_auth_foundation.sql",
  "202607200002_server_pkce_transactions.sql",
  "202607200003_user_security_state.sql",
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
end
$$;
`;

type DatabaseAdmin = Readonly<{
  connect(): Promise<unknown>;
  query(sql: string): Promise<Readonly<{ rows: Array<Record<string, unknown>> }>>;
  end(): Promise<void>;
}>;

type CreateAdmin = (connectionString: string) => DatabaseAdmin;

const createPostgresAdmin: CreateAdmin = (connectionString) => new Client({ connectionString });

/**
 * Rebuilds only the exact local disposable authentication schema and applies every auth migration in order.
 * @param environment - Must contain the exact disposable flag and reviewed local test database URL.
 * @param createAdmin - Injectable PostgreSQL admin factory used by focused tests; production code uses `pg.Client`.
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
