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
  public constructor(public readonly code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE") {
    super(code);
    this.name = "AuthProviderError";
  }
}

/** Server-only port that prevents Supabase SDK details and provider tokens reaching routes or UI code. */
export interface AuthProviderPort {
  signUp(input: SignUpInput, redirectUrl: URL, codeChallenge: string): Promise<EmailAuthResult>;
  signInWithPassword(input: SignInInput): Promise<AuthTokenPair>;
  confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair>;
  startOAuth(input: OAuthStartInput): Promise<OAuthStartResult>;
  exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair>;
  refresh(refreshToken: string): Promise<AuthTokenPair>;
  signOut(accessToken: string, refreshToken: string): Promise<void>;
  requestPasswordReset(email: string, redirectUrl: URL, codeChallenge: string): Promise<void>;
  exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext>;
  updatePassword(input: PasswordUpdateAtProviderInput): Promise<void>;
}
