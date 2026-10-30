import { NativeSessionTokenSchema } from "@account-book/contracts";
import { CoreBoundaryError } from "../core/http-boundary.js";

/** @param url 프레임워크 URL. @param origin canonical 서버 설정. @param host 원래 Host. Next의 loopback 정규화만 허용한다. */
function matchesOrigin(url: URL, origin: URL, host: string | null): boolean {
  if (url.origin === origin.origin) return true;
  return ["127.0.0.1", "[::1]"].includes(origin.hostname) && url.hostname === "localhost" &&
    url.protocol === origin.protocol && url.port === origin.port && host === origin.host;
}

/** @param request 앱 HTTP 요청. @param origin 서버 canonical origin. 쿠키/브라우저 문맥을 거절하며 앱 진위 증명은 아니다. */
export function nativeRequestUrl(request: Request, origin: URL): URL {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || !matchesOrigin(url, origin, request.headers.get("host")) || url.hash || url.username || url.password ||
    request.headers.has("cookie") || request.headers.has("origin") || [...request.headers.keys()].some(name => name.startsWith("sec-fetch-"))) {
    throw new CoreBoundaryError("AUTH_CSRF_REJECTED", 403);
  }
  return url;
}

/** @param request 앱 HTTP 요청. 쉼표로 합쳐진 중복 헤더도 토큰 스키마에서 거절한다. */
export function nativeBearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  const parsed = NativeSessionTokenSchema.safeParse(authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (!parsed.success) throw new CoreBoundaryError("AUTH_SESSION_EXPIRED", 401);
  return parsed.data;
}
