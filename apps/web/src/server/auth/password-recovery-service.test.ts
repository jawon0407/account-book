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

  /**
   * 복구 저장 순서를 기록하고 식별자 해시를 복사해 초기 레코드를 보관합니다.
   * @param record 저장할 초기 복구 레코드.
   * @returns 값 없이 완료합니다.
   */
  public async createRecoveryTransaction(record: RecoveryRecord): Promise<void> {
    this.events.push("create");
    this.record = { ...record, interactionHash: Uint8Array.from(record.interactionHash) };
  }

  /**
   * 브라우저·기한·대기 상태를 비교해 코드 교환을 한 번 선점하는 메모리 대역입니다.
   * @param interactionHash 기대 브라우저 해시.
   * @param claimedAt 선점 시각.
   * @returns 선점 레코드 또는 조건 불일치 시 null.
   */
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

  /**
   * 기대 선점 시각과 단계를 검사한 뒤 PKCE 비밀값을 지우고 복구 자격 증명을 저장합니다.
   * @param input 대상 ID·기대 선점 시각·사용자·암호문·완료 시각.
   * @returns 상태가 변경되면 true, 조건이 다르면 false.
   */
  public async promoteRecoveryExchange(input: { transactionId: string; expectedExchangeClaimedAt: Date; userId: string; encryptedRecoveryToken: TokenEnvelope; now: Date }): Promise<boolean> {
    this.events.push("promote");
    const row = this.record;
    if (row === null || row.id !== input.transactionId || row.exchangeClaimedAt?.getTime() !== input.expectedExchangeClaimedAt.getTime() || row.exchangedAt !== null || row.userId !== null || row.encryptedRecoveryToken !== null || row.encryptedPkceVerifier === null || row.consumedAt !== null || row.expiresAt.getTime() <= input.now.getTime()) return false;
    this.record = { ...row, encryptedPkceVerifier: null, userId: input.userId, encryptedRecoveryToken: input.encryptedRecoveryToken, exchangedAt: new Date(input.now) };
    return true;
  }

  /**
   * 코드 교환이 끝난 유효 레코드의 비밀번호 변경을 한 번 선점합니다.
   * @param interactionHash 기대 브라우저 해시.
   * @param claimedAt 갱신 선점 시각.
   * @returns 선점 레코드 또는 null.
   */
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

  /**
   * 복구 ID·사용자·선점 시각·기한을 확인해 소비하고 세션 폐기 횟수에 3을 더해 외부 부작용을 모사합니다.
   * @param input 복구 소비 조건과 기준 시각.
   * @returns 소비 성공 시 true; 조건 불일치 시 false.
   */
  public async consumeRecoveryAndRevokeSessions(input: { transactionId: string; userId: string; expectedPasswordUpdateClaimedAt: Date; now: Date }): Promise<boolean> {
    this.events.push("consume-and-revoke");
    const row = this.record;
    if (row === null || row.id !== input.transactionId || row.userId !== input.userId || row.passwordUpdateClaimedAt?.getTime() !== input.expectedPasswordUpdateClaimedAt.getTime() || row.consumedAt !== null || row.expiresAt.getTime() <= input.now.getTime()) return false;
    this.record = { ...row, consumedAt: new Date(input.now) };
    this.revokedSessions += 3;
    return true;
  }
}

/**
 * 고정 난수와 메모리 복구 저장소, 단계별 실패를 지정할 수 있는 제공자 대역을 연결합니다.
 * @returns 복구 서비스·저장소·제공자와 요청 컨텍스트.
 */
function setup() {
  const repository = new RecoveryRepository();
  const provider = {
    requestFailure: null as AuthProviderError | null,
    exchangeFailure: null as AuthProviderError | null,
    updateFailure: null as AuthProviderError | null,
    recoveryResult: { accessToken, refreshToken, user: { id: userId, email: "person@example.test", emailVerified: true } } as unknown,
    calls: { request: [] as unknown[], exchange: [] as unknown[], update: [] as unknown[] },
    /**
     * 복구 메일 요청 인자와 실행 순서를 기록하고 선택한 실패를 재현합니다.
     * @param args 이메일·콜백 URL·PKCE 챌린지 인자 목록.
     * @returns 실패 설정이 없으면 값 없이 완료합니다.
     * @throws requestFailure에 지정한 오류.
     */
    requestPasswordReset: vi.fn(async (...args: unknown[]) => {
      repository.events.push("provider-request");
      provider.calls.request.push(args);
      if (provider.requestFailure) throw provider.requestFailure;
    }),
    /**
     * 복구 코드 교환 입력과 순서를 기록하며 미리 지정한 복구 결과를 반환합니다.
     * @param input 복구 코드와 PKCE 검증값.
     * @returns recoveryResult 테스트 응답.
     * @throws exchangeFailure에 지정한 오류.
     */
    exchangeRecoveryCode: vi.fn(async (input: unknown) => {
      repository.events.push("provider-exchange");
      provider.calls.exchange.push(input);
      if (provider.exchangeFailure) throw provider.exchangeFailure;
      return provider.recoveryResult;
    }),
    /**
     * 비밀번호 변경 요청과 실행 순서를 기록하는 대역이며 실제 비밀번호는 바꾸지 않습니다.
     * @param input 복구 토큰·사용자·새 비밀번호.
     * @returns 실패가 없으면 값 없이 완료합니다.
     * @throws updateFailure에 지정한 오류.
     */
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

/**
 * 복구 시작과 코드 교환을 순서대로 실행해 비밀번호 변경 직전 상태를 준비합니다.
 * @param subject setup이 만든 테스트 환경.
 * @returns 코드 교환 완료 후 값 없이 종료합니다.
 * @throws 준비 과정의 서비스 오류.
 */
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
