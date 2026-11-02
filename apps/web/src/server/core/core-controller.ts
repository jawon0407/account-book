import { SessionOperationError, type SessionService } from "../session/session-service.js";
import type { DelegatedApiClient } from "../http/delegated-api-client.js";
import { AuthRequestRejectedError } from "../security/request-origin.js";
import { CoreBoundaryError, boundedJson, coreJson, coreFailure, upstreamFailure } from "./http-boundary.js";
import { operationFor, targetFor, invalidInput } from "./operations.js";
import { coreRequestSelector, coreSession, type CoreChannelPolicy } from "./channel-auth.js";
export { sessionSelector } from "./channel-auth.js";

export type CoreDependencies = Readonly<{
  configuredOrigin: URL;
  csrfKey: Uint8Array;
  now: () => Date;
  sessions: Pick<SessionService, "resolve">;
  delegatedApiClient: Pick<DelegatedApiClient, "request">;
}>;

/** @param error 경계/세션 오류. @returns 세부값을 숨긴 공개 응답. */
export function failure(error: unknown): Response {
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
  public constructor(private readonly dependencies: CoreDependencies, private readonly policy: CoreChannelPolicy = { channel: "web" }) {}
  /** @param operation 서버의 고정 작업. @param request 브라우저 요청. @param parameters 경로 매개변수. */
  public async handle(operation: string, request: Request, parameters: Readonly<Record<string, string>> = {}): Promise<Response> {
    try {
      const selected = operationFor(operation);
      if (request.method !== selected.method) return coreFailure("LEDGER_VALIDATION_FAILED", 405);
      const now = this.dependencies.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("INVALID_CLOCK");
      const read = selected.method === "GET";
      const selector = await coreRequestSelector(this.policy, request, this.dependencies, now);
      const url = new URL(request.url);
      const target = targetFor(selected, url, parameters, this.policy.channel === "android" ? "/api/native/" : "/api/");
      let body = new Uint8Array();
      if (selected.input) {
        try { body = new TextEncoder().encode(JSON.stringify(selected.input.parse(await boundedJson(request, 16_384)))); }
        catch { throw invalidInput(selected); }
      }
      const session = await coreSession(this.policy, request, this.dependencies, selector, now);
      if (selected.androidOnly && session.clientChannel !== "android") return coreFailure("LEDGER_CHANNEL_FORBIDDEN", 403);
      try {
        const upstream = await this.dependencies.delegatedApiClient.request({ body, contentType: read ? null : "application/json", method: selected.method, scope: selected.scope, target, sessionId: session.sessionId, userId: session.userId, clientChannel: session.clientChannel });
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
