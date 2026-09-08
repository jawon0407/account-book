import { handleAuthRoute } from "../../../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as GET, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../../../server/http/route-adapter.js";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
type Context = Readonly<{ params: Promise<Readonly<{ provider: string }>> }>;
/** 선택 공급자의 OAuth 시작 요청을 전달한다. 고정 operation으로 handleAuthRoute에 위임한다.
 * @param request - Next.js가 전달한 HTTP 요청. URL·헤더·쿠키·JSON 본문 검증은 서버에 위임한다.
 * @param context - params Promise가 provider 경로 값을 제공한다. 예: {provider: "google"}; 최종 허용 검사는 서버가 한다.
 * @returns 서버 컨트롤러의 Response Promise. 처리 예외는 어댑터에서 안전한 503 응답으로 변환한다.
 * @remarks 서버에서 provider 허용 목록과 CSRF를 검사하고 같은 출처 계속 경로를 반환한다. 다른 메서드는 위의 재수출로 405 처리한다.
 */
export const POST = (request: Request, context: Context) => handleAuthRoute("oauthStart", request, context);
