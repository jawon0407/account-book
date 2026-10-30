import { handleBankRoute } from "../../../../../server/bank-connections/route-adapter.js";
export { unsupportedBankRoute as POST, unsupportedBankRoute as PUT, unsupportedBankRoute as PATCH, unsupportedBankRoute as DELETE, unsupportedBankRoute as HEAD, unsupportedBankRoute as OPTIONS } from "../../../../../server/bank-connections/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
/** @param request 본인 세션 요청. @param context 불투명 요청 ID는 권한이 아니며 서버에서 소유자를 확인한다. */
export const GET = (request: Request, context: { params: Promise<{ requestId: string }> }) => handleBankRoute("status", request, context);
