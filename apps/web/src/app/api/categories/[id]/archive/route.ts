import { handleCoreRoute, type CoreRouteContext } from "../../../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as GET, unsupportedCoreRoute as PUT, unsupportedCoreRoute as PATCH, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request 세션을 포함한 브라우저 요청. @param context UUID 경로 매개변수. @returns categoriesArchive의 검증된 공개 응답. */
export const POST = (request: Request, context: CoreRouteContext) => handleCoreRoute("categoriesArchive", request, context);
