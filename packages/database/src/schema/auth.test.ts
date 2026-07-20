import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  authRateLimits,
  authRecoveryTransactions,
  authSessions,
  createDatabaseClient,
  emailConfirmationTransactions,
  oauthTransactions,
} from "../index.js";

describe("private authentication database schema", () => {
  it("exports the five app_private tables", () => {
    expect(authSessions[Symbol.for("drizzle:Name")]).toBe("auth_sessions");
    expect(oauthTransactions[Symbol.for("drizzle:Name")]).toBe("oauth_transactions");
    expect(authRecoveryTransactions[Symbol.for("drizzle:Name")]).toBe("auth_recovery_transactions");
    expect(emailConfirmationTransactions[Symbol.for("drizzle:Name")]).toBe("email_confirmation_transactions");
    expect(authRateLimits[Symbol.for("drizzle:Name")]).toBe("auth_rate_limits");
  });

  it("models nullable recovery stages and explicit claim timestamps", () => {
    const columns = getTableConfig(authRecoveryTransactions).columns;
    const byName = Object.fromEntries(columns.map((column) => [column.name, column]));
    expect(byName.user_id?.notNull).toBe(false);
    expect(byName.encrypted_recovery_token?.notNull).toBe(false);
    expect(byName.encrypted_pkce_verifier?.notNull).toBe(false);
    expect(byName.exchange_claimed_at).toBeDefined();
    expect(byName.exchanged_at).toBeDefined();
    expect(byName.password_update_claimed_at).toBeDefined();
  });

  it("constrains OAuth return paths and all staged recovery shapes", () => {
    const oauthChecks = getTableConfig(oauthTransactions).checks.map((constraint) => constraint.name);
    const recoveryChecks = getTableConfig(authRecoveryTransactions).checks.map((constraint) => constraint.name);
    expect(oauthChecks).toContain("oauth_transactions_return_path");
    expect(recoveryChecks).toContain("auth_recovery_transactions_stage");
    expect(recoveryChecks).toContain("auth_recovery_transactions_stage_order");
  });

  it("rejects blank database connection strings", () => {
    expect(() => createDatabaseClient("   ")).toThrow("connectionString must not be blank");
  });
});
