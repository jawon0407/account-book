import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { authSessions } from "../index.js";

const databaseExports: Record<string, unknown> = await import("../index.js");
const apiJwtReplays = databaseExports.apiJwtReplays as typeof authSessions | undefined;
const migrationUrl = new URL(
  "../../../../supabase/migrations/202607230001_delegated_jwt_replay.sql",
  import.meta.url,
);

describe("delegated JWT replay schema", () => {
  it("exports one private replay table with digest-only columns", () => {
    expect(apiJwtReplays).toBeDefined();
    if (!apiJwtReplays) return;

    const config = getTableConfig(apiJwtReplays);
    const byName = Object.fromEntries(config.columns.map((column) => [column.name, column]));

    expect(config.schema).toBe("app_private");
    expect(config.name).toBe("api_jwt_replays");
    expect(Object.keys(byName)).toEqual(["jti_digest", "created_at", "expires_at"]);
    expect(byName.jti_digest?.getSQLType()).toBe("bytea");
    expect(byName.jti_digest?.primary).toBe(true);
    expect(byName.jti_digest?.notNull).toBe(true);
    expect(byName.created_at?.getSQLType()).toBe("timestamp with time zone");
    expect(byName.created_at?.notNull).toBe(true);
    expect(byName.created_at?.hasDefault).toBe(true);
    expect(byName.expires_at?.getSQLType()).toBe("timestamp with time zone");
    expect(byName.expires_at?.notNull).toBe(true);
    expect(byName.expires_at?.hasDefault).toBe(false);
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "api_jwt_replays_digest_length",
      "api_jwt_replays_expiry",
    ]);
  });

  it("defines a digest-only table and exact integrity checks in SQL", async () => {
    const migration = await readFile(migrationUrl, "utf8").catch(() => "");

    expect(migration).toMatch(/create table app_private\.api_jwt_replays\s*\(\s*jti_digest bytea primary key,\s*created_at timestamptz not null default now\(\),\s*expires_at timestamptz not null,/isu);
    expect(migration).toMatch(/api_jwt_replays_digest_length check \(octet_length\(jti_digest\) = 32\)/u);
    expect(migration).toMatch(/api_jwt_replays_expiry check \(expires_at > created_at\)/u);
    expect(migration).not.toMatch(/\b(raw_jti|compact_jwt|claims|request_binding|user_id|session_id|key_material)\b/iu);
  });

  it("creates a hardened login role with only schema usage and replay insert", async () => {
    const migration = await readFile(migrationUrl, "utf8").catch(() => "");

    expect(migration).toMatch(/create role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/iu);
    expect(migration).toMatch(/alter role app_api login nocreatedb nocreaterole noinherit/iu);
    expect(migration).toMatch(/revoke all privileges on schema app_private from app_api/iu);
    expect(migration).toMatch(/revoke all privileges on table app_private\.api_jwt_replays from public, anon, authenticated, service_role, app_session_bff, app_api/iu);
    expect(migration).toMatch(/grant usage on schema app_private to app_api/iu);
    expect(migration).toMatch(/grant insert on table app_private\.api_jwt_replays to app_api/iu);
    expect(migration).not.toMatch(/grant\s+(?:select|update|delete|truncate|references|trigger|create)[\s\S]*\bapp_api\b/iu);
    expect(migration).not.toMatch(/alter role app_api password|account-book-e2e-only|postgresql:\/\//iu);
  });

  it("registers one owner-run cleanup job only when pg_cron is available", async () => {
    const migration = await readFile(migrationUrl, "utf8").catch(() => "");

    expect(migration).toMatch(/if exists \(select 1 from pg_available_extensions where name = 'pg_cron'\)/iu);
    expect(migration.match(/\bcron\.schedule\s*\(/gu)).toHaveLength(1);
    expect(migration).toContain("'account-book-api-jwt-replay-cleanup'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain("'delete from app_private.api_jwt_replays where expires_at <= now()'");
    expect(migration).not.toMatch(/grant delete on table app_private\.api_jwt_replays to app_api/iu);
  });
});
