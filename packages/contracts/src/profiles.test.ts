import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";
import { DelegatedScopeSchema } from "./internal-api.js";

describe("profile public boundary", () => {
  it("normalizes the nickname without accepting client-owned identity fields", () => {
    expect(contracts.UpdateProfileInputSchema.parse({ nickname: "  라온  ", expectedVersion: 1 }))
      .toEqual({ nickname: "라온", expectedVersion: 1 });
    expect(contracts.UpdateProfileInputSchema.parse({ nickname: null, expectedVersion: 2 }).nickname).toBeNull();
  });
  it.each(["role", "userId", "signupProvider", "deletedAt", "avatarObjectKey"])("rejects protected %s", field => {
    expect(contracts.UpdateProfileInputSchema.safeParse({ nickname: "닉네임", expectedVersion: 1, [field]: "attacker" }).success).toBe(false);
  });
  it.each([
    { nickname: " ", expectedVersion: 1 }, { nickname: "가".repeat(51), expectedVersion: 1 },
    { expectedVersion: 1 }, { nickname: "가", expectedVersion: 0 }, { nickname: "가", expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects incomplete or out-of-range update %#", input => {
    expect(contracts.UpdateProfileInputSchema.safeParse(input).success).toBe(false);
  });
  it("validates only a minimal profile response and named scopes", () => {
    const profile = { id: "11111111-1111-4111-8111-111111111111", nickname: null, avatarObjectKey: null,
      signupProvider: "email", role: "member", version: 1, createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z" };
    expect(contracts.ProfileSchema.parse(profile)).toEqual(profile);
    expect(contracts.ProfileSchema.safeParse({ ...profile, token: "secret" }).success).toBe(false);
    expect(DelegatedScopeSchema.safeParse("profile:read").success).toBe(true);
    expect(DelegatedScopeSchema.safeParse("profile:write").success).toBe(true);
  });
  it.each(["PROFILE_VALIDATION_FAILED", "PROFILE_VERSION_CONFLICT", "LEDGER_SERVICE_UNAVAILABLE"] as const)("builds a fixed non-secret %s envelope", code => {
    const result = contracts.buildApiError({ code, retryable: false, message: "private SQL detail" });
    expect(result.code).toBe(code);
    expect(result.message).not.toContain("SQL");
  });
});
