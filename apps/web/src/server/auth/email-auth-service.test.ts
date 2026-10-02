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

  /**
   * 호출 순서를 기록하고 이메일 확인 레코드를 메모리에 저장하는 대역입니다. 브라우저 해시는 복사합니다.
   * @param record 저장을 요청받은 테스트 레코드.
   * @returns 저장 후 값 없이 완료합니다.
   */
  public async createEmailConfirmationTransaction(record: EmailRecord): Promise<void> {
    this.events.push("create");
    this.record = { ...record, interactionHash: Uint8Array.from(record.interactionHash) };
  }

  /**
   * 메모리 레코드의 브라우저·기한·미소비 상태를 확인한 뒤 소비 시각을 기록합니다.
   * @param interactionHash 기대 브라우저 식별자 해시.
   * @param claimedAt 소비 및 만료 판단 시각.
   * @returns 소비한 레코드 또는 조건이 다르면 null.
   */
  public async claimEmailConfirmationTransaction(interactionHash: Uint8Array, claimedAt: Date): Promise<EmailRecord | null> {
    this.events.push("claim");
    const record = this.record;
    if (record === null || record.consumedAt !== null || record.expiresAt.getTime() <= claimedAt.getTime() || !Buffer.from(record.interactionHash).equals(Buffer.from(interactionHash))) return null;
    this.record = { ...record, consumedAt: new Date(claimedAt) };
    return this.record;
  }
}

/**
 * 고정 UUID·PKCE 값과 메모리 저장소·제공자 대역을 연결해 이메일 인증 테스트 환경을 만듭니다.
 * @param clock 제공자 응답 이후 시각을 제어할 함수.
 * @returns 서비스·저장소·대역·콜백 컨텍스트.
 */
function setup(clock: () => Date = () => new Date(now)) {
  const repository = new EmailRepository();
  const provider = {
    signUpResult: { status: "verification_required" } as unknown,
    signInResult: tokens as unknown,
    confirmationResult: tokens as unknown,
    failure: null as AuthProviderError | null,
    calls: { signUp: [] as unknown[], signIn: [] as unknown[], confirm: [] as unknown[] },
    /**
     * 가입 요청과 실행 순서를 기록한 뒤 지정한 결과 또는 실패를 돌려주는 대역입니다.
     * @param args 가입 입력·콜백 URL·PKCE 챌린지 인자 목록.
     * @returns signUpResult에 지정된 테스트 응답.
     * @throws provider.failure가 설정돼 있으면 그 오류.
     */
    signUp: vi.fn(async (...args: unknown[]) => {
      repository.events.push("provider-signup");
      provider.calls.signUp.push(args);
      if (provider.failure) throw provider.failure;
      return provider.signUpResult;
    }),
    /**
     * 로그인 입력을 기록하고 지정한 토큰 응답 또는 실패를 재현합니다.
     * @param input 서비스가 전달한 로그인 입력.
     * @returns signInResult 테스트 응답.
     * @throws 설정된 제공자 오류.
     */
    signInWithPassword: vi.fn(async (input: unknown) => {
      provider.calls.signIn.push(input);
      if (provider.failure) throw provider.failure;
      return provider.signInResult;
    }),
    /**
     * 메일 확인 코드 교환의 입력과 순서를 기록하고 지정 결과를 반환합니다.
     * @param input 확인 코드와 PKCE 검증값.
     * @returns confirmationResult 테스트 응답.
     * @throws 설정된 제공자 오류.
     */
    confirmEmail: vi.fn(async (input: unknown) => {
      repository.events.push("provider-confirm");
      provider.calls.confirm.push(input);
      if (provider.failure) throw provider.failure;
      return provider.confirmationResult;
    }),
  };
  const sessions = {
    /**
     * 세션 생성 순서를 기록하고 고정된 공개 세션 정보를 반환합니다. 실제 세션은 저장하지 않습니다.
     * @returns 테스트 식별자·접근 토큰 만료·하루 뒤 절대 만료 정보.
     */
    create: vi.fn(async () => {
      repository.events.push("session");
      return { selector: "opaque-session-selector", accessTokenExpiresAt: tokens.accessTokenExpiresAt, absoluteExpiresAt: new Date(now.getTime() + 86_400_000) };
    }),
  };
  expect(EmailAuthService).toBeTypeOf("function");
  const service = new EmailAuthService!(provider, sessions, repository, keyring, () => transactionId, () => verifier, clock);
  const context = {
    emailRedirectUrl: new URL("https://app.example.test/auth/confirm"),
    passwordResetRedirectUrl: new URL("https://app.example.test/auth/recovery"),
    interactionSelector: interaction,
    now,
  };
  return { repository, provider, sessions, service, context };
}

describe("EmailAuthService PKCE confirmation continuity", () => {
  it.each([
    "https://app.example.test/confirm",
    new URL("https://user:password@app.example.test/confirm"),
    new URL("https://app.example.test/confirm#fragment"),
    new URL("http://remote.example.test/confirm"),
  ])("rejects unsafe callback input before persistence %#", async (emailRedirectUrl) => {
    const subject = setup();
    await expect(subject.service.signUp(validInput, { ...subject.context, emailRedirectUrl }))
      .rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.repository.events).toEqual([]);
  });

  it("accepts explicit loopback HTTP callbacks", async () => {
    const subject = setup();
    await expect(subject.service.signUp(validInput, { ...subject.context, emailRedirectUrl: new URL("http://localhost:3000/confirm") }))
      .resolves.toEqual({ accepted: true });
    expect(subject.provider.calls.signUp[0]).toEqual([validInput, new URL("http://localhost:3000/confirm"), expect.any(String)]);
  });

  it.each(["signUp", "signIn"] as const)("rejects malformed %s input before external effects", async (method) => {
    const subject = setup();
    await expect(subject.service[method]({}, subject.context)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(subject.repository.events).toEqual([]);
    expect(subject.provider.calls.signIn).toEqual([]);
  });

  it("rejects an invalid generated ID and an overflowing confirmation lifetime", async () => {
    const subject = setup();
    const invalidId = new EmailAuthService!(subject.provider, subject.sessions, subject.repository, keyring, () => "invalid", () => verifier);
    await expect(invalidId.signUp(validInput, subject.context)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await expect(subject.service.signUp(validInput, { ...subject.context, now: new Date(8_640_000_000_000_000) }))
      .rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.repository.record).toBeNull();
    expect(subject.provider.signUp).not.toHaveBeenCalled();
  });

  it("hides signup verification-required responses and unknown provider failures", async () => {
    const subject = setup();
    subject.provider.failure = new AuthProviderError("AUTH_EMAIL_VERIFICATION_REQUIRED");
    await expect(subject.service.signUp(validInput, subject.context)).resolves.toEqual({ accepted: true });
    subject.provider.signInWithPassword.mockRejectedValueOnce(new Error("private-provider-detail"));
    await expect(subject.service.signIn(validInput, subject.context))
      .rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", message: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects token metadata inconsistent with a verified user", async () => {
    const subject = setup();
    subject.provider.signInResult = { ...tokens, accessToken: "" };
    await expect(subject.service.signIn(validInput, subject.context)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    { interactionHash: Buffer.alloc(32, 9) },
    { consumedAt: null },
    { expiresAt: new Date(now.getTime() + 900_001) },
  ])("rejects malformed claimed transactions before exchanging codes %#", async (override) => {
    const subject = setup();
    await subject.service.signUp(validInput, subject.context);
    vi.spyOn(subject.repository, "claimEmailConfirmationTransaction").mockResolvedValueOnce({ ...subject.repository.record!, consumedAt: now, ...override });
    await expect(subject.service.confirmEmail({ code: "code" }, subject.context))
      .rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.confirmEmail).not.toHaveBeenCalled();
    expect(subject.sessions.create).not.toHaveBeenCalled();
  });

  it("hides unexpected storage failures during confirmation", async () => {
    const subject = setup();
    vi.spyOn(subject.repository, "claimEmailConfirmationTransaction").mockRejectedValueOnce(new Error("private-storage-detail"));
    await expect(subject.service.confirmEmail({ code: "code" }, subject.context))
      .rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID", message: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.confirmEmail).not.toHaveBeenCalled();
  });

  it("uses the default clock and generators without exposing provider tokens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      const subject = setup();
      const service = new EmailAuthService!(subject.provider, subject.sessions, subject.repository, keyring);
      await expect(service.signUp(validInput, subject.context)).resolves.toEqual({ accepted: true });
      expect(subject.repository.record?.id).toMatch(/^[0-9a-f-]{36}$/u);
      const result = await service.signIn(validInput, subject.context);
      expect(result).toMatchObject({ user: tokens.user, selector: "opaque-session-selector" });
      expect(subject.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ userId }), now);
      expect(JSON.stringify(result)).not.toContain(tokens.accessToken);
    } finally { vi.useRealTimers(); }
  });

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

  it("accepts a sign-in token issued in the next second using a post-provider clock sample", async () => {
    const providerCompletedAt = new Date(now.getTime() + 1_000);
    const subject = setup(() => providerCompletedAt);
    subject.provider.signInResult = { ...tokens, issuedAtSeconds: Math.floor(providerCompletedAt.getTime() / 1000) };

    await expect(subject.service.signIn(validInput, subject.context)).resolves.toMatchObject({ selector: "opaque-session-selector" });
    expect(subject.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ issuedAtSeconds: Math.floor(providerCompletedAt.getTime() / 1000) }), providerCompletedAt);
  });

  it.each([1, 60])("accepts provider clock skew of %i seconds for sign-in and confirmation", async (skewSeconds) => {
    const subject = setup();
    const issuedAtSeconds = tokens.issuedAtSeconds + skewSeconds;
    const providerTokens = { ...tokens, issuedAtSeconds, accessTokenExpiresAt: new Date(now.getTime() + 3600_000) };
    subject.provider.signInResult = providerTokens;
    subject.provider.confirmationResult = providerTokens;
    await expect(subject.service.signIn(validInput, subject.context)).resolves.toMatchObject({ selector: "opaque-session-selector" });
    await subject.service.signUp(validInput, subject.context);
    await expect(subject.service.confirmEmail({ code: "code" }, subject.context)).resolves.toMatchObject({ selector: "opaque-session-selector" });
    expect(subject.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ issuedAtSeconds }), now);
  });

  it.each([
    ["issuance beyond the clock skew bound", { issuedAtSeconds: tokens.issuedAtSeconds + 61, accessTokenExpiresAt: new Date(now.getTime() + 3600_000) }],
    ["actual expiry at the current time", { accessTokenExpiresAt: now }],
  ])("rejects %s for sign-in and confirmation", async (_label, override) => {
    const subject = setup();
    subject.provider.signInResult = { ...tokens, ...override };
    subject.provider.confirmationResult = { ...tokens, ...override };
    await expect(subject.service.signIn(validInput, subject.context)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await subject.service.signUp(validInput, subject.context);
    await expect(subject.service.confirmEmail({ code: "code" }, subject.context)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.sessions.create).not.toHaveBeenCalled();
  });

  it("accepts a confirmation token issued in the next second using a post-provider clock sample", async () => {
    const providerCompletedAt = new Date(now.getTime() + 1_000);
    const subject = setup(() => providerCompletedAt);
    subject.provider.confirmationResult = { ...tokens, issuedAtSeconds: Math.floor(providerCompletedAt.getTime() / 1000) };
    await subject.service.signUp(validInput, subject.context);

    await expect(subject.service.confirmEmail({ code: "code" }, subject.context)).resolves.toMatchObject({ selector: "opaque-session-selector" });
    expect(subject.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ issuedAtSeconds: Math.floor(providerCompletedAt.getTime() / 1000) }), providerCompletedAt);
  });

  it("fails closed when the post-provider clock is invalid", async () => {
    const subject = setup(() => new Date("invalid"));
    await expect(subject.service.signIn(validInput, subject.context)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.sessions.create).not.toHaveBeenCalled();
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
