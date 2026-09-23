import "server-only";

import { createRequestContainer, type RequestContainer } from "../container.js";
import { safeAuthFailure } from "./auth-controller.js";

const OPERATIONS = new Set(["csrf", "signUp", "signIn", "emailCallback", "oauthStart", "oauthContinue", "oauthCallback", "session", "refresh", "signOut", "passwordResetRequest", "passwordCallback", "passwordUpdate", "me"]);

type RouteContext = Readonly<{ params?: Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>> }>;
type ContainerFactory = () => RequestContainer;

/**
 * Creates one dependency graph, resolves trusted filesystem route parameters, and delegates to the controller.
 * @param operation - Fixed operation name selected by a route module, never by request input.
 * @param request - The standard request passed unchanged to the controller.
 * @param context - Optional Next route context containing only path parameters.
 * @param factory - Request-scoped container factory; injectable for deterministic tests.
 * @returns The controller response without route-level domain logic.
 */
/**
 * 허용된 작업 이름으로 요청별 의존성을 만들고 경로 매개변수를 기다린 뒤 컨트롤러 메서드에 위임합니다.
 * @param operation 라우트 코드가 고정한 작업 이름; 요청 입력으로 선택하지 않습니다.
 * @param request 컨트롤러에 그대로 전달할 표준 요청.
 * @param context 선택적 Next 경로 매개변수.
 * @param factory 요청별 컨테이너 생성 함수; 테스트에서 교체 가능.
 * @returns 컨트롤러 응답; 위임 실패 시 재시도 불가 표시의 안전한 503 응답.
 */
export async function handleAuthRoute(operation: string, request: Request, context: RouteContext = {}, factory: ContainerFactory = createRequestContainer): Promise<Response> {
  try {
    if (!OPERATIONS.has(operation)) throw new Error("AUTH_ROUTE_INVALID");
    const container = factory();
    const candidate = (container.authController as unknown as Record<string, unknown>)[operation];
    if (typeof candidate !== "function") throw new Error("AUTH_ROUTE_INVALID");
    const parameters = context.params === undefined ? {} : await context.params;
    return await (candidate as (request: Request, parameters: Readonly<Record<string, string>>) => Promise<Response>).call(container.authController, request, parameters);
  } catch {
    return safeAuthFailure("AUTH_PROVIDER_UNAVAILABLE", 503, false);
  }
}

/** Explicitly rejects every route method not selected by a route module. */
/**
 * 지원하지 않는 HTTP 메서드용 고정 오류 응답을 만듭니다.
 * @param request 사용하지 않는 표준 요청; 라우트 서명을 맞추기 위해 받습니다.
 * @returns 405 상태의 표준 인증 오류 응답.
 */
export function unsupportedAuthRoute(request: Request): Response {
  void request;
  return safeAuthFailure("AUTH_INVALID_CREDENTIALS", 405);
}
