import { handleNativeAuthRoute } from "../../../../../server/native-auth/route-adapter.js";
export { unsupportedNativeRoute as GET, unsupportedNativeRoute as PUT, unsupportedNativeRoute as PATCH, unsupportedNativeRoute as DELETE, unsupportedNativeRoute as HEAD, unsupportedNativeRoute as OPTIONS } from "../../../../../server/native-auth/route-adapter.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** @param request Android HTTP 요청. 고정 작업과 공통 보안 경계에 위임한다. */
export const POST = (request: Request) => handleNativeAuthRoute("signOut", request);
