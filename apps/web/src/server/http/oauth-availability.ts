import "server-only";
import { enabledOAuthProviders } from "../auth/oauth-configuration.js";
import { safeAuthFailure } from "./auth-controller.js";

/**
 * DB·공급자 요청 없이 UI에 활성화 목록만 전달한다. 설정 오류 시 원문 없이 거부한다.
 * @param environment 서버 설정. 테스트만 별도 값을 주입하며 요청 입력을 사용하지 않는다.
 * @returns 캐시 금지 JSON. 이 목록은 상태 안내이지 인증 권한 증명이 아니다.
 */
export function oauthAvailabilityResponse(environment: Readonly<Record<string, string | undefined>> = process.env): Response {
  try {
    return Response.json({ enabledProviders: enabledOAuthProviders(environment) }, {
      headers: { "Cache-Control": "private, no-store", Pragma: "no-cache", Expires: "0", "X-Content-Type-Options": "nosniff" },
    });
  } catch { return safeAuthFailure("AUTH_PROVIDER_UNAVAILABLE", 503, false); }
}
