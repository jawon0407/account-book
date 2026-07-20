import type { AuthProvider, CurrentUser, SignInInput, SignUpInput } from "@account-book/contracts";

/** A confirmation code received only by the server callback. */
export type EmailConfirmationInput = Readonly<{ code: string }>;
/** The approved provider and callback URL for starting an OAuth transaction. */
export type OAuthStartInput = Readonly<{ provider: AuthProvider; redirectUrl: URL }>;
/** An OAuth authorization code received only by the server callback. */
export type OAuthExchangeInput = Readonly<{ code: string }>;
/** A password-recovery code received only by the server callback. */
export type RecoveryExchangeInput = Readonly<{ code: string }>;
/** Server-held recovery credentials used to update one password. */
export type PasswordUpdateAtProviderInput = Readonly<{ accessToken: string; refreshToken: string; password: string }>;

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
  signUp(input: SignUpInput, redirectUrl: URL): Promise<EmailAuthResult>;
  signInWithPassword(input: SignInInput): Promise<AuthTokenPair>;
  confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair>;
  startOAuth(input: OAuthStartInput): Promise<OAuthStartResult>;
  exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair>;
  refresh(refreshToken: string): Promise<AuthTokenPair>;
  signOut(accessToken: string, refreshToken: string): Promise<void>;
  requestPasswordReset(email: string, redirectUrl: URL): Promise<void>;
  exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext>;
  updatePassword(input: PasswordUpdateAtProviderInput): Promise<void>;
}
