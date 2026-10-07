import { handleCoreRoute } from "../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as PUT, unsupportedCoreRoute as PATCH, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../server/core/route-adapter.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request 본인 세션과 조회 필터. @returns 검증된 거래 페이지. */
export const GET = (request: Request) => handleCoreRoute("transactionsList", request);
/** @param request CSRF로 보호하는 생성 JSON. @returns 멱등 거래 응답. */
export const POST = (request: Request) => handleCoreRoute("transactionsCreate", request);
