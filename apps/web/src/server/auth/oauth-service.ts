import { randomUUID } from "node:crypto";
import { AuthProviderSchema, CurrentUserSchema, type AuthProvider, type CurrentUser } from "@account-book/contracts";
import type { AuthRepository, OAuthTransactionRecord } from "../persistence/auth-repository.js";
import { createPkceVerifier, derivePkceChallenge } from "../security/pkce.js";
import { createSessionSelector, hashSessionSelector } from "../security/session-selector.js";
import { decryptToken, encryptToken, type TokenKeyring } from "../security/token-envelope.js";
import type { SessionTokenPair } from "../session/session-service.js";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OAUTH_LIFETIME_MS = 10 * 60_000;
const RETURN_PATHS = new Set(["/app", "/settings/security"]);

/** Trusted request context required to begin one interaction-bound OAuth transaction. */
export type OAuthStartContext = Readonly<{
  callbackBaseUrl: URL;
  interactionSelector: string;
  returnPath: "/app" | "/settings/security";
  now: Date;
}>;
/** Browser callback values accepted only after exact transaction matching. */
export type OAuthCallback = Readonly<{ provider: AuthProvider; state: string; code: string }>;
/** Existing pre-auth browser interaction and trusted time for callback completion. */
export type OAuthCompleteContext = Readonly<{ interactionSelector: string; now: Date }>;
type SessionCreator = Readonly<{
  /**
   * 검증된 제공자 토큰을 앱 세션으로 저장하는 최소 경계입니다. 원문 토큰은 반환하지 않습니다.
   * @param tokens 서버가 보관할 제공자 접근·갱신 토큰과 소유자·만료 정보.
   * @param now 세션 생성 기준 시각.
   * @returns 브라우저용 불투명 식별자와 접근 토큰·앱 세션의 만료 시각.
   * @throws 세션 검증·암호화·저장 실패.
   */
  create(tokens: SessionTokenPair, now: Date): Promise<Readonly<{ selector: string; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>>
}>;
type PublicResult = Readonly<{ selector: string; user: CurrentUser; accessTokenExpiresAt: Date; absoluteExpiresAt: Date; returnPath: "/app" | "/settings/security" }>;

/** Fixed OAuth use-case error that never includes callback or provider values. */
export class OAuthServiceError extends Error {
  /** Creates one allowlisted OAuth failure without retaining submitted values. */
  /**
   * 외부 입력을 담지 않고 허용된 코드만 보관하는 서비스 오류를 만듭니다.
   * @param code 호출자에게 전달할 고정 오류 코드.
   */
  public constructor(public readonly code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID") {
    super(code);
    this.name = "OAuthServiceError";
  }
}

/**
 * OAuth 요청값을 숨기고 허용된 오류 코드로 흐름을 중단합니다.
 * @param code 실패 코드; 기본값은 잘못된 OAuth 트랜잭션.
 * @returns 반환하지 않습니다.
 * @throws OAuthServiceError.
 */
function fail(code: AuthProviderErrorCode = "AUTH_OAUTH_TRANSACTION_INVALID"): never { throw new OAuthServiceError(code); }
/**
 * 값이 실제 Date이고 유한한 시각을 가리키는지 확인합니다.
 * @param value 검사할 값.
 * @returns 유효한 날짜이면 true.
 */
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
/**
 * 제공자 호출이 끝난 뒤 시계를 다시 읽어 응답 지연을 반영한 시각을 복사합니다.
 * @param clock 현재 Date를 반환하는 함수.
 * @returns 유효한 완료 시각의 복사본.
 * @throws 시계가 잘못된 값을 주면 가용성 오류.
 */
function postProviderTime(clock: () => Date): Date { const value = clock(); if (!validDate(value)) return fail("AUTH_PROVIDER_UNAVAILABLE"); return new Date(value); }
/**
 * 값이 소문자 16진수 UUID 형태인지 확인합니다.
 * @param value 검사할 식별자.
 * @returns 문자열 형식이 맞으면 true.
 */
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
/**
 * 로그인 완료 후 이동할 경로를 두 개의 내부 허용 경로로 제한합니다.
 * @param value 검사할 이동 경로.
 * @returns /app 또는 /settings/security.
 * @throws 허용되지 않은 경로이면 OAuth 오류.
 */
function validReturnPath(value: unknown): "/app" | "/settings/security" { if (typeof value !== "string" || !RETURN_PATHS.has(value)) return fail(); return value as "/app" | "/settings/security"; }
/**
 * 콜백 코드가 비어 있지 않고 4096자 이하이며 앞뒤 공백·제어문자가 없는지 검사합니다.
 * @param value 외부 콜백 코드.
 * @returns 검증된 원래 문자열.
 * @throws 검증 실패 시 인증 트랜잭션 오류.
 */
function validCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail();
  return value;
}
/**
 * 신뢰된 콜백 URL을 복사하고 HTTPS/로컬 HTTP 및 인증정보·해시·기존 provider/state 부재를 확인합니다.
 * @param value 서버 콜백 기본 URL.
 * @returns 검증된 URL 복사본.
 * @throws 허용되지 않은 URL이면 OAuth 오류.
 */
function validCallbackBase(value: unknown): URL {
  if (!(value instanceof URL)) return fail();
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (local && url.protocol === "http:")) || url.searchParams.has("provider") || url.searchParams.has("state")) return fail();
  return url;
}
/**
 * 제공자 이동 URL이 HTTPS 또는 로컬 HTTP이며 인증정보·해시가 없는지 검사합니다.
 * @param value 제공자가 반환한 URL.
 * @returns 검증된 URL 복사본.
 * @throws 잘못된 값이면 제공자 가용성 오류.
 */
function validAuthorizeUrl(value: unknown): URL {
  if (!(value instanceof URL)) return fail("AUTH_PROVIDER_UNAVAILABLE");
  const url = new URL(value.toString());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (local && url.protocol === "http:")) || url.username !== "" || url.password !== "" || url.hash !== "") return fail("AUTH_PROVIDER_UNAVAILABLE");
  return url;
}
/**
 * 날짜에 지정한 밀리초를 더하고 결과가 유효한지 검사합니다.
 * @param date 기준 날짜.
 * @param milliseconds 더할 시간(밀리초).
 * @returns 새 Date 객체.
 * @throws 날짜 범위를 벗어나면 OAuth 오류.
 */
function shifted(date: Date, milliseconds: number): Date {
  const result = new Date(date.getTime() + milliseconds);
  if (!validDate(result)) return fail();
  return result;
}
/**
 * state 또는 브라우저 식별자를 검증하고 해시로 바꾸며 오류를 OAuth 경계로 통일합니다.
 * @param value 해시로 바꿀 식별자.
 * @returns 32바이트 SHA-256 해시.
 * @throws 잘못된 식별자이면 OAuth 오류.
 */
function selectorHash(value: unknown): Uint8Array {
  try { return hashSessionSelector(value as string); } catch { return fail(); }
}
/**
 * 두 해시가 모두 32바이트이고 내용이 동일한지 비교합니다.
 * @param left 첫 번째 해시.
 * @param right 두 번째 해시.
 * @returns 길이와 내용이 모두 같으면 true.
 */
function sameDigest(left: Uint8Array, right: Uint8Array): boolean { return left.length === 32 && right.length === 32 && Buffer.from(left).equals(Buffer.from(right)); }
/**
 * 사용자 인증·토큰 소유권·UUID·발급과 만료 시각을 확인해 앱 세션 생성 전 제공자 응답을 검증합니다.
 * @param value 제공자 토큰 쌍.
 * @param now 제공자 호출 완료 시각.
 * @returns 검증된 토큰 쌍.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
function trustedPair(value: AuthTokenPair, now: Date): AuthTokenPair {
  const user = CurrentUserSchema.safeParse(value?.user);
  if (
    !user.success || !user.data.emailVerified || user.data.id !== value?.userId || !validUuid(value?.userId) || !validUuid(value?.supabaseSessionId) ||
    typeof value?.accessToken !== "string" || value.accessToken.length === 0 || typeof value?.refreshToken !== "string" || value.refreshToken.length === 0 ||
    !Number.isSafeInteger(value?.issuedAtSeconds) || value.issuedAtSeconds <= 0 || value.issuedAtSeconds > Math.floor(now.getTime() / 1000) ||
    !validDate(value?.accessTokenExpiresAt) || value.accessTokenExpiresAt.getTime() <= now.getTime() || value.accessTokenExpiresAt.getTime() <= value.issuedAtSeconds * 1000
  ) return fail("AUTH_PROVIDER_UNAVAILABLE");
  return value;
}
/**
 * 사용 처리된 OAuth 레코드가 제공자·state·브라우저와 일치하고 10분 기한과 허용 복귀 경로를 갖는지 확인합니다.
 * @param record 저장소에서 사용 처리 후 반환한 레코드.
 * @param input 기대한 제공자·해시·기준 시각.
 * @returns 검증된 레코드.
 * @throws 불일치·만료·잘못된 상태이면 OAuth 오류.
 */
function trustedClaim(record: OAuthTransactionRecord, input: { provider: AuthProvider; stateHash: Uint8Array; interactionHash: Uint8Array; now: Date }): OAuthTransactionRecord {
  if (
    !validUuid(record?.id) || record?.provider !== input.provider || !sameDigest(record?.stateHash, input.stateHash) || !sameDigest(record?.interactionHash, input.interactionHash) ||
    !validDate(record?.createdAt) || !validDate(record?.expiresAt) || !validDate(record?.consumedAt) || record.expiresAt.getTime() <= input.now.getTime() ||
    record.expiresAt.getTime() - record.createdAt.getTime() !== OAUTH_LIFETIME_MS || !validReturnPath(record?.returnPath)
  ) return fail();
  return record;
}
/**
 * 알려진 서비스 오류는 유지하고 제공자 오류는 허용 코드로 옮기며 나머지는 가용성 오류로 숨깁니다.
 * @param error 하위 계층에서 발생한 오류.
 * @returns 반환하지 않습니다.
 * @throws 해당 인증 서비스의 고정 코드 오류.
 */
function providerFailure(error: unknown): never {
  if (error instanceof OAuthServiceError) throw error;
  if (error instanceof AuthProviderError) return fail(error.code);
  return fail("AUTH_PROVIDER_UNAVAILABLE");
}

/** Owns OAuth state, PKCE persistence, atomic callback claim, and opaque-session creation. */
export class OAuthService {
  /** Installs narrow persistence/provider/session ports and injectable cryptographic generators for deterministic tests. */
  /**
   * OAuth에 필요한 저장소·제공자·세션 생성기와 난수·시계 함수를 연결합니다.
   * @param repository OAuth 저장 및 원자적 사용 처리 기능.
   * @param provider 인증 URL 생성·코드 교환 기능.
   * @param sessions 앱 세션 생성 기능.
   * @param keyring PKCE 검증값 암호화 키.
   * @param createId 트랜잭션 UUID 생성 함수.
   * @param createState 브라우저 콜백 연결용 state 생성 함수.
   * @param createVerifier PKCE 비밀 검증값 생성 함수.
   * @param clock 제공자 응답 이후 시각을 얻는 함수.
   */
  public constructor(
    private readonly repository: Pick<AuthRepository, "createOAuthTransaction" | "claimOAuthTransaction">,
    private readonly provider: Pick<AuthProviderPort, "startOAuth" | "exchangeOAuthCode">,
    private readonly sessions: SessionCreator,
    private readonly keyring: TokenKeyring,
    private readonly createId: () => string = randomUUID,
    private readonly createState: () => string = createSessionSelector,
    private readonly createVerifier: () => string = createPkceVerifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Persists a ten-minute encrypted verifier before provider authorization.
   * @param providerValue - One approved provider identifier.
   * @param context - Trusted callback, interaction, return path, and time.
   * @returns Only the validated provider authorization URL.
   * @throws A fixed OAuth/provider code when validation, persistence, or the provider fails.
   */
  /**
   * 새 state와 PKCE를 만들고 암호화한 검증값을 10분 트랜잭션으로 먼저 저장합니다. 이후 제공자가 준 인증 URL을 검증합니다.
   * @param providerValue 검사 전 제공자 식별자.
   * @param context 신뢰된 콜백·브라우저·복귀 경로·시각.
   * @returns 브라우저를 보낼 인증 URL만 담은 객체.
   * @throws 입력·저장·제공자 실패의 고정 코드.
   */
  public async start(providerValue: unknown, context: OAuthStartContext): Promise<Readonly<{ authorizationUrl: URL }>> {
    try {
      const provider = AuthProviderSchema.safeParse(providerValue);
      if (!provider.success || !validDate(context?.now)) return fail();
      const callback = validCallbackBase(context?.callbackBaseUrl);
      const returnPath = validReturnPath(context?.returnPath);
      const interactionHash = selectorHash(context?.interactionSelector);
      const state = this.createState();
      const stateHash = selectorHash(state);
      const verifier = this.createVerifier();
      const codeChallenge = derivePkceChallenge(verifier);
      const id = this.createId();
      if (!validUuid(id)) return fail();
      callback.searchParams.set("provider", provider.data);
      callback.searchParams.set("state", state);
      await this.repository.createOAuthTransaction({
        id,
        stateHash,
        interactionHash,
        provider: provider.data,
        encryptedPkceVerifier: encryptToken(verifier, { recordId: id, tokenKind: "pkce" }, this.keyring),
        returnPath,
        createdAt: new Date(context.now),
        expiresAt: shifted(context.now, OAUTH_LIFETIME_MS),
        consumedAt: null,
      });
      const result = await this.provider.startOAuth({ provider: provider.data, redirectUrl: callback, codeChallenge });
      return { authorizationUrl: validAuthorizeUrl(result?.authorizationUrl) };
    } catch (error) { return providerFailure(error); }
  }

  /**
   * Claims the exact live callback before exchanging its code.
   * @param callback - Provider, state, and authorization code from the callback.
   * @param context - Existing browser interaction and trusted time.
   * @returns Opaque session metadata and the stored allowlisted return path.
   * @throws A fixed OAuth/provider code for invalid, replayed, expired, or failed callbacks.
   */
  /**
   * 제공자·state·브라우저가 일치하는 트랜잭션을 한 번만 사용 처리한 뒤 PKCE로 코드를 교환하고 앱 세션을 만듭니다.
   * @param callback 제공자·state·인증 코드.
   * @param context 기존 브라우저 식별자와 확인 시각.
   * @returns 공개 사용자·세션 정보와 저장해 둔 내부 복귀 경로.
   * @throws 재사용·만료·불일치·제공자 실패의 고정 코드.
   */
  public async complete(callback: OAuthCallback, context: OAuthCompleteContext): Promise<PublicResult> {
    try {
      const provider = AuthProviderSchema.safeParse(callback?.provider);
      if (!provider.success || !validDate(context?.now)) return fail();
      const code = validCode(callback?.code);
      const stateHash = selectorHash(callback?.state);
      const interactionHash = selectorHash(context?.interactionSelector);
      const input = { provider: provider.data, stateHash, interactionHash, now: new Date(context.now) };
      const claimed = await this.repository.claimOAuthTransaction(input);
      if (claimed === null) return fail();
      const record = trustedClaim(claimed, input);
      const codeVerifier = decryptToken(record.encryptedPkceVerifier, { recordId: record.id, tokenKind: "pkce" }, this.keyring);
      derivePkceChallenge(codeVerifier);
      const providerPair = await this.provider.exchangeOAuthCode({ code, codeVerifier });
      const completedAt = postProviderTime(this.clock);
      const pair = trustedPair(providerPair, completedAt);
      const created = await this.sessions.create({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, userId: pair.userId, supabaseSessionId: pair.supabaseSessionId, issuedAtSeconds: pair.issuedAtSeconds, accessTokenExpiresAt: pair.accessTokenExpiresAt }, completedAt);
      return { selector: created.selector, user: pair.user, accessTokenExpiresAt: created.accessTokenExpiresAt, absoluteExpiresAt: created.absoluteExpiresAt, returnPath: record.returnPath };
    } catch (error) {
      if (error instanceof OAuthServiceError || error instanceof AuthProviderError) return providerFailure(error);
      return fail();
    }
  }
}
