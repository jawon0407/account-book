import { oauthAvailabilityResponse } from "../../../../server/http/oauth-availability.js";
export { unsupportedAuthRoute as POST, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../server/http/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** 공개 공급자 이름만 응답한다. 요청 인수·DB 연결·외부 자격 증명은 사용하지 않는다. */
export const GET = () => oauthAvailabilityResponse();
