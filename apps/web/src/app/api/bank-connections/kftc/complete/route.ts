import { handleBankRoute } from "../../../../../server/bank-connections/route-adapter.js";
export { unsupportedBankRoute as GET, unsupportedBankRoute as PUT, unsupportedBankRoute as PATCH, unsupportedBankRoute as DELETE, unsupportedBankRoute as HEAD, unsupportedBankRoute as OPTIONS } from "../../../../../server/bank-connections/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
/** @param request 세션·CSRF 쿠키를 포함한 브라우저 요청. 은행 비밀값은 반환하지 않는다. */
export const POST = (request: Request) => handleBankRoute("complete", request);
