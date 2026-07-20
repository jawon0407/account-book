import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SessionService } from "../session/session-service.js";

const authModule = await import("./email-auth-service.js").catch(() => ({} as Record<string, unknown>));
const fakeModule = await import("./fake-auth-provider.js").catch(() => ({} as Record<string, unknown>));

const EmailAuthService = authModule.EmailAuthService as (new (provider: unknown, sessions: unknown) => {
  signUp(input: unknown, context: unknown): Promise<unknown>;
  signIn(input: unknown, context: unknown): Promise<unknown>;
  confirmEmail(input: unknown, context: unknown): Promise<unknown>;
  requestPasswordReset(email: string, context: unknown): Promise<unknown>;
}) | undefined;
const EmailAuthServiceError = authModule.EmailAuthServiceError as (new (code: string) => Error & { code: string }) | undefined;
const FakeAuthProvider = fakeModule.FakeAuthProvider as (new () => {
  signUpResult: unknown;
  signInResult: unknown;
  confirmationResult: unknown;
  failure: Error | null;
  calls: { signUp: unknown[]; signInWithPassword: unknown[]; requestPasswordReset: unknown[]; confirmEmail: unknown[] };
}) | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const userId = "123e4567-e89b-12d3-a456-426614174001";
const providerSessionId = "123e4567-e89b-12d3-a456-426614174002";
const tokens = {
  accessToken: "provider-access-token",
  refreshToken: "provider-refresh-token",
  userId,
  supabaseSessionId: providerSessionId,
  accessTokenExpiresAt: new Date(now.getTime() + 60_000),
  user: { id: userId, email: "person@example.test", emailVerified: true },
};
const context = {
  emailRedirectUrl: new URL("https://app.example.test/auth/confirm"),
  passwordResetRedirectUrl: new URL("https://app.example.test/auth/recovery"),
  now,
};
const validInput = { email: "person@example.test", password: "a".repeat(12) };

function sessionCreator() {
  return { create: vi.fn(async () => ({ selector: "opaque-selector", sessionId: "123e4567-e89b-12d3-a456-426614174003", userId, accessTokenExpiresAt: tokens.accessTokenExpiresAt, absoluteExpiresAt: new Date(now.getTime() + 30 * 86_400_000) })) };
}

describe("EmailAuthService", () => {
  it("does not create an app session before email verification", async () => {
    expect(EmailAuthService).toBeTypeOf("function");
    expect(FakeAuthProvider).toBeTypeOf("function");
    const provider = new FakeAuthProvider!();
    const sessions = sessionCreator();
    const service = new EmailAuthService!(provider, sessions);

    provider.signInResult = { ...tokens, user: { ...tokens.user, emailVerified: false } };
    await expect(service.signIn(validInput, context)).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("returns only opaque session metadata after verified sign in", async () => {
    const provider = new FakeAuthProvider!();
    const sessions = sessionCreator();
    const service = new EmailAuthService!(provider, sessions);
    provider.signInResult = tokens;

    const result = await service.signIn(validInput, context);
    const serialized = JSON.stringify(result);
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ selector: "opaque-selector", user: tokens.user, accessTokenExpiresAt: tokens.accessTokenExpiresAt });
    for (const secret of [tokens.accessToken, tokens.refreshToken, providerSessionId]) expect(serialized).not.toContain(secret);
  });

  it("creates a real encrypted opaque session without serializing provider tokens", async () => {
    const provider = new FakeAuthProvider!();
    provider.signInResult = tokens;
    const repository = { record: null as unknown, async create(record: unknown) { this.record = record; } };
    const realSessions = new SessionService(repository as never, { currentKeyId: "current", keys: new Map([["current", randomBytes(32)]]) }, async () => tokens, () => "123e4567-e89b-12d3-a456-426614174003");

    const result = await new EmailAuthService!(provider, realSessions).signIn(validInput, context) as { selector: string };
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(tokens.accessToken);
    expect(serialized).not.toContain(tokens.refreshToken);
    expect(serialized).not.toContain(providerSessionId);
    expect(JSON.stringify(repository.record)).not.toContain(tokens.accessToken);
    expect(JSON.stringify(repository.record)).not.toContain(tokens.refreshToken);
    expect(result.selector).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("acknowledges signup without creating a session until verification", async () => {
    const provider = new FakeAuthProvider!();
    const sessions = sessionCreator();
    const service = new EmailAuthService!(provider, sessions);
    provider.signUpResult = { status: "verification_required" };

    await expect(service.signUp(validInput, context)).resolves.toEqual({ accepted: true });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("returns the same reset response for present and absent accounts", async () => {
    const provider = new FakeAuthProvider!();
    const service = new EmailAuthService!(provider, sessionCreator());

    const present = await service.requestPasswordReset("present@example.test", context);
    const absent = await service.requestPasswordReset("absent@example.test", context);
    expect(present).toEqual(absent);
    expect(present).toEqual({ accepted: true });
  });

  it("creates one opaque session after a verified confirmation", async () => {
    const provider = new FakeAuthProvider!();
    const sessions = sessionCreator();
    const service = new EmailAuthService!(provider, sessions);
    provider.confirmationResult = tokens;

    await expect(service.confirmEmail({ code: "server-only-code" }, context)).resolves.toMatchObject({ selector: "opaque-selector", user: tokens.user });
    expect(provider.calls.confirmEmail).toEqual([{ code: "server-only-code" }]);
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it("maps provider and session failures without echoing secrets", async () => {
    const provider = new FakeAuthProvider!();
    const sessions = sessionCreator();
    const service = new EmailAuthService!(provider, sessions);
    provider.failure = new (await import("./auth-provider-port.js")).AuthProviderError("AUTH_RATE_LIMITED");
    await expect(service.signUp(validInput, context)).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", message: "AUTH_RATE_LIMITED" });

    provider.failure = null;
    provider.signInResult = { ...tokens, user: { ...tokens.user, id: "123e4567-e89b-12d3-a456-426614174099" } };
    await expect(service.signIn(validInput, context)).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("rejects invalid context and reset input before invoking the provider", async () => {
    const provider = new FakeAuthProvider!();
    const service = new EmailAuthService!(provider, sessionCreator());
    const badContext = { ...context, now: new Date("invalid") };
    await expect(service.signUp(validInput, badContext)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await expect(service.signUp({ email: "bad", password: "short" }, context)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    await expect(service.requestPasswordReset("bad", context)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(provider.calls.signUp).toHaveLength(0);
    expect(provider.calls.requestPasswordReset).toHaveLength(0);
  });

  it("accepts explicit local development callback URLs and safely maps unexpected session errors", async () => {
    const provider = new FakeAuthProvider!();
    const sessions = { create: vi.fn(async () => { throw new Error("session secret"); }) };
    const localContext = { ...context, emailRedirectUrl: new URL("http://localhost:3000/confirm"), passwordResetRedirectUrl: new URL("http://localhost:3000/recovery") };
    await expect(new EmailAuthService!(provider, sessions).signUp(validInput, localContext)).resolves.toEqual({ accepted: true });
    provider.signInResult = tokens;
    await expect(new EmailAuthService!(provider, sessions).signIn(validInput, localContext)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", message: "AUTH_PROVIDER_UNAVAILABLE" });
  });

  it("rejects invalid input before provider calls and never echoes it", async () => {
    const provider = new FakeAuthProvider!();
    const service = new EmailAuthService!(provider, sessionCreator());
    await expect(service.signIn({ email: "secret@example.test", password: "short", extra: true }, context)).rejects.toSatisfy((error: unknown) =>
      error instanceof EmailAuthServiceError! && !error.message.includes("secret@example.test"),
    );
    expect(provider.calls.signInWithPassword).toHaveLength(0);
  });
});
