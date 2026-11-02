import type { SessionService } from "../session/session-service.js";
import type { NativeRateLimitPort } from "../native-auth/native-types.js";
import { SESSION_COOKIE_NAME } from "../security/auth-cookie.js";
import { hashSessionSelector } from "../security/session-selector.js";
import { AuthRequestRejectedError, verifyMutationCsrfRequest } from "../security/request-origin.js";
import { nativeBearer, nativeRequestUrl } from "../security/native-request.js";
import { CoreBoundaryError } from "./http-boundary.js";

export type CoreChannelPolicy = Readonly<{ channel: "web" }> | Readonly<{ channel: "android"; limiter: NativeRateLimitPort }>;
type Dependencies = Readonly<{ configuredOrigin: URL; csrfKey: Uint8Array; sessions: Pick<SessionService, "resolve"> }>;

/** @param request 브라우저 요청. 중복 쿠키/비정규 선택자는 DB 접근 전에 거절한다. */
export function sessionSelector(request: Request): string {
  const values = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.split("=", 1)[0] === SESSION_COOKIE_NAME);
  try {
    if (values.length !== 1) throw new Error("INVALID_COOKIE");
    const selector = values[0]!.slice(SESSION_COOKIE_NAME.length + 1);
    hashSessionSelector(selector);
    return selector;
  } catch { throw new CoreBoundaryError("AUTH_SESSION_EXPIRED", 401); }
}

/** @param policy 서버 고정 채널. @param request 외부 요청. @param deps 출처/CSRF 정책. @param now 검증 시각. @returns 검증된 세션 선택자. */
export async function coreRequestSelector(policy: CoreChannelPolicy, request: Request, deps: Dependencies, now: Date): Promise<string> {
  if (policy.channel === "android") {
    nativeRequestUrl(request, deps.configuredOrigin);
    if (request.method === "GET" && (request.body !== null || ![null, "0"].includes(request.headers.get("content-length")))) throw new CoreBoundaryError("LEDGER_VALIDATION_FAILED", 400);
    const selector = nativeBearer(request);
    if (!await policy.limiter.consume(request.method === "GET" ? "ledgerRead" : "ledgerWrite", "global", "all")) throw new CoreBoundaryError("AUTH_RATE_LIMITED", 429);
    return selector;
  }
  const selector = sessionSelector(request);
  if (request.method !== "GET") verifyMutationCsrfRequest(request, { selector }, { now, key: deps.csrfKey, allowedOrigins: new Set([deps.configuredOrigin.origin]) });
  // Next의 내부 listener URL은 공개 출처가 아니다. 웹은 검증된 Origin/CSRF와 고정 경로로 제한한다.
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== deps.configuredOrigin.origin) || (site !== null && site !== "same-origin" && site !== "none")) throw new AuthRequestRejectedError();
  return selector;
}

/** @param policy 서버 채널. @param request 추가 사용자 일치 조건만 읽는다. @param deps 세션 서비스. @param selector 검증된 토큰. @param now 검증 시각. */
export async function coreSession(policy: CoreChannelPolicy, request: Request, deps: Dependencies, selector: string, now: Date) {
  const session = await deps.sessions.resolve(selector, now);
  if (session.clientChannel !== policy.channel || (policy.channel === "android" && !session.deviceId)) throw new CoreBoundaryError("AUTH_SESSION_EXPIRED", 401);
  const expected = request.headers.get("x-account-book-user");
  if (expected !== null && expected !== session.userId) throw new CoreBoundaryError("AUTH_SESSION_EXPIRED", 401);
  const remaining = session.accessTokenExpiresAt.getTime() - now.getTime();
  if (!Number.isFinite(remaining)) throw new Error("INVALID_SESSION");
  if (remaining <= 60_000) throw new CoreBoundaryError("AUTH_SESSION_REFRESH_REQUIRED", 401);
  if (policy.channel === "android" && !await policy.limiter.consume(request.method === "GET" ? "ledgerRead" : "ledgerWrite", "identity", `${session.userId}:${session.deviceId}`)) throw new CoreBoundaryError("AUTH_RATE_LIMITED", 429);
  return session;
}
