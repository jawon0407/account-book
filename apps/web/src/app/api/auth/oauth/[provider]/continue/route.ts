import { handleAuthRoute } from "../../../../../../server/http/route-adapter.js";
export { unsupportedAuthRoute as POST, unsupportedAuthRoute as PUT, unsupportedAuthRoute as PATCH, unsupportedAuthRoute as DELETE, unsupportedAuthRoute as HEAD, unsupportedAuthRoute as OPTIONS } from "../../../../../../server/http/route-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
type Context = Readonly<{ params: Promise<Readonly<{ provider: string }>> }>;
/** 서버가 보관한 OAuth transaction을 이용해 공급자 인증으로 계속 진행한다. 고정 operation으로 handleAuthRoute에 위임한다.
 * @param request - Next.js가 전달한 HTTP 요청. URL·헤더·쿠키 검증은 서버에 위임한다.
 * @param context - params Promise가 provider 경로 값을 제공한다. 예: {provider: "google"}; 최종 허용 검사는 서버가 한다.
 * @returns 서버 컨트롤러의 Response Promise. 처리 예외는 어댑터에서 안전한 503 응답으로 변환한다.
 * @remarks 검증·외부 인증 URL 생성·리다이렉트는 서버 계층이 담당한다. 다른 메서드는 위의 재수출로 405 처리한다.
 */
export const GET = (request: Request, context: Context) => handleAuthRoute("oauthContinue", request, context);
