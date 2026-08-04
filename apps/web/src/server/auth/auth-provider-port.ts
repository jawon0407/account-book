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
  signUp(input: SignUpInput, redirectUrl: URL, codeChallenge: string): Promise<EmailAuthResult>;
  /**
   * Exchanges email credentials for one verified provider session.
   * @param input - Validated email and password input.
   * @returns A complete server-only provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, verification, rate, or availability code.
   */
  signInWithPassword(input: SignInInput): Promise<AuthTokenPair>;
  /**
   * Exchanges an email-confirmation code using its server-held verifier.
   * @param input - Confirmation code and matching PKCE verifier.
   * @returns A complete verified server-only provider token pair.
   * @throws {@link AuthProviderError} with a fixed transaction or availability code.
   */
  confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair>;
  /**
   * Builds the provider authorization URL without persisting browser state in the SDK.
   * @param input - Approved provider, trusted redirect, and canonical challenge.
   * @returns The validated HTTPS-or-loopback authorization URL.
   * @throws {@link AuthProviderError} with a fixed transaction or availability code.
   */
  startOAuth(input: OAuthStartInput): Promise<OAuthStartResult>;
  /**
   * Exchanges one OAuth callback code using its server-held verifier.
   * @param input - OAuth code and matching PKCE verifier.
   * @returns A complete verified server-only provider token pair.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, or availability code.
   */
  exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair>;
  /**
   * Refreshes one server-held provider refresh token.
   * @param refreshToken - The decrypted provider refresh token.
   * @returns A complete replacement provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, rate, or availability code.
   */
  refresh(refreshToken: string): Promise<AuthTokenPair>;
  /**
   * Revokes one provider session using its complete token pair.
   * @param accessToken - The decrypted provider access token.
   * @param refreshToken - The decrypted provider refresh token.
   * @returns Completion after the provider accepts revocation.
   * @throws {@link AuthProviderError} with a fixed auth failure code.
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
  requestPasswordReset(email: string, redirectUrl: URL, codeChallenge: string): Promise<void>;
  /**
   * Exchanges one recovery callback code using its server-held verifier.
   * @param input - Recovery code and matching PKCE verifier.
   * @returns Verified server-only recovery credentials and public user data.
   * @throws {@link AuthProviderError} with a fixed transaction, rate, or availability code.
   */
  exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext>;
  /**
   * Updates a recovered user's password after verifying token ownership.
   * @param input - Recovery credentials, expected user, and validated new password.
   * @returns Completion after the matching provider user is updated.
   * @throws {@link AuthProviderError} with a fixed credential, transaction, or availability code.
   */
  updatePassword(input: PasswordUpdateAtProviderInput): Promise<void>;
}
