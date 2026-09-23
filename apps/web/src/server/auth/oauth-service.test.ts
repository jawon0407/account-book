import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken, type TokenEnvelope, type TokenKeyring } from "../security/token-envelope.js";
import { AuthProviderError } from "./auth-provider-port.js";

vi.mock("server-only", () => ({}));
const module = await import("./oauth-service.js").catch(() => ({} as Record<string, unknown>));
const OAuthService = module.OAuthService as (new (...args: unknown[]) => {
  start(provider: unknown, context: unknown): Promise<unknown>;
  complete(callback: unknown, context: unknown): Promise<unknown>;
}) | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const transactionId = "123e4567-e89b-12d3-a456-426614174010";
const userId = "123e4567-e89b-12d3-a456-426614174011";
const providerSessionId = "123e4567-e89b-12d3-a456-426614174012";
const state = Buffer.alloc(32, 1).toString("base64url");
const interaction = Buffer.alloc(32, 2).toString("base64url");
const otherInteraction = Buffer.alloc(32, 3).toString("base64url");
const verifier = "v".repeat(43);
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

type RecordShape = {
  id: string;
  stateHash: Uint8Array;
  interactionHash: Uint8Array;
  provider: "google" | "kakao" | "naver";
  encryptedPkceVerifier: TokenEnvelope;
  returnPath: "/app" | "/settings/security";
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

class OAuthRepository {
  public record: RecordShape | null = null;
  public events: string[] = [];

  /**
   * OAuth 저장 순서를 기록하고 두 해시를 복사해 한 레코드만 메모리에 보관합니다.
   * @param record 저장할 OAuth 테스트 레코드.
   * @returns 저장 후 값 없이 완료합니다.
   */
  public async createOAuthTransaction(record: RecordShape): Promise<void> {
    this.events.push("create");
    this.record = { ...record, stateHash: Uint8Array.from(record.stateHash), interactionHash: Uint8Array.from(record.interactionHash) };
  }

  /**
   * 제공자·state·브라우저 해시·기한이 일치하는 미소비 레코드를 한 번 소비하는 대역입니다.
   * @param input 기대 바인딩 값과 현재 시각.
   * @returns 소비한 레코드 또는 불일치하면 null.
   */
  public async claimOAuthTransaction(input: { provider: string; stateHash: Uint8Array; interactionHash: Uint8Array; now: Date }): Promise<RecordShape | null> {
    this.events.push("claim");
    const record = this.record;
    if (
      record === null ||
      record.consumedAt !== null ||
      record.provider !== input.provider ||
      !Buffer.from(record.stateHash).equals(Buffer.from(input.stateHash)) ||
      !Buffer.from(record.interactionHash).equals(Buffer.from(input.interactionHash)) ||
      record.expiresAt.getTime() <= input.now.getTime()
    ) return null;
    this.record = { ...record, consumedAt: new Date(input.now) };
    return this.record;
  }
}

/**
 * 고정된 난수·콜백 컨텍스트와 호출 기록 대역으로 OAuth 테스트 환경을 구성합니다.
 * @param clock 제공자 응답 이후 시각을 제어할 함수.
 * @returns 서비스·저장소·제공자·세션 대역과 시작/완료 컨텍스트.
 */
function setup(clock: () => Date = () => new Date(now.getTime() + 1_000)) {
  const repository = new OAuthRepository();
  const provider = {
    calls: { start: [] as unknown[], exchange: [] as unknown[] },
    /**
     * 제공자 시작 요청과 순서를 기록하고 고정 인증 URL을 돌려줍니다.
     * @param input 제공자·콜백·PKCE 챌린지.
     * @returns 테스트 인증 URL.
     */
    startOAuth: vi.fn(async (input: unknown) => {
      repository.events.push("provider-start");
      provider.calls.start.push(input);
      return { authorizationUrl: new URL("https://provider.example.test/authorize") };
    }),
    /**
     * 코드 교환 요청과 순서를 기록하고 정상 테스트 토큰을 돌려줍니다.
     * @param input OAuth 코드와 PKCE 검증값.
     * @returns 미리 정의한 제공자 토큰 쌍.
     */
    exchangeOAuthCode: vi.fn(async (input: unknown) => {
      repository.events.push("exchange");
      provider.calls.exchange.push(input);
      return tokens;
    }),
  };
  const sessions = {
    /**
     * 앱 세션 생성 순서를 기록하고 공개 결과만 반환하는 대역입니다.
     * @returns 고정 세션 식별자와 만료 정보.
     */
    create: vi.fn(async () => {
      repository.events.push("session");
      return { selector: "opaque-session-selector", accessTokenExpiresAt: tokens.accessTokenExpiresAt, absoluteExpiresAt: new Date(now.getTime() + 86_400_000) };
    }),
  };
  expect(OAuthService).toBeTypeOf("function");
  const service = new OAuthService!(repository, provider, sessions, keyring, () => transactionId, () => state, () => verifier, clock);
  const startContext = { callbackBaseUrl: new URL("https://app.example.test/auth/oauth/callback"), interactionSelector: interaction, returnPath: "/app", now };
  const completeContext = { interactionSelector: interaction, now: new Date(now.getTime() + 1_000) };
  return { repository, provider, sessions, service, startContext, completeContext };
}

/**
 * 실제 저장소 해시와 대조할 기대 SHA-256 값을 계산합니다.
 * @param value 테스트 state 또는 브라우저 식별자.
 * @returns 복사된 32바이트 해시.
 */
function digest(value: string): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(value, "utf8").digest());
}

describe("OAuthService", () => {
  it("persists only digests and an encrypted verifier before returning the authorize URL", async () => {
    const subject = setup();
    const result = await subject.service.start("google", subject.startContext) as Record<string, unknown>;
    const record = subject.repository.record;
    expect(record).not.toBeNull();
    expect(record?.stateHash).toEqual(digest(state));
    expect(record?.interactionHash).toEqual(digest(interaction));
    expect(record?.expiresAt.getTime()).toBe(now.getTime() + 10 * 60_000);
    expect(record?.consumedAt).toBeNull();
    expect(decryptToken(record?.encryptedPkceVerifier, { recordId: transactionId, tokenKind: "pkce" }, keyring)).toBe(verifier);
    expect(subject.repository.events).toEqual(["create", "provider-start"]);

    const providerInput = subject.provider.calls.start[0] as { redirectUrl: URL; codeChallenge: string };
    expect(providerInput.redirectUrl.toString()).toBe(`https://app.example.test/auth/oauth/callback?provider=google&state=${state}`);
    expect(providerInput.codeChallenge).toBe(createHash("sha256").update(verifier, "ascii").digest("base64url"));
    expect(result).toEqual({ authorizationUrl: new URL("https://provider.example.test/authorize") });
    const serialized = JSON.stringify({ result, record });
    for (const secret of [state, interaction, verifier]) expect(serialized).not.toContain(secret);
  });

  it("accepts an exact loopback HTTP authorize URL and rejects arbitrary HTTP", async () => {
    const loopback = setup();
    loopback.provider.startOAuth.mockResolvedValueOnce({ authorizationUrl: new URL("http://localhost:54321/auth/v1/authorize") });
    await expect(loopback.service.start("google", loopback.startContext)).resolves.toEqual({ authorizationUrl: new URL("http://localhost:54321/auth/v1/authorize") });

    const publicHttp = setup();
    publicHttp.provider.startOAuth.mockResolvedValueOnce({ authorizationUrl: new URL("http://provider.example.test/authorize") });
    await expect(publicHttp.service.start("google", publicHttp.startContext)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  });

  it("claims before exchange and returns only opaque session metadata plus the stored return path", async () => {
    const subject = setup();
    await subject.service.start("naver", { ...subject.startContext, returnPath: "/settings/security" });
    subject.repository.events.length = 0;

    const result = await subject.service.complete({ provider: "naver", state, code: "provider-code" }, subject.completeContext);
    expect(subject.repository.events).toEqual(["claim", "exchange", "session"]);
    expect(subject.provider.calls.exchange).toEqual([{ code: "provider-code", codeVerifier: verifier }]);
    expect(result).toMatchObject({ selector: "opaque-session-selector", user: tokens.user, returnPath: "/settings/security" });
    const serialized = JSON.stringify(result);
    for (const secret of [state, interaction, verifier, "provider-code", tokens.accessToken, tokens.refreshToken]) expect(serialized).not.toContain(secret);
  });

  it("validates and creates with a fresh time sampled after a next-second provider exchange", async () => {
    const providerCompletedAt = new Date(now.getTime() + 2_000);
    const subject = setup(() => providerCompletedAt);
    const nextSecondTokens = { ...tokens, issuedAtSeconds: Math.floor(providerCompletedAt.getTime() / 1000) };
    subject.provider.exchangeOAuthCode.mockResolvedValueOnce(nextSecondTokens);
    await subject.service.start("google", subject.startContext);

    await expect(subject.service.complete({ provider: "google", state, code: "code" }, subject.completeContext)).resolves.toMatchObject({ selector: "opaque-session-selector" });
    expect(subject.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ issuedAtSeconds: nextSecondTokens.issuedAtSeconds }), providerCompletedAt);
  });

  it("fails closed when the post-provider clock is invalid", async () => {
    const subject = setup(() => new Date("invalid"));
    await subject.service.start("google", subject.startContext);
    await expect(subject.service.complete({ provider: "google", state, code: "code" }, subject.completeContext)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(subject.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", (subject: ReturnType<typeof setup>) => ({ ...subject.completeContext, now: new Date(now.getTime() + 10 * 60_000) }), {}],
    ["wrong provider", (subject: ReturnType<typeof setup>) => subject.completeContext, { provider: "kakao" }],
    ["wrong state", (subject: ReturnType<typeof setup>) => subject.completeContext, { state: Buffer.alloc(32, 4).toString("base64url") }],
    ["wrong browser", (subject: ReturnType<typeof setup>) => ({ ...subject.completeContext, interactionSelector: otherInteraction }), {}],
  ] as const)("rejects an %s callback before provider exchange", async (_label, context, callback) => {
    const subject = setup();
    await subject.service.start("google", subject.startContext);
    await expect(subject.service.complete({ provider: "google", state, code: "code", ...callback }, context(subject))).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID", message: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.exchangeOAuthCode).not.toHaveBeenCalled();
  });

  it("rejects replay and lets only one concurrent callback reach the provider", async () => {
    const subject = setup();
    await subject.service.start("google", subject.startContext);
    const callback = { provider: "google", state, code: "code" };
    const results = await Promise.allSettled([
      subject.service.complete(callback, subject.completeContext),
      subject.service.complete(callback, subject.completeContext),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(subject.provider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
  });

  it("keeps a provider-failed claim unusable", async () => {
    const subject = setup();
    await subject.service.start("google", subject.startContext);
    subject.provider.exchangeOAuthCode.mockRejectedValueOnce(new AuthProviderError("AUTH_PROVIDER_UNAVAILABLE"));
    const callback = { provider: "google", state, code: "secret-code" };
    await expect(subject.service.complete(callback, subject.completeContext)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    await expect(subject.service.complete(callback, subject.completeContext)).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.provider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
  });

  it.each([
    { returnPath: "/admin" },
    { callbackBaseUrl: new URL("http://public.example.test/callback") },
    { callbackBaseUrl: new URL("https://user:pass@app.example.test/callback") },
    { callbackBaseUrl: new URL("https://app.example.test/callback#fragment") },
    { callbackBaseUrl: new URL("https://app.example.test/callback?state=duplicate") },
    { callbackBaseUrl: new URL("https://app.example.test/callback?provider=duplicate") },
    { interactionSelector: "bad" },
    { now: new Date("invalid") },
  ])("rejects unsafe start context before persistence %#", async (override) => {
    const subject = setup();
    await expect(subject.service.start("google", { ...subject.startContext, ...override })).rejects.toMatchObject({ code: "AUTH_OAUTH_TRANSACTION_INVALID" });
    expect(subject.repository.record).toBeNull();
    expect(subject.provider.startOAuth).not.toHaveBeenCalled();
  });

  it("rejects malformed callback values without echoing them or claiming", async () => {
    const subject = setup();
    await subject.service.start("google", subject.startContext);
    for (const callback of [
      { provider: "github", state, code: "code" },
      { provider: "google", state: "bad-state", code: "code" },
      { provider: "google", state, code: "bad\ncode" },
    ]) {
      await expect(subject.service.complete(callback, subject.completeContext)).rejects.toSatisfy((error: unknown) => {
        const message = (error as Error).message;
        return message === "AUTH_OAUTH_TRANSACTION_INVALID" && !JSON.stringify(callback).includes(message);
      });
    }
    expect(subject.provider.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(subject.repository.record?.consumedAt).toBeNull();
  });
});
