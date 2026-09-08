import { handleAuthRoute } from "../../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as GET, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../../server/http/route-adapter.js";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** CSRF 보호 세션 갱신 요청을 전달한다. 고정 operation으로 handleAuthRoute에 위임한다.
 * @param request - Next.js가 전달한 HTTP 요청. URL·헤더·쿠키·JSON 본문 검증은 서버에 위임한다.
 * @returns 서버 컨트롤러의 Response Promise. 처리 예외는 어댑터에서 안전한 503 응답으로 변환한다.
 * @remarks 서버 계층에서 공급자 자격증명·세션·쿠키를 갱신할 수 있다. 다른 메서드는 위의 재수출로 405 처리한다.
 */
export const POST = (request: Request) => handleAuthRoute("refresh", request);
