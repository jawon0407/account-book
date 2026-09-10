import { handleAuthRoute } from "../../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as POST, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../../server/http/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** 비밀번호 복구 링크에서 돌아온 요청을 전달한다. 고정 operation으로 handleAuthRoute에 위임한다.
 * @param request - Next.js가 전달한 HTTP 요청. URL·헤더·쿠키 검증은 서버에 위임한다.
 * @returns 서버 컨트롤러의 Response Promise. 처리 예외는 어댑터에서 안전한 503 응답으로 변환한다.
 * @remarks 서버가 복구 자료를 검증하고 비밀번호 변경용 문맥을 구성한다. 다른 메서드는 위의 재수출로 405 처리한다.
 */
export const GET = (request: Request) => handleAuthRoute("passwordCallback", request);
