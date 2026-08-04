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
  signInWithPassword(input: unknown): Promise<unknown>;
  refreshSession(input: unknown): Promise<unknown>;
  setSession(input: unknown): Promise<unknown>;
  signOut(): Promise<unknown>;
  updateUser(input: unknown): Promise<unknown>;
} }>;
/** Test seam for a fresh non-persistent Supabase client used only by non-PKCE operations. */
export type SupabaseClientFactory = (url: string, anonKey: string, auth: typeof AUTH_OPTIONS) => SupabaseClient;
/** Test seam for the explicit server-only Supabase Auth HTTP boundary. */
export type SupabaseFetch = typeof fetch;

function fail(code: AuthProviderErrorCode = "AUTH_PROVIDER_UNAVAILABLE"): never { throw new AuthProviderError(code); }
function object(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
function hasControlCharacter(value: string): boolean { return Array.from(value).some((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127; }); }
function nonEmpty(value: unknown, max = 16_384): string { if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || hasControlCharacter(value)) return fail(); return value; }
function token(value: unknown): string { return nonEmpty(value); }
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) return fail(); return value; }
function safeUrl(value: unknown, allowDevelopmentHttp: boolean): URL {
  if (!(value instanceof URL) && typeof value !== "string") return fail();
  let url: URL;
  try { url = new URL(value.toString()); } catch { return fail(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (allowDevelopmentHttp && local && url.protocol === "http:")) || hasControlCharacter(url.href)) return fail();
  return url;
}
function config(input: SupabaseServerConfig): SupabaseServerConfig {
  const url = safeUrl(input?.url, true);
  if (url.pathname !== "/" || url.search !== "") return fail();
  return { url: url.toString(), anonKey: nonEmpty(input?.anonKey) };
}
function providerCode(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}
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
function tokenPair(sessionValue: unknown): AuthTokenPair {
  const { session, pair, claims } = commonTokenPair(sessionValue);
  if (typeof session.expires_at !== "number" || !Number.isSafeInteger(session.expires_at) || claims.expiresAt !== session.expires_at) return fail();
  return pair;
}
function rawTokenPair(sessionValue: unknown): AuthTokenPair {
  const { session, pair, claims } = commonTokenPair(sessionValue);
  const expiresIn = session.expires_in;
  if (session.token_type !== "bearer" || typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0 || claims.expiresAt - claims.issuedAt !== expiresIn) return fail();
  if (session.expires_at !== undefined && (typeof session.expires_at !== "number" || !Number.isSafeInteger(session.expires_at) || session.expires_at !== claims.expiresAt)) return fail();
  return pair;
}
function code(value: unknown): string {
  try { return nonEmpty(value, 4096); } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
}
function verifier(value: unknown): string {
  try {
    const safe = nonEmpty(value, 128);
    derivePkceChallenge(safe);
    return safe;
  } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
}
function challenge(value: unknown): string {
  try { return validatePkceChallenge(nonEmpty(value, 43)); } catch { return fail(); }
}
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
  public async confirmEmail(input: EmailConfirmationInput): Promise<AuthTokenPair> {
    return this.exchange(input?.code, input?.codeVerifier);
  }

  /**
   * Constructs a Supabase authorize URL from the approved provider and S256 challenge.
   * @param input - Approved provider, trusted redirect, and canonical challenge.
   * @returns A validated HTTPS-or-loopback provider authorization URL.
   * @throws {@link AuthProviderError} with a fixed transaction or availability code.
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
  public async exchangeOAuthCode(input: OAuthExchangeInput): Promise<AuthTokenPair> {
    return this.exchange(input?.code, input?.codeVerifier);
  }

  /**
   * Refreshes a server-held token through a fresh non-persistent SDK client.
   * @param refreshToken - Decrypted provider refresh token.
   * @returns A strictly parsed replacement provider token pair.
   * @throws {@link AuthProviderError} with a fixed credential, verification, rate, or availability code.
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

  private async exchange(authCode: unknown, codeVerifier: unknown): Promise<AuthTokenPair> {
    try {
      const url = new URL("auth/v1/token", this.config.url);
      url.searchParams.set("grant_type", "pkce");
      const result = await this.request(url, { auth_code: code(authCode), code_verifier: verifier(codeVerifier) });
      if (!result.ok) throw mappedProviderError(result.body, result.status, true);
      return rawTokenPair(result.body);
    } catch (error) { return this.rethrow(error); }
  }

  private async post(path: "signup" | "recover", body: Record<string, unknown>, redirect: URL): Promise<HttpResult> {
    const url = new URL(`auth/v1/${path}`, this.config.url);
    url.searchParams.set("redirect_to", redirect.toString());
    return this.request(url, body);
  }

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

  private client(): SupabaseClient { return this.factory(this.config.url, this.config.anonKey, AUTH_OPTIONS); }
  private rethrow(error: unknown): never { if (error instanceof AuthProviderError) throw error; return fail(); }
}
