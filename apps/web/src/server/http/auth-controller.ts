import { randomUUID } from "node:crypto";
import {
  ApiErrorCodeSchema,
  ApiErrorSchema,
  buildApiError,
  AuthProviderSchema,
  CurrentUserSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type ApiError,
  type CurrentUser,
  type AuthProvider,
} from "@account-book/contracts";
import { z } from "zod";
import type { AuthProviderPort } from "../auth/auth-provider-port.js";
import type { AccountAccessPort } from "../auth/account-access.js";
import type { EmailAuthService } from "../auth/email-auth-service.js";
import type { OAuthService } from "../auth/oauth-service.js";
import type { PasswordRecoveryService } from "../auth/password-recovery-service.js";
import {
  authBudgetCookie,
  clearAuthCookie,
  interactionCookie,
  sessionCookie,
  INTERACTION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  AUTH_BUDGET_COOKIE_NAME,
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
const OAuthIntentSchema = z.enum(["sign_in", "sign_up"]);
const OAuthStartBodySchema = z.object({ returnPath: ReturnPathSchema, intent: OAuthIntentSchema.optional() }).strict();
const EmptyBodySchema = z.object({}).strict();

type AuthErrorCode = Extract<ApiError["code"], `AUTH_${string}`>;

/**
 * 공용 오류 코드 중 AUTH_ 접두사를 가진 인증 코드인지 구분합니다.
 * @param code 계약에 정의된 API 오류 코드.
 * @returns 인증 코드이면 true.
 */
function isAuthErrorCode(code: ApiError["code"]): code is AuthErrorCode { return code.startsWith("AUTH_"); }

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
  /**
   * 세션 컨트롤러가 사용하는 최소 조회 경계입니다. 복호화된 자격 증명은 서버 요청 안에서만 사용해야 합니다.
   * @param selector 브라우저 세션 식별자.
   * @param now 유효성 판단 시각.
   * @returns 서버 전용 토큰과 세션 메타데이터.
   * @throws 세션 만료 또는 조회 장애.
   */
  resolve(selector: string, now: Date): Promise<ResolvedSession>;
}>;

/** Request-owned services and immutable configuration used by one controller instance. */
export type AuthControllerDependencies = Readonly<{
  accountAccess: AccountAccessPort;
  enabledProviders?: readonly AuthProvider[];
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
  /**
   * HTTP 상태와 공개 인증 코드만 보관하는 경계 오류를 만듭니다.
   * @param code 응답에 사용할 인증 오류 코드.
   * @param status 응답 HTTP 상태.
   */
  public constructor(public readonly code: AuthErrorCode, public readonly status: number) {
    super(code);
  }
}

/**
 * 코드와 HTTP 상태를 가진 경계 오류를 던져 현재 처리를 중단합니다.
 * @param code 공개 인증 오류 코드.
 * @param status 응답 HTTP 상태.
 * @returns 반환하지 않습니다.
 * @throws BoundaryError.
 */
function fail(code: AuthErrorCode, status: number): never {
  throw new BoundaryError(code, status);
}

/**
 * 주입된 시계의 결과가 유효한 Date인지 확인하고 복사합니다.
 * @param clock 현재 시각을 제공할 함수.
 * @returns 현재 시각 복사본.
 * @throws 잘못된 시계 결과이면 503 가용성 경계 오류.
 */
function safeNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return fail("AUTH_PROVIDER_UNAVAILABLE", 503);
  return new Date(value);
}

/**
 * 인증 응답이 브라우저나 중간 캐시에 저장되지 않도록 응답 헤더를 만듭니다.
 * @returns private/no-store 및 레거시 캐시 방지 헤더.
 */
function noStoreHeaders(): Headers {
  return new Headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", Expires: "0" });
}

/**
 * 알려진 인증 코드·CSRF 오류만 공개 응답으로 변환하고 나머지 오류는 503 가용성 오류로 숨깁니다.
 * @param error 서비스 또는 검증에서 발생한 오류.
 * @returns 캐시되지 않는 표준 오류 Response.
 */
function errorResponse(error: unknown): Response {
  let code: AuthErrorCode = "AUTH_PROVIDER_UNAVAILABLE";
  let status = 503;
  if (error instanceof BoundaryError) {
    code = error.code;
    status = error.status;
  } else if (error !== null && typeof error === "object") {
    const candidate = (error as { code?: unknown }).code;
    const parsed = ApiErrorCodeSchema.safeParse(candidate);
    if (parsed.success && isAuthErrorCode(parsed.data)) {
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
/**
 * 새 요청 UUID를 붙인 표준 API 오류를 만들고 캐시 금지 JSON 응답으로 바꿉니다.
 * @param code 공개할 인증 오류 코드.
 * @param status HTTP 상태 코드.
 * @param retryable 재시도 가능 표시; 기본은 제공자 가용성 503일 때만 true.
 * @returns 표준 오류 JSON Response.
 */
export function safeAuthFailure(code: AuthErrorCode, status: number, retryable = code === "AUTH_PROVIDER_UNAVAILABLE" && status === 503): Response {
  const body = buildApiError({
    code,
    requestId: randomUUID(),
    retryable,
    fieldErrors: [],
  });
  return json(body, status);
}

/**
 * 세션 실패 사유를 만료 401·제한 429·가용성 503으로 바꾸고 재시도 표시를 정합니다.
 * @param error 세션 서비스의 제한된 오류.
 * @returns 표준 오류 Response.
 */
function sessionFailureResponse(error: SessionOperationError): Response {
  if (error.reason === "expired") return safeAuthFailure("AUTH_SESSION_EXPIRED", 401, false);
  if (error.reason === "rate_limited") return safeAuthFailure("AUTH_RATE_LIMITED", 429, false);
  return safeAuthFailure("AUTH_PROVIDER_UNAVAILABLE", 503, true);
}

/**
 * 인증 오류 코드별 HTTP 상태를 한곳에서 결정합니다.
 * @param code 공개 인증 오류 코드.
 * @returns 대응하는 HTTP 상태 코드.
 */
function statusFor(code: AuthErrorCode): number {
  switch (code) {
    case "AUTH_ACCOUNT_EXISTS": return 409;
    case "AUTH_ACCOUNT_NOT_FOUND": return 404;
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

/**
 * 응답 데이터를 JSON으로 직렬화하고 캐시 금지·콘텐츠 타입·선택적 쿠키 헤더를 설정합니다.
 * @param body JSON으로 반환할 값.
 * @param status HTTP 상태; 기본 200.
 * @param cookies 직렬화된 Set-Cookie 값 목록.
 * @returns JSON Response.
 * @throws JSON 직렬화가 실패하면 오류.
 */
function json(body: unknown, status = 200, cookies: readonly string[] = []): Response {
  const headers = noStoreHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * 서버가 정한 출처와 허용된 내부 경로로 303 이동 응답을 만듭니다.
 * @param origin 신뢰된 앱 출처.
 * @param path 허용된 내부 이동 경로.
 * @param cookies 함께 설정·삭제할 쿠키 문자열 목록.
 * @returns 캐시 금지 Location 응답.
 */
function redirect(origin: URL, path: "/app" | "/reset-password" | "/settings/security" | "/forgot-password/invalid-link" | "/login?notice=social-signup", cookies: readonly string[] = []): Response {
  const headers = noStoreHeaders();
  headers.set("Location", new URL(path, origin).toString());
  for (const cookieValue of cookies) headers.append("Set-Cookie", cookieValue);
  return new Response(null, { status: 303, headers });
}

/**
 * 제공자 URL이 HTTPS/로컬 HTTP이며 인증정보·해시가 없는지 재확인해 303 이동 응답을 만듭니다.
 * @param value 제공자 인증 URL.
 * @returns 캐시 금지 303 Response.
 * @throws 잘못된 이동 URL이면 400 트랜잭션 오류.
 */
function providerRedirect(value: URL): Response {
  const target = new URL(value.toString());
  if (!(target.protocol === "https:" || (target.protocol === "http:" && LOOPBACK_HOSTS.has(target.hostname))) || target.username !== "" || target.password !== "" || target.hash !== "") return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
  const headers = noStoreHeaders();
  headers.set("Location", target.toString());
  return new Response(null, { status: 303, headers });
}

/**
 * 인증 쿠키 객체를 Set-Cookie 헤더 문자열로 바꾸며 지정된 보안 속성과 필요 시 즉시 만료를 넣습니다.
 * @param value 생성 또는 삭제할 인증 쿠키 데이터.
 * @returns Set-Cookie 헤더 값.
 */
function serializedCookie(value: AuthCookie & Partial<Readonly<{ maxAge: 0 | 600 }>>): string {
  const attributes = [`${value.name}=${value.value}`, "HttpOnly"];
  if (value.secure) attributes.push("Secure");
  attributes.push("SameSite=Lax", "Path=/", "Priority=High");
  if (value.maxAge !== undefined) attributes.push(`Max-Age=${value.maxAge}`);
  return attributes.join("; ");
}

/**
 * 지정 이름이 정확히 한 번 나타나는 쿠키를 찾아 식별자 형식을 검사합니다. 중복·누락·잘못된 값은 거부합니다.
 * @param request Cookie 헤더를 읽을 요청.
 * @param name 세션·상호작용·브라우저 요청 예산 쿠키 이름.
 * @returns 검증된 식별자 또는 null.
 */
function cookie(request: Request, name: AuthCookie["name"]): string | null {
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

/**
 * 선언된 길이와 실제 스트림 바이트를 모두 제한하며 JSON을 읽습니다. 초과 시 읽기를 취소하고 항상 reader 잠금을 해제합니다.
 * @param stream 읽을 요청/응답 바이트 스트림.
 * @param stated Content-Length 헤더 또는 null.
 * @param maximum 허용 최대 바이트 수.
 * @param code 실패 시 공개할 인증 코드.
 * @param status 실패 시 HTTP 상태.
 * @returns 파싱된 JSON 값; 아직 업무 스키마 검증 전입니다.
 * @throws 크기·스트림·JSON 오류는 지정한 BoundaryError.
 */
async function boundedJson(stream: ReadableStream<Uint8Array> | null, stated: string | null, maximum: number, code: AuthErrorCode, status: number): Promise<unknown> {
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

/**
 * 브라우저 본문을 최대 16384바이트로 제한해 JSON으로 읽습니다.
 * @param request 읽을 브라우저 요청.
 * @returns 스키마 검사 전 JSON 값.
 * @throws 본문 크기·읽기·JSON 오류는 422 입력 오류.
 */
async function body(request: Request): Promise<unknown> {
  return boundedJson(request.body, request.headers.get("Content-Length"), MAX_BODY_BYTES, "AUTH_INVALID_CREDENTIALS", 422);
}

/**
 * Zod 스키마로 외부 입력을 검증하고 안전한 타입의 결과만 반환합니다.
 * @param schema 기대 입력을 정의한 스키마.
 * @param input 검증 전 입력.
 * @returns 스키마가 파싱한 데이터.
 * @throws 스키마 불일치 시 422 입력 오류.
 */
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("AUTH_INVALID_CREDENTIALS", 422);
  return parsed.data;
}

/**
 * 콜백 코드/state의 길이·빈 값·앞뒤 공백·제어문자를 검사합니다.
 * @param value URL 쿼리에서 읽은 문자열 또는 null.
 * @returns 검증된 콜백 값.
 * @throws 잘못된 값이면 400 트랜잭션 오류.
 */
function callbackValue(value: string | null): string {
  if (value === null || value.length === 0 || value.length > 4096 || value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
  return value;
}

/**
 * 내부 API 본문을 최대 65536바이트로 제한해 JSON으로 읽습니다.
 * @param response 내부 API 응답.
 * @returns 스키마 검사 전 JSON 값.
 * @throws 본문 오류는 502 가용성 오류.
 */
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
  /**
   * 보안 쿠키 사용을 요구하고 요청별 서비스와 설정 출처 복사본을 보관합니다.
   * @param dependencies 이 요청만 사용할 서비스·출처·시계·CSRF 키.
   * @throws secureCookies가 true가 아니거나 URL 복사에 실패하면 설정 오류.
   */
  public constructor(private readonly dependencies: AuthControllerDependencies) {
    if (dependencies.secureCookies !== true) throw new Error("AUTH_CONFIGURATION_INVALID");
    this.origin = new URL(dependencies.configuredOrigin.toString());
    this.createInteractionSelector = dependencies.createInteractionSelector ?? createSessionSelector;
  }

  /** Issues a selector-bound CSRF token, creating a pre-auth selector only when no valid cookie exists. */
  /**
   * 요청한 컨텍스트의 기존 쿠키를 선택하고, 없으면 새 로그인 전 쿠키를 만듭니다. 선택한 식별자에 묶인 CSRF 토큰을 발급합니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns CSRF 토큰 JSON과 필요 시 상호작용 Set-Cookie; 실패 시 안전한 오류 응답.
   */
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
  /**
   * CSRF와 로그인 본문을 검사해 이메일 로그인 서비스를 호출하고 세션 쿠키를 설정합니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns 공개 사용자·만료 정보 JSON과 세션/상호작용 쿠키 변경 또는 오류 응답.
   */
  public async signIn(request: Request): Promise<Response> {
    try {
      const selected = this.verifyMutation(request);
      const result = await this.dependencies.email.signIn(parse(SignInInputSchema, await body(request)), this.emailContext(selected));
      return this.sessionCreated(result);
    } catch (error) { return errorResponse(error); }
  }

  /** Starts email signup with a newly generated interaction after the prior selector passes CSRF. */
  /**
   * 기존 식별자로 CSRF를 통과한 뒤 새 상호작용을 만들어 가입 메일 요청과 연결합니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns accepted JSON과 새 상호작용 쿠키 또는 오류 응답.
   */
  public async signUp(request: Request): Promise<Response> {
    let budgetCookie: string | undefined;
    try {
      this.verifyMutation(request);
      const input = parse(SignUpInputSchema, await body(request));
      const budgetSelector = cookie(request, AUTH_BUDGET_COOKIE_NAME) ?? createSessionSelector();
      budgetCookie = serializedCookie(authBudgetCookie(budgetSelector, this.dependencies.secureCookies));
      if (await this.dependencies.accountAccess.check(input.email, "sign_up", budgetSelector) === "present") return fail("AUTH_ACCOUNT_EXISTS", 409);
      const selected = this.createInteractionSelector();
      await this.dependencies.email.signUp(input, this.emailContext(selected));
      return json({ accepted: true }, 200, [budgetCookie, serializedCookie(interactionCookie(selected, this.dependencies.secureCookies))]);
    } catch (error) {
      const response = errorResponse(error);
      if (budgetCookie !== undefined) response.headers.append("Set-Cookie", budgetCookie);
      return response;
    }
  }

  /** Returns only a fixed same-origin navigation path after creating a fresh interaction. */
  /**
   * CSRF·제공자·내부 복귀 경로를 검사하고 새 상호작용 쿠키와 같은 출처의 다음 이동 경로를 만듭니다. 아직 제공자 트랜잭션은 만들지 않습니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @param parameters 파일 경로에서 얻은 제공자 ID.
   * @returns authorizationPath JSON과 상호작용 쿠키 또는 오류 응답.
   */
  public async oauthStart(request: Request, parameters: Readonly<{ provider?: string }> = {}): Promise<Response> {
    try {
      this.verifyMutation(request);
      const provider = AuthProviderSchema.safeParse(parameters.provider);
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 422);
      this.requireEnabledProvider(provider.data);
      const input = parse(OAuthStartBodySchema, await body(request));
      const selected = this.createInteractionSelector();
      const query = new URLSearchParams({ returnPath: input.returnPath });
      if (input.intent !== undefined) query.set("intent", input.intent);
      return json({ authorizationPath: `/api/auth/oauth/${provider.data}/continue?${query.toString()}` }, 200, [serializedCookie(interactionCookie(selected, this.dependencies.secureCookies))]);
    } catch (error) { return errorResponse(error); }
  }

  /** Creates the server-owned OAuth transaction only during an exact same-origin document navigation. */
  /**
   * 같은 출처의 문서 탐색 헤더·제공자·복귀 경로를 검사한 다음 OAuth 트랜잭션을 만들고 제공자로 이동시킵니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @param parameters 파일 경로에서 얻은 제공자 ID.
   * @returns 제공자 인증 URL로의 303 응답 또는 안전한 오류 응답.
   */
  public async oauthContinue(request: Request, parameters: Readonly<{ provider?: string }> = {}): Promise<Response> {
    try {
      if (request.headers.get("Sec-Fetch-Site") !== "same-origin" || request.headers.get("Sec-Fetch-Mode") !== "navigate" || request.headers.get("Sec-Fetch-Dest") !== "document") return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const selected = this.interactionSelector(request);
      const provider = AuthProviderSchema.safeParse(parameters.provider);
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      this.requireEnabledProvider(provider.data);
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((key) => key !== "returnPath" && key !== "intent") || search.getAll("returnPath").length !== 1 || search.getAll("intent").length > 1) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const returnPath = ReturnPathSchema.safeParse(search.get("returnPath"));
      if (!returnPath.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const intent = OAuthIntentSchema.safeParse(search.get("intent") ?? "sign_in");
      if (!intent.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      const result = await this.dependencies.oauth.start(provider.data, {
        callbackBaseUrl: new URL("/api/auth/callback", this.origin),
        interactionSelector: selected,
        returnPath: returnPath.data,
        intent: intent.data,
        now: safeNow(this.dependencies.now),
      });
      return providerRedirect(result.authorizationUrl);
    } catch (error) { return errorResponse(error); }
  }

  /** Starts enumeration-resistant recovery using configured callback origin and a fresh interaction. */
  /**
   * CSRF와 이메일을 검사한 후 새 상호작용으로 비밀번호 복구 메일을 요청합니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns accepted JSON과 새 상호작용 쿠키 또는 오류 응답.
   */
  public async passwordResetRequest(request: Request): Promise<Response> {
    let budgetCookie: string | undefined;
    try {
      this.verifyMutation(request);
      const input = parse(PasswordResetRequestInputSchema, await body(request));
      const budgetSelector = cookie(request, AUTH_BUDGET_COOKIE_NAME) ?? createSessionSelector();
      budgetCookie = serializedCookie(authBudgetCookie(budgetSelector, this.dependencies.secureCookies));
      if (await this.dependencies.accountAccess.check(input.email, "password_reset", budgetSelector) === "absent") return fail("AUTH_ACCOUNT_NOT_FOUND", 404);
      const selected = this.createInteractionSelector();
      await this.dependencies.recovery.start(input.email, {
        passwordResetRedirectUrl: new URL("/api/auth/password/callback", this.origin),
        interactionSelector: selected,
        now: safeNow(this.dependencies.now),
      });
      return json({ accepted: true }, 200, [budgetCookie, serializedCookie(interactionCookie(selected, this.dependencies.secureCookies))]);
    } catch (error) {
      const response = errorResponse(error);
      if (budgetCookie !== undefined) response.headers.append("Set-Cookie", budgetCookie);
      return response;
    }
  }

  /** Exchanges one email confirmation code and redirects without preserving it in browser history. */
  /**
   * 브라우저 상호작용과 이메일 코드를 확인해 세션을 생성하고 코드가 없는 앱 경로로 이동시킵니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns 성공 시 세션 쿠키와 /app 이동; 실패 시 상호작용 쿠키를 지우고 /app 이동.
   */
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
  /**
   * 제공자·state·코드와 브라우저 상호작용으로 OAuth를 완료하고 저장된 허용 경로로 이동시킵니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns 로그인 성공은 세션 쿠키와 저장된 경로로 303, 가입 인증은 세션 없이 고정 로그인 안내로 303, 실패는 상호작용 쿠키 삭제와 /app 이동.
   */
  public async oauthCallback(request: Request): Promise<Response> {
    try {
      const selected = this.interactionSelector(request);
      const search = new URL(request.url).searchParams;
      const provider = AuthProviderSchema.safeParse(search.get("provider"));
      if (!provider.success) return fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
      this.requireEnabledProvider(provider.data);
      const state = callbackValue(search.get("state"));
      hashSessionSelector(state);
      const code = callbackValue(search.get("code"));
      const result = await this.dependencies.oauth.complete({ provider: provider.data, state, code }, { interactionSelector: selected, now: safeNow(this.dependencies.now) });
      if ("status" in result) {
        return redirect(this.origin, "/login?notice=social-signup", [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
      }
      return this.sessionRedirect(result, result.returnPath);
    } catch {
      return redirect(this.origin, "/app", [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    }
  }

  /** Rotates a provider token pair only after a session-bound CSRF POST. */
  /**
   * 세션 쿠키에 묶인 CSRF와 빈 JSON 본문을 검증하고 제공자 토큰 갱신을 요청합니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns refreshed JSON 또는 만료·제한·가용성 등에 맞춘 오류 응답.
   */
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
  /**
   * 복구 코드를 서버의 제한된 복구 자격 증명으로 교환합니다. 앱 로그인 세션은 만들지 않습니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns 성공 시 /reset-password 이동, 실패 시 로그인 불필요 복구 안내로 이동.
   */
  public async passwordCallback(request: Request): Promise<Response> {
    try {
      const selected = this.interactionSelector(request);
      const code = callbackValue(new URL(request.url).searchParams.get("code"));
      await this.dependencies.recovery.exchange({ code }, this.recoveryContext(selected));
      return redirect(this.origin, "/reset-password");
    } catch {
      return redirect(this.origin, "/forgot-password/invalid-link", [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    }
  }

  /** Consumes a limited recovery context, then removes its interaction cookie. */
  /**
   * 상호작용 쿠키에 묶인 CSRF와 새 비밀번호를 검증해 복구를 소비하고 해당 쿠키를 지웁니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns updated JSON과 쿠키 삭제 또는 안전한 오류 응답.
   */
  public async passwordUpdate(request: Request): Promise<Response> {
    try {
      const selected = this.verifyMutation(request, "interaction");
      const input = parse(PasswordUpdateInputSchema, await body(request));
      await this.dependencies.recovery.update(input, this.recoveryContext(selected));
      return json({ updated: true }, 200, [serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies))]);
    } catch (error) { return errorResponse(error); }
  }

  /** Resolves status without refreshing or extending the session. */
  /**
   * 세션을 갱신하지 않고 상태만 조회합니다. 접근 토큰 잔여 시간이 60초 이하면 명시적인 갱신 필요 오류를 보냅니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns 인증 상태·만료 시각 JSON 또는 오류 응답.
   */
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
  /**
   * CSRF 검증 후 로컬 세션을 먼저 폐기하고 제공자 로그아웃을 시도합니다. 외부 실패는 보류 기록으로 남기며 응답에서는 세션 쿠키를 지웁니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns signedOut JSON 또는 안전한 오류 응답; 어느 쪽이든 세션 쿠키 삭제를 포함합니다.
   */
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
  /**
   * 세션을 확인하고 만료 임박 여부를 검사한 뒤 고정된 내부 /v1/me만 요청합니다. 응답 스키마를 검증하며 제공자 토큰은 브라우저에 노출하지 않습니다.
   * @param request 표준 브라우저 Request; 헤더·쿠키·본문을 검증하며 사용합니다.
   * @returns 현재 사용자 JSON 또는 정규화한 인증/상위 서버 오류 응답.
   */
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
      return errorResponse(new BoundaryError(isAuthErrorCode(parsed.data.code) ? parsed.data.code : "AUTH_PROVIDER_UNAVAILABLE", isAuthErrorCode(parsed.data.code) ? statusFor(parsed.data.code) : 502));
    } catch (error) {
      if (error instanceof SessionOperationError) return sessionFailureResponse(error);
      return errorResponse(error);
    }
  }

  /**
   * 지정 종류의 쿠키를 선택하고 POST·출처·JSON·CSRF를 검증해 변경 작업 전 공통 방어를 적용합니다.
   * @param request 변경 요청.
   * @param selectorKind session·interaction·둘 중 선택 가능한 any.
   * @returns 검증을 통과한 브라우저 식별자.
   * @throws 쿠키가 없거나 CSRF 검증이 실패하면 거부 오류.
   */
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

  /** @param provider 검증된 공급자. 허용 목록이 없거나 빠져 있으면 부작용 전에 503으로 거부한다. */
  private requireEnabledProvider(provider: AuthProvider): void {
    if (!this.dependencies.enabledProviders?.includes(provider)) fail("AUTH_PROVIDER_UNAVAILABLE", 503);
  }

  /**
   * 요청에서 유일하고 유효한 세션 식별자를 요구합니다.
   * @param request 쿠키를 읽을 요청.
   * @returns 세션 식별자.
   * @throws 없거나 잘못되면 401 세션 만료 오류.
   */
  private sessionSelector(request: Request): string {
    return cookie(request, SESSION_COOKIE_NAME) ?? fail("AUTH_SESSION_EXPIRED", 401);
  }

  /**
   * 요청에서 유일하고 유효한 로그인 전 식별자를 요구합니다.
   * @param request 쿠키를 읽을 요청.
   * @returns 상호작용 식별자.
   * @throws 없거나 잘못되면 400 트랜잭션 오류.
   */
  private interactionSelector(request: Request): string {
    return cookie(request, INTERACTION_COOKIE_NAME) ?? fail("AUTH_OAUTH_TRANSACTION_INVALID", 400);
  }

  /**
   * 요청 헤더 대신 설정된 출처로 이메일 콜백을 만들고 현재 시각을 붙입니다.
   * @param interactionSelector 이메일 인증에 연결할 브라우저 식별자.
   * @returns 이메일 서비스용 신뢰된 컨텍스트.
   * @throws 시계 결과가 잘못되면 가용성 오류.
   */
  private emailContext(interactionSelector: string) {
    return { emailRedirectUrl: new URL("/api/auth/email/callback", this.origin), interactionSelector, now: safeNow(this.dependencies.now) };
  }

  /**
   * 설정된 출처로 복구 콜백을 만들고 브라우저 식별자와 현재 시각을 묶습니다.
   * @param interactionSelector 복구에 연결할 브라우저 식별자.
   * @returns 복구 서비스용 신뢰된 컨텍스트.
   * @throws 시계 결과가 잘못되면 가용성 오류.
   */
  private recoveryContext(interactionSelector: string) {
    return { passwordResetRedirectUrl: new URL("/api/auth/password/callback", this.origin), interactionSelector, now: safeNow(this.dependencies.now) };
  }

  /**
   * 세션 생성 결과에서 공개 사용자·만료 정보만 JSON으로 내보내고 세션 쿠키 설정 및 상호작용 쿠키 삭제를 추가합니다.
   * @param result 서비스가 생성한 공개 세션 결과.
   * @returns 로그인 성공 JSON Response.
   * @throws 잘못된 식별자 또는 날짜 직렬화 오류.
   */
  private sessionCreated(result: PublicSession): Response {
    return json({ user: result.user, expiresAt: result.accessTokenExpiresAt.toISOString(), absoluteExpiresAt: result.absoluteExpiresAt.toISOString() }, 200, [
      serializedCookie(sessionCookie(result.selector, this.dependencies.secureCookies)),
      serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies)),
    ]);
  }


  /**
   * 새 세션 쿠키 설정과 상호작용 쿠키 삭제를 포함하여 허용된 앱 경로로 이동시킵니다.
   * @param result 생성된 세션 정보.
   * @param path 허용된 로그인 후 내부 경로.
   * @returns 303 이동 Response.
   * @throws 잘못된 쿠키 식별자이면 오류.
   */
  private sessionRedirect(result: PublicSession, path: "/app" | "/settings/security"): Response {
    return redirect(this.origin, path, [
      serializedCookie(sessionCookie(result.selector, this.dependencies.secureCookies)),
      serializedCookie(clearAuthCookie(INTERACTION_COOKIE_NAME, this.dependencies.secureCookies)),
    ]);
  }
}
