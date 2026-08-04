import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken, type TokenEnvelope, type TokenKeyring } from "../security/token-envelope.js";
import { AuthProviderError } from "./auth-provider-port.js";

vi.mock("server-only", () => ({}));
const module = await import("./password-recovery-service.js").catch(() => ({} as Record<string, unknown>));
const PasswordRecoveryService = module.PasswordRecoveryService as (new (...args: unknown[]) => {
  start(email: unknown, context: unknown): Promise<unknown>;
  exchange(input: unknown, context: unknown): Promise<unknown>;
  update(input: unknown, context: unknown): Promise<unknown>;
}) | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const transactionId = "123e4567-e89b-12d3-a456-426614174030";
const userId = "123e4567-e89b-12d3-a456-426614174031";
const interaction = Buffer.alloc(32, 8).toString("base64url");
const otherInteraction = Buffer.alloc(32, 9).toString("base64url");
const verifier = "r".repeat(43);
const accessToken = "recovery-access-token";
const refreshToken = "recovery-refresh-token";
const keyring: TokenKeyring = { currentKeyId: "current", keys: new Map([["current", randomBytes(32)]]) };

type RecoveryRecord = {
  id: string;
  interactionHash: Uint8Array;
  encryptedPkceVerifier: TokenEnvelope | null;
  userId: string | null;
  encryptedRecoveryToken: TokenEnvelope | null;
  createdAt: Date;
  expiresAt: Date;
  exchangeClaimedAt: Date | null;
  exchangedAt: Date | null;
  passwordUpdateClaimedAt: Date | null;
  consumedAt: Date | null;
};

class RecoveryRepository {
  public record: RecoveryRecord | null = null;
  public events: string[] = [];
  public revokedSessions = 0;

  public async createRecoveryTransaction(record: RecoveryRecord): Promise<void> {
    this.events.push("create");
    this.record = { ...record, interactionHash: Uint8Array.from(record.interactionHash) };
  }

  public async claimRecoveryExchange(interactionHash: Uint8Array, claimedAt: Date): Promise<RecoveryRecord | null> {
    this.events.push("claim-exchange");
    const row = this.record;
    if (
      row === null || row.exchangeClaimedAt !== null || row.exchangedAt !== null || row.passwordUpdateClaimedAt !== null || row.consumedAt !== null ||
      row.encryptedPkceVerifier === null || row.userId !== null || row.encryptedRecoveryToken !== null || row.expiresAt.getTime() <= claimedAt.getTime() ||
      !Buffer.from(row.interactionHash).equals(Buffer.from(interactionHash))
    ) return null;
    this.record = { ...row, exchangeClaimedAt: new Date(claimedAt) };
    return this.record;
  }

  public async promoteRecoveryExchange(input: { transactionId: string; expectedExchangeClaimedAt: Date; userId: string; encryptedRecoveryToken: TokenEnvelope; now: Date }): Promise<boolean> {
    this.events.push("promote");
    const row = this.record;
    if (row === null || row.id !== input.transactionId || row.exchangeClaimedAt?.getTime() !== input.expectedExchangeClaimedAt.getTime() || row.exchangedAt !== null || row.userId !== null || row.encryptedRecoveryToken !== null || row.encryptedPkceVerifier === null || row.consumedAt !== null || row.expiresAt.getTime() <= input.now.getTime()) return false;
    this.record = { ...row, encryptedPkceVerifier: null, userId: input.userId, encryptedRecoveryToken: input.encryptedRecoveryToken, exchangedAt: new Date(input.now) };
    return true;
  }

  public async claimRecoveryPasswordUpdate(interactionHash: Uint8Array, claimedAt: Date): Promise<RecoveryRecord | null> {
    this.events.push("claim-update");
    const row = this.record;
    if (
      row === null || row.exchangeClaimedAt === null || row.exchangedAt === null || row.passwordUpdateClaimedAt !== null || row.consumedAt !== null ||
      row.encryptedPkceVerifier !== null || row.userId === null || row.encryptedRecoveryToken === null || row.expiresAt.getTime() <= claimedAt.getTime() ||
      !Buffer.from(row.interactionHash).equals(Buffer.from(interactionHash))
    ) return null;
    this.record = { ...row, passwordUpdateClaimedAt: new Date(claimedAt) };
    return this.record;
  }

  public async consumeRecoveryAndRevokeSessions(input: { transactionId: string; userId: string; expectedPasswordUpdateClaimedAt: Date; now: Date }): Promise<boolean> {
    this.events.push("consume-and-revoke");
    const row = this.record;
    if (row === null || row.id !== input.transactionId || row.userId !== input.userId || row.passwordUpdateClaimedAt?.getTime() !== input.expectedPasswordUpdateClaimedAt.getTime() || row.consumedAt !== null || row.expiresAt.getTime() <= input.now.getTime()) return false;
    this.record = { ...row, consumedAt: new Date(input.now) };
    this.revokedSessions += 3;
    return true;
  }
}

function setup() {
  const repository = new RecoveryRepository();
  const provider = {
    requestFailure: null as AuthProviderError | null,
    exchangeFailure: null as AuthProviderError | null,
    updateFailure: null as AuthProviderError | null,
    recoveryResult: { accessToken, refreshToken, user: { id: userId, email: "person@example.test", emailVerified: true } } as unknown,
    calls: { request: [] as unknown[], exchange: [] as unknown[], update: [] as unknown[] },
    requestPasswordReset: vi.fn(async (...args: unknown[]) => {
      repository.events.push("provider-request");
      provider.calls.request.push(args);
      if (provider.requestFailure) throw provider.requestFailure;
    }),
    exchangeRecoveryCode: vi.fn(async (input: unknown) => {
      repository.events.push("provider-exchange");
      provider.calls.exchange.push(input);
      if (provider.exchangeFailure) throw provider.exchangeFailure;
      return provider.recoveryResult;
    }),
    updatePassword: vi.fn(async (input: unknown) => {
      repository.events.push("provider-update");
      provider.calls.update.push(input);
      if (provider.updateFailure) throw provider.updateFailure;
    }),
  };
  expect(PasswordRecoveryService).toBeTypeOf("function");
  const service = new PasswordRecoveryService!(repository, provider, keyring, () => transactionId, () => verifier);
  const context = { passwordResetRedirectUrl: new URL("https://app.example.test/auth/recovery"), interactionSelector: interaction, now };
  return { repository, provider, service, context };
}

async function exchanged(subject: ReturnType<typeof setup>): Promise<void> {
  await subject.service.start("person@example.test", subject.context);
  await subject.service.exchange({ code: "recovery-code" }, { ...subject.context, now: new Date(now.getTime() + 1_000) });
}

describe("PasswordRecoveryService", () => {
  it("stores a fifteen-minute pending encrypted verifier before requesting reset", async () => {
    const subject = setup();
    await expect(subject.service.start("person@example.test", subject.context)).resolves.toEqual({ accepted: true });
    const row = subject.repository.record;
    expect(row).toMatchObject({ userId: null, encryptedRecoveryToken: null, exchangeClaimedAt: null, exchangedAt: null, passwordUpdateClaimedAt: null, consumedAt: null });
    expect(row?.interactionHash).toEqual(Uint8Array.from(createHash("sha256").update(interaction).digest()));
    expect(row?.expiresAt.getTime()).toBe(now.getTime() + 15 * 60_000);
    expect(decryptToken(row?.encryptedPkceVerifier, { recordId: transactionId, tokenKind: "pkce" }, keyring)).toBe(verifier);
    expect(subject.repository.events).toEqual(["create", "provider-request"]);
    const args = subject.provider.calls.request[0] as [string, URL, string];
    expect(args).toEqual(["person@example.test", new URL("https://app.example.test/auth/recovery"), createHash("sha256").update(verifier, "ascii").digest("base64url")]);
    expect(JSON.stringify(row)).not.toContain(verifier);
    expect(JSON.stringify(row)).not.toContain(interaction);
  });

  it("returns the same accepted result for present and absent accounts", async () => {
    const present = setup();
    const presentResult = await present.service.start("present@example.test", present.context);
    const absent = setup();
    absent.provider.requestFailure = new AuthProviderError("AUTH_INVALID_CREDENTIALS");
    const absentResult = await absent.service.start("absent@example.test", absent.context);
    expect(absentResult).toEqual(presentResult);
    expect(absentResult).toEqual({ accepted: true });
  });

  it("claims before exchange, encrypts one canonical credential pair, and clears the verifier", async () => {
    const subject = setup();
    await subject.service.start("person@example.test", subject.context);
    subject.repository.events.length = 0;
    const result = await subject.service.exchange({ code: "recovery-code" }, { ...subject.context, now: new Date(now.getTime() + 1_000) });
    expect(subject.repository.events).toEqual(["claim-exchange", "provider-exchange", "promote"]);
    expect(subject.provider.calls.exchange).toEqual([{ code: "recovery-code", codeVerifier: verifier }]);
    expect(result).toEqual({ ready: true });
    const row = subject.repository.record;
    expect(row).toMatchObject({ encryptedPkceVerifier: null, userId, exchangedAt: new Date(now.getTime() + 1_000), consumedAt: null });
    expect(decryptToken(row?.encryptedRecoveryToken, { recordId: transactionId, tokenKind: "recovery" }, keyring)).toBe(JSON.stringify({ accessToken, refreshToken }));
    const serialized = JSON.stringify({ row, result });
    for (const secret of [verifier, accessToken, refreshToken, "recovery-code"]) expect(serialized).not.toContain(secret);
  });

  it.each([
    ["wrong browser", { interactionSelector: otherInteraction, now: new Date(now.getTime() + 1_000) }],
    ["expired", { interactionSelector: interaction, now: new Date(now.getTime() + 15 * 60_000) }],
  ])("rejects a %s exchange before the provider", async (_label, callbackContext) => {
    const subject = setup();
    await subject.service.start("person@example.test", subject.context);
    await expect(subject.service.exchange({ code: "code" }, { ...subject.context, ...callbackContext })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.exchangeRecoveryCode).not.toHaveBeenCalled();
  });

  it("rejects replayed and concurrent exchanges after only one provider call", async () => {
    const subject = setup();
    await subject.service.start("person@example.test", subject.context);
    const callbackContext = { ...subject.context, now: new Date(now.getTime() + 1_000) };
    const results = await Promise.allSettled([
      subject.service.exchange({ code: "code" }, callbackContext),
      subject.service.exchange({ code: "code" }, callbackContext),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(subject.service.exchange({ code: "code" }, callbackContext)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.exchangeRecoveryCode).toHaveBeenCalledTimes(1);
  });

  it("leaves a failed provider exchange claimed and unusable", async () => {
    const subject = setup();
    await subject.service.start("person@example.test", subject.context);
    subject.provider.exchangeFailure = new AuthProviderError("AUTH_PROVIDER_UNAVAILABLE");
    const callbackContext = { ...subject.context, now: new Date(now.getTime() + 1_000) };
    await expect(subject.service.exchange({ code: "secret-code" }, callbackContext)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await expect(subject.service.exchange({ code: "secret-code" }, callbackContext)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.exchangeRecoveryCode).toHaveBeenCalledTimes(1);
  });

  it("claims one password update, consumes after provider success, and revokes every local session", async () => {
    const subject = setup();
    await exchanged(subject);
    subject.repository.events.length = 0;
    const updateContext = { ...subject.context, now: new Date(now.getTime() + 2_000) };
    await expect(subject.service.update({ password: "b".repeat(12) }, updateContext)).resolves.toEqual({ updated: true });
    expect(subject.repository.events).toEqual(["claim-update", "provider-update", "consume-and-revoke"]);
    expect(subject.provider.calls.update).toEqual([{ accessToken, refreshToken, userId, password: "b".repeat(12) }]);
    expect(subject.repository.record?.consumedAt).toEqual(updateContext.now);
    expect(subject.repository.revokedSessions).toBe(3);
  });

  it("lets only one concurrent password update reach the provider", async () => {
    const subject = setup();
    await exchanged(subject);
    const context = { ...subject.context, now: new Date(now.getTime() + 2_000) };
    const results = await Promise.allSettled([
      subject.service.update({ password: "b".repeat(12) }, context),
      subject.service.update({ password: "c".repeat(12) }, context),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(subject.provider.updatePassword).toHaveBeenCalledTimes(1);
  });

  it("does not mark a failed provider password update consumed or revoke sessions", async () => {
    const subject = setup();
    await exchanged(subject);
    subject.provider.updateFailure = new AuthProviderError("AUTH_PROVIDER_UNAVAILABLE");
    const context = { ...subject.context, now: new Date(now.getTime() + 2_000) };
    await expect(subject.service.update({ password: "b".repeat(12) }, context)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.repository.record?.passwordUpdateClaimedAt).toEqual(context.now);
    expect(subject.repository.record?.consumedAt).toBeNull();
    expect(subject.repository.revokedSessions).toBe(0);
    await expect(subject.service.update({ password: "b".repeat(12) }, context)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.updatePassword).toHaveBeenCalledTimes(1);
  });

  it("fails closed for malformed records, mismatched users, and invalid boundary input", async () => {
    const malformed = setup();
    await exchanged(malformed);
    malformed.repository.record = { ...malformed.repository.record!, encryptedRecoveryToken: { version: 1, keyId: "missing", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(22) } };
    await expect(malformed.service.update({ password: "b".repeat(12) }, { ...malformed.context, now: new Date(now.getTime() + 2_000) })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(malformed.provider.updatePassword).not.toHaveBeenCalled();

    const mismatch = setup();
    await exchanged(mismatch);
    mismatch.repository.record = { ...mismatch.repository.record!, userId: "123e4567-e89b-12d3-a456-426614174099" };
    mismatch.provider.updateFailure = new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID");
    await expect(mismatch.service.update({ password: "b".repeat(12) }, { ...mismatch.context, now: new Date(now.getTime() + 2_000) })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });

    const invalid = setup();
    await expect(invalid.service.start("not-an-email", invalid.context)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    await expect(invalid.service.start("person@example.test", { ...invalid.context, interactionSelector: "bad" })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    await expect(invalid.service.exchange({ code: "bad\ncode" }, invalid.context)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    await expect(invalid.service.update({ password: "short" }, invalid.context)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(invalid.repository.record).toBeNull();
  });
});
