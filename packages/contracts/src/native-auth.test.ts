import { describe, expect, it } from "vitest";
const contracts = await import("./native-auth.js").catch(() => ({})) as Record<string, { safeParse(input: unknown): { success: boolean } }>;
const deviceId = "11111111-1111-4111-8111-111111111111";
describe("native auth contracts", () => {
  it("requires canonical device ID and excludes caller-selected channel/user", () => {
    expect(contracts.NativeSignInInputSchema).toBeDefined();
    const input = { email: "person@example.test", password: "synthetic-password", deviceId };
    expect(contracts.NativeSignInInputSchema!.safeParse(input).success).toBe(true);
    for (const invalid of [{ ...input, deviceId: "invalid" }, { ...input, userId: deviceId }, { ...input, clientChannel: "android" }, { ...input, password: "short" }]) {
      expect(contracts.NativeSignInInputSchema!.safeParse(invalid).success).toBe(false);
    }
  });
  it("returns only native opaque credentials and safe session metadata", () => {
    expect(contracts.NativeAuthResponseSchema).toBeDefined();
    const session = { authenticated: true, userId: deviceId, deviceId, refreshAt: "2026-10-16T00:00:00.000Z" };
    const input = { sessionToken: "A".repeat(43), session };
    expect(contracts.NativeAuthResponseSchema!.safeParse(input).success).toBe(true);
    for (const invalid of [{ ...input, accessToken: "provider-secret" }, { ...input, session: { ...session, refreshToken: "secret" } }, { ...input, sessionToken: "A".repeat(42) + "B" }]) {
      expect(contracts.NativeAuthResponseSchema!.safeParse(invalid).success).toBe(false);
    }
  });
});
