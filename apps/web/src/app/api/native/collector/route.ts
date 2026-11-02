import { handleNativeCoreRoute, type CoreRouteContext } from "../../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as POST, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as PUT, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request Android bearer 요청. @param context 비동기 경로 문맥. @returns 이 세션의 수집 상태만. */
export const GET = (request: Request, context: CoreRouteContext) => handleNativeCoreRoute("collectorGet", request, context);
/** @param request 버전·활성/해제·교체 선택. @param context 경로 문맥. @returns 서버가 검증하고 변경한 상태. */
export const PATCH = (request: Request, context: CoreRouteContext) => handleNativeCoreRoute("collectorChange", request, context);
