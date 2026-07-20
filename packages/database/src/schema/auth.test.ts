import { describe, expect, it } from "vitest";
import {
  authRateLimits,
  authRecoveryTransactions,
  authSessions,
  createDatabaseClient,
  oauthTransactions,
} from "../index.js";

describe("private authentication database schema", () => {
  it("exports the four app_private tables", () => {
    expect(authSessions[Symbol.for("drizzle:Name")]).toBe("auth_sessions");
    expect(oauthTransactions[Symbol.for("drizzle:Name")]).toBe("oauth_transactions");
    expect(authRecoveryTransactions[Symbol.for("drizzle:Name")]).toBe("auth_recovery_transactions");
    expect(authRateLimits[Symbol.for("drizzle:Name")]).toBe("auth_rate_limits");
  });

  it("rejects blank database connection strings", () => {
    expect(() => createDatabaseClient("   ")).toThrow("connectionString must not be blank");
  });
});
