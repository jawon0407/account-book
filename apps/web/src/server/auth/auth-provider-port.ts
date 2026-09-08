import "server-only";

import type { AuthProvider, CurrentUser, SignInInput, SignUpInput } from "@account-book/contracts";

/** A confirmation code and its matching server-owned PKCE verifier. */
export type EmailConfirmationInput = Readonly<{ code: string; codeVerifier: string }>;
/** The approved provider, trusted callback, and canonical S256 challenge for OAuth. */
export type OAuthStartInput = Readonly<{ provider: AuthProvider; redirectUrl: URL; codeChallenge: string }>;
/** An OAuth authorization code and its matching server-owned PKCE verifier. */
export type OAuthExchangeInput = Readonly<{ code: string; codeVerifier: string }>;
/** A password-recovery code and its matching server-owned PKCE verifier. */
export type RecoveryExchangeInput = Readonly<{ code: string; codeVerifier: string }>;
/** Server-held recovery credentials used to update one password. */
export type PasswordUpdateAtProviderInput = Readonly<{ accessToken: string; refreshToken: string; userId: string; password: string }>;

/** A complete verified provider session that may be encrypted into an app session. */
export type AuthTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  userId: string;
  supabaseSessionId: string;
  issuedAtSeconds: number;
  accessTokenExpiresAt: Date;
  user: CurrentUser;
}>;
/** Signup either needs email verification or has a verified provider session. */
export type EmailAuthResult = Readonly<{ status: "verification_required" }> | Readonly<{ status: "authenticated"; tokens: AuthTokenPair }>;
/** A provider authorization URL that is never constructed from request headers. */
export type OAuthStartResult = Readonly<{ authorizationUrl: URL }>;
/** Server-only recovery credentials from a successful recovery code exchange. */
export type RecoveryContext = Readonly<{ accessToken: string; refreshToken: string; user: CurrentUser }>;

export type AuthProviderErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_EMAIL_VERIFICATION_REQUIRED"
  | "AUTH_OAUTH_TRANSACTION_INVALID"
  | "AUTH_RATE_LIMITED"
  | "AUTH_PROVIDER_UNAVAILABLE";

/** Fixed provider boundary error; it intentionally excludes provider details and request values. */
export class AuthProviderError extends Error {
  /**
   * Creates a provider-boundary error containing only an allowlisted code.
   * @param code - The fixed failure code safe to expose to another server layer.
   */
  /**
   * 요청이나 제공자 세부값 없이 허용된 오류 코드만 보관합니다.
   * @param code 공개 가능한 실패 코드; 기본은 제공자 가용성 오류.
   */
  public constructor(public readonly code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE") {
    super(code);
    this.name = "AuthProviderError";
  }
}

/** Server-only port that prevents Supabase SDK details and provider tokens reaching routes or UI code. */
export interface AuthProviderPort {
  /**
   * Starts verified-email signup with server-owned PKCE continuity.
   * @param input - Validated email and password input.
   * @param redirectUrl - Trusted confirmation callback URL.
   * @param codeChallenge - Canonical S256 PKCE challenge.
   * @returns An enumeration-resistant verification acknowledgement.
   * @throws {@link AuthProviderError} with a fixed auth failure code.
   */
  /**
   * 검증된 이메일·비밀번호로 PKCE 기반 가입을 시작하는 제공자 경계입니다. 구현은 가입 여부가 추측되지 않는 응답을 반환해야 합니다.
   * @param input 검증된 가입 이메일·비밀번호.
   * @param redirectUrl 신뢰된 메일 확인 콜백.
   * @param codeChallenge 서버 PKCE 비밀값의 S256 해시.
   * @returns 메일 인증 필요 여부 또는 인증된 서버 토큰 쌍.
   * @throws 고정 코드의 AuthProviderError.
   */
  signUp(input: SignUpInput, redirectUrl: URL, codeChallenge: string): Promise<EmailAuthResult>;
  /**
   * Exchanges email credentials for one verified provider session.
   * @param input - Validated email and password input.
   * @returns A complete server-only provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, verification, rate, or availability code.
   */
  /**
   * 이메일·비밀번호를 제공자 세션으로 교환하는 경계입니다.
   * @param input 검증된 로그인 입력.
   * @returns 메일 인증된 사용자의 서버 전용 토큰 쌍.
   * @throws 자격 증명·메일 미인증·요청 제한·가용성 오류.
   */
  signInWithPassword(input: SignInInput): Promise<AuthTokenPair>;
  /**
   * Exchanges an email-confirmation code using its server-held verifier.
   * @param input - Confirmation code and matching PKCE verifier.
   * @returns A complete verified server-only provider token pair.
   * @throws {@link AuthProviderError} with a fixed transaction or availability code.
   */
  /**
   * 메일 콜백 코드와 서버가 보관한 PKCE 비밀값을 함께 교환합니다.
   * @param input 확인 코드와 대응하는 PKCE 검증값.
   * @returns 검증된 서버 전용 토큰 쌍.
   * @throws 트랜잭션 또는 제공자 오류.
   */
  confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair>;
  /**
   * Builds the provider authorization URL without persisting browser state in the SDK.
   * @param input - Approved provider, trusted redirect, and canonical challenge.
   * @returns The validated HTTPS-or-loopback authorization URL.
   * @throws {@link AuthProviderError} with a fixed transaction or availability code.
   */
  /**
   * 허용 제공자와 서버가 정한 콜백·PKCE 챌린지로 인증 이동 URL을 준비합니다.
   * @param input 제공자·신뢰된 콜백 URL·S256 챌린지.
   * @returns 검증된 제공자 인증 URL.
   * @throws 트랜잭션 또는 제공자 오류.
   */
  startOAuth(input: OAuthStartInput): Promise<OAuthStartResult>;
  /**
   * Exchanges one OAuth callback code using its server-held verifier.
   * @param input - OAuth code and matching PKCE verifier.
   * @returns A complete verified server-only provider token pair.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, or availability code.
   */
  /**
   * OAuth 인증 코드와 서버에 저장한 PKCE 비밀값을 제공자 토큰으로 교환합니다.
   * @param input OAuth 코드와 대응하는 PKCE 검증값.
   * @returns 검증된 서버 전용 토큰 쌍.
   * @throws 트랜잭션·요청 제한·제공자 오류.
   */
  exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair>;
  /**
   * Refreshes one server-held provider refresh token.
   * @param refreshToken - The decrypted provider refresh token.
   * @returns A complete replacement provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, rate, or availability code.
   */
  /**
   * 서버가 가진 갱신 토큰으로 제공자에게 새 토큰 쌍을 요청합니다.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 새 접근·갱신 토큰 및 사용자·만료 정보.
   * @throws 자격 증명·요청 제한·가용성 오류.
   */
  refresh(refreshToken: string): Promise<AuthTokenPair>;
  /**
   * Revokes one provider session using its complete token pair.
   * @param accessToken - The decrypted provider access token.
   * @param refreshToken - The decrypted provider refresh token.
   * @returns Completion after the provider accepts revocation.
   * @throws {@link AuthProviderError} with a fixed auth failure code.
   */
  /**
   * 제공자 세션의 접근·갱신 토큰을 사용하여 외부 로그아웃을 수행합니다.
   * @param accessToken 복호화한 제공자 접근 토큰.
   * @param refreshToken 복호화한 제공자 갱신 토큰.
   * @returns 제공자 폐기가 완료되면 값 없이 종료합니다.
   * @throws 제공자 경계의 고정 오류.
   */
  signOut(accessToken: string, refreshToken: string): Promise<void>;
  /**
   * Requests password-recovery delivery with server-owned PKCE continuity.
   * @param email - The validated recovery email.
   * @param redirectUrl - Trusted recovery callback URL.
   * @param codeChallenge - Canonical S256 PKCE challenge.
   * @returns Completion after the enumeration-resistant provider request.
   * @throws {@link AuthProviderError} with a fixed credential, rate, or availability code.
   */
  /**
   * 서버 소유 PKCE와 신뢰된 콜백으로 복구 메일 발송을 요청합니다.
   * @param email 검증된 이메일.
   * @param redirectUrl 신뢰된 복구 콜백 URL.
   * @param codeChallenge PKCE S256 챌린지.
   * @returns 계정 존재 여부를 노출하지 않고 완료합니다.
   * @throws 자격 증명·요청 제한·가용성 오류.
   */
  requestPasswordReset(email: string, redirectUrl: URL, codeChallenge: string): Promise<void>;
  /**
   * Exchanges one recovery callback code using its server-held verifier.
   * @param input - Recovery code and matching PKCE verifier.
   * @returns Verified server-only recovery credentials and public user data.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, or availability code.
   */
  /**
   * 복구 콜백 코드와 대응하는 서버 PKCE 비밀값을 교환합니다.
   * @param input 복구 코드와 PKCE 검증값.
   * @returns 서버 전용 복구 토큰과 공개 사용자 정보.
   * @throws 트랜잭션·요청 제한·제공자 오류.
   */
  exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext>;
  /**
   * Updates a recovered user's password after verifying token ownership.
   * @param input - Recovery credentials, expected user, and validated new password.
   * @returns Completion after the matching provider user is updated.
   * @throws {@link AuthProviderError} with a fixed credential, transaction, or availability code.
   */
  /**
   * 복구 자격 증명이 기대한 사용자 소유인지 확인한 뒤 제공자 비밀번호를 변경합니다.
   * @param input 복구 접근·갱신 토큰, 사용자 ID, 검증된 새 비밀번호.
   * @returns 비밀번호 변경이 완료되면 값 없이 종료합니다.
   * @throws 사용자 불일치·입력·제공자 오류.
   */
  updatePassword(input: PasswordUpdateAtProviderInput): Promise<void>;
}
