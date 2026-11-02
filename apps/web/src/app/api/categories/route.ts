import { handleCoreRoute } from "../../../server/core/route-adapter.js";
export { unsupportedCoreRoute as PUT, unsupportedCoreRoute as PATCH, unsupportedCoreRoute as DELETE, unsupportedCoreRoute as HEAD, unsupportedCoreRoute as OPTIONS } from "../../../server/core/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request 세션을 포함한 브라우저 요청. @returns categoriesList의 검증된 공개 응답. */
export const GET = (request: Request) => handleCoreRoute("categoriesList", request);
/** @param request 세션을 포함한 브라우저 요청. @returns categoriesCreate의 검증된 공개 응답. */
export const POST = (request: Request) => handleCoreRoute("categoriesCreate", request);
