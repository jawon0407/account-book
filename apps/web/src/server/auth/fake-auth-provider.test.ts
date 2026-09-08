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
  const pair = { accessToken: "access", refreshToken: "refresh", userId: user.id, supabaseSessionId: "123e4567-e89b-12d3-a456-426614174002", issuedAtSeconds: Math.floor(Date.now() / 1000), accessTokenExpiresAt: new Date(Date.now() + 60_000), user };
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

const bridgeInput = { email: "verified@example.test", password: "correct horse battery staple" };
const bridgeUser = { id: "123e4567-e89b-42d3-a456-426614174001", email: bridgeInput.email, emailVerified: true };

/**
 * 현재보다 1초 전 발급되어 5분 수명을 갖는 정상 테스트 제공자 응답을 만듭니다. 실제 인증 토큰은 아닙니다.
 * @returns 검증된 사용자 형식과 가짜 토큰을 담은 캐시 금지 JSON Response.
 */
function validBridgeResponse(): Response {
  const issuedAtSeconds = Math.floor(Date.now() / 1000) - 1;
  return Response.json({
    accessToken: "signed-access-token",
    accessTokenExpiresAt: new Date((issuedAtSeconds + 300) * 1000).toISOString(),
    issuedAtSeconds,
    refreshToken: "opaque-refresh-token",
    supabaseSessionId: "123e4567-e89b-42d3-a456-426614174002",
    user: bridgeUser,
    userId: bridgeUser.id,
  }, { headers: { "Cache-Control": "no-store" } });
}

it("accepts one strict valid token pair from the explicit loopback bridge", async () => {
  const fetcher = vi.fn(async () => validBridgeResponse());
  const fake = new FakeAuthProvider({ tokenUrl: new URL("http://127.0.0.1:4510/token"), fetcher });
  const pair = await fake.signInWithPassword(bridgeInput);
  expect(pair).toMatchObject({ accessToken: "signed-access-token", refreshToken: "opaque-refresh-token", user: bridgeUser, userId: bridgeUser.id });
  expect(fetcher).toHaveBeenCalledWith(new URL("http://127.0.0.1:4510/token"), expect.objectContaining({ method: "POST", body: JSON.stringify(bridgeInput) }));
});

it("maps bridge 401 to one fixed invalid-credentials error", async () => {
  const fake = new FakeAuthProvider({ tokenUrl: new URL("http://127.0.0.1:4510/token"), fetcher: vi.fn(async () => Response.json({ provider: "detail-secret" }, { status: 401 })) });
  await expect(fake.signInWithPassword(bridgeInput)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", message: "AUTH_INVALID_CREDENTIALS" });
});

it.each([
  ["malformed pair", async () => Response.json({ accessToken: "provider-detail-secret" })],
  ["oversized response", async () => new Response("x".repeat(65_537), { status: 200, headers: { "Content-Type": "application/json" } })],
  ["fetch failure", async () => { throw new Error("provider-detail-secret"); }],
  ["timeout", async () => { throw new DOMException("provider-detail-secret", "AbortError"); }],
])("maps %s to one detail-free unavailable error", async (_name, fetcher) => {
  const fake = new FakeAuthProvider({ tokenUrl: new URL("http://127.0.0.1:4510/token"), fetcher });
  const error = await fake.signInWithPassword(bridgeInput).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", message: "AUTH_PROVIDER_UNAVAILABLE" });
  expect(JSON.stringify(error)).not.toContain("provider-detail-secret");
});
