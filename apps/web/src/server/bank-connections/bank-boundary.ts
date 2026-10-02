import { ApiErrorSchema, BankConnectionRequestIdSchema, buildApiError, type ApiErrorCode } from "@account-book/contracts";
import { z } from "zod";
import { coreJson, CoreBoundaryError } from "../core/http-boundary.js";
import { failure, sessionSelector, type CoreDependencies } from "../core/core-controller.js";
import { AuthRequestRejectedError, verifyMutationCsrfRequest } from "../security/request-origin.js";

export const BankId = BankConnectionRequestIdSchema.refine(id => id === id.toLowerCase());
export const StartOutput = z.strictObject({ requestId: BankId, authorizationUrl: z.string().min(1).max(8192) });
export const CompleteInput = z.strictObject({ requestId: BankId });
export const EmptyInput = z.strictObject({});

/** @param response 생성한 응답. @returns 모든 성공·실패에서 referrer를 숨기는 동일 응답. */
export function privateBankResponse(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
/** @param error 내부 오류. @returns 공개 코드만 남기는 응답. */
export const bankFailure = (error: unknown) => privateBankResponse(failure(error));
/** @param code 은행 오류. @param status HTTP 상태. */
export const bankError = (code: ApiErrorCode, status: number) => privateBankResponse(coreJson(buildApiError({ code, retryable: false }), status));

/** @param deps 기존 인증 의존성. @param request 요청. @returns 최신 DB 세션의 사용자/세션만 사용한다. */
export async function bankIdentity(deps: CoreDependencies, request: Request) {
  const selector = sessionSelector(request), now = deps.now();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_CLOCK");
  if (request.method !== "GET") verifyMutationCsrfRequest(request, { selector }, { now, key: deps.csrfKey, allowedOrigins: new Set([deps.configuredOrigin.origin]) });
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== deps.configuredOrigin.origin) || (site !== null && site !== "same-origin" && site !== "none")) throw new AuthRequestRejectedError();
  const session = await deps.sessions.resolve(selector, now);
  const expected = request.headers.get("x-account-book-user");
  if (expected !== null && expected !== session.userId) throw new CoreBoundaryError("AUTH_SESSION_EXPIRED", 401);
  const remaining = session.accessTokenExpiresAt.getTime() - now.getTime();
  if (!Number.isFinite(remaining)) throw new Error("INVALID_SESSION");
  if (remaining <= 60_000) throw new CoreBoundaryError("AUTH_SESSION_REFRESH_REQUIRED", 401);
  return { userId: session.userId, sessionId: session.sessionId };
}

/** @param value 상류 인가 URL. @param endpoint 서버가 주입한 허용 HTTPS 경로. @returns 정확한 origin/path·state만 통과. */
export function authorizationUrl(value: string, endpoint: string): string {
  const url = new URL(value), allowed = new URL(endpoint), state = url.searchParams.get("state") ?? "";
  if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.search || allowed.hash
    || url.origin !== allowed.origin || url.pathname !== allowed.pathname || url.username || url.password || url.hash
    || value !== url.href || url.searchParams.getAll("state").length !== 1 || !/^[A-Za-z0-9_-]{43}$/u.test(state)
    || Buffer.from(state, "base64url").toString("base64url") !== state) throw new Error("INVALID_BANK_URL");
  return url.href;
}
const statuses: Partial<Record<ApiErrorCode, number>> = { BANK_INVALID_REQUEST: 400, BANK_REQUEST_NOT_FOUND: 404, BANK_REQUEST_CONFLICT: 409, BANK_RATE_LIMITED: 429, BANK_UNAVAILABLE: 503, AUTH_SESSION_EXPIRED: 401 };
/** @param value 상류 오류. @param status 상류 HTTP 상태. 원문 message/header는 전달하지 않는다. */
export function bankUpstreamFailure(value: unknown, status: number): Response {
  const parsed = ApiErrorSchema.parse(value);
  if (statuses[parsed.code] !== status) throw new Error("INVALID_BANK_ERROR");
  return bankError(parsed.code, status);
}
