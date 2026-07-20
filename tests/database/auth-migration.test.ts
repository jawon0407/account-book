import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for database migration integration tests");
}

const migration = await readFile(
  new URL("../../supabase/migrations/202607200001_security_auth_foundation.sql", import.meta.url),
  "utf8",
);
const admin = new Client({ connectionString });
const privateTables = [
  "auth_sessions",
  "oauth_transactions",
  "auth_recovery_transactions",
  "auth_rate_limits",
] as const;
const hash = "\\x" + "11".repeat(32);
const hashTwo = "\\x" + "22".repeat(32);
const hashThree = "\\x" + "33".repeat(32);
const hashFour = "\\x" + "44".repeat(32);
const hashFive = "\\x" + "55".repeat(32);
const uuid = "11111111-1111-4111-8111-111111111111";
const uuidTwo = "22222222-2222-4222-8222-222222222222";

async function expectRoleDenied(role: string, query: string): Promise<void> {
  await admin.query(`set role ${role}`);
  try {
    await expect(admin.query(query)).rejects.toThrow(/permission denied/u);
  } finally {
    await admin.query("reset role");
  }
}

beforeAll(async () => {
  await admin.connect();
  await admin.query("drop schema if exists app_private cascade");
  await admin.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      if exists (select 1 from pg_roles where rolname = 'app_session_bff') then drop role app_session_bff; end if;
    end
    $$;
  `);
  await admin.query(migration);
});

afterAll(async () => {
  await admin.end();
});

describe("private authentication migration", () => {
  it("creates all private tables with their required columns", async () => {
    const result = await admin.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'app_private'
      order by table_name, ordinal_position
    `);
    const columns = new Map<string, Set<string>>();
    for (const row of result.rows) {
      const tableColumns = columns.get(row.table_name) ?? new Set<string>();
      tableColumns.add(row.column_name);
      columns.set(row.table_name, tableColumns);
    }

    const requiredColumns: Record<(typeof privateTables)[number], readonly string[]> = {
      auth_sessions: [
        "id", "selector_hash", "user_id", "supabase_session_id", "encrypted_access_token",
        "encrypted_refresh_token", "access_token_expires_at", "created_at", "last_seen_at",
        "absolute_expires_at", "revoked_at", "revocation_pending_at", "rotation_version",
      ],
      oauth_transactions: [
        "id", "state_hash", "interaction_hash", "provider", "encrypted_pkce_verifier",
        "return_path", "created_at", "expires_at", "consumed_at",
      ],
      auth_recovery_transactions: [
        "id", "interaction_hash", "user_id", "encrypted_recovery_token", "created_at",
        "expires_at", "consumed_at",
      ],
      auth_rate_limits: [
        "fingerprint", "kind", "window_started_at", "window_seconds", "count", "blocked_until",
      ],
    };

    for (const table of privateTables) {
      const tableColumns = columns.get(table);
      expect(tableColumns).toBeDefined();
      for (const column of requiredColumns[table]) expect(tableColumns).toContain(column);
    }
  });

  it("denies browser-facing roles table access", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await expectRoleDenied(role, "select * from app_private.auth_sessions");
    }
    const publicAccess = await admin.query<{ has_access: boolean }>(`
      select has_table_privilege('public', 'app_private.auth_sessions', 'select') as has_access
    `);
    expect(publicAccess.rows[0]?.has_access).toBe(false);
  });

  it("gives the BFF role only schema usage and table CRUD", async () => {
    const role = await admin.query<{
      rolcanlogin: boolean;
      schema_usage: boolean;
    }>(`
      select rolcanlogin,
        has_schema_privilege('app_session_bff', 'app_private', 'usage') as schema_usage
      from pg_roles where rolname = 'app_session_bff'
    `);
    expect(role.rows[0]).toMatchObject({
      rolcanlogin: false,
      schema_usage: true,
    });
    for (const table of privateTables) {
      const privileges = await admin.query<{
        select_access: boolean;
        insert_access: boolean;
        update_access: boolean;
        delete_access: boolean;
        truncate_access: boolean;
        references_access: boolean;
        trigger_access: boolean;
      }>(`
        select
          has_table_privilege('app_session_bff', 'app_private.${table}', 'select') as select_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'insert') as insert_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'update') as update_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'delete') as delete_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'truncate') as truncate_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'references') as references_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'trigger') as trigger_access
      `);
      expect(privileges.rows[0]).toEqual({
        select_access: true,
        insert_access: true,
        update_access: true,
        delete_access: true,
        truncate_access: false,
        references_access: false,
        trigger_access: false,
      });
    }
  });

  it("enforces session uniqueness and token length constraints", async () => {
    const row = [uuid, hash, uuid, uuidTwo, "{}", "{}", "2026-07-20T01:00:00Z", "2026-07-20T00:00:00Z", "2026-07-20T00:00:00Z", "2026-07-21T00:00:00Z"];
    await admin.query(`
      insert into app_private.auth_sessions (
        id, selector_hash, user_id, supabase_session_id, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, row);
    await expect(admin.query(`
      insert into app_private.auth_sessions (
        id, selector_hash, user_id, supabase_session_id, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at
      ) values ('33333333-3333-4333-8333-333333333333', $1, $2, '44444444-4444-4444-8444-444444444444', '{}', '{}', now(), now(), now(), now() + interval '1 day')
    `, [hash, uuid])).rejects.toThrow(/unique/u);
    await expect(admin.query(`
      insert into app_private.auth_sessions (
        id, selector_hash, user_id, supabase_session_id, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at
      ) values ('55555555-5555-4555-8555-555555555555', $1, $2, $3, '{}', '{}', now(), now(), now(), now() + interval '1 day')
    `, [hashTwo, uuid, uuidTwo])).rejects.toThrow(/unique/u);
    await expect(admin.query(`
      insert into app_private.auth_sessions (
        id, selector_hash, user_id, supabase_session_id, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at
      ) values ('66666666-6666-4666-8666-666666666666', $1, $2, '77777777-7777-4777-8777-777777777777', '{}', '{}', now(), now(), now(), now())
    `, [hashThree, uuid])).rejects.toThrow(/check/u);
    await expect(admin.query(`
      insert into app_private.auth_sessions (
        id, selector_hash, user_id, supabase_session_id, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at
      ) values ('77777777-7777-4777-8777-777777777777', '\\x11', $1, '88888888-8888-4888-8888-888888888888', '{}', '{}', now(), now(), now(), now() + interval '1 day')
    `, [uuid])).rejects.toThrow(/check/u);
  });

  it("enforces OAuth, recovery, and rate-limit integrity constraints", async () => {
    await admin.query(`
      insert into app_private.oauth_transactions (
        id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at
      ) values ($1, $2, $3, 'google', '{}', '/settings', now(), now() + interval '10 minutes')
    `, ["88888888-8888-4888-8888-888888888888", hash, hashTwo]);
    await admin.query(`
      insert into app_private.auth_recovery_transactions (
        id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at
      ) values ($1, $2, $3, '{}', now(), now() + interval '10 minutes')
    `, ["99999999-9999-4999-8999-999999999999", hashThree, uuid]);
    await admin.query(`
      insert into app_private.auth_rate_limits (
        fingerprint, kind, window_started_at, window_seconds, count
      ) values ($1, 'sign_in', now(), 60, 0)
    `, [hash]);

    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, $2, 'google', '{}', '/ok', now(), now() + interval '1 minute')`, ["\\x01", hashFour])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, '\\x01', 'google', '{}', '/ok', now(), now() + interval '1 minute')`, [hashFour])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, $2, 'github', '{}', '/ok', now(), now() + interval '1 minute')`, [hashFour, hashFive])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $1, $2, 'kakao', '{}', '//evil', now(), now() + interval '1 minute')`, [hashFour, hashFive])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', $1, $2, 'naver', '{}', '/ok', now(), now())`, [hashFour, hashFive])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_recovery_transactions (id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '\\x01', $1, '{}', now(), now() + interval '1 minute')`, [uuid])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ('\\x01', 'sign_up', now(), 60, 0)`)).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'unknown', now(), 60, 0)`, [hashTwo])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'sign_up', now(), 60, -1)`, [hashTwo])).rejects.toThrow(/check/u);
  });
});
