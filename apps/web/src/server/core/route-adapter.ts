import "server-only";
import { createRequestContainer } from "../container.js";
import { CoreBoundaryError, coreFailure } from "./http-boundary.js";
import { operationFor, type CoreOperation } from "./operations.js";
import type { CoreController } from "./core-controller.js";

export type CoreRouteContext = Readonly<{ params?: Promise<Readonly<Record<string, string>>> }>;
type ContainerFactory = () => Readonly<{ coreController: Pick<CoreController, "handle"> }>;

/**
 * 라우트가 지정한 작업만 요청별 컨트롤러에 연결한다. 생성/params 오류 원문은 공개하지 않는다.
 * @param operation 서버 고정 작업. @param request 표준 요청. @param context Next의 비동기 경로 매개변수.
 * @param factory 요청 전용 컨테이너 생성자. @returns 캐시 금지 컨트롤러 응답.
 */
export async function handleCoreRoute(operation: CoreOperation, request: Request, context: CoreRouteContext = {}, factory: ContainerFactory = createRequestContainer): Promise<Response> {
  try {
    operationFor(operation);
    const parameters = context.params === undefined ? {} : await context.params;
    return await factory().coreController.handle(operation, request, parameters);
  } catch (error) {
    if (error instanceof CoreBoundaryError) return coreFailure(error.code, error.status);
    return coreFailure("LEDGER_SERVICE_UNAVAILABLE", 503);
  }
}

/** 허용하지 않은 HTTP 메서드는 컨테이너/DB/API를 만들거나 호출하지 않고 405로 끝낸다. */
export function unsupportedCoreRoute(): Response { return coreFailure("LEDGER_VALIDATION_FAILED", 405); }
