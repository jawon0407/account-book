import { handleAuthRoute } from "../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as GET, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../server/http/route-adapter.js";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** 이메일 로그인 요청을 인증 컨트롤러에 전달한다. 고정 operation으로 handleAuthRoute에 위임한다.
 * @param request - Next.js가 전달한 HTTP 요청. URL·헤더·쿠키·JSON 본문 검증은 서버에 위임한다.
 * @returns 서버 컨트롤러의 Response Promise. 처리 예외는 어댑터에서 안전한 503 응답으로 변환한다.
 * @remarks 입력·Origin·CSRF 검증 후 서버 세션과 응답 쿠키를 만들 수 있다. 다른 메서드는 위의 재수출로 405 처리한다.
 */
export const POST = (request: Request) => handleAuthRoute("signIn", request);
