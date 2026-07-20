import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { SupabaseAuthAdapter } = await import("./supabase-auth-adapter.js");
const { AuthProviderError } = await import("./auth-provider-port.js");

const nowSeconds = Math.floor(Date.now() / 1000) + 3600;
const userId = "123e4567-e89b-12d3-a456-426614174001";
const sessionId = "123e4567-e89b-12d3-a456-426614174002";
const verifier = "v".repeat(43);
const challenge = "A".repeat(43);

function jwt(claims: Record<string, unknown> = {}) {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ session_id: sessionId, sub: userId, exp: nowSeconds, ...claims })).toString("base64url")}.${Buffer.from("signature").toString("base64url")}`;
}

const accessToken = jwt();
const session = {
  access_token: accessToken,
  refresh_token: "refresh-token",
  expires_at: nowSeconds,
  user: { id: userId, email: "person@example.test", email_confirmed_at: "2026-07-20T00:00:00.000Z" },
};
const ok = (data: unknown) => ({ data, error: null });

function client(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(async () => ok({ session })),
    exchangeCodeForSession: vi.fn(),
    signInWithOAuth: vi.fn(),
    refreshSession: vi.fn(async () => ok({ session })),
    setSession: vi.fn(async () => ok({ session })),
    signOut: vi.fn(async () => ({ data: null, error: null })),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(async () => ok({ user: session.user })),
    ...overrides,
  };
  return { auth };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function adapter(responses: Response[] = [], sdk = client()) {
  const factory = vi.fn(() => sdk);
  const fetcher = vi.fn<typeof fetch>(async () => responses.shift() ?? jsonResponse({}));
  return {
    sdk,
    factory,
    fetcher,
    adapter: new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, factory, fetcher),
  };
}

function request(setup: ReturnType<typeof adapter>, index: number) {
  const call = setup.fetcher.mock.calls[index];
  expect(call).toBeDefined();
  return { url: String(call?.[0]), init: call?.[1] as RequestInit };
}

function expectSafeError(action: () => Promise<unknown>, code: string, ...secrets: string[]) {
  return expect(action()).rejects.toSatisfy((error: unknown) =>
    error instanceof AuthProviderError && error.code === code && secrets.every((secret) => !error.message.includes(secret)),
  );
}

describe("SupabaseAuthAdapter explicit server PKCE boundary", () => {
  it.each([
    ["google", "google"],
    ["kakao", "kakao"],
    ["naver", "custom%3Anaver"],
  ] as const)("maps %s to only its approved authorize provider id", async (provider, providerId) => {
    const setup = adapter();
    const result = await setup.adapter.startOAuth({
      provider,
      redirectUrl: new URL("https://app.example.test/auth/oauth?provider=google&state=opaque-state"),
      codeChallenge: challenge,
    });

    expect(result.authorizationUrl.toString()).toBe(
      `https://project.supabase.co/auth/v1/authorize?provider=${providerId}&redirect_to=https%3A%2F%2Fapp.example.test%2Fauth%2Foauth%3Fprovider%3Dgoogle%26state%3Dopaque-state&code_challenge=${challenge}&code_challenge_method=s256`,
    );
    expect(setup.factory).not.toHaveBeenCalled();
    expect(setup.fetcher).not.toHaveBeenCalled();
  });

  it("posts signup, token exchange, and recovery requests with exact server-set inputs", async () => {
    const setup = adapter([jsonResponse({ user: { id: userId } }), jsonResponse(session), jsonResponse(session), jsonResponse({}), jsonResponse(session)]);
    const confirmationUrl = new URL("https://app.example.test/auth/confirm");
    const recoveryUrl = new URL("https://app.example.test/auth/recovery");

    await expect(setup.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, confirmationUrl, challenge)).resolves.toEqual({ status: "verification_required" });
    await setup.adapter.confirmEmail({ code: "confirmation-code", codeVerifier: verifier });
    await setup.adapter.exchangeOAuthCode({ code: "oauth-code", codeVerifier: verifier });
    await setup.adapter.requestPasswordReset("person@example.test", recoveryUrl, challenge);
    await setup.adapter.exchangeRecoveryCode({ code: "recovery-code", codeVerifier: verifier });

    expect(request(setup, 0)).toEqual({
      url: "https://project.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fapp.example.test%2Fauth%2Fconfirm",
      init: expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "person@example.test", password: "a".repeat(12), code_challenge: challenge, code_challenge_method: "s256" }) }),
    });
    for (const index of [1, 2, 4]) {
      expect(request(setup, index).url).toBe("https://project.supabase.co/auth/v1/token?grant_type=pkce");
    }
    expect(JSON.parse(String(request(setup, 1).init.body))).toEqual({ auth_code: "confirmation-code", code_verifier: verifier });
    expect(JSON.parse(String(request(setup, 2).init.body))).toEqual({ auth_code: "oauth-code", code_verifier: verifier });
    expect(request(setup, 3)).toEqual({
      url: "https://project.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.example.test%2Fauth%2Frecovery",
      init: expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "person@example.test", code_challenge: challenge, code_challenge_method: "s256" }) }),
    });
    expect(JSON.parse(String(request(setup, 4).init.body))).toEqual({ auth_code: "recovery-code", code_verifier: verifier });
    for (let index = 0; index < 5; index += 1) {
      expect(request(setup, index).init.headers).toEqual({
        Accept: "application/json",
        Authorization: "Bearer anon-key",
        "Content-Type": "application/json",
        apikey: "anon-key",
      });
    }
    expect(setup.factory).not.toHaveBeenCalled();
    for (const method of ["signUp", "exchangeCodeForSession", "signInWithOAuth", "resetPasswordForEmail"] as const) {
      expect(setup.sdk.auth[method]).not.toHaveBeenCalled();
    }
  });

  it("returns validated provider sessions from every direct PKCE exchange", async () => {
    const setup = adapter([jsonResponse(session), jsonResponse(session), jsonResponse(session)]);
    await expect(setup.adapter.confirmEmail({ code: "code", codeVerifier: verifier })).resolves.toMatchObject({ userId, supabaseSessionId: sessionId });
    await expect(setup.adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier })).resolves.toMatchObject({ userId, supabaseSessionId: sessionId });
    await expect(setup.adapter.exchangeRecoveryCode({ code: "code", codeVerifier: verifier })).resolves.toMatchObject({ user: { id: userId, emailVerified: true } });
  });

  it("keeps SDK calls request-scoped and non-persistent for non-PKCE operations", async () => {
    const setup = adapter();
    await setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) });
    await setup.adapter.refresh("refresh-token");
    await setup.adapter.signOut(accessToken, "refresh-token");
    await setup.adapter.updatePassword({ accessToken, refreshToken: "refresh-token", userId, password: "b".repeat(12) });

    expect(setup.factory).toHaveBeenCalledTimes(4);
    for (const call of setup.factory.mock.calls) {
      expect(call).toEqual(["https://project.supabase.co/", "anon-key", { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" }]);
    }
  });

  it.each([
    { body: { code: "bad_code_verifier", message: "secret provider text" }, status: 400, expected: "AUTH_OAUTH_TRANSACTION_INVALID" },
    { body: { code: "over_request_rate_limit" }, status: 429, expected: "AUTH_RATE_LIMITED" },
    { body: { code: "unexpected" }, status: 503, expected: "AUTH_PROVIDER_UNAVAILABLE" },
  ])("maps PKCE HTTP failures to fixed safe errors", async ({ body, status, expected }) => {
    const setup = adapter([jsonResponse(body, status)]);
    await expectSafeError(() => setup.adapter.exchangeOAuthCode({ code: "secret-code", codeVerifier: verifier }), expected, "secret-code", verifier, "secret provider text");
  });

  it.each(["user_already_exists", "email_exists", "user_already_registered", "email_already_exists"])(
    "preserves the signup acknowledgement for provider existence code %s",
    async (code) => {
      const setup = adapter([jsonResponse({ code, message: "hostile" }, 400)]);
      await expect(setup.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"), challenge)).resolves.toEqual({ status: "verification_required" });
    },
  );

  it.each(["user_not_found", "email_not_found", "user_not_exist", "email_not_exists"])(
    "preserves the recovery acknowledgement for absent-account code %s",
    async (code) => {
      const setup = adapter([jsonResponse({ code, message: "hostile" }, 400)]);
      await expect(setup.adapter.requestPasswordReset("absent@example.test", new URL("https://app.example.test/recovery"), challenge)).resolves.toBeUndefined();
    },
  );

  it("rejects malformed HTTP JSON and incomplete token material", async () => {
    const malformedJson = new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
    await expectSafeError(() => adapter([malformedJson]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_PROVIDER_UNAVAILABLE");
    await expectSafeError(() => adapter([jsonResponse({ ...session, refresh_token: "" })]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_PROVIDER_UNAVAILABLE", accessToken);
    await expectSafeError(() => adapter([jsonResponse([])]).adapter.requestPasswordReset("person@example.test", new URL("https://app.example.test/recovery"), challenge), "AUTH_PROVIDER_UNAVAILABLE");
  });

  it("rejects unsafe configuration, redirects, challenges, verifiers, and providers before side effects", async () => {
    expect(() => new SupabaseAuthAdapter({ url: "http://public.example.test", anonKey: "anon-key" })).toThrow(AuthProviderError);
    expect(() => new SupabaseAuthAdapter({ url: "https://project.supabase.co/path", anonKey: "anon-key" })).toThrow(AuthProviderError);
    expect(() => new SupabaseAuthAdapter({ url: "https://project.supabase.co?secret=1", anonKey: "anon-key" })).toThrow(AuthProviderError);
    const setup = adapter();
    await expectSafeError(() => setup.adapter.startOAuth({ provider: "github" as never, redirectUrl: new URL("https://app.example.test/oauth"), codeChallenge: challenge }), "AUTH_OAUTH_TRANSACTION_INVALID");
    await expectSafeError(() => setup.adapter.startOAuth({ provider: "google", redirectUrl: new URL("http://public.example.test/oauth"), codeChallenge: challenge }), "AUTH_PROVIDER_UNAVAILABLE");
    await expectSafeError(() => setup.adapter.startOAuth({ provider: "google", redirectUrl: new URL("https://app.example.test/oauth"), codeChallenge: "bad" }), "AUTH_PROVIDER_UNAVAILABLE");
    await expectSafeError(() => setup.adapter.confirmEmail({ code: "bad\ncode", codeVerifier: verifier }), "AUTH_OAUTH_TRANSACTION_INVALID", "bad\ncode");
    await expectSafeError(() => setup.adapter.confirmEmail({ code: "code", codeVerifier: "bad" }), "AUTH_OAUTH_TRANSACTION_INVALID");
    expect(setup.factory).not.toHaveBeenCalled();
    expect(setup.fetcher).not.toHaveBeenCalled();
  });

  it("allows an explicit loopback Supabase authorize endpoint for local development", async () => {
    const subject = new SupabaseAuthAdapter({ url: "http://localhost:54321", anonKey: "anon-key" });
    await expect(subject.startOAuth({ provider: "google", redirectUrl: new URL("http://localhost:3000/oauth"), codeChallenge: challenge })).resolves.toMatchObject({
      authorizationUrl: new URL(`http://localhost:54321/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Foauth&code_challenge=${challenge}&code_challenge_method=s256`),
    });
  });

  it("rejects a provider password update when the recovered user does not match", async () => {
    const setup = adapter();
    await expectSafeError(() => setup.adapter.updatePassword({ accessToken, refreshToken: "refresh-token", userId: "123e4567-e89b-12d3-a456-426614174099", password: "b".repeat(12) }), "AUTH_OAUTH_TRANSACTION_INVALID", accessToken);
    expect(setup.sdk.auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps SDK provider errors without returning provider text or token values", async () => {
    const setup = adapter([], client({ signInWithPassword: vi.fn(async () => ({ data: null, error: { status: 401, message: "hostile refresh-token" } })) }));
    await expectSafeError(() => setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), "AUTH_INVALID_CREDENTIALS", "hostile", "refresh-token");
  });
});
