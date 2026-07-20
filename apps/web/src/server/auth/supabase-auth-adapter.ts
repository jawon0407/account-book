import "server-only";

import { createClient } from "@supabase/supabase-js";
import { AuthProviderSchema, CurrentUserSchema, PasswordResetRequestInputSchema, PasswordUpdateInputSchema, SignInInputSchema, SignUpInputSchema, type AuthProvider, type SignInInput, type SignUpInput } from "@account-book/contracts";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair, type EmailAuthResult, type EmailConfirmationInput, type OAuthExchangeInput, type OAuthStartInput, type OAuthStartResult, type PasswordUpdateAtProviderInput, type RecoveryContext, type RecoveryExchangeInput } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" } as const;
const SIGNUP_EXISTENCE_CODES = new Set(["user_already_exists", "email_exists", "user_already_registered", "email_already_exists", "user_already_exist"]);
const RESET_ABSENT_CODES = new Set(["user_not_found", "email_not_found", "user_not_exist", "email_not_exists", "user_does_not_exist"]);

/** Validated public Supabase endpoint and anon key; service-role credentials are deliberately absent. */
export type SupabaseServerConfig = Readonly<{ url: string; anonKey: string }>;
type SupabaseClient = Readonly<{ auth: {
  signUp(input: unknown): Promise<unknown>; signInWithPassword(input: unknown): Promise<unknown>; exchangeCodeForSession(code: string): Promise<unknown>;
  signInWithOAuth(input: unknown): Promise<unknown>; refreshSession(input: unknown): Promise<unknown>; setSession(input: unknown): Promise<unknown>;
  signOut(): Promise<unknown>; resetPasswordForEmail(email: string, input: unknown): Promise<unknown>; updateUser(input: unknown): Promise<unknown>;
} }>;
/** Test seam for a request-scoped Supabase client; no fake is selected by production configuration. */
export type SupabaseClientFactory = (url: string, anonKey: string, auth: typeof AUTH_OPTIONS) => SupabaseClient;

function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new AuthProviderError(code); }
function object(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
function hasControlCharacter(value: string): boolean { return Array.from(value).some((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127; }); }
function nonEmpty(value: unknown, max = 16_384): string { if (typeof value !== "string" || value.length === 0 || value.length > max || hasControlCharacter(value)) return fail(); return value; }
function token(value: unknown): string { const safe = nonEmpty(value); if (safe.trim() !== safe) return fail(); return safe; }
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) return fail(); return value; }
function safeUrl(value: unknown, allowDevelopmentHttp: boolean): URL {
  if (!(value instanceof URL) && typeof value !== "string") return fail();
  let url: URL; try { url = new URL(value.toString()); } catch { return fail(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || !(url.protocol === "https:" || (allowDevelopmentHttp && local && url.protocol === "http:")) || hasControlCharacter(url.href)) return fail();
  return url;
}
function config(input: SupabaseServerConfig): SupabaseServerConfig { return { url: safeUrl(input?.url, true).toString(), anonKey: nonEmpty(input?.anonKey) }; }
function providerCode(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}
function mappedProviderError(value: unknown): AuthProviderError {
  const error = object(value);
  const status = error.status;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (status === 429 || code === "over_request_rate_limit" || code === "rate_limit_exceeded") return new AuthProviderError("AUTH_RATE_LIMITED");
  if (code === "email_not_confirmed" || message === "email not confirmed") return new AuthProviderError("AUTH_EMAIL_VERIFICATION_REQUIRED");
  if (status === 400 || status === 401 || ["invalid_credentials", "invalid_grant", "bad_code_verifier"].includes(code)) return new AuthProviderError("AUTH_INVALID_CREDENTIALS");
  if (["flow_state_expired", "flow_state_not_found", "otp_expired", "otp_disabled", "same_password"].includes(code)) return new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID");
  return new AuthProviderError();
}
function dataOf(value: unknown): Record<string, unknown> {
  const response = object(value);
  if (response.error !== null && response.error !== undefined) throw mappedProviderError(response.error);
  return object(response.data);
}
function accepted(value: unknown): void {
  const response = object(value);
  if (response.error !== null && response.error !== undefined) throw mappedProviderError(response.error);
}
function canonicalSegment(value: unknown): string {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) return fail();
  return value;
}
function jwtClaims(accessToken: string): Readonly<{ userId: string; sessionId: string; expiresAt: number }> {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return fail();
  try {
    canonicalSegment(parts[0]!); const payload = canonicalSegment(parts[1]!); canonicalSegment(parts[2]!);
    const claims = object(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const expiresAt = claims.exp;
    if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || new Date(expiresAt * 1000).getTime() <= Date.now()) return fail();
    return { userId: uuid(claims.sub), sessionId: uuid(claims.session_id), expiresAt };
  } catch { return fail(); }
}
function tokenPair(sessionValue: unknown): AuthTokenPair {
  const session = object(sessionValue);
  const accessToken = token(session.access_token);
  const refreshToken = token(session.refresh_token);
  const user = object(session.user);
  const email = typeof user.email === "string" ? user.email : null;
  const confirmation = typeof user.email_confirmed_at === "string" ? user.email_confirmed_at : user.confirmed_at;
  const confirmedAt = typeof confirmation === "string" ? new Date(confirmation) : new Date("invalid");
  const verified = typeof user.email === "string" && Number.isFinite(confirmedAt.getTime()) && confirmedAt.getTime() <= Date.now();
  const parsedUser = CurrentUserSchema.safeParse({ id: user.id, email, emailVerified: verified });
  if (!parsedUser.success || !parsedUser.data.emailVerified) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  const claims = jwtClaims(accessToken);
  const userId = uuid(user.id);
  const expiresAt = typeof session.expires_at === "number" && Number.isSafeInteger(session.expires_at) ? new Date(session.expires_at * 1000) : new Date("invalid");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || claims.userId !== userId || claims.expiresAt !== session.expires_at) return fail();
  return { accessToken, refreshToken, userId, supabaseSessionId: claims.sessionId, accessTokenExpiresAt: expiresAt, user: parsedUser.data };
}
function code(value: unknown): string { const safe = nonEmpty(value, 4096); if (safe.trim() !== safe) return fail("AUTH_OAUTH_TRANSACTION_INVALID"); return safe; }
function providerId(provider: AuthProvider): string { return provider === "naver" ? "custom:naver" : provider; }

/** Request-scoped Supabase adapter that returns only validated, verified token pairs to server use cases. */
export class SupabaseAuthAdapter implements AuthProviderPort {
  private readonly config: SupabaseServerConfig;
  private readonly factory: SupabaseClientFactory;

  public constructor(configInput: SupabaseServerConfig, factory?: SupabaseClientFactory) {
    this.config = config(configInput);
    this.factory = factory ?? ((url, anonKey, auth) => createClient(url, anonKey, { auth }) as unknown as SupabaseClient);
  }

  /** Starts email signup with a trusted server-supplied confirmation callback URL. */
  public async signUp(input: SignUpInput, redirectUrl: URL): Promise<EmailAuthResult> {
    try {
      const parsed = SignUpInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const callbackUrl = safeUrl(redirectUrl, true);
      const response = object(await this.client().auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { emailRedirectTo: callbackUrl.toString() } }));
      if (response.error !== null && response.error !== undefined) {
        if (SIGNUP_EXISTENCE_CODES.has(providerCode(response.error))) return { status: "verification_required" };
        throw mappedProviderError(response.error);
      }
      const data = object(response.data);
      if (data.session === null || data.session === undefined) return { status: "verification_required" };
      try { return { status: "authenticated", tokens: tokenPair(data.session) }; } catch { return { status: "verification_required" }; }
    } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges valid email credentials for a complete verified provider session. */
  public async signInWithPassword(input: SignInInput): Promise<AuthTokenPair> {
    try {
      const parsed = SignInInputSchema.safeParse(input);
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      return tokenPair(dataOf(await this.client().auth.signInWithPassword(parsed.data)).session);
    } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges an email confirmation code without persisting it in the adapter. */
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> {
    try { const authCode = code(input?.code); return tokenPair(dataOf(await this.client().auth.exchangeCodeForSession(authCode)).session); } catch (error) { return this.rethrow(error); }
  }

  /** Obtains an external provider authorization URL with no browser redirect or local session persistence. */
  public async startOAuth(input: OAuthStartInput): Promise<OAuthStartResult> {
    try {
      const provider = AuthProviderSchema.safeParse(input?.provider);
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID");
      const redirectUrl = safeUrl(input?.redirectUrl, true);
      const data = dataOf(await this.client().auth.signInWithOAuth({ provider: providerId(provider.data), options: { redirectTo: redirectUrl.toString(), skipBrowserRedirect: true } }));
      return { authorizationUrl: safeUrl(object(data).url, false) };
    } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges a server-only OAuth callback code for a verified provider session. */
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> {
    try { const authCode = code(input?.code); return tokenPair(dataOf(await this.client().auth.exchangeCodeForSession(authCode)).session); } catch (error) { return this.rethrow(error); }
  }

  /** Refreshes a server-held refresh token through a fresh no-persistence client. */
  public async refresh(refreshToken: string): Promise<AuthTokenPair> {
    try { const refresh = token(refreshToken); return tokenPair(dataOf(await this.client().auth.refreshSession({ refresh_token: refresh })).session); } catch (error) { return this.rethrow(error); }
  }

  /** Revokes a provider session using only server-held token material. */
  public async signOut(accessToken: string, refreshToken: string): Promise<void> {
    try { const access = token(accessToken); const refresh = token(refreshToken); const client = this.client(); dataOf(await client.auth.setSession({ access_token: access, refresh_token: refresh })); accepted(await client.auth.signOut()); } catch (error) { return this.rethrow(error); }
  }

  /** Requests password reset delivery without exposing provider account-existence behavior. */
  public async requestPasswordReset(email: string, redirectUrl: URL): Promise<void> {
    try {
      const parsed = PasswordResetRequestInputSchema.safeParse({ email });
      if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS");
      const callbackUrl = safeUrl(redirectUrl, true);
      const response = object(await this.client().auth.resetPasswordForEmail(parsed.data.email, { redirectTo: callbackUrl.toString() }));
      if (response.error !== null && response.error !== undefined && RESET_ABSENT_CODES.has(providerCode(response.error))) return;
      accepted(response);
    } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges a recovery callback code into server-only credentials for the next recovery step. */
  public async exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext> {
    try { const authCode = code(input?.code); const pair = tokenPair(dataOf(await this.client().auth.exchangeCodeForSession(authCode)).session); return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, user: pair.user }; } catch (error) { return this.rethrow(error); }
  }

  /** Updates one password after placing recovery credentials only in the fresh in-memory client. */
  public async updatePassword(input: PasswordUpdateAtProviderInput): Promise<void> {
    try {
      const access = token(input?.accessToken); const refresh = token(input?.refreshToken);
      const password = PasswordUpdateInputSchema.safeParse({ password: input?.password });
      if (!password.success) return fail("AUTH_INVALID_CREDENTIALS");
      const client = this.client();
      dataOf(await client.auth.setSession({ access_token: access, refresh_token: refresh }));
      accepted(await client.auth.updateUser({ password: password.data.password }));
    } catch (error) { return this.rethrow(error); }
  }

  private client(): SupabaseClient { return this.factory(this.config.url, this.config.anonKey, AUTH_OPTIONS); }
  private rethrow(error: unknown): never { if (error instanceof AuthProviderError) throw error; return fail(); }
}
