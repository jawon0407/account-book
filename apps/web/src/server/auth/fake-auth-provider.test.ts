import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { AuthProviderError } = await import("./auth-provider-port.js");
const { FakeAuthProvider } = await import("./fake-auth-provider.js");

it("is explicit test-only configuration with deterministic call capture", async () => {
  const fake = new FakeAuthProvider();
  await expect(fake.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })).rejects.toBeInstanceOf(AuthProviderError);
  await fake.requestPasswordReset("person@example.test", new URL("https://app.example.test/recovery"));
  expect(fake.calls.requestPasswordReset).toEqual([["person@example.test", expect.any(URL)]]);
});

it("implements every provider operation only from explicit deterministic results", async () => {
  const fake = new FakeAuthProvider();
  const user = { id: "123e4567-e89b-12d3-a456-426614174001", email: "person@example.test", emailVerified: true };
  const pair = { accessToken: "access", refreshToken: "refresh", userId: user.id, supabaseSessionId: "123e4567-e89b-12d3-a456-426614174002", accessTokenExpiresAt: new Date(Date.now() + 60_000), user };
  fake.signUpResult = { status: "authenticated", tokens: pair };
  fake.signInResult = pair; fake.confirmationResult = pair; fake.oauthStartResult = { authorizationUrl: new URL("https://provider.example.test") };
  fake.oauthExchangeResult = pair; fake.refreshResult = pair; fake.recoveryResult = { accessToken: "access", refreshToken: "refresh", user };
  await fake.signUp({ email: user.email, password: "a".repeat(12) }, new URL("https://app.example.test/confirm"));
  await fake.signInWithPassword({ email: user.email, password: "a".repeat(12) }); await fake.confirmEmail({ code: "code" });
  await fake.startOAuth({ provider: "google", redirectUrl: new URL("https://app.example.test/oauth") }); await fake.exchangeOAuthCode({ code: "code" }); await fake.refresh("refresh");
  await fake.signOut("access", "refresh"); await fake.requestPasswordReset(user.email, new URL("https://app.example.test/recovery")); await fake.exchangeRecoveryCode({ code: "code" }); await fake.updatePassword({ accessToken: "access", refreshToken: "refresh", password: "b".repeat(12) });
  expect(Object.values(fake.calls).map((calls) => calls.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
});
