import "server-only";
import { createRequestContainer } from "../container.js";
import { coreFailure } from "../core/http-boundary.js";
import type { NativeAuthController } from "./native-controller.js";
import type { NativeOperation } from "./native-types.js";

/** @param operation 서버가 정한 작업. @param request HTTP 요청. @param factory 요청 전용 의존성 생성기. 설정 오류도 비밀값 없이 종료한다. */
export async function handleNativeAuthRoute(operation: NativeOperation, request: Request, factory: () => { nativeAuthController: Pick<NativeAuthController, "handle"> } = createRequestContainer): Promise<Response> {
  try { return await factory().nativeAuthController.handle(operation, request); }
  catch { return coreFailure("AUTH_PROVIDER_UNAVAILABLE", 503); }
}

/** 허용하지 않는 메서드에 캐시 금지 405를 반환하며 CORS 허용 헤더를 만들지 않는다. */
export function unsupportedNativeRoute(): Response { return coreFailure("AUTH_INVALID_CREDENTIALS", 405); }
