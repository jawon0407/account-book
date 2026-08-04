import { randomUUID } from "node:crypto";
import {
  ApiErrorSchema,
  AuthProviderSchema,
  CurrentUserSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type ApiError,
  type CurrentUser,
} from "@account-book/contracts";
import { z } from "zod";
import type { AuthProviderPort } from "../auth/auth-provider-port.js";
import type { EmailAuthService } from "../auth/email-auth-service.js";
import type { OAuthService } from "../auth/oauth-service.js";
import type { PasswordRecoveryService } from "../auth/password-recovery-service.js";
import {
  clearAuthCookie,
  interactionCookie,
  sessionCookie,
  INTERACTION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type AuthCookie,
} from "../security/auth-cookie.js";
import { issueCsrfToken } from "../security/csrf.js";
import { verifyCsrfRequest } from "../security/request-origin.js";
import { createSessionSelector, hashSessionSelector } from "../security/session-selector.js";
import { SessionOperationError, type SessionService } from "../session/session-service.js";
import type { DelegatedApiClient } from "./delegated-api-client.js";

const MAX_BODY_BYTES = 16_384;
const MAX_UPSTREAM_BYTES = 65_536;
const REFRESH_THRESHOLD_MS = 60_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ReturnPathSchema = z.enum(["/app", "/settings/security"]);
const CsrfContextSchema = z.enum(["session", "interaction"]);
const OAuthStartBodySchema = z.object({ returnPath: ReturnPathSchema }).strict();
const EmptyBodySchema = z.object({}).strict();

type PublicSession = Readonly<{
  selector: string;
  user: CurrentUser;
  accessTokenExpiresAt: Date;
  absoluteExpiresAt: Date;
}>;

type ResolvedSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: string;
  supabaseSessionId: string;
  accessTokenExpiresAt: Date;
  rotationVersion: number;
}>;

type SessionBoundary = Pick<SessionService, "refresh" | "revokeCurrent" | "markRevocationPending"> & Readonly<{
  resolve(selector: string, now: Date): Promise<ResolvedSession>;
}>;

/** Request-owned services and immutable configuration used by one controller instance. */
export type AuthControllerDependencies = Readonly<{
  configuredOrigin: URL;
  secureCookies: true;
  csrfKey: Uint8Array;
  now: () => Date;
  createInteractionSelector?: () => string;
  email: Pick<EmailAuthService, "signUp" | "signIn" | "confirmEmail">;
  oauth: Pick<OAuthService, "start" | "complete">;
  recovery: Pick<PasswordRecoveryService, "start" | "exchange" | "update">;
  sessions: SessionBoundary;
  provider: Pick<AuthProviderPort, "signOut">;
  delegatedApiClient: Pick<DelegatedApiClient, "request">;
}>;

class BoundaryError extends Error {
  public constructor(public readonly code: ApiError["code"], public readonly status: number) {
    super(code);
  }
}

function fail(code: ApiError["code"], status: number): never {
  throw new BoundaryError(code, status);
}

function safeNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return fail("AUTH_PROVIDER_UNAVAILABLE", 503);
  return new Date(value);
}

function noStoreHeaders(): Headers {
  return new Headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", Expires: "0" });
}

function message(code: ApiError["code"]): string {
  const messages: Record<ApiError["code"], string> = {
    AUTH_INVALID_CREDENTIALS: "The authentication input was rejected.",
    AUTH_EMAIL_VERIFICATION_REQUIRED: "Email verification is required.",
    AUTH_SESSION_EXPIRED: "The session has expired.",
    AUTH_SESSION_REFRESH_REQUIRED: "The session must be refreshed.",
    AUTH_CSRF_REJECTED: "The request could not be verified.",
    AUTH_OAUTH_TRANSACTION_INVALID: "The authentication transaction is invalid.",
    AUTH_RATE_LIMITED: "Too many authentication attempts.",
    AUTH_PROVIDER_UNAVAILABLE: "The authentication service is unavailable.",
  };
  return messages[code];
}

function errorResponse(error: unknown): Response {
  let code: ApiError["code"] = "AUTH_PROVIDER_UNAVAILABLE";
  let status = 503;
  if (error instanceof BoundaryError) {
    code = error.code;
    status = error.status;
  } else if (error !== null && typeof error === "object") {
    const candidate = (error as { code?: unknown }).code;
    const parsed = ApiErrorSchema.shape.code.safeParse(candidate);
    if (parsed.success) {
      code = parsed.data;
      status = statusFor(code);
    } else if ((error as { message?: unknown }).message === "AUTH_CSRF_REJECTED") {
      code = "AUTH_CSRF_REJECTED";
      status = 403;
    }
  }
  return safeAuthFailure(code, status);
}

/** Creates a fixed public error envelope with explicitly constrained retry semantics. */
export function safeAuthFailure(code: ApiError["code"], status: number, retryable = code === "AUTH_PROVIDER_UNAVAILABLE" && status === 503): Response {
  const body: ApiError = {
    code,
    message: message(code),
    requestId: randomUUID(),
    retryable,
    fieldErrors: [],
  };
  return json(body, status);
}

function sessionFailureResponse(error: SessionOperationError): Response {
  if (error.reason === "expired") return safeAuthFailure("AUTH_SESSION_EXPIRED", 401, false);
  if (error.reason === "rate_limited") return safeAuthFailure("AUTH_RATE_LIMITED", 429, false);
  return safeAuthFailure("AUTH_PROVIDER_UNAVAILABLE", 503, true);
}

function statusFor(code: ApiError["code"]): number {
  switch (code) {
    case "AUTH_INVALID_CREDENTIALS": return 401;
    case "AUTH_EMAIL_VERIFICATION_REQUIRED": return 403;
    case "AUTH_SESSION_EXPIRED":
    case "AUTH_SESSION_REFRESH_REQUIRED": return 401;
    case "AUTH_CSRF_REJECTED": return 403;
    case "AUTH_OAUTH_TRANSACTION_INVALID": return 400;
    case "AUTH_RATE_LIMITED": return 429;
    case "AUTH_PROVIDER_UNAVAILABLE": return 503;
  }
}

function json(body: unknown, status = 200, cookies: readonly string[] = []): Response {
  const headers = noStoreHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(origin: URL, path: "/app" | "/reset-password" | "/settings/security", cookies: readonly string[] = []): Response {
  const headers = noStoreHeaders();
  headers.set("Location", new URL(path, origin).toString());
  for (const cookieValue of cookies) headers.append("Set-Cookie", cookieValue);
  return new Response(null, { status: 303, headers });
}

function providerRedirect(value: URL): Response {
  const target = new URL(value.toString());
  if (!(target.protocol === "https:" || (target.protocol === "http:" && LOOPBACK_HOSTS.has(target.hostname))) || target.username !== "" || target.password !== "" || target.hash !== "") return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
  const headers = noStoreHeaders();
  headers.set("Location", target.toString());
  return new Response(null, { status: 303, headers });
}

function serializedCookie(value: AuthCookie & Partial<Readonly<{ maxAge: 0 }>>): string {
  const attributes = [`${value.name}=${value.value}`, "HttpOnly"];
  if (value.secure) attributes.push("Secure");
  attributes.push("SameSite=Lax", "Path=/", "Priority=High");
  if (value.maxAge === 0) attributes.push("Max-Age=0");
  return attributes.join("; ");
}

function cookie(request: Request, name: typeof SESSION_COOKIE_NAME | typeof INTERACTION_COOKIE_NAME): string | null {
  const raw = request.headers.get("Cookie");
  if (raw === null) return null;
  const matches = raw.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(name.length + 1);
  try {
    hashSessionSelector(value);
    return value;
  } catch {
    return null;
  }
}

async function boundedJson(stream: ReadableStream<Uint8Array> | null, stated: string | null, maximum: number, code: ApiError["code"], status: number): Promise<unknown> {
  if (stated !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(stated) || Number(stated) > maximum)) {
    try { await stream?.cancel(); } catch { /* The fixed boundary error still wins. */ }
    return fail(code, status);
  }
  if (stream === null) return fail(code, status);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maximum) {
        await reader.cancel();
        return fail(code, status);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof BoundaryError) throw error;
    return fail(code, status);
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(text) as unknown; } catch { return fail(code, status); }
}

async function body(request: Request): Promise<unknown> {
  return boundedJson(request.body, request.headers.get("Content-Length"), MAX_BODY_BYTES, "AUTH_INVALID_CREDENTIALS", 422);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS", 422);
  return parsed.data;
}

function callbackValue(value: string | null): string {
  if (value === null || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
  return value;
}

async function upstreamJson(response: Response): Promise<unknown> {
  return boundedJson(response.body, response.headers.get("Content-Length"), MAX_UPSTREAM_BYTES, "AUTH_PROVIDER_UNAVAILABLE", 502);
}

/**
 * Converts authenticated browser requests into domain calls without trusting request URL or proxy headers.
 * Every instance is request scoped; dependencies may hold decrypted credentials only for that request.
 */
export class AuthController {
  private readonly origin: URL;
  private readonly createInteractionSelector: () => string;

  /**
   * Validates immutable origins and installs request-owned domain dependencies.
   * @param dependencies - Canonical URLs, cryptographic policy, and the services created for one request.
   * @throws A safe configuration error before a request can use an unsafe URL or key.
   */
  public constructor(private readonly dependencies: AuthControllerDependencies) {
    if (dependencies.secureCookies !== true) throw new Error("AUTH_CONFIGURATION_INVALID");
    this.origin = new URL(dependencies.configuredOrigin.toString());
    this.createInteractionSelector = dependencies.createInteractionSelector ?? createSessionSelector;
  }

  /** Issues a selector-bound CSRF token, creating a pre-auth selector only when no valid cookie exists. */
  public async csrf(request: Request): Promise<Response> {
    try {
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((key) => key !== "context") || search.getAll("context").length > 1) return fail("AUTH_INVALID_CREDENTIALS", 422);
      const requested = search.get("context");
      const context = requested === null ? null : CsrfContextSchema.safeParse(requested);
      if (context !== null && !context.success) return fail("AUTH_INVALID_CREDENTIALS", 422);
      let selected = context === null
        ? cookie(request, SESSION_COOKIE_NAME) ?? cookie(request, INTERACTION_COOKIE_NAME)
        : cookie(request, context.data === "session" ? SESSION_COOKIE_NAME : INTERACTION_COOKIE_NAME);
      const cookies: string[] = [];
      if (selected === null) {
        selected = this.createInteractionSelector();
        cookies.push(serializedCookie(interactionCookie(selected, this.dependencies.secureCookies)));
      }
      return json({ csrfToken: issueCsrfToken({ selector: selected }, safeNow(this.dependencies.now), this.dependencies.csrfKey) }, 200, cookies);
    } catch (error) { return errorResponse(error); }
  }

  /** Validates a login mutation and exposes only public user/session expiry metadata. */
  public async signIn(request: Request): Promise<Response> {
    try {
      const selected = this.verifyMutation(request);
      const result = await this.dependencies.email.signIn(parse(SignInInputSchema, await body(request)), this.emailContext(selected));
      return this.sessionCreated(result);
    } catch (error) { return errorResponse(error); }
  }

  /** Starts email signup with a newly generated interaction after the prior selector passes CSRF. */
  public async signUp(request: Request): Promise<Response> {
    try {
      this.verifyMutation(request);
      const input = parse(SignUpInputSchema, await body(request));
      const selected = this.createInteractionSelector();
      await this.dependencies.email.signUp(input, this.emailContext(selected));
      return json({ accepted: true }, 200, [serializedCookie(interactionCookie(selected, this.dependencies.secureCookies))]);
    } catch (error) { return errorResponse(error); }
  }

  /** Returns only a fixed same-origin navigation path after creating a fresh interaction. */
  public async oauthStart(request: Request, parameters: Readonly<{ provider?: string }> = {}): Promise<Response> {
    try {
      this.verifyMutation(request);
      const provider = AuthProviderSchema.safeParse(parameters.provider);
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 422);
      const input = parse(OAuthStartBodySchema, await body(request));
      const selected = this.createInteractionSelector();
      const query = new URLSearchParams({ returnPath: input.returnPath });
      return json({ authorizationPath: `/api/auth/oauth/${provider.data}/continue?${query.toString()}` }, 200, [serializedCookie(interactionCookie(selected, this.dependencies.secureCookies))]);
    } catch (error) { return errorResponse(error); }
  }

  /** Creates the server-owned OAuth transaction only during an exact same-origin document navigation. */
  public async oauthContinue(request: Request, parameters: Readonly<{ provider?: string }> = {}): Promise<Response> {
    try {
      if (request.headers.get("Sec-Fetch-Site") !== "same-origin" || request.headers.get("Sec-Fetch-Mode") !== "navigate" || request.headers.get("Sec-Fetch-Dest") !== "document") return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const selected = this.interactionSelector(request);
      const provider = AuthProviderSchema.safeParse(parameters.provider);
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((key) => key !== "returnPath") || search.getAll("returnPath").length !== 1) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const returnPath = ReturnPathSchema.safeParse(search.get("returnPath"));
      if (!returnPath.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const result = await this.dependencies.oauth.start(provider.data, {
        callbackBaseUrl: new URL("/api/auth/callback", this.origin),
        interactionSelector: selected,
        returnPath: returnPath.data,
        now: safeNow(this.dependencies.now),
      });
      return providerRedirect(result.authorizationUrl);
    } catch (error) { return errorResponse(error); }
  }

  /** Starts enumeration-resistant recovery using configured callback origin and a fresh interaction. */
  public async passwordResetRequest(request: Request): Promise<Response> {
    try {
      this.verifyMutation(request);
      const input = parse(PasswordResetRequestInputSchema, await body(request));
      const selected = this.createInteractionSelector();
      await this.dependencies.recovery.start(input.email, {
        passwordResetRedirectUrl: new URL("/api/auth/password/callback", this.origin),
        interactionSelector: selected,
        now: safeNow(this.dependencies.now),
      });
      return json({ accepted: true }, 200, [serializedCookie(interactionCookie(selected, this.dependencies.secureCookies))]);
    } catch (error) { return errorResponse(error); }
  }

  /** Exchanges one email confirmation code and redirects without preserving it in browser history. */
  public async emailCallback(request: Request): Promise<Response> {
    try {
      const selected = this.interactionSelector(request);
      const code = callbackValue(new URL(request.url).searchParams.get("code"));
      const result = await this.dependencies.email.confirmEmail({ code }, this.emailContext(selected));
      return this.sessionRedirect(result, "/app");
    } catch {
      return redirect(this.origin, "/app", [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    }
  }

  /** Completes one interaction-bound OAuth transaction and redirects only to its stored allowlisted path. */
  public async oauthCallback(request: Request): Promise<Response> {
    try {
      const selected = this.interactionSelector(request);
      const search = new URL(request.url).searchParams;
      const provider = AuthProviderSchema.safeParse(search.get("provider"));
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const state = callbackValue(search.get("state"));
      hashSessionSelector(state);
      const code = callbackValue(search.get("code"));
      const result = await this.dependencies.oauth.complete({ provider: provider.data, state, code }, { interactionSelector: selected, now: safeNow(this.dependencies.now) });
      return this.sessionRedirect(result, result.returnPath);
    } catch {
      return redirect(this.origin, "/app", [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    }
  }

  /** Rotates a provider token pair only after a session-bound CSRF POST. */
  public async refresh(request: Request): Promise<Response> {
    try {
      const selected = this.verifyMutation(request, "session");
      parse(EmptyBodySchema, await body(request));
      await this.dependencies.sessions.refresh(selected, safeNow(this.dependencies.now));
      return json({ refreshed: true });
    } catch (error) {
      if (error instanceof SessionOperationError) return sessionFailureResponse(error);
      return errorResponse(error);
    }
  }

  /** Exchanges a recovery code into a limited server-side context without creating an app session. */
  public async passwordCallback(request: Request): Promise<Response> {
    try {
      const selected = this.interactionSelector(request);
      const code = callbackValue(new URL(request.url).searchParams.get("code"));
      await this.dependencies.recovery.exchange({ code }, this.recoveryContext(selected));
      return redirect(this.origin, "/reset-password");
    } catch {
      return redirect(this.origin, "/app", [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    }
  }

  /** Consumes a limited recovery context, then removes its interaction cookie. */
  public async passwordUpdate(request: Request): Promise<Response> {
    try {
      const selected = this.verifyMutation(request, "interaction");
      const input = parse(PasswordUpdateInputSchema, await body(request));
      await this.dependencies.recovery.update(input, this.recoveryContext(selected));
      return json({ updated: true }, 200, [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    } catch (error) { return errorResponse(error); }
  }

  /** Resolves status without refreshing or extending the session. */
  public async session(request: Request): Promise<Response> {
    try {
      const selected = this.sessionSelector(request);
      const now = safeNow(this.dependencies.now);
      const resolved = await this.dependencies.sessions.resolve(selected, now);
      if (resolved.accessTokenExpiresAt.getTime() - now.getTime() <= REFRESH_THRESHOLD_MS) return fail("AUTH_SESSION_REFRESH_REQUIRED", 401);
      return json({ authenticated: true, expiresAt: resolved.accessTokenExpiresAt.toISOString() });
    } catch (error) {
      if (error instanceof SessionOperationError) return sessionFailureResponse(error);
      return errorResponse(error);
    }
  }

  /** Revokes locally before attempting provider logout and never resurrects the local session. */
  public async signOut(request: Request): Promise<Response> {
    const cleared = serializedCookie(clearAuthCookie(SESSION_COOKIE_NAME, this.dependencies.secureCookies));
    try {
      const selected = this.verifyMutation(request, "session");
      const now = safeNow(this.dependencies.now);
      const resolved = await this.dependencies.sessions.resolve(selected, now);
      await this.dependencies.sessions.revokeCurrent(selected, now);
      try {
        await this.dependencies.provider.signOut(resolved.accessToken, resolved.refreshToken);
      } catch {
        await this.dependencies.sessions.markRevocationPending(resolved.sessionId, safeNow(this.dependencies.now));
      }
      return json({ signedOut: true }, 200, [cleared]);
    } catch (error) {
      const response = errorResponse(error);
      response.headers.append("Set-Cookie", cleared);
      return response;
    }
  }

  /** Proxies only the fixed internal current-user endpoint with a fresh request-bound delegated JWT. */
  public async me(request: Request): Promise<Response> {
    try {
      const selected = this.sessionSelector(request);
      const now = safeNow(this.dependencies.now);
      const resolved = await this.dependencies.sessions.resolve(selected, now);
      if (resolved.accessTokenExpiresAt.getTime() - now.getTime() <= REFRESH_THRESHOLD_MS) return fail("AUTH_SESSION_REFRESH_REQUIRED", 401);
      let upstream: Response;
      try {
        upstream = await this.dependencies.delegatedApiClient.request({
          body: new Uint8Array(),
          contentType: null,
          method: "GET",
          scope: "me:read",
          sessionId: resolved.sessionId,
          target: "/v1/me",
          userId: resolved.userId,
        });
      } catch {
        throw new BoundaryError("AUTH_PROVIDER_UNAVAILABLE", 502);
      }
      const payload = await upstreamJson(upstream);
      if (upstream.ok) {
        const parsed = CurrentUserSchema.safeParse(payload);
        if (!parsed.success) return fail("AUTH_PROVIDER_UNAVAILABLE", 502);
        return json(parsed.data);
      }
      const parsed = ApiErrorSchema.safeParse(payload);
      if (!parsed.success) return fail("AUTH_PROVIDER_UNAVAILABLE", 502);
      return errorResponse(new BoundaryError(parsed.data.code, statusFor(parsed.data.code)));
    } catch (error) {
      if (error instanceof SessionOperationError) return sessionFailureResponse(error);
      return errorResponse(error);
    }
  }

  private verifyMutation(request: Request, selectorKind: "any" | "session" | "interaction" = "any"): string {
    const selected = selectorKind === "session"
      ? cookie(request, SESSION_COOKIE_NAME)
      : selectorKind === "interaction"
        ? cookie(request, INTERACTION_COOKIE_NAME)
        : cookie(request, SESSION_COOKIE_NAME) ?? cookie(request, INTERACTION_COOKIE_NAME);
    if (selected === null) return fail("AUTH_CSRF_REJECTED", 403);
    verifyCsrfRequest(request, { selector: selected }, {
      now: safeNow(this.dependencies.now),
      key: this.dependencies.csrfKey,
      allowedOrigins: new Set([this.origin.origin]),
    });
    return selected;
  }

  private sessionSelector(request: Request): string {
    return cookie(request, SESSION_COOKIE_NAME) ?? fail("AUTH_SESSION_EXPIRED", 401);
  }

  private interactionSelector(request: Request): string {
    return cookie(request, INTERACTION_COOKIE_NAME) ?? fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
  }

  private emailContext(interactionSelector: string) {
    return { emailRedirectUrl: new URL("/api/auth/email/callback", this.origin), interactionSelector, now: safeNow(this.dependencies.now) };
  }

  private recoveryContext(interactionSelector: string) {
    return { passwordResetRedirectUrl: new URL("/api/auth/password/callback", this.origin), interactionSelector, now: safeNow(this.dependencies.now) };
  }

  private sessionCreated(result: PublicSession): Response {
    return json({ user: result.user, expiresAt: result.accessTokenExpiresAt.toISOString(), absoluteExpiresAt: result.absoluteExpiresAt.toISOString() }, 200, [
      serializedCookie(sessionCookie(result.selector, this.dependencies.secureCookies)),
      serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies)),
    ]);
  }


  private sessionRedirect(result: PublicSession, path: "/app" | "/settings/security"): Response {
    return redirect(this.origin, path, [
      serializedCookie(sessionCookie(result.selector, this.dependencies.secureCookies)),
      serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies)),
    ]);
  }
}
