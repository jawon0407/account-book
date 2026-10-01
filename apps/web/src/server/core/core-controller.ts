import { SessionOperationError, type SessionService } from "../session/session-service.js";
import type { DelegatedApiClient } from "../http/delegated-api-client.js";
import { SESSION_COOKIE_NAME } from "../security/auth-cookie.js";
import { hashSessionSelector } from "../security/session-selector.js";
import { AuthRequestRejectedError, verifyMutationCsrfRequest } from "../security/request-origin.js";
import { CoreBoundaryError, boundedJson, coreJson, coreFailure, upstreamFailure } from "./http-boundary.js";
import { operationFor, targetFor, invalidInput } from "./operations.js";

export type CoreDependencies = Readonly<{
  configuredOrigin: URL;
  csrfKey: Uint8Array;
  now: () => Date;
  sessions: Pick<SessionService, "resolve">;
  delegatedApiClient: Pick<DelegatedApiClient, "request">;
}>;

/** @param request 브라우저 요청. @returns 중복/위조를 거부한 세션 선택자. DB 내용은 읽지 않는다. */
function sessionSelector(request: Request): string {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.split("=", 1)[0] === SESSION_COOKIE_NAME);
  try {
    if (values.length !== 1) throw new Error("INVALID_COOKIE");
    const selector = values[0]!.slice(SESSION_COOKIE_NAME.length + 1);
    hashSessionSelector(selector);
    return selector;
  } catch { throw new CoreBoundaryError("AUTH_SESSION_EXPIRED", 401); }
}

/** @param error 경계/세션 오류. @returns 세부값을 숨긴 공개 응답. */
function failure(error: unknown): Response {
  if (error instanceof CoreBoundaryError) return coreFailure(error.code, error.status);
  if (error instanceof AuthRequestRejectedError) return coreFailure("AUTH_CSRF_REJECTED", 403);
  if (error instanceof SessionOperationError) {
    if (error.reason === "expired") return coreFailure("AUTH_SESSION_EXPIRED", 401);
    if (error.reason === "rate_limited") return coreFailure("AUTH_RATE_LIMITED", 429);
  }
  return coreFailure("AUTH_PROVIDER_UNAVAILABLE", 503);
}

/** 세션 식별 → CSRF/입력 검증 → 한 번의 위임 전송 → 공개 응답 검증을 담당한다. DB 권한을 늘리지 않는다. */
export class CoreController {
  /** @param dependencies 요청 전용 서비스와 서버 정책. */
  public constructor(private readonly dependencies: CoreDependencies) {}
  /** @param operation 서버의 고정 작업. @param request 브라우저 요청. @param parameters 경로 매개변수. */
  public async handle(operation: string, request: Request, parameters: Readonly<Record<string, string>> = {}): Promise<Response> {
    try {
      const selected = operationFor(operation);
      if (request.method !== selected.method) return coreFailure("LEDGER_VALIDATION_FAILED", 405);
      const selector = sessionSelector(request);
      const now = this.dependencies.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("INVALID_CLOCK");
      const read = selected.method === "GET";
      if (!read) verifyMutationCsrfRequest(request, { selector }, { now, key: this.dependencies.csrfKey, allowedOrigins: new Set([this.dependencies.configuredOrigin.origin]) });
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      const site = request.headers.get("sec-fetch-site");
      // Next는 프록시 뒤에서 URL에 내부 listener 주소를 사용할 수 있다. 공개 출처는 검증된 Origin/Referer로 판단한다.
      // URL의 호스트는 내부 API 대상에 사용하지 않으며 경로·쿼리만 아래 고정 작업 표와 대조한다.
      if ((origin !== null && origin !== this.dependencies.configuredOrigin.origin) || (site !== null && site !== "same-origin" && site !== "none")) throw new AuthRequestRejectedError();
      const target = targetFor(selected, url, parameters);
      let body = new Uint8Array();
      if (selected.input) {
        try { body = new TextEncoder().encode(JSON.stringify(selected.input.parse(await boundedJson(request, 16_384)))); }
        catch { throw invalidInput(selected); }
      }
      const session = await this.dependencies.sessions.resolve(selector, now);
      // 화면 A를 연 후 다른 탭에서 B로 로그인한 경우 A의 입력을 B에게 적용하지 않는다.
      // 이 헤더는 추가 일치 조건일 뿐이며 실제 사용자/권한은 반드시 서버 세션에서 가져온다.
      const expectedUserId = request.headers.get("x-account-book-user");
      if (expectedUserId !== null && expectedUserId !== session.userId) return coreFailure("AUTH_SESSION_EXPIRED", 401);
      const remaining = session.accessTokenExpiresAt.getTime() - now.getTime();
      if (!Number.isFinite(remaining)) throw new Error("INVALID_SESSION");
      if (remaining <= 60_000) return coreFailure("AUTH_SESSION_REFRESH_REQUIRED", 401);
      try {
        const upstream = await this.dependencies.delegatedApiClient.request({ body, contentType: read ? null : "application/json", method: selected.method, scope: selected.scope, target, sessionId: session.sessionId, userId: session.userId });
        const parsed = await boundedJson(upstream, 1_048_576);
        if (!upstream.ok) return upstreamFailure(parsed, upstream.status, read);
        if (upstream.status !== selected.status) throw new Error("INVALID_STATUS");
        const output = selected.output.parse(parsed);
        // 응답 모양뿐 아니라 요청한 본인/자원의 ID가 일치하는지도 확인한다.
        if (selected.path === "/v1/profile" && (output as { id: string }).id !== session.userId) throw new Error("INVALID_PROFILE");
        if (selected.item && (output as { id: string }).id !== parameters.id?.toLowerCase()) throw new Error("INVALID_RESOURCE");
        if (selected.list && (output as { items: unknown[] }).items.length > 1_000) throw new Error("INVALID_LIST");
        return coreJson(output, selected.status);
      } catch { return coreFailure("LEDGER_SERVICE_UNAVAILABLE", 502, read); }
    } catch (error) { return failure(error); }
  }
}
