import { handleCoreRoute } from "../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as PUT, unsupportedCoreRoute as PATCH, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request 세션을 포함한 브라우저 요청. @returns accountsList의 검증된 공개 응답. */
export const GET = (request: Request) => handleCoreRoute("accountsList", request);
/** @param request 세션을 포함한 브라우저 요청. @returns accountsCreate의 검증된 공개 응답. */
export const POST = (request: Request) => handleCoreRoute("accountsCreate", request);
