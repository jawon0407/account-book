import "server-only";

import { createClient } from "@supabase/supabase-js";
import { CurrentUserSchema, type AuthProvider, type SignInInput, type SignUpInput } from "@account-book/contracts";
import { AuthProviderError, type AuthProviderErrorCode, type AuthProviderPort, type AuthTokenPair, type EmailAuthResult, type EmailConfirmationInput, type OAuthExchangeInput, type OAuthStartInput, type OAuthStartResult, type PasswordUpdateAtProviderInput, type RecoveryContext, type RecoveryExchangeInput } from "./auth-provider-port.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "pkce" } as const;

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
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) return fail(); return value; }
function safeUrl(value: unknown, allowDevelopmentHttp: boolean): URL {
  if (!(value instanceof URL) && typeof value !== "string") return fail();
  let url: URL; try { url = new URL(value.toString()); } catch { return fail(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || !(url.protocol === "https:" || (allowDevelopmentHttp && local && url.protocol === "http:")) || hasControlCharacter(url.href)) return fail();
  return url;
}
function config(input: SupabaseServerConfig): SupabaseServerConfig { return { url: safeUrl(input?.url, true).toString(), anonKey: nonEmpty(input?.anonKey) }; }
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
function sessionId(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length !== 3 || !BASE64URL_PATTERN.test(parts[1]!)) return fail();
  try {
    const payload = parts[1]!;
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.length === 0 || decoded.toString("base64url") !== payload) return fail();
    return uuid(object(JSON.parse(decoded.toString("utf8"))).session_id);
  } catch { return fail(); }
}
function tokenPair(sessionValue: unknown): AuthTokenPair {
  const session = object(sessionValue);
  const accessToken = nonEmpty(session.access_token);
  const refreshToken = nonEmpty(session.refresh_token);
  const user = object(session.user);
  const email = typeof user.email === "string" ? user.email : null;
  const verified = typeof user.email === "string" && (typeof user.email_confirmed_at === "string" || typeof user.confirmed_at === "string");
  const parsedUser = CurrentUserSchema.safeParse({ id: user.id, email, emailVerified: verified });
  const expiresAt = typeof session.expires_at === "number" && Number.isFinite(session.expires_at) ? new Date(session.expires_at * 1000) : new Date("invalid");
  if (!parsedUser.success || !parsedUser.data.emailVerified || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return fail("AUTH_EMAIL_VERIFICATION_REQUIRED");
  return { accessToken, refreshToken, userId: uuid(user.id), supabaseSessionId: sessionId(accessToken), accessTokenExpiresAt: expiresAt, user: parsedUser.data };
}
function code(value: unknown): string { return nonEmpty(value, 4096); }
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
      const callbackUrl = safeUrl(redirectUrl, true);
      const data = dataOf(await this.client().auth.signUp({ email: input.email, password: input.password, options: { emailRedirectTo: callbackUrl.toString() } }));
      if (data.session === null || data.session === undefined) return { status: "verification_required" };
      return { status: "authenticated", tokens: tokenPair(data.session) };
    } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges valid email credentials for a complete verified provider session. */
  public async signInWithPassword(input: SignInInput): Promise<AuthTokenPair> {
    try { return tokenPair(dataOf(await this.client().auth.signInWithPassword({ email: input.email, password: input.password })).session); } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges an email confirmation code without persisting it in the adapter. */
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> {
    try { const authCode = code(input?.code); return tokenPair(dataOf(await this.client().auth.exchangeCodeForSession(authCode)).session); } catch (error) { return this.rethrow(error); }
  }

  /** Obtains an external provider authorization URL with no browser redirect or local session persistence. */
  public async startOAuth(input: OAuthStartInput): Promise<OAuthStartResult> {
    try {
      const redirectUrl = safeUrl(input?.redirectUrl, true);
      const data = dataOf(await this.client().auth.signInWithOAuth({ provider: providerId(input.provider), options: { redirectTo: redirectUrl.toString(), skipBrowserRedirect: true } }));
      return { authorizationUrl: safeUrl(object(data).url, false) };
    } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges a server-only OAuth callback code for a verified provider session. */
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> {
    try { const authCode = code(input?.code); return tokenPair(dataOf(await this.client().auth.exchangeCodeForSession(authCode)).session); } catch (error) { return this.rethrow(error); }
  }

  /** Refreshes a server-held refresh token through a fresh no-persistence client. */
  public async refresh(refreshToken: string): Promise<AuthTokenPair> {
    try { const token = nonEmpty(refreshToken); return tokenPair(dataOf(await this.client().auth.refreshSession({ refresh_token: token })).session); } catch (error) { return this.rethrow(error); }
  }

  /** Revokes a provider session using only server-held token material. */
  public async signOut(accessToken: string, refreshToken: string): Promise<void> {
    try { const access = nonEmpty(accessToken); const refresh = nonEmpty(refreshToken); const client = this.client(); dataOf(await client.auth.setSession({ access_token: access, refresh_token: refresh })); accepted(await client.auth.signOut()); } catch (error) { return this.rethrow(error); }
  }

  /** Requests password reset delivery without exposing provider account-existence behavior. */
  public async requestPasswordReset(email: string, redirectUrl: URL): Promise<void> {
    try { const safeEmail = nonEmpty(email, 254); const callbackUrl = safeUrl(redirectUrl, true); accepted(await this.client().auth.resetPasswordForEmail(safeEmail, { redirectTo: callbackUrl.toString() })); } catch (error) { return this.rethrow(error); }
  }

  /** Exchanges a recovery callback code into server-only credentials for the next recovery step. */
  public async exchangeRecoveryCode(input: RecoveryExchangeInput): Promise<RecoveryContext> {
    try { const authCode = code(input?.code); const pair = tokenPair(dataOf(await this.client().auth.exchangeCodeForSession(authCode)).session); return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, user: pair.user }; } catch (error) { return this.rethrow(error); }
  }

  /** Updates one password after placing recovery credentials only in the fresh in-memory client. */
  public async updatePassword(input: PasswordUpdateAtProviderInput): Promise<void> {
    try {
      const access = nonEmpty(input?.accessToken); const refresh = nonEmpty(input?.refreshToken); const password = nonEmpty(input?.password, 1024);
      const client = this.client();
      dataOf(await client.auth.setSession({ access_token: access, refresh_token: refresh }));
      accepted(await client.auth.updateUser({ password }));
    } catch (error) { return this.rethrow(error); }
  }

  private client(): SupabaseClient { return this.factory(this.config.url, this.config.anonKey, AUTH_OPTIONS); }
  private rethrow(error: unknown): never { if (error instanceof AuthProviderError) throw error; return fail(); }
}
