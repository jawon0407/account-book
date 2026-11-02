import { handleNativeCoreRoute, type CoreRouteContext } from "../../../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as POST, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as PUT, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request Android bearer 요청. @param context 경로 문맥. @returns 인증된 설치의 서버 동의 상태. */
export const GET = (request: Request, context: CoreRouteContext) => handleNativeCoreRoute("consentGet", request, context);
/** @param request 명시적 동의/철회와 기대 버전. @param context 경로 문맥. @returns commit된 서버 상태. */
export const PATCH = (request: Request, context: CoreRouteContext) => handleNativeCoreRoute("consentChange", request, context);
