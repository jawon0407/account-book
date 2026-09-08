import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  AuthProviderSchema,
  CurrentUserSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type AuthProvider,
  type SignInInput,
  type SignUpInput,
} from "@account-book/contracts";
import { derivePkceChallenge, validatePkceChallenge } from "../security/pkce.js";
import {
  AuthProviderError,
  type AuthProviderErrorCode,
  type AuthProviderPort,
  type AuthTokenPair,
  type EmailAuthResult,
  type EmailConfirmationInput,
  type OAuthExchangeInput,
  type OAuthStartInput,
  type OAuthStartResult,
  type PasswordUpdateAtProviderInput,
  type RecoveryContext,
  type RecoveryExchangeInput,
} from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" } as const;
const SIGNUP_EXISTENCE_CODES = new Set(["user_already_exists", "email_exists", "user_already_registered", "email_already_exists", "user_already_exist"]);
const RESET_ABSENT_CODES = new Set(["user_not_found", "email_not_found", "user_not_exist", "email_not_exists", "user_does_not_exist"]);
const PKCE_TRANSACTION_CODES = new Set(["invalid_grant", "bad_code_verifier", "flow_state_expired", "flow_state_not_found", "otp_expired", "otp_disabled"]);
const EXPECTED_DISCLOSURE_STATUSES = new Set([400, 422]);

/** Validated public Supabase endpoint and anon key; service-role credentials are deliberately absent. */
export type SupabaseServerConfig = Readonly<{ url: string; anonKey: string }>;
type SupabaseClient = Readonly<{ auth: {
  /**
   * SDK에 이메일·비밀번호 로그인 요청을 맡기는 최소 인터페이스입니다.
   * @param input SDK 로그인 입력.
   * @returns SDK 원시 응답; 어댑터에서 검증합니다.
   */
  signInWithPassword(input: unknown): Promise<unknown>;
  /**
   * SDK에 갱신 토큰 교환을 맡기는 최소 인터페이스입니다.
   * @param input refresh_token을 포함한 SDK 입력.
   * @returns SDK 원시 응답.
   */
  refreshSession(input: unknown): Promise<unknown>;
  /**
   * 서버 요청용 SDK 클라이언트에 접근·갱신 토큰을 연결합니다.
   * @param input access_token·refresh_token 입력.
   * @returns SDK가 확인한 세션 응답.
   */
  setSession(input: unknown): Promise<unknown>;
  /**
   * 현재 SDK 세션의 로그아웃을 요청하는 최소 인터페이스입니다.
   * @returns SDK 성공 또는 오류 응답.
   */
  signOut(): Promise<unknown>;
  /**
   * 현재 SDK 사용자 정보를 변경하는 최소 인터페이스입니다.
   * @param input 변경할 비밀번호 등 사용자 필드.
   * @returns SDK 성공 또는 오류 응답.
   */
  updateUser(input: unknown): Promise<unknown>;
} }>;
/** Test seam for a fresh non-persistent Supabase client used only by non-PKCE operations. */
export type SupabaseClientFactory = (url: string, anonKey: string, auth: typeof AUTH_OPTIONS) => SupabaseClient;
/** Test seam for the explicit server-only Supabase Auth HTTP boundary. */
export type SupabaseFetch = typeof fetch;

/**
 * 제공자 내부값을 숨긴 고정 코드로 작업을 중단합니다.
 * @param code 공개 가능한 실패 코드.
 * @returns 반환하지 않습니다.
 * @throws AuthProviderError.
 */
function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new AuthProviderError(code); }
/**
 * 외부 값이 null이나 배열이 아닌 객체인지 검사합니다.
 * @param value 검사할 응답 후보.
 * @returns 문자열 키의 객체로 좁힌 값.
 * @throws 객체가 아니면 제공자 가용성 오류.
 */
function object(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
/**
 * ASCII 제어문자 포함 여부를 찾습니다.
 * @param value 검사할 문자열.
 * @returns 제어문자가 있으면 true.
 */
function hasControlCharacter(value: string): boolean { return Array.from(value).some((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127; }); }
/**
 * 빈 문자열·과도한 길이·앞뒤 공백·제어문자를 거부합니다.
 * @param value 검사할 문자열 후보.
 * @param max 허용 최대 문자 수; 기본 16384.
 * @returns 검증된 문자열.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
function nonEmpty(value: unknown, max = 16_384): string { if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || hasControlCharacter(value)) return fail(); return value; }
/**
 * 서버 토큰에 공통 문자열 제한을 적용합니다.
 * @param value 토큰 후보.
 * @returns 검증된 토큰 문자열.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
function token(value: unknown): string { return nonEmpty(value); }
/**
 * 사용자 또는 제공자 세션 ID의 소문자 UUID 형식을 확인합니다.
 * @param value 검사할 ID.
 * @returns 검증된 UUID 문자열.
 * @throws 형식이 다르면 제공자 가용성 오류.
 */
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) return fail(); return value; }
/**
 * HTTP(S) URL을 복사하며 인증정보·해시를 금지합니다. HTTP는 명시적으로 허용한 로컬 호스트에서만 가능합니다.
 * @param value URL 객체 또는 문자열.
 * @param allowDevelopmentHttp 로컬 HTTP를 허용할지 여부.
 * @returns 검증된 URL.
 * @throws 잘못된 URL이면 제공자 가용성 오류.
 */
function safeUrl(value: unknown, allowDevelopmentHttp: boolean): URL {
  if (!(value instanceof URL) && typeof value !== "string") return fail();
  let url: URL;
  try { url = new URL(value.toString()); } catch { return fail(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (allowDevelopmentHttp && local && url.protocol === "http:")) || hasControlCharacter(url.href)) return fail();
  return url;
}
/**
 * Supabase 기본 URL을 루트 경로로 제한하고 공개 anon 키의 문자열 형식을 검사합니다.
 * @param input 서버용 공개 URL과 anon 키.
 * @returns 정규화된 URL과 검증한 키.
 * @throws 설정 검증 실패 시 제공자 가용성 오류.
 */
function config(input: SupabaseServerConfig): SupabaseServerConfig {
  const url = safeUrl(input?.url, true);
  if (url.pathname !== "/" || url.search !== "") return fail();
  return { url: url.toString(), anonKey: nonEmpty(input?.anonKey) };
}
/**
 * 외부 오류 객체에서 문자열 code만 안전하게 골라냅니다.
 * @param value 제공자 응답 후보.
 * @returns 문자열 오류 코드 또는 없으면 빈 문자열.
 */
function providerCode(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}
/**
 * HTTP/SDK 오류와 PKCE 교환 여부에 따라 제한·미인증·잘못된 자격 증명·트랜잭션·가용성의 허용 코드로 변환합니다.
 * @param value 원시 제공자 오류.
 * @param status 직접 HTTP 응답의 상태 코드; SDK일 때 생략.
 * @param pkce PKCE 교환 실패인지 여부.
 * @returns 민감한 원문을 담지 않은 AuthProviderError.
 */
function mappedProviderError(value: unknown, status?: number, pkce = false): AuthProviderError {
  const error = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const isHttp = status !== undefined;
  const providerStatus = status ?? (typeof error.status === "number" ? error.status : undefined);
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (providerStatus === 429 || (!isHttp && (code === "over_request_rate_limit" || code === "rate_limit_exceeded"))) return new AuthProviderError("AUTH_RATE_LIMITED");
  if (!isHttp && (code === "email_not_confirmed" || message === "email not confirmed")) return new AuthProviderError("AUTH_EMAIL_VERIFICATION_REQUIRED");
  if (pkce) {
    if ((providerStatus === 400 || providerStatus === 401) && PKCE_TRANSACTION_CODES.has(code)) return new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID");
    return new AuthProviderError();
  }
  if (isHttp) return new AuthProviderError();
  if (providerStatus === 400 || providerStatus === 401 || ["invalid_credentials", "invalid_grant", "bad_code_verifier"].includes(code)) return new AuthProviderError("AUTH_INVALID_CREDENTIALS");
  if (["flow_state_expired", "flow_state_not_found", "otp_expired", "otp_disabled", "same_password"].includes(code)) return new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID");
  return new AuthProviderError();
}
/**
 * SDK 응답에서 오류를 먼저 확인하고 data가 객체인지 검사합니다.
 * @param value SDK 원시 응답.
 * @returns 검증된 data 객체.
 * @throws SDK 오류를 고정 코드로 바꾸거나 형식 오류를 던집니다.
 */
function dataOf(value: unknown): Record<string, unknown> {
  const response = object(value);
  if (response.error !== null && response.error !== undefined) throw mappedProviderError(response.error);
  return object(response.data);
}
/**
 * 반환 데이터가 필요 없는 SDK 응답에서 error 유무를 확인합니다.
 * @param value SDK 원시 응답.
 * @returns 오류가 없으면 값 없이 종료합니다.
 * @throws SDK 오류 또는 응답 형식 오류.
 */
function accepted(value: unknown): void {
  const response = object(value);
  if (response.error !== null && response.error !== undefined) throw mappedProviderError(response.error);
}
/**
 * JWT 한 구간이 빈 값 없는 표준 base64url인지 해독·재인코딩으로 확인합니다.
 * @param value JWT 헤더·페이로드·서명 구간.
 * @returns 검증된 원래 구간.
 * @throws 잘못된 표기이면 제공자 가용성 오류.
 */
function canonicalSegment(value: unknown): string {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) return fail();
  return value;
}
/**
 * JWT의 세 구간과 사용자·세션 ID, 발급·만료 시각을 읽고 검사합니다. 이 함수 자체는 암호학적 서명 검증을 하지 않습니다.
 * @param accessToken 신뢰된 제공자 응답에서 받은 접근 JWT.
 * @returns 사용자 ID·제공자 세션 ID·발급 초·만료 초.
 * @throws 구조·JSON·클레임·시각 오류 시 제공자 가용성 오류.
 */
function jwtClaims(accessToken: string): Readonly<{ userId: string; sessionId: string; issuedAt: number; expiresAt: number }> {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return fail();
  try {
    canonicalSegment(parts[0]!);
    const payload = canonicalSegment(parts[1]!);
    canonicalSegment(parts[2]!);
    const claims = object(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const issuedAt = claims.iat;
    const expiresAt = claims.exp;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt <= 0 || issuedAt > nowSeconds ||
      typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt || expiresAt <= nowSeconds
    ) return fail();
    return { userId: uuid(claims.sub), sessionId: uuid(claims.session_id), issuedAt, expiresAt };
  } catch { return fail(); }
}
/**
 * 제공자 세션의 토큰과 이메일 인증 사용자, JWT 소유자와 만료 시각을 공통 검증합니다.
 * @param sessionValue 제공자 세션 후보.
 * @returns 원본 세션 객체·내부 토큰 쌍·파싱한 클레임.
 * @throws 미인증 사용자 또는 응답 불일치 오류.
 */
function commonTokenPair(sessionValue: unknown): Readonly<{ session: Record<string, unknown>; pair: AuthTokenPair; claims: ReturnType<typeof jwtClaims> }> {
  const session = object(sessionValue);
  const accessToken = token(session.access_token);
  const refreshToken = token(session.refresh_token);
  const user = object(session.user);
  const confirmation = user.email_confirmed_at;
  const confirmedAt = typeof confirmation === "string" ? new Date(confirmation) : new Date("invalid");
  const parsedUser = CurrentUserSchema.safeParse({ id: user.id, email: typeof user.email === "string" ? user.email : null, emailVerified: Number.isFinite(confirmedAt.getTime()) && confirmedAt.getTime() <= Date.now() });
  if (!parsedUser.success || !parsedUser.data.emailVerified) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  const claims = jwtClaims(accessToken);
  const userId = uuid(user.id);
  if (claims.userId !== userId) return fail();
  const accessTokenExpiresAt = new Date(claims.expiresAt * 1000);
  if (!Number.isFinite(accessTokenExpiresAt.getTime()) || accessTokenExpiresAt.getTime() <= Date.now()) return fail();
  const pair = { accessToken, refreshToken, userId, supabaseSessionId: claims.sessionId, issuedAtSeconds: claims.issuedAt, accessTokenExpiresAt, user: parsedUser.data };
  return { session, pair, claims };
}
/**
 * SDK 세션의 expires_at과 JWT exp가 정확히 같은지 추가 검증합니다.
 * @param sessionValue SDK 세션 응답.
 * @returns 검증된 내부 토큰 쌍.
 * @throws 공통 검증 또는 만료값 불일치 오류.
 */
function tokenPair(sessionValue: unknown): AuthTokenPair {
  const { session, pair, claims } = commonTokenPair(sessionValue);
  if (typeof session.expires_at !== "number" || !Number.isSafeInteger(session.expires_at) || claims.expiresAt !== session.expires_at) return fail();
  return pair;
}
/**
 * 직접 HTTP 세션의 bearer 타입·expires_in과 JWT 수명 일치 여부를 검증합니다.
 * @param sessionValue 직접 토큰 교환 JSON.
 * @returns 검증된 내부 토큰 쌍.
 * @throws 응답 형식·수명 불일치 오류.
 */
function rawTokenPair(sessionValue: unknown): AuthTokenPair {
  const { session, pair, claims } = commonTokenPair(sessionValue);
  const expiresIn = session.expires_in;
  if (session.token_type !== "bearer" || typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0 || claims.expiresAt - claims.issuedAt !== expiresIn) return fail();
  if (session.expires_at !== undefined && (typeof session.expires_at !== "number" || !Number.isSafeInteger(session.expires_at) || session.expires_at !== claims.expiresAt)) return fail();
  return pair;
}
/**
 * 인증 코드를 최대 4096자의 공통 문자열 규칙으로 검사합니다.
 * @param value 외부 인증 코드.
 * @returns 검증된 코드.
 * @throws 검증 실패 시 트랜잭션 오류.
 */
function code(value: unknown): string {
  try { return nonEmpty(value, 4096); } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
}
/**
 * PKCE 비밀값의 문자열 제한을 검사하고 챌린지 계산을 통해 RFC 허용 형식인지 확인합니다.
 * @param value 서버가 보관한 PKCE 검증값.
 * @returns 검증된 비밀 문자열.
 * @throws 검증 실패 시 트랜잭션 오류.
 */
function verifier(value: unknown): string {
  try {
    const safe = nonEmpty(value, 128);
    derivePkceChallenge(safe);
    return safe;
  } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
}
/**
 * 챌린지가 정확한 길이의 표준 S256 base64url인지 확인합니다.
 * @param value 챌린지 후보.
 * @returns 검증된 문자열.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
function challenge(value: unknown): string {
  try { return validatePkceChallenge(nonEmpty(value, 43)); } catch { return fail(); }
}
/**
 * 앱 제공자 ID를 Supabase가 사용하는 ID로 바꿉니다. 네이버만 custom:naver로 매핑합니다.
 * @param provider 허용된 앱 제공자.
 * @returns Supabase 제공자 문자열.
 */
function providerId(provider: AuthProvider): string { return provider === "naver" ? "custom:naver" : provider; }

type HttpResult = Readonly<{ ok: boolean; status: number; body: unknown }>;

/** Request-scoped Supabase adapter with an explicit server-owned PKCE HTTP boundary. */
export class SupabaseAuthAdapter implements AuthProviderPort {
  private readonly config: SupabaseServerConfig;
  private readonly factory: SupabaseClientFactory;
  private readonly fetcher: SupabaseFetch;

  /**
   * Validates public configuration and installs request-scoped SDK and HTTP seams.
   * @param configInput - Public Supabase URL and anon key; service-role credentials are forbidden.
   * @param factory - Optional factory for fresh non-persistent SDK clients.
   * @param fetcher - Optional fetch implementation for direct server-owned PKCE requests.
   * @throws {@link AuthProviderError} with `AUTH_PROVIDER_UNAVAILABLE` for unsafe configuration.
   */
  /**
   * 설정을 검증하고 각 작업에 새 비영속 SDK 클라이언트를 만들 팩토리와 직접 HTTP 함수를 연결합니다.
   * @param configInput Supabase 공개 URL과 anon 키.
   * @param factory 선택적 SDK 클라이언트 생성 함수.
   * @param fetcher 서버 PKCE 요청용 fetch 함수.
   * @throws 안전하지 않은 설정이면 AuthProviderError.
   */
  public constructor(configInput: SupabaseServerConfig, factory?: SupabaseClientFactory, fetcher: SupabaseFetch = fetch) {
    this.config = config(configInput);
    this.factory = factory ?? ((url, anonKey, auth) => createClient(url, anonKey, { auth }) as unknown as SupabaseClient);
    this.fetcher = fetcher;
  }

  /**
   * Posts signup with a trusted redirect and supplied S256 challenge.
   * @param input - Validated email and password input.
   * @param redirectUrl - Trusted HTTPS-or-loopback confirmation callback.
   * @param codeChallenge - Canonical S256 PKCE challenge.
   * @returns An enumeration-resistant verification acknowledgement.
   * @throws {@link AuthProviderError} with a fixed credential, rate, or availability code.
   */
  /**
   * 직접 HTTP 가입 요청에 S256 챌린지를 넣어 보냅니다. 응답이 계정 존재를 나타내도 인증 필요 응답으로 통일합니다.
   * @param input 검증된 가입 이메일·비밀번호.
   * @param redirectUrl 신뢰된 메일 확인 콜백.
   * @param codeChallenge 서버 PKCE 비밀값의 S256 해시.
   * @returns 메일 인증 필요 여부 또는 인증된 서버 토큰 쌍.
   * @throws 고정 코드의 AuthProviderError.
   */
  public async signUp(input: SignUpInput, redirectUrl: URL, codeChallenge: string): Promise<EmailAuthResult> {
    try {
      const parsed = SignUpInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const callback = safeUrl(redirectUrl, true);
      const result = await this.post("signup", { email: parsed.data.email, password: parsed.data.password, code_challenge: challenge(codeChallenge), code_challenge_method: "s256" }, callback);
      if (!result.ok) {
        if (EXPECTED_DISCLOSURE_STATUSES.has(result.status) && SIGNUP_EXISTENCE_CODES.has(providerCode(result.body))) return { status: "verification_required" };
        throw mappedProviderError(result.body, result.status);
      }
      return { status: "verification_required" };
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * Exchanges email credentials through a fresh non-persistent SDK client.
   * @param input - Validated email and password input.
   * @returns A strictly parsed, verified provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, verification, rate, or availability code.
   */
  /**
   * 새 비영속 SDK 클라이언트로 로그인하고 응답 토큰·사용자·만료 시각을 엄격히 파싱합니다.
   * @param input 검증된 로그인 입력.
   * @returns 메일 인증된 사용자의 서버 전용 토큰 쌍.
   * @throws 자격 증명·메일 미인증·요청 제한·가용성 오류.
   */
  public async signInWithPassword(input: SignInInput): Promise<AuthTokenPair> {
    try {
      const parsed = SignInInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      return tokenPair(dataOf(await this.client().auth.signInWithPassword(parsed.data)).session);
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * Exchanges one email-confirmation code with its matching server-owned verifier.
   * @param input - Confirmation code and canonical PKCE verifier.
   * @returns A strictly parsed raw provider token pair.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, verification, or availability code.
   */
  /**
   * 메일 확인 코드와 PKCE 비밀값을 직접 HTTP 교환 경로에 위임합니다.
   * @param input 확인 코드와 대응하는 PKCE 검증값.
   * @returns 검증된 서버 전용 토큰 쌍.
   * @throws 트랜잭션 또는 제공자 오류.
   */
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> {
    return this.exchange(input?.code, input?.codeVerifier);
  }

  /**
   * Constructs a Supabase authorize URL from the approved provider and S256 challenge.
   * @param input - Approved provider, trusted redirect, and canonical challenge.
   * @returns A validated HTTPS-or-loopback provider authorization URL.
   * @throws {@link AuthProviderError} with a fixed transaction or availability code.
   */
  /**
   * 허용된 제공자·콜백·챌린지로 Supabase 인증 URL을 구성합니다. 이 메서드 자체는 네트워크 요청을 보내지 않습니다.
   * @param input 제공자·신뢰된 콜백 URL·S256 챌린지.
   * @returns 검증된 제공자 인증 URL.
   * @throws 트랜잭션 또는 제공자 오류.
   */
  public async startOAuth(input: OAuthStartInput): Promise<OAuthStartResult> {
    try {
      const provider = AuthProviderSchema.safeParse(input?.provider);
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
      const authorize = new URL("auth/v1/authorize", this.config.url);
      authorize.searchParams.set("provider", providerId(provider.data));
      authorize.searchParams.set("redirect_to", safeUrl(input?.redirectUrl, true).toString());
      authorize.searchParams.set("code_challenge", challenge(input?.codeChallenge));
      authorize.searchParams.set("code_challenge_method", "s256");
      return { authorizationUrl: safeUrl(authorize, true) };
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * Exchanges one OAuth callback code with its matching server-owned verifier.
   * @param input - OAuth code and canonical PKCE verifier.
   * @returns A strictly parsed raw provider token pair.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, verification, or availability code.
   */
  /**
   * OAuth 코드와 PKCE 비밀값을 직접 HTTP 교환 경로에 위임합니다.
   * @param input OAuth 코드와 대응하는 PKCE 검증값.
   * @returns 검증된 서버 전용 토큰 쌍.
   * @throws 트랜잭션·요청 제한·제공자 오류.
   */
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> {
    return this.exchange(input?.code, input?.codeVerifier);
  }

  /**
   * Refreshes a server-held token through a fresh non-persistent SDK client.
   * @param refreshToken - Decrypted provider refresh token.
   * @returns A strictly parsed replacement provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, verification, rate, or availability code.
   */
  /**
   * 새 비영속 SDK 클라이언트로 갱신 토큰을 교환하고 새 세션 응답을 검사합니다.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 새 접근·갱신 토큰 및 사용자·만료 정보.
   * @throws 자격 증명·요청 제한·가용성 오류.
   */
  public async refresh(refreshToken: string): Promise<AuthTokenPair> {
    try { return tokenPair(dataOf(await this.client().auth.refreshSession({ refresh_token: token(refreshToken) })).session); } catch (error) { return this.rethrow(error); }
  }

  /**
   * Revokes a provider session through a fresh non-persistent SDK client.
   * @param accessToken - Decrypted provider access token.
   * @param refreshToken - Decrypted provider refresh token.
   * @returns Completion after provider revocation succeeds.
   * @throws {@link AuthProviderError} with a fixed auth failure code.
   */
  /**
   * 새 SDK 클라이언트에 토큰 쌍을 설정한 뒤 제공자 로그아웃을 호출하고 오류를 검사합니다.
   * @param accessToken 복호화한 제공자 접근 토큰.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 제공자 폐기가 완료되면 값 없이 종료합니다.
   * @throws 제공자 경계의 고정 오류.
   */
  public async signOut(accessToken: string, refreshToken: string): Promise<void> {
    try {
      const client = this.client();
      dataOf(await client.auth.setSession({ access_token: token(accessToken), refresh_token: token(refreshToken) }));
      accepted(await client.auth.signOut());
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * Posts password-recovery delivery with a trusted redirect and S256 challenge.
   * @param email - Validated recovery email.
   * @param redirectUrl - Trusted HTTPS-or-loopback recovery callback.
   * @param codeChallenge - Canonical S256 PKCE challenge.
   * @returns Completion after the enumeration-resistant provider request.
   * @throws {@link AuthProviderError} with a fixed credential, rate, or availability code.
   */
  /**
   * 이메일과 S256 챌린지를 직접 HTTP 복구 요청으로 보내며 알려진 계정 부재 응답은 성공으로 숨깁니다.
   * @param email 검증된 이메일.
   * @param redirectUrl 신뢰된 복구 콜백 URL.
   * @param codeChallenge PKCE S256 챌린지.
   * @returns 계정 존재 여부를 노출하지 않고 완료합니다.
   * @throws 자격 증명·요청 제한·가용성 오류.
   */
  public async requestPasswordReset(email: string, redirectUrl: URL, codeChallenge: string): Promise<void> {
    try {
      const parsed = PasswordResetRequestInputSchema.safeParse({ email });
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const result = await this.post("recover", { email: parsed.data.email, code_challenge: challenge(codeChallenge), code_challenge_method: "s256" }, safeUrl(redirectUrl, true));
      if (!result.ok && !(EXPECTED_DISCLOSURE_STATUSES.has(result.status) && RESET_ABSENT_CODES.has(providerCode(result.body)))) throw mappedProviderError(result.body, result.status);
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * Exchanges one recovery callback code with its matching server-owned verifier.
   * @param input - Recovery code and canonical PKCE verifier.
   * @returns Verified server-only recovery credentials and public user data.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, verification, or availability code.
   */
  /**
   * PKCE 코드 교환으로 얻은 토큰과 사용자만 복구 컨텍스트로 추립니다.
   * @param input 복구 코드와 PKCE 검증값.
   * @returns 서버 전용 복구 토큰과 공개 사용자 정보.
   * @throws 트랜잭션·요청 제한·제공자 오류.
   */
  public async exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext> {
    const pair = await this.exchange(input?.code, input?.codeVerifier);
    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, user: pair.user };
  }

  /**
   * Verifies recovered credentials belong to the expected user before updating a password.
   * @param input - Recovery tokens, expected user identifier, and validated new password.
   * @returns Completion after the matching provider user is updated.
   * @throws {@link AuthProviderError} with a fixed credential, transaction, verification, or availability code.
   */
  /**
   * 새 비밀번호를 검증하고 SDK 세션의 사용자 ID가 기대값과 일치하는지 확인한 뒤 비밀번호를 변경합니다.
   * @param input 복구 접근·갱신 토큰, 사용자 ID, 검증된 새 비밀번호.
   * @returns 비밀번호 변경이 완료되면 값 없이 종료합니다.
   * @throws 사용자 불일치·입력·제공자 오류.
   */
  public async updatePassword(input: PasswordUpdateAtProviderInput): Promise<void> {
    try {
      const password = PasswordUpdateInputSchema.safeParse({ password: input?.password });
      if (!password.success) return fail("AUTH_INVALID_CREDENTIALS");
      const expectedUserId = uuid(input?.userId);
      const client = this.client();
      const pair = tokenPair(dataOf(await client.auth.setSession({ access_token: token(input?.accessToken), refresh_token: token(input?.refreshToken) })).session);
      if (pair.userId !== expectedUserId) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
      accepted(await client.auth.updateUser({ password: password.data.password }));
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * 코드·PKCE 비밀값을 검증해 grant_type=pkce 토큰 엔드포인트에 POST하고 원시 토큰 응답을 검사합니다.
   * @param authCode 콜백 인증 코드.
   * @param codeVerifier 서버 PKCE 비밀값.
   * @returns 검증된 내부 토큰 쌍.
   * @throws HTTP·거래·응답 검증 실패의 고정 제공자 오류.
   */
  private async exchange(authCode: unknown, codeVerifier: unknown): Promise<AuthTokenPair> {
    try {
      const url = new URL("auth/v1/token", this.config.url);
      url.searchParams.set("grant_type", "pkce");
      const result = await this.request(url, { auth_code: code(authCode), code_verifier: verifier(codeVerifier) });
      if (!result.ok) throw mappedProviderError(result.body, result.status, true);
      return rawTokenPair(result.body);
    } catch (error) { return this.rethrow(error); }
  }

  /**
   * 가입 또는 복구 API URL에 신뢰된 redirect_to를 넣고 공통 POST 함수로 전송합니다.
   * @param path signup 또는 recover 경로.
   * @param body 제공자에게 보낼 JSON 객체.
   * @param redirect 신뢰된 콜백 URL.
   * @returns 성공 여부·상태 코드·파싱된 응답.
   * @throws 네트워크·응답 파싱 오류.
   */
  private async post(path: "signup" | "recover", body: Record<string, unknown>, redirect: URL): Promise<HttpResult> {
    const url = new URL(`auth/v1/${path}`, this.config.url);
    url.searchParams.set("redirect_to", redirect.toString());
    return this.request(url, body);
  }

  /**
   * anon 키 헤더와 JSON 본문으로 POST를 보내 응답을 파싱합니다. 실패 응답의 파싱 오류는 null 본문으로 숨깁니다.
   * @param url 요청할 제공자 URL.
   * @param body JSON으로 직렬화할 요청 객체.
   * @returns ok·status·body가 있는 HTTP 결과.
   * @throws 성공 응답이 잘못된 JSON/객체이거나 네트워크가 실패하면 오류.
   */
  private async request(url: URL, body: Record<string, unknown>): Promise<HttpResult> {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${this.config.anonKey}`, "Content-Type": "application/json", apikey: this.config.anonKey },
      body: JSON.stringify(body),
    });
    let parsed: unknown;
    try { parsed = await response.json(); } catch {
      if (response.ok) return fail();
      return { ok: false, status: response.status, body: null };
    }
    return { ok: response.ok, status: response.status, body: response.ok ? object(parsed) : parsed };
  }

  /**
   * 브라우저 저장이나 자동 갱신을 하지 않는 새 서버용 SDK 클라이언트를 생성합니다.
   * @returns 현재 작업 전용 Supabase 클라이언트.
   * @throws 주입된 팩토리의 생성 오류.
   */
  private client(): SupabaseClient { return this.factory(this.config.url, this.config.anonKey, AUTH_OPTIONS); }
  /**
   * 알려진 제공자 오류는 유지하고 알 수 없는 오류는 고정 가용성 오류로 바꿉니다.
   * @param error 처리 중 발생한 오류.
   * @returns 반환하지 않습니다.
   * @throws AuthProviderError.
   */
  private rethrow(error: unknown): never { if (error instanceof AuthProviderError) throw error; return fail(); }
}
