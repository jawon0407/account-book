import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString || process.env.TEST_DATABASE_DISPOSABLE !== "true") {
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_DISPOSABLE=true are required for disposable database migration tests");
}

const baseMigration = await readFile(
  new URL("../../supabase/migrations/202607200001_security_auth_foundation.sql", import.meta.url),
  "utf8",
);
const replayMigration = await readFile(
  new URL("../../supabase/migrations/202607230001_delegated_jwt_replay.sql", import.meta.url),
  "utf8",
);
const admin = new Client({ connectionString });
const privateTables = [
  "auth_sessions",
  "oauth_transactions",
  "auth_recovery_transactions",
  "auth_rate_limits",
] as const;
const browserRoles = ["anon", "authenticated", "service_role"] as const;
const hash = (byte: string) => `\\x${byte.repeat(32)}`;
const uuid = "11111111-1111-4111-8111-111111111111";
const uuidTwo = "22222222-2222-4222-8222-222222222222";

async function asRole(role: string, operation: () => Promise<void>): Promise<void> {
  await admin.query(`set role ${role}`);
  try {
    await operation();
  } finally {
    await admin.query("reset role");
  }
}

/**
 * Runs one live privilege assertion with `app_api` as the actual session authority.
 * @param operation - Database operation that must be authorized as `app_api`, not the postgres session user.
 * @returns Nothing after the operation and mandatory session-authorization reset complete.
 * @throws Propagates setup, operation, or reset failures after always attempting reset once authorization changed.
 */
async function asAppApiSessionAuthorization(operation: () => Promise<void>): Promise<void> {
  await admin.query("set session authorization app_api");
  try {
    await operation();
  } finally {
    await admin.query("reset session authorization");
  }
}

async function expectRoleDenied(role: string, table: (typeof privateTables)[number]): Promise<void> {
  await asRole(role, async () => {
    await expect(admin.query(`select * from app_private.${table}`)).rejects.toThrow(/permission denied/u);
  });
}

async function verifyPostgresOwner(): Promise<void> {
  const result = await admin.query<{ current_user: string }>("select current_user");
  if (result.rows[0]?.current_user !== "postgres") {
    throw new Error("TEST_DATABASE_URL must connect as postgres for disposable migration tests");
  }
}

beforeAll(async () => {
  await admin.connect();
  await verifyPostgresOwner();
  await admin.query("drop schema if exists app_private cascade");
  await admin.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      if exists (select 1 from pg_roles where rolname = 'app_api') then drop role app_api; end if;
      if exists (select 1 from pg_roles where rolname = 'app_session_bff') then drop role app_session_bff; end if;
      create role app_session_bff nologin;
      create role app_api login;
    end
    $$;
  `);
  await admin.query("grant app_session_bff to app_api");
  await admin.query("create schema app_private");
  await admin.query("create table app_private.preexisting_probe (id integer primary key)");
  await admin.query("grant all privileges on schema app_private to app_session_bff");
  await admin.query("grant all privileges on app_private.preexisting_probe to app_session_bff");
  await admin.query("alter default privileges for role postgres in schema app_private grant select on tables to app_session_bff");
  await admin.query(baseMigration);
  await admin.query(replayMigration);
  await verifyPostgresOwner();
  await admin.query("create table app_private.after_migration_probe (id integer primary key)");
});

afterAll(async () => {
  await admin.end();
});

describe("private authentication migration", () => {
  it("uses identifier-safe SQL to remove every direct app_api parent-role membership", () => {
    expect(replayMigration).toMatch(/from pg_auth_members memberships[\s\S]*join pg_roles parent_roles[\s\S]*join pg_roles member_roles[\s\S]*where member_roles\.rolname = 'app_api'/iu);
    expect(replayMigration).toMatch(/execute format\('revoke %I from app_api', parent_role\)/iu);
  });

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
      auth_sessions: ["id", "selector_hash", "user_id", "supabase_session_id", "encrypted_access_token", "encrypted_refresh_token", "access_token_expires_at", "created_at", "last_seen_at", "absolute_expires_at", "revoked_at", "revocation_pending_at", "rotation_version"],
      oauth_transactions: ["id", "state_hash", "interaction_hash", "provider", "encrypted_pkce_verifier", "return_path", "created_at", "expires_at", "consumed_at"],
      auth_recovery_transactions: ["id", "interaction_hash", "user_id", "encrypted_recovery_token", "created_at", "expires_at", "consumed_at"],
      auth_rate_limits: ["fingerprint", "kind", "window_started_at", "window_seconds", "count", "blocked_until"],
    };
    for (const table of privateTables) {
      const tableColumns = columns.get(table);
      expect(tableColumns).toBeDefined();
      for (const column of requiredColumns[table]) expect(tableColumns).toContain(column);
    }
  });

  it("denies every browser-facing role and PUBLIC table access", async () => {
    for (const role of browserRoles) {
      for (const table of privateTables) await expectRoleDenied(role, table);
    }
    const publicGrants = await admin.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
      where n.nspname = 'app_private'
        and c.relname in ('auth_sessions', 'oauth_transactions', 'auth_recovery_transactions', 'auth_rate_limits')
        and acl.grantee = 0
    `);
    expect(publicGrants.rows).toEqual([]);
  });

  it("removes existing BFF excess access and grants CRUD only to auth tables", async () => {
    const role = await admin.query<{ rolcanlogin: boolean; schema_usage: boolean; schema_create: boolean }>(`
      select rolcanlogin,
        has_schema_privilege('app_session_bff', 'app_private', 'usage') as schema_usage,
        has_schema_privilege('app_session_bff', 'app_private', 'create') as schema_create
      from pg_roles where rolname = 'app_session_bff'
    `);
    expect(role.rows[0]).toEqual({ rolcanlogin: false, schema_usage: true, schema_create: false });

    for (const table of privateTables) {
      const privileges = await admin.query<{ select_access: boolean; insert_access: boolean; update_access: boolean; delete_access: boolean; truncate_access: boolean; references_access: boolean; trigger_access: boolean }>(`
        select
          has_table_privilege('app_session_bff', 'app_private.${table}', 'select') as select_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'insert') as insert_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'update') as update_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'delete') as delete_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'truncate') as truncate_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'references') as references_access,
          has_table_privilege('app_session_bff', 'app_private.${table}', 'trigger') as trigger_access
      `);
      expect(privileges.rows[0]).toEqual({ select_access: true, insert_access: true, update_access: true, delete_access: true, truncate_access: false, references_access: false, trigger_access: false });
    }
    await asRole("app_session_bff", async () => {
      await expect(admin.query("select * from app_private.preexisting_probe")).rejects.toThrow(/permission denied/u);
      await expect(admin.query("select * from app_private.after_migration_probe")).rejects.toThrow(/permission denied/u);
      await expect(admin.query("create table app_private.bff_probe (id integer)")).rejects.toThrow(/permission denied/u);
    });
  });

  it("does not default-grant BFF access from the postgres migration owner", async () => {
    const defaultGrants = await admin.query<{ grant_count: number }>(`
      select count(*)::integer as grant_count
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) as acl
      where d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
        and d.defaclnamespace = (select oid from pg_namespace where nspname = 'app_private')
        and d.defaclobjtype = 'r'
        and acl.grantee = (select oid from pg_roles where rolname = 'app_session_bff')
    `);
    expect(defaultGrants.rows[0]?.grant_count).toBe(0);
  });

  it("allows app_api to consume one digest exactly once with no read, delete, auth, or DDL access", async () => {
    const role = await admin.query<{
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolsuper: boolean;
      schema_create: boolean;
      schema_usage: boolean;
    }>(`
      select
        rolbypassrls,
        rolcanlogin,
        rolcreatedb,
        rolcreaterole,
        rolinherit,
        rolreplication,
        rolsuper,
        has_schema_privilege('app_api', 'app_private', 'create') as schema_create,
        has_schema_privilege('app_api', 'app_private', 'usage') as schema_usage
      from pg_roles
      where rolname = 'app_api'
    `);
    expect(role.rows[0]).toEqual({
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolsuper: false,
      schema_create: false,
      schema_usage: true,
    });

    const privileges = await admin.query<{
      delete_access: boolean;
      insert_access: boolean;
      references_access: boolean;
      select_access: boolean;
      trigger_access: boolean;
      truncate_access: boolean;
      update_access: boolean;
    }>(`
      select
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'select') as select_access,
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'insert') as insert_access,
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'update') as update_access,
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'delete') as delete_access,
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'truncate') as truncate_access,
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'references') as references_access,
        has_table_privilege('app_api', 'app_private.api_jwt_replays', 'trigger') as trigger_access
    `);
    expect(privileges.rows[0]).toEqual({
      delete_access: false,
      insert_access: true,
      references_access: false,
      select_access: false,
      trigger_access: false,
      truncate_access: false,
      update_access: false,
    });

    await asRole("app_api", async () => {
      const digest = Buffer.alloc(32, 7);
      const first = await admin.query(
        "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now() + interval '45 seconds') on conflict do nothing",
        [digest],
      );
      const replay = await admin.query(
        "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now() + interval '45 seconds') on conflict do nothing",
        [digest],
      );
      expect(first.rowCount).toBe(1);
      expect(replay.rowCount).toBe(0);
      await expect(admin.query("select * from app_private.api_jwt_replays")).rejects.toThrow(/permission denied/u);
      await expect(admin.query("delete from app_private.api_jwt_replays")).rejects.toThrow(/permission denied/u);
      await expect(admin.query("select * from app_private.auth_sessions")).rejects.toThrow(/permission denied/u);
      await expect(admin.query("create table app_private.api_probe (id integer)")).rejects.toThrow(/permission denied/u);
    });
  });

  it("removes every preexisting direct parent-role membership from app_api", async () => {
    const memberships = await admin.query<{ parent_role: string }>(`
      select parent_roles.rolname as parent_role
      from pg_auth_members memberships
      join pg_roles parent_roles on parent_roles.oid = memberships.roleid
      join pg_roles member_roles on member_roles.oid = memberships.member
      where member_roles.rolname = 'app_api'
    `);
    expect(memberships.rows).toEqual([]);

    await asAppApiSessionAuthorization(async () => {
      await expect(admin.query("set role app_session_bff")).rejects.toThrow(/permission denied/u);
    });
  });

  it("enforces exact digest length and future expiry", async () => {
    await expect(admin.query(
      "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now() + interval '45 seconds')",
      [Buffer.alloc(31, 1)],
    )).rejects.toThrow(/check/u);
    await expect(admin.query(
      "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now())",
      [Buffer.alloc(32, 2)],
    )).rejects.toThrow(/check/u);
  });

  it("keeps replay data inaccessible to browser and BFF roles", async () => {
    for (const role of [...browserRoles, "app_session_bff"]) {
      await asRole(role, async () => {
        await expect(admin.query("select * from app_private.api_jwt_replays")).rejects.toThrow(/permission denied/u);
        await expect(admin.query(
          "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, now() + interval '45 seconds')",
          [Buffer.alloc(32, 3)],
        )).rejects.toThrow(/permission denied/u);
      });
    }
  });

  it("registers the single expected cleanup job when pg_cron is available", async () => {
    const extension = await admin.query<{ available: boolean }>(
      "select exists (select 1 from pg_available_extensions where name = 'pg_cron') as available",
    );
    if (!extension.rows[0]?.available) return;

    const jobs = await admin.query<{ command: string; jobname: string; schedule: string }>(`
      select jobname, schedule, command
      from cron.job
      where jobname = 'account-book-api-jwt-replay-cleanup'
    `);
    expect(jobs.rows).toEqual([{
      command: "delete from app_private.api_jwt_replays where expires_at <= now()",
      jobname: "account-book-api-jwt-replay-cleanup",
      schedule: "* * * * *",
    }]);
  });

  it("allows the BFF to perform CRUD on all four authentication tables", async () => {
    await asRole("app_session_bff", async () => {
      await admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at) values ('33333333-3333-4333-8333-333333333333', $1, $2, $3, '{}', '{}', now(), now(), now(), now() + interval '1 day')`, [hash("61"), uuid, uuidTwo]);
      await admin.query("select * from app_private.auth_sessions where id = '33333333-3333-4333-8333-333333333333'");
      await admin.query("update app_private.auth_sessions set last_seen_at = now() where id = '33333333-3333-4333-8333-333333333333'");
      await admin.query("delete from app_private.auth_sessions where id = '33333333-3333-4333-8333-333333333333'");

      await admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('44444444-4444-4444-8444-444444444444', $1, $2, 'google', '{}', '/settings', now(), now() + interval '1 minute')`, [hash("62"), hash("63")]);
      await admin.query("select * from app_private.oauth_transactions where id = '44444444-4444-4444-8444-444444444444'");
      await admin.query("update app_private.oauth_transactions set consumed_at = now() where id = '44444444-4444-4444-8444-444444444444'");
      await admin.query("delete from app_private.oauth_transactions where id = '44444444-4444-4444-8444-444444444444'");

      await admin.query(`insert into app_private.auth_recovery_transactions (id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at) values ('55555555-5555-4555-8555-555555555555', $1, $2, '{}', now(), now() + interval '1 minute')`, [hash("64"), uuid]);
      await admin.query("select * from app_private.auth_recovery_transactions where id = '55555555-5555-4555-8555-555555555555'");
      await admin.query("update app_private.auth_recovery_transactions set consumed_at = now() where id = '55555555-5555-4555-8555-555555555555'");
      await admin.query("delete from app_private.auth_recovery_transactions where id = '55555555-5555-4555-8555-555555555555'");

      await admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'sign_in', now(), 60, 0)", [hash("65")]);
      await admin.query("select * from app_private.auth_rate_limits where fingerprint = $1", [hash("65")]);
      await admin.query("update app_private.auth_rate_limits set count = 1 where fingerprint = $1", [hash("65")]);
      await admin.query("delete from app_private.auth_rate_limits where fingerprint = $1", [hash("65")]);
    });
  });

  it("enforces session uniqueness, active provider-session uniqueness, and selector length", async () => {
    await admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at) values ('66666666-6666-4666-8666-666666666666', $1, $2, $3, '{}', '{}', now(), now(), now(), now() + interval '1 day')`, [hash("11"), uuid, uuidTwo]);
    await expect(admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at) values ('77777777-7777-4777-8777-777777777777', $1, $2, '88888888-8888-4888-8888-888888888888', '{}', '{}', now(), now(), now(), now() + interval '1 day')`, [hash("11"), uuid])).rejects.toThrow(/unique/u);
    await expect(admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at) values ('88888888-8888-4888-8888-888888888888', $1, $2, $3, '{}', '{}', now(), now(), now(), now() + interval '1 day')`, [hash("12"), uuid, uuidTwo])).rejects.toThrow(/unique/u);
    await expect(admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at) values ('99999999-9999-4999-8999-999999999999', '\\x11', $1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}', '{}', now(), now(), now(), now() + interval '1 day')`, [uuid])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, $2, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}', '{}', now(), now(), now(), now())`, [hash("13"), uuid])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_sessions (id, selector_hash, user_id, supabase_session_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, created_at, last_seen_at, absolute_expires_at, rotation_version) values ('abababab-abab-4bab-8bab-abababababab', $1, $2, 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', '{}', '{}', now(), now(), now(), now() + interval '1 day', -1)`, [hash("14"), uuid])).rejects.toThrow(/check/u);
  });

  it("enforces OAuth and recovery transaction integrity", async () => {
    await admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, $2, 'google', '{}', '/settings', now(), now() + interval '10 minutes')`, [hash("21"), hash("22")]);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, $2, 'google', '{}', '/ok', now(), now() + interval '1 minute')`, [hash("21"), hash("23")])).rejects.toThrow(/unique/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $1, $2, 'google', '{}', '/ok', now(), now() + interval '1 minute')`, [hash("24"), hash("22")])).rejects.toThrow(/unique/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '\\x01', $1, 'google', '{}', '/ok', now(), now() + interval '1 minute')`, [hash("25")])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', $1, '\\x01', 'google', '{}', '/ok', now(), now() + interval '1 minute')`, [hash("26")])).rejects.toThrow(/check/u);
    for (const [id, returnPath] of [
      ["10101010-1010-4010-8010-101010101010", ""],
      ["11111111-1111-4111-8111-111111111111", "//evil.example"],
      ["18181818-1818-4818-8818-181818181818", "/\\evil.example"],
      ["19191919-1919-4919-8919-191919191919", "https://evil.example"],
      ["1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a", `/${"a".repeat(2048)}`],
    ]) {
      await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ($1, $2, $3, 'google', '{}', $4, now(), now() + interval '1 minute')`, [id, hash("27"), hash("28"), returnPath])).rejects.toThrow(/check/u);
    }
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('12121212-1212-4212-8212-121212121212', $1, $2, 'github', '{}', '/ok', now(), now() + interval '1 minute')`, [hash("29"), hash("2a")])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.oauth_transactions (id, state_hash, interaction_hash, provider, encrypted_pkce_verifier, return_path, created_at, expires_at) values ('13131313-1313-4313-8313-131313131313', $1, $2, 'naver', '{}', '/ok', now(), now())`, [hash("2b"), hash("2c")])).rejects.toThrow(/check/u);

    await admin.query(`insert into app_private.auth_recovery_transactions (id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at) values ('14141414-1414-4414-8414-141414141414', $1, $2, '{}', now(), now() + interval '10 minutes')`, [hash("31"), uuid]);
    await expect(admin.query(`insert into app_private.auth_recovery_transactions (id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at) values ('15151515-1515-4515-8515-151515151515', $1, $2, '{}', now(), now() + interval '10 minutes')`, [hash("31"), uuid])).rejects.toThrow(/unique/u);
    await expect(admin.query(`insert into app_private.auth_recovery_transactions (id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at) values ('16161616-1616-4616-8616-161616161616', '\\x01', $1, '{}', now(), now() + interval '10 minutes')`, [uuid])).rejects.toThrow(/check/u);
    await expect(admin.query(`insert into app_private.auth_recovery_transactions (id, interaction_hash, user_id, encrypted_recovery_token, created_at, expires_at) values ('17171717-1717-4717-8717-171717171717', $1, $2, '{}', now(), now())`, [hash("32"), uuid])).rejects.toThrow(/check/u);
  });

  it("enforces rate-limit fingerprint, kind, window, and count checks", async () => {
    await admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'sign_in', '2026-07-20T00:00:00Z', 60, 0)", [hash("41")]);
    await expect(admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'sign_in', '2026-07-20T00:00:00Z', 60, 0)", [hash("41")])).rejects.toThrow(/unique/u);
    await expect(admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ('\\x01', 'sign_up', now(), 60, 0)")).rejects.toThrow(/check/u);
    await expect(admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'unknown', now(), 60, 0)", [hash("42")])).rejects.toThrow(/check/u);
    for (const seconds of [0, -1]) {
      await expect(admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'sign_up', now(), $2, 0)", [hash("43"), seconds])).rejects.toThrow(/check/u);
    }
    await expect(admin.query("insert into app_private.auth_rate_limits (fingerprint, kind, window_started_at, window_seconds, count) values ($1, 'sign_up', now(), 60, -1)", [hash("44")])).rejects.toThrow(/check/u);
  });
});
