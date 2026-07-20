import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { AuthProviderError } = await import("./auth-provider-port.js");
const { FakeAuthProvider } = await import("./fake-auth-provider.js");

it("is explicit test-only configuration with deterministic call capture", async () => {
  const fake = new FakeAuthProvider();
  await expect(fake.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })).rejects.toBeInstanceOf(AuthProviderError);
  await fake.requestPasswordReset("person@example.test", new URL("https://app.example.test/recovery"), "A".repeat(43));
  expect(fake.calls.requestPasswordReset).toEqual([["person@example.test", expect.any(URL), "A".repeat(43)]]);
});

it("implements every provider operation only from explicit deterministic results", async () => {
  const fake = new FakeAuthProvider();
  const user = { id: "123e4567-e89b-12d3-a456-426614174001", email: "person@example.test", emailVerified: true };
  const pair = { accessToken: "access", refreshToken: "refresh", userId: user.id, supabaseSessionId: "123e4567-e89b-12d3-a456-426614174002", accessTokenExpiresAt: new Date(Date.now() + 60_000), user };
  fake.signUpResult = { status: "authenticated", tokens: pair };
  fake.signInResult = pair; fake.confirmationResult = pair; fake.oauthStartResult = { authorizationUrl: new URL("https://provider.example.test") };
  fake.oauthExchangeResult = pair; fake.refreshResult = pair; fake.recoveryResult = { accessToken: "access", refreshToken: "refresh", user };
  const codeChallenge = "A".repeat(43);
  const codeVerifier = "v".repeat(43);
  await fake.signUp({ email: user.email, password: "a".repeat(12) }, new URL("https://app.example.test/confirm"), codeChallenge);
  await fake.signInWithPassword({ email: user.email, password: "a".repeat(12) }); await fake.confirmEmail({ code: "code", codeVerifier });
  await fake.startOAuth({ provider: "google", redirectUrl: new URL("https://app.example.test/oauth"), codeChallenge }); await fake.exchangeOAuthCode({ code: "code", codeVerifier }); await fake.refresh("refresh");
  await fake.signOut("access", "refresh"); await fake.requestPasswordReset(user.email, new URL("https://app.example.test/recovery"), codeChallenge); await fake.exchangeRecoveryCode({ code: "code", codeVerifier }); await fake.updatePassword({ accessToken: "access", refreshToken: "refresh", userId: user.id, password: "b".repeat(12) });
  expect(Object.values(fake.calls).map((calls) => calls.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  expect(fake.calls.signUp[0]).toEqual([{ email: user.email, password: "a".repeat(12) }, expect.any(URL), codeChallenge]);
  expect(fake.calls.confirmEmail).toEqual([{ code: "code", codeVerifier }]);
  expect(fake.calls.exchangeOAuthCode).toEqual([{ code: "code", codeVerifier }]);
  expect(fake.calls.exchangeRecoveryCode).toEqual([{ code: "code", codeVerifier }]);
});
