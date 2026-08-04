import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const modulePath = "./prepare-auth-e2e.js";
const loaded = await import(modulePath).catch(() => ({} as Record<string, unknown>));
type Admin = Readonly<{
  connect(): Promise<void>;
  query(sql: string): Promise<Readonly<{ rows: Array<Record<string, unknown>> }>>;
  end(): Promise<void>;
}>;
type Prepare = (
  environment: Readonly<Record<string, string | undefined>>,
  createAdmin: (connectionString: string) => Admin,
) => Promise<void>;
const prepareAuthE2e = loaded.prepareAuthE2e as Prepare | undefined;
const exactEnvironment = {
  TEST_DATABASE_DISPOSABLE: "true",
  TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test",
} as const;

function fakeAdmin(user = "postgres") {
  const queries: string[] = [];
  const admin: Admin = {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: sql.includes("current_user") ? [{ current_database: "account_book_test", current_user: user }] : [] };
    }),
    end: vi.fn(async () => undefined),
  };
  return { admin, queries };
}

describe("disposable authentication E2E database preparation", () => {
  it("exports the preparation boundary", () => {
    expect(prepareAuthE2e).toBeTypeOf("function");
  });

  it.each([
    [{ TEST_DATABASE_URL: exactEnvironment.TEST_DATABASE_URL }],
    [{ ...exactEnvironment, TEST_DATABASE_DISPOSABLE: "TRUE" }],
    [{ ...exactEnvironment, TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/account_book_test" }],
    [{ ...exactEnvironment, TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" }],
    [{ ...exactEnvironment, TEST_DATABASE_URL: "postgresql://app:postgres@127.0.0.1:5432/account_book_test" }],
  ])("rejects a non-exact disposable environment before connecting %#", async (environment) => {
    const createAdmin = vi.fn(() => fakeAdmin().admin);
    await expect(prepareAuthE2e!(environment, createAdmin)).rejects.toThrow("E2E_DATABASE_CONFIGURATION_INVALID");
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("verifies postgres ownership before any destructive statement and always closes", async () => {
    const { admin, queries } = fakeAdmin("app_session_bff");
    await expect(prepareAuthE2e!(exactEnvironment, () => admin)).rejects.toThrow("E2E_DATABASE_ADMIN_REQUIRED");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/current_user/u);
    expect(admin.end).toHaveBeenCalledOnce();
  });

  it("recreates roles/schema, applies migrations 001 through 004 in order, then sets the disposable password", async () => {
    const { admin, queries } = fakeAdmin();
    await prepareAuthE2e!(exactEnvironment, () => admin);
    const migrationFiles = [
      "202607200001_security_auth_foundation.sql",
      "202607200002_server_pkce_transactions.sql",
      "202607200003_user_security_state.sql",
      "202607230001_delegated_jwt_replay.sql",
    ];
    const migrations = await Promise.all(migrationFiles.map((name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8")));
    expect(queries[0]).toMatch(/current_user/u);
    expect(queries[1]).toMatch(/drop schema if exists app_private cascade/iu);
    expect(queries[2]).toMatch(/anon.*authenticated.*service_role.*app_session_bff.*app_api/isu);
    for (const role of ["anon", "authenticated", "service_role", "app_session_bff", "app_api"]) {
      expect(queries[2]).toMatch(new RegExp(`drop role ${role}.*create role ${role}`, "isu"));
    }
    expect(queries.slice(-5, -1)).toEqual(migrations);
    expect(queries.at(-1)).toBe("alter role app_api password 'account-book-e2e-only'");
    expect(admin.end).toHaveBeenCalledOnce();
  });
});
