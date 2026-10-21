import { handleCoreRoute, type CoreRouteContext } from "../../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as GET, unsupportedCoreRoute as POST, unsupportedCoreRoute as PUT, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request 세션·CSRF·변경 JSON. @param context 검증할 UUID. @returns 수정 후 공개 거래. */
export const PATCH = (request: Request, context: CoreRouteContext) => handleCoreRoute("transactionsUpdate", request, context);
/** @param request 세션·CSRF·기대 버전. @param context 검증할 UUID. @returns soft delete tombstone. */
export const DELETE = (request: Request, context: CoreRouteContext) => handleCoreRoute("transactionsDelete", request, context);
