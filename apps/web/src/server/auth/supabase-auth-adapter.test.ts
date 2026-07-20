import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { SupabaseAuthAdapter } = await import("./supabase-auth-adapter.js");
const { AuthProviderError } = await import("./auth-provider-port.js");
const { EmailAuthService } = await import("./email-auth-service.js");

const nowSeconds = Math.floor(Date.now() / 1000) + 3600;
const userId = "123e4567-e89b-12d3-a456-426614174001";
const sessionId = "123e4567-e89b-12d3-a456-426614174002";
function jwt(claims: Record<string, unknown> = {}) { return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ session_id: sessionId, sub: userId, exp: nowSeconds, ...claims })).toString("base64url")}.${Buffer.from("signature").toString("base64url")}`; }
const accessToken = jwt();
const session = { access_token: accessToken, refresh_token: "refresh-token", expires_at: nowSeconds, user: { id: userId, email: "person@example.test", email_confirmed_at: "2026-07-20T00:00:00.000Z" } };
const ok = (data: unknown) => ({ data, error: null });

function client(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    signUp: vi.fn(async () => ok({ session: null })), signInWithPassword: vi.fn(async () => ok({ session })), exchangeCodeForSession: vi.fn(async () => ok({ session })),
    signInWithOAuth: vi.fn(async () => ok({ url: "https://provider.example.test/authorize" })), refreshSession: vi.fn(async () => ok({ session })), setSession: vi.fn(async () => ok({ session })),
    signOut: vi.fn(async () => ({ data: null, error: null })), resetPasswordForEmail: vi.fn(async () => ok({})), updateUser: vi.fn(async () => ok({ user: session.user })),
    ...overrides,
  };
  return { auth };
}

function adapter(subject = client()) {
  const factory = vi.fn(() => subject);
  return { subject, factory, adapter: new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, factory) };
}

function expectSafeError(action: () => Promise<unknown>, ...secrets: string[]) {
  return expect(action()).rejects.toSatisfy((error: unknown) => error instanceof AuthProviderError && secrets.every((secret) => !error.message.includes(secret)));
}

describe("SupabaseAuthAdapter", () => {
  it("creates a fresh non-persistent PKCE client for every direct provider call", async () => {
    const setup = adapter();
    await setup.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"));
    await setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) });
    await setup.adapter.confirmEmail({ code: "confirmation-code" });
    await setup.adapter.startOAuth({ provider: "naver", redirectUrl: new URL("https://app.example.test/oauth") });
    await setup.adapter.exchangeOAuthCode({ code: "oauth-code" });
    await setup.adapter.refresh("refresh-token");
    await setup.adapter.signOut(accessToken, "refresh-token");
    await setup.adapter.requestPasswordReset("person@example.test", new URL("https://app.example.test/recovery"));
    await setup.adapter.exchangeRecoveryCode({ code: "recovery-code" });
    await setup.adapter.updatePassword({ accessToken, refreshToken: "refresh-token", password: "b".repeat(12) });

    expect(setup.factory).toHaveBeenCalledTimes(10);
    for (const call of setup.factory.mock.calls) expect(call).toEqual(["https://project.supabase.co/", "anon-key", { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" }]);
    expect(setup.subject.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "custom:naver", options: { redirectTo: "https://app.example.test/oauth", skipBrowserRedirect: true } });
  });

  it("returns only a complete verified canonical provider pair", async () => {
    const { adapter: subject } = adapter();
    await expect(subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })).resolves.toMatchObject({ accessToken, refreshToken: "refresh-token", userId, supabaseSessionId: sessionId, user: { id: userId, emailVerified: true } });
  });

  it("returns an authenticated signup only for a complete verified provider session", async () => {
    const { adapter: subject } = adapter(client({ signUp: vi.fn(async () => ok({ session })) }));
    await expect(subject.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"))).resolves.toMatchObject({ status: "authenticated", tokens: { userId, supabaseSessionId: sessionId } });
  });

  it.each(["user_already_exists", "email_exists", "user_already_registered", "email_already_exists"])("returns the same verification-required signup result for %s", async (code) => {
    const { adapter: subject } = adapter(client({ signUp: vi.fn(async () => ({ data: { session: null }, error: { code, message: "hostile provider text" } })) }));
    await expect(subject.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"))).resolves.toEqual({ status: "verification_required" });
  });

  it("returns verification-required rather than exposing incomplete signup sessions", async () => {
    const { adapter: subject } = adapter(client({ signUp: vi.fn(async () => ok({ session: { ...session, refresh_token: "" } })) }));
    await expect(subject.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm"))).resolves.toEqual({ status: "verification_required" });
  });

  it.each(["user_not_found", "email_not_found", "user_not_exist", "email_not_exists"])("accepts password reset when provider reports absent account %s", async (code) => {
    const { adapter: subject } = adapter(client({ resetPasswordForEmail: vi.fn(async () => ({ data: null, error: { code, message: "hostile provider text" } })) }));
    await expect(subject.requestPasswordReset("absent@example.test", new URL("https://app.example.test/recovery"))).resolves.toBeUndefined();
  });

  it("serializes the same public acknowledgements for new/existing signup and present/absent reset", async () => {
    const context = { emailRedirectUrl: new URL("https://app.example.test/confirm"), passwordResetRedirectUrl: new URL("https://app.example.test/recovery"), now: new Date("2026-07-20T12:00:00.000Z") };
    const noSession = { create: vi.fn() };
    const publicResult = async (provider: InstanceType<typeof SupabaseAuthAdapter>) => new EmailAuthService(provider, noSession).signUp({ email: "person@example.test", password: "a".repeat(12) }, context);
    const newAccount = JSON.stringify(await publicResult(adapter(client()).adapter));
    const existing = JSON.stringify(await publicResult(adapter(client({ signUp: vi.fn(async () => ({ data: { session: null }, error: { code: "user_already_exists" } })) })).adapter));
    const authenticated = JSON.stringify(await publicResult(adapter(client({ signUp: vi.fn(async () => ok({ session })) })).adapter));
    const presentReset = JSON.stringify(await new EmailAuthService(adapter(client()).adapter, noSession).requestPasswordReset("person@example.test", context));
    const absentReset = JSON.stringify(await new EmailAuthService(adapter(client({ resetPasswordForEmail: vi.fn(async () => ({ data: null, error: { code: "user_not_found" } })) })).adapter, noSession).requestPasswordReset("absent@example.test", context));
    expect(newAccount).toBe(JSON.stringify({ accepted: true }));
    expect(existing).toBe(newAccount); expect(authenticated).toBe(newAccount); expect(absentReset).toBe(presentReset);
    expect(noSession.create).not.toHaveBeenCalled();
  });

  it("covers provider-id defaults and the safe primitive validation boundary", async () => {
    const setup = adapter(client({ signInWithPassword: vi.fn(async () => []), signInWithOAuth: vi.fn(async () => ok({ url: "https://provider.example.test/authorize" })) }));
    await expectSafeError(() => setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }));
    await setup.adapter.startOAuth({ provider: "google", redirectUrl: new URL("https://app.example.test/oauth") });
    await expectSafeError(() => setup.adapter.startOAuth({ provider: "google", redirectUrl: null as never }));
    const defaultAdapter = new SupabaseAuthAdapter({ url: "http://localhost:54321", anonKey: "anon-key" }) as unknown as { client(): unknown };
    expect(defaultAdapter.client()).toBeDefined();
  });

  it.each([
    { token: `header.${Buffer.from(JSON.stringify({ session_id: "not-a-uuid" })).toString("base64url")}.signature`, email: "person@example.test", expires: nowSeconds },
    { token: "header.A.signature", email: "person@example.test", expires: nowSeconds },
    { token: accessToken, email: undefined, expires: nowSeconds },
    { token: accessToken, email: "person@example.test", expires: "future" },
  ])("fails closed for malformed JWT payload and untrusted optional fields", async ({ token, email, expires }) => {
    const invalid = { ...session, access_token: token, expires_at: expires, user: { ...session.user, email } };
    const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => ok({ session: invalid })) }));
    await expectSafeError(() => subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), token);
  });

  it.each([
    { ...session, access_token: "not-a-jwt" },
    { ...session, refresh_token: "" },
    { ...session, expires_at: nowSeconds - 7200 },
    { ...session, user: { ...session.user, email_confirmed_at: undefined } },
    { ...session, user: { ...session.user, id: "not-a-uuid" } },
  ])("fails closed for malformed or unverified session material", async (invalidSession) => {
    const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => ok({ session: invalidSession })) }));
    await expectSafeError(() => subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), "person@example.test", "refresh-token");
  });

  it("maps allowlisted provider errors and never echoes hostile provider text", async () => {
    const hostile = "raw provider response person@example.test refresh-token";
    for (const [error, code] of [
      [{ status: 429, message: hostile }, "AUTH_RATE_LIMITED"],
      [{ code: "email_not_confirmed", message: hostile }, "AUTH_EMAIL_VERIFICATION_REQUIRED"],
      [{ status: 401, message: hostile }, "AUTH_INVALID_CREDENTIALS"],
      [{ code: "flow_state_expired", message: hostile }, "AUTH_OAUTH_TRANSACTION_INVALID"],
      [{ status: 503, message: hostile }, "AUTH_PROVIDER_UNAVAILABLE"],
    ] as const) {
      const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => ({ data: { session: null }, error })) }));
      await expect(subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })).rejects.toMatchObject({ code, message: code });
    }
  });

  it("rejects unsafe configuration and callback codes before creating a client", async () => {
    expect(() => new SupabaseAuthAdapter({ url: "http://public.example.test", anonKey: "secret-key" })).toThrow(AuthProviderError);
    expect(() => new SupabaseAuthAdapter({ url: "https://user:pass@project.supabase.co", anonKey: "secret-key" })).toThrow(AuthProviderError);
    const setup = adapter();
    await expectSafeError(() => setup.adapter.confirmEmail({ code: "bad\ncode" }), "bad\ncode");
    await expectSafeError(() => setup.adapter.startOAuth({ provider: "google", redirectUrl: new URL("http://public.example.test/callback") }));
    expect(setup.factory).not.toHaveBeenCalled();
  });

  it("validates schema-backed and strict port inputs before creating a client", async () => {
    const setup = adapter();
    await expectSafeError(() => setup.adapter.signUp({ email: "bad", password: "short" } as never, new URL("https://app.example.test/confirm")));
    await expectSafeError(() => setup.adapter.signInWithPassword({ email: "bad", password: "short" } as never));
    await expectSafeError(() => setup.adapter.requestPasswordReset("bad", new URL("https://app.example.test/recovery")));
    await expectSafeError(() => setup.adapter.startOAuth({ provider: "unapproved" as never, redirectUrl: new URL("https://app.example.test/oauth") }));
    await expectSafeError(() => setup.adapter.updatePassword({ accessToken, refreshToken: "refresh-token", password: "short" }));
    expect(setup.factory).not.toHaveBeenCalled();
  });

  it("rejects malformed raw errors, whitespace credentials, and non-integer JWT claims without provider calls", async () => {
    const malformed = adapter(client({ signUp: vi.fn(async () => ({ data: null, error: { code: 7 } })) }));
    await expectSafeError(() => malformed.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm")));
    const primitive = adapter(client({ signUp: vi.fn(async () => ({ data: null, error: "hostile" })) }));
    await expectSafeError(() => primitive.adapter.signUp({ email: "person@example.test", password: "a".repeat(12) }, new URL("https://app.example.test/confirm")));
    const noClient = adapter();
    await expectSafeError(() => noClient.adapter.confirmEmail({ code: " code " }));
    await expectSafeError(() => noClient.adapter.refresh(" refresh-token "));
    expect(noClient.factory).not.toHaveBeenCalled();
    for (const access_token of [jwt({ exp: 1.5 }), jwt({ sub: 7 })]) {
      const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => ok({ session: { ...session, access_token } })) }));
      await expectSafeError(() => subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }));
    }
  });

  it.each([
    { token: jwt({ sub: "123e4567-e89b-12d3-a456-426614174099" }), expires: nowSeconds, confirmed: session.user.email_confirmed_at },
    { token: jwt({ exp: nowSeconds + 1 }), expires: nowSeconds, confirmed: session.user.email_confirmed_at },
    { token: `!.${Buffer.from(JSON.stringify({ session_id: sessionId, sub: userId, exp: nowSeconds })).toString("base64url")}.signature`, expires: nowSeconds, confirmed: session.user.email_confirmed_at },
    { token: jwt(), expires: nowSeconds, confirmed: "not-a-timestamp" },
    { token: jwt(), expires: nowSeconds, confirmed: new Date(Date.now() + 60_000).toISOString() },
  ])("rejects inconsistent JWT claims and invalid verification timestamps", async ({ token, expires, confirmed }) => {
    const invalid = { ...session, access_token: token, expires_at: expires, user: { ...session.user, email_confirmed_at: confirmed } };
    const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => ok({ session: invalid })) }));
    await expectSafeError(() => subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), token);
  });

  it("maps update failures safely after setting only a fresh in-memory provider session", async () => {
    const hostile = "password and access token must not escape";
    const { adapter: subject, subject: fake } = adapter(client({ updateUser: vi.fn(async () => ({ data: null, error: { status: 503, message: hostile } })) }));
    await expectSafeError(() => subject.updatePassword({ accessToken, refreshToken: "refresh-token", password: "b".repeat(12) }), hostile, accessToken);
    expect(fake.auth.setSession).toHaveBeenCalledWith({ access_token: accessToken, refresh_token: "refresh-token" });
  });

  it("maps non-provider throws to the fixed unavailable error", async () => {
    const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => { throw new Error("hostile transport detail"); }) }));
    await expectSafeError(() => subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), "hostile transport detail");
  });

  it("safely maps provider errors even when no raw message exists", async () => {
    const { adapter: subject } = adapter(client({ signInWithPassword: vi.fn(async () => ({ data: null, error: { status: 503 } })) }));
    await expectSafeError(() => subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }));
  });
});
