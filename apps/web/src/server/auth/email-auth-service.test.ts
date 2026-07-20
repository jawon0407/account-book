import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken, type TokenEnvelope, type TokenKeyring } from "../security/token-envelope.js";
import { AuthProviderError } from "./auth-provider-port.js";

vi.mock("server-only", () => ({}));
const module = await import("./email-auth-service.js").catch(() => ({} as Record<string, unknown>));
const EmailAuthService = module.EmailAuthService as (new (...args: unknown[]) => {
  signUp(input: unknown, context: unknown): Promise<unknown>;
  signIn(input: unknown, context: unknown): Promise<unknown>;
  confirmEmail(input: unknown, context: unknown): Promise<unknown>;
}) | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const transactionId = "123e4567-e89b-12d3-a456-426614174020";
const userId = "123e4567-e89b-12d3-a456-426614174021";
const providerSessionId = "123e4567-e89b-12d3-a456-426614174022";
const interaction = Buffer.alloc(32, 5).toString("base64url");
const otherInteraction = Buffer.alloc(32, 6).toString("base64url");
const verifier = "e".repeat(43);
const keyring: TokenKeyring = { currentKeyId: "current", keys: new Map([["current", randomBytes(32)]]) };
const tokens = {
  accessToken: "provider-access-token",
  refreshToken: "provider-refresh-token",
  userId,
  supabaseSessionId: providerSessionId,
  issuedAtSeconds: Math.floor(now.getTime() / 1000),
  accessTokenExpiresAt: new Date(now.getTime() + 60_000),
  user: { id: userId, email: "person@example.test", emailVerified: true },
};
const validInput = { email: "person@example.test", password: "a".repeat(12) };

type EmailRecord = {
  id: string;
  interactionHash: Uint8Array;
  encryptedPkceVerifier: TokenEnvelope;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

class EmailRepository {
  public record: EmailRecord | null = null;
  public events: string[] = [];

  public async createEmailConfirmationTransaction(record: EmailRecord): Promise<void> {
    this.events.push("create");
    this.record = { ...record, interactionHash: Uint8Array.from(record.interactionHash) };
  }

  public async claimEmailConfirmationTransaction(interactionHash: Uint8Array, claimedAt: Date): Promise<EmailRecord | null> {
    this.events.push("claim");
    const record = this.record;
    if (record === null || record.consumedAt !== null || record.expiresAt.getTime() <= claimedAt.getTime() || !Buffer.from(record.interactionHash).equals(Buffer.from(interactionHash))) return null;
    this.record = { ...record, consumedAt: new Date(claimedAt) };
    return this.record;
  }
}

function setup() {
  const repository = new EmailRepository();
  const provider = {
    signUpResult: { status: "verification_required" } as unknown,
    signInResult: tokens as unknown,
    confirmationResult: tokens as unknown,
    failure: null as AuthProviderError | null,
    calls: { signUp: [] as unknown[], signIn: [] as unknown[], confirm: [] as unknown[] },
    signUp: vi.fn(async (...args: unknown[]) => {
      repository.events.push("provider-signup");
      provider.calls.signUp.push(args);
      if (provider.failure) throw provider.failure;
      return provider.signUpResult;
    }),
    signInWithPassword: vi.fn(async (input: unknown) => {
      provider.calls.signIn.push(input);
      if (provider.failure) throw provider.failure;
      return provider.signInResult;
    }),
    confirmEmail: vi.fn(async (input: unknown) => {
      repository.events.push("provider-confirm");
      provider.calls.confirm.push(input);
      if (provider.failure) throw provider.failure;
      return provider.confirmationResult;
    }),
  };
  const sessions = {
    create: vi.fn(async () => {
      repository.events.push("session");
      return { selector: "opaque-session-selector", accessTokenExpiresAt: tokens.accessTokenExpiresAt, absoluteExpiresAt: new Date(now.getTime() + 86_400_000) };
    }),
  };
  expect(EmailAuthService).toBeTypeOf("function");
  const service = new EmailAuthService!(provider, sessions, repository, keyring, () => transactionId, () => verifier);
  const context = {
    emailRedirectUrl: new URL("https://app.example.test/auth/confirm"),
    passwordResetRedirectUrl: new URL("https://app.example.test/auth/recovery"),
    interactionSelector: interaction,
    now,
  };
  return { repository, provider, sessions, service, context };
}

describe("EmailAuthService PKCE confirmation continuity", () => {
  it("stores an interaction-bound encrypted verifier before sending only its challenge", async () => {
    const subject = setup();
    await expect(subject.service.signUp(validInput, subject.context)).resolves.toEqual({ accepted: true });
    const record = subject.repository.record;
    expect(record?.interactionHash).toEqual(Uint8Array.from(createHash("sha256").update(interaction).digest()));
    expect(record?.expiresAt.getTime()).toBe(now.getTime() + 15 * 60_000);
    expect(decryptToken(record?.encryptedPkceVerifier, { recordId: transactionId, tokenKind: "pkce" }, keyring)).toBe(verifier);
    expect(subject.repository.events).toEqual(["create", "provider-signup"]);
    const args = subject.provider.calls.signUp[0] as [unknown, URL, string];
    expect(args[1].toString()).toBe("https://app.example.test/auth/confirm");
    expect(args[2]).toBe(createHash("sha256").update(verifier, "ascii").digest("base64url"));
    const serialized = JSON.stringify({ record, result: await subject.service.signUp(validInput, { ...subject.context, interactionSelector: otherInteraction }) });
    for (const secret of [interaction, verifier]) expect(serialized).not.toContain(secret);
  });

  it("claims before exchanging confirmation code and returns only opaque metadata", async () => {
    const subject = setup();
    await subject.service.signUp(validInput, subject.context);
    subject.repository.events.length = 0;
    const result = await subject.service.confirmEmail({ code: "confirmation-code" }, { ...subject.context, now: new Date(now.getTime() + 1_000) });
    expect(subject.repository.events).toEqual(["claim", "provider-confirm", "session"]);
    expect(subject.provider.calls.confirm).toEqual([{ code: "confirmation-code", codeVerifier: verifier }]);
    expect(result).toMatchObject({ selector: "opaque-session-selector", user: tokens.user });
    const serialized = JSON.stringify(result);
    for (const secret of [verifier, "confirmation-code", tokens.accessToken, tokens.refreshToken]) expect(serialized).not.toContain(secret);
  });

  it.each([
    ["wrong browser", { interactionSelector: otherInteraction, now: new Date(now.getTime() + 1_000) }],
    ["expired", { interactionSelector: interaction, now: new Date(now.getTime() + 15 * 60_000) }],
  ])("rejects %s before provider exchange", async (_label, callbackContext) => {
    const subject = setup();
    await subject.service.signUp(validInput, subject.context);
    await expect(subject.service.confirmEmail({ code: "code" }, { ...subject.context, ...callbackContext })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.confirmEmail).not.toHaveBeenCalled();
  });

  it("rejects replay and leaves a provider-failed claim unusable", async () => {
    const replay = setup();
    await replay.service.signUp(validInput, replay.context);
    await replay.service.confirmEmail({ code: "code" }, { ...replay.context, now: new Date(now.getTime() + 1_000) });
    await expect(replay.service.confirmEmail({ code: "code" }, { ...replay.context, now: new Date(now.getTime() + 2_000) })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(replay.provider.confirmEmail).toHaveBeenCalledTimes(1);

    const failed = setup();
    await failed.service.signUp(validInput, failed.context);
    failed.provider.failure = new AuthProviderError("AUTH_PROVIDER_UNAVAILABLE");
    await expect(failed.service.confirmEmail({ code: "secret-code" }, { ...failed.context, now: new Date(now.getTime() + 1_000) })).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await expect(failed.service.confirmEmail({ code: "secret-code" }, { ...failed.context, now: new Date(now.getTime() + 2_000) })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(failed.provider.confirmEmail).toHaveBeenCalledTimes(1);
  });

  it("returns identical signup acknowledgements for new, existing, and unexpected authenticated outcomes", async () => {
    const subject = setup();
    const fresh = JSON.stringify(await subject.service.signUp(validInput, subject.context));
    subject.provider.failure = new AuthProviderError("AUTH_INVALID_CREDENTIALS");
    const existing = JSON.stringify(await subject.service.signUp(validInput, { ...subject.context, interactionSelector: otherInteraction }));
    subject.provider.failure = null;
    subject.provider.signUpResult = { status: "authenticated", tokens };
    const authenticated = JSON.stringify(await subject.service.signUp(validInput, { ...subject.context, interactionSelector: Buffer.alloc(32, 7).toString("base64url") }));
    expect(fresh).toBe(JSON.stringify({ accepted: true }));
    expect(existing).toBe(fresh);
    expect(authenticated).toBe(fresh);
    expect(subject.sessions.create).not.toHaveBeenCalled();
  });

  it("keeps verified password sign-in behavior and rejects unverified users", async () => {
    const subject = setup();
    await expect(subject.service.signIn(validInput, subject.context)).resolves.toMatchObject({ selector: "opaque-session-selector", user: tokens.user });
    subject.provider.signInResult = { ...tokens, user: { ...tokens.user, emailVerified: false } };
    await expect(subject.service.signIn(validInput, subject.context)).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_REQUIRED" });
  });

  it("rejects invalid context and callback input before persistence or provider calls", async () => {
    const subject = setup();
    await expect(subject.service.signUp(validInput, { ...subject.context, interactionSelector: "bad" })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    await expect(subject.service.signUp(validInput, { ...subject.context, now: new Date("invalid") })).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await expect(subject.service.confirmEmail({ code: "bad\ncode" }, subject.context)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.repository.record).toBeNull();
    expect(subject.provider.signUp).not.toHaveBeenCalled();
    expect(subject.provider.confirmEmail).not.toHaveBeenCalled();
  });
});
