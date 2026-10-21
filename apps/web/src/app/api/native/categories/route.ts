import { handleNativeCoreRoute, type CoreRouteContext } from "../../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as PATCH, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as PUT, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request Android Bearer 요청. @param context 비동기 경로 변수. 고정 작업만 호출한다. */
export const GET = (request: Request, context: CoreRouteContext) => handleNativeCoreRoute("categoriesList", request, context);
/** @param request Android Bearer 요청. @param context 비동기 경로 변수. 고정 작업만 호출한다. */
export const POST = (request: Request, context: CoreRouteContext) => handleNativeCoreRoute("categoriesCreate", request, context);
