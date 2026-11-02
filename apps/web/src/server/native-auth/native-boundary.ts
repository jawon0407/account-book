import { boundedJson, CoreBoundaryError } from "../core/http-boundary.js";
import { nativeBearer, nativeRequestUrl } from "../security/native-request.js";
import type { NativeOperation } from "./native-types.js";

const paths: Record<NativeOperation, string> = { signIn: "sign-in", session: "session", refresh: "session/refresh", signOut: "sign-out" };

/** @param operation 라우트가 선택한 작업. @param request 외부 요청. @param origin 서버 canonical origin.
 * 브라우저 인증과 혼용을 막는다. 앱 진위/하드웨어 인증을 대신하지 않는다. */
export function nativeBoundary(operation: NativeOperation, request: Request, origin: URL): string | null {
  if (request.method !== (operation === "session" ? "GET" : "POST")) throw new CoreBoundaryError("AUTH_INVALID_CREDENTIALS", 405);
  const url = nativeRequestUrl(request, origin);
  if (url.pathname !== `/api/native/auth/${paths[operation]}` || url.search) {
    throw new CoreBoundaryError("AUTH_CSRF_REJECTED", 403);
  }
  if (operation === "signIn") {
    if (request.headers.has("authorization")) throw new CoreBoundaryError("AUTH_CSRF_REJECTED", 403);
    return null;
  }
  if (operation === "session" && (request.body !== null || ![null, "0"].includes(request.headers.get("content-length")))) throw new CoreBoundaryError("AUTH_INVALID_CREDENTIALS", 400);
  return nativeBearer(request);
}

/** @param request JSON 요청. 16KiB/3초 제한을 적용하고 원문 오류는 외부에 내보내지 않는다. */
export async function nativeBody(request: Request): Promise<unknown> {
  try { return await boundedJson(request, 16_384); }
  catch { throw new CoreBoundaryError("AUTH_INVALID_CREDENTIALS", 400); }
}
