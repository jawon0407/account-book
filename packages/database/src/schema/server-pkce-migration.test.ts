import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../../supabase/migrations/202607200002_server_pkce_transactions.sql", import.meta.url);

describe("server PKCE forward migration", () => {
  it("adds the dedicated confirmation table and auditable recovery stages", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/create table app_private\.email_confirmation_transactions/u);
    expect(sql).toMatch(/encrypted_pkce_verifier jsonb not null/u);
    expect(sql).toMatch(/alter column user_id drop not null/u);
    expect(sql).toMatch(/alter column encrypted_recovery_token drop not null/u);
    expect(sql).toMatch(/exchange_claimed_at timestamptz/u);
    expect(sql).toMatch(/exchanged_at timestamptz/u);
    expect(sql).toMatch(/password_update_claimed_at timestamptz/u);
    expect(sql).toMatch(/auth_recovery_transactions_stage/u);
    expect(sql).toMatch(/auth_recovery_transactions_stage_order/u);
  });

  it("tightens exact OAuth return paths and preserves private grants", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("return_path in ('/app', '/settings/security')");
    expect(sql).toMatch(/revoke all privileges on table app_private\.email_confirmation_transactions from public, anon, authenticated, service_role, app_session_bff/u);
    expect(sql).toMatch(/grant select, insert, update, delete on table app_private\.email_confirmation_transactions to app_session_bff/u);
    expect(sql).not.toMatch(/drop table|service_role_key|code_verifier text|state text|interaction_selector text/iu);
  });
});
