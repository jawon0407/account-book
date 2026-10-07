import "server-only";
import type { AuthProvider } from "@account-book/contracts";

/** undefined는 이메일 필수, refresh는 기존 OAuth 세션만 허용한다. */
export type SocialSessionPolicy = AuthProvider | "refresh" | undefined;

/** 객체 후보를 읽되 null·배열을 신뢰하지 않는다. @param value 제공자 응답 필드. @returns 객체 또는 빈 객체. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * 이메일이 없는 계정의 소셜 신원을 검증한다. 반드시 고정 Supabase HTTPS 응답에만 적용한다.
 * @param user 서버가 반환한 사용자. 편집 가능한 user_metadata는 읽지 않는다.
 * @param claims 같은 응답 토큰의 클레임. 별도 서명 검증기가 아니며 브라우저 JWT 입력에는 사용 금지.
 * @param policy 서버 트랜잭션의 기대 공급자 또는 기존 세션 갱신.
 * @returns 비익명 OAuth 인증·동일 사용자·허용 공급자의 비어 있지 않은 고유 식별자가 모두 확인될 때 true.
 */
export function hasEmailLessSocialIdentity(user: Record<string, unknown>, claims: Record<string, unknown>, policy: SocialSessionPolicy): boolean {
  if (policy === undefined || user.is_anonymous !== false || claims.is_anonymous !== false) return false;
  const oauth = Array.isArray(claims.amr) && claims.amr.some((entry) => {
    const method = record(entry);
    return method.method === "oauth" && typeof method.timestamp === "number" && Number.isSafeInteger(method.timestamp)
      && method.timestamp > 0 && typeof claims.iat === "number" && method.timestamp <= claims.iat;
  });
  if (!oauth || !Array.isArray(user.identities)) return false;
  const allowed = policy === "refresh" ? ["google", "kakao", "custom:naver"] : [policy === "naver" ? "custom:naver" : policy];
  return user.identities.some((entry) => {
    const identity = record(entry);
    const sub = record(identity.identity_data).sub;
    return identity.user_id === user.id && typeof identity.provider === "string" && allowed.includes(identity.provider)
      && typeof sub === "string" && sub.trim().length > 0 && sub.length <= 1024;
  });
}
