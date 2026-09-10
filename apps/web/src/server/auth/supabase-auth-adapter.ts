import "server-only";

import {
  AuthProviderSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type AuthProvider,
  type SignInInput,
  type SignUpInput,
} from "@account-book/contracts";
import {
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
import {
  fail,
  isResetAbsenceResponse,
  isSignupExistenceResponse,
  mappedProviderError,
  rethrowProviderError,
} from "./supabase/error-mapper.js";
import { postSupabaseAuth, requestSupabaseAuth, type SupabaseFetch } from "./supabase/http-client.js";
import { accepted, dataOf, rawTokenPair, tokenPair } from "./supabase/session-parser.js";
import { AUTH_OPTIONS, defaultSupabaseClientFactory, type SupabaseClient, type SupabaseClientFactory } from "./supabase/sdk-client.js";
import { challenge, code, config, safeUrl, token, uuid, verifier, type SupabaseServerConfig } from "./supabase/validation.js";

export type { SupabaseFetch } from "./supabase/http-client.js";
export type { SupabaseClientFactory } from "./supabase/sdk-client.js";
export type { SupabaseServerConfig } from "./supabase/validation.js";

/**
 * 앱 제공자 ID를 Supabase가 사용하는 ID로 바꿉니다. 네이버만 custom:naver로 매핑합니다.
 * @param provider 허용된 앱 제공자.
 * @returns Supabase 제공자 문자열.
 */
function providerId(provider: AuthProvider): string { return provider === "naver" ? "custom:naver" : provider; }

/** 요청 단위로 동작하며 서버 소유 PKCE HTTP 경계를 명시하는 Supabase 인증 어댑터입니다. */
export class SupabaseAuthAdapter implements AuthProviderPort {
  private readonly config: SupabaseServerConfig;
  private readonly factory: SupabaseClientFactory;
  private readonly fetcher: SupabaseFetch;

  /**
   * 설정을 검증하고 각 작업에 새 비영속 SDK 클라이언트를 만들 팩토리와 직접 HTTP 함수를 연결합니다.
   * @param configInput Supabase 공개 URL과 anon 키.
   * @param factory 선택적 SDK 클라이언트 생성 함수.
   * @param fetcher 서버 PKCE 요청용 fetch 함수.
   * @throws 안전하지 않은 설정이면 AuthProviderError.
   */
  public constructor(configInput: SupabaseServerConfig, factory?: SupabaseClientFactory, fetcher: SupabaseFetch = fetch) {
    this.config = config(configInput);
    this.factory = factory ?? defaultSupabaseClientFactory;
    this.fetcher = fetcher;
  }

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
      const result = await postSupabaseAuth(
        this.config,
        this.fetcher,
        "signup",
        { email: parsed.data.email, password: parsed.data.password, code_challenge: challenge(codeChallenge), code_challenge_method: "s256" },
        callback,
      );
      if (!result.ok) {
        if (isSignupExistenceResponse(result.body, result.status)) return { status: "verification_required" };
        throw mappedProviderError(result.body, result.status);
      }
      return { status: "verification_required" };
    } catch (error) { return rethrowProviderError(error); }
  }

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
    } catch (error) { return rethrowProviderError(error); }
  }

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
    } catch (error) { return rethrowProviderError(error); }
  }

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
   * 새 비영속 SDK 클라이언트로 갱신 토큰을 교환하고 새 세션 응답을 검사합니다.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 새 접근·갱신 토큰 및 사용자·만료 정보.
   * @throws 자격 증명·요청 제한·가용성 오류.
   */
  public async refresh(refreshToken: string): Promise<AuthTokenPair> {
    try { return tokenPair(dataOf(await this.client().auth.refreshSession({ refresh_token: token(refreshToken) })).session); } catch (error) { return rethrowProviderError(error); }
  }

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
    } catch (error) { return rethrowProviderError(error); }
  }

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
      const result = await postSupabaseAuth(
        this.config,
        this.fetcher,
        "recover",
        { email: parsed.data.email, code_challenge: challenge(codeChallenge), code_challenge_method: "s256" },
        safeUrl(redirectUrl, true),
      );
      if (!result.ok && !isResetAbsenceResponse(result.body, result.status)) throw mappedProviderError(result.body, result.status);
    } catch (error) { return rethrowProviderError(error); }
  }

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
    } catch (error) { return rethrowProviderError(error); }
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
      const result = await requestSupabaseAuth(this.config, this.fetcher, url, { auth_code: code(authCode), code_verifier: verifier(codeVerifier) });
      if (!result.ok) throw mappedProviderError(result.body, result.status, true);
      return rawTokenPair(result.body);
    } catch (error) { return rethrowProviderError(error); }
  }

  /**
   * 브라우저 저장이나 자동 갱신을 하지 않는 새 서버용 SDK 클라이언트를 생성합니다.
   * @returns 현재 작업 전용 Supabase 클라이언트.
   * @throws 주입된 팩토리의 생성 오류.
   */
  private client(): SupabaseClient { return this.factory(this.config.url, this.config.anonKey, AUTH_OPTIONS); }
}
