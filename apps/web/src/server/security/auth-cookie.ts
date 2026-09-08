const SELECTOR_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** The only cookie names this authentication boundary may create or remove. */
export const SESSION_COOKIE_NAME = "__Host-ab_session";
/** The only cookie names this authentication boundary may create or remove. */
export const INTERACTION_COOKIE_NAME = "__Host-ab_interaction";

/** A host-only opaque authentication cookie suitable for response serialization. */
export type AuthCookie = Readonly<{
  name: typeof SESSION_COOKIE_NAME | typeof INTERACTION_COOKIE_NAME;
  value: string;
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  priority: "high";
}>;

/**
 * 쿠키 검증 실패를 입력값이 없는 고정 오류로 중단합니다.
 * @returns 반환하지 않습니다.
 * @throws AUTH_COOKIE_INVALID 오류.
 */
function invalidCookie(): never {
  throw new Error("AUTH_COOKIE_INVALID");
}

/**
 * 브라우저 식별자가 정확히 32바이트를 표현한 표준 base64url 문자열인지 확인합니다.
 * @param value 검사할 외부 입력.
 * @returns 검증을 통과한 원래 문자열.
 * @throws 형식이나 길이가 다르면 AUTH_COOKIE_INVALID.
 */
function selector(value: unknown): string {
  if (typeof value !== "string" || !SELECTOR_PATTERN.test(value)) {
    return invalidCookie();
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    return invalidCookie();
  }
  return value;
}

/**
 * 식별자를 검증하고 HTTPS 전용·자바스크립트 접근 금지 속성을 갖춘 쿠키 데이터를 만듭니다. 실제 응답 전송은 호출자가 합니다.
 * @param name 허용된 인증 쿠키 이름.
 * @param value 쿠키에 넣을 불투명 식별자.
 * @param secure 반드시 true인 HTTPS 사용 여부.
 * @returns 직렬화 전의 쿠키 객체.
 * @throws 보안 설정이나 식별자가 잘못되면 AUTH_COOKIE_INVALID.
 */
function cookie(name: AuthCookie["name"], value: string, secure: unknown): AuthCookie {
  if (secure !== true) return invalidCookie();
  return { name, value: selector(value), httpOnly: true, secure: true, sameSite: "lax", path: "/", priority: "high" };
}

/** Creates the host-only HttpOnly cookie for a validated opaque session selector. */
/**
 * 로그인 세션을 가리키는 호스트 전용 쿠키 데이터를 만듭니다.
 * @param value 유효한 세션 식별자.
 * @param secure 반드시 true인 보안 설정.
 * @returns 세션 쿠키 객체.
 * @throws 검증 실패 시 AUTH_COOKIE_INVALID.
 */
export function sessionCookie(value: string, secure: boolean): AuthCookie {
  return cookie(SESSION_COOKIE_NAME, value, secure);
}

/** Creates the host-only HttpOnly cookie for a validated pre-auth interaction selector. */
/**
 * 로그인 전 이메일·OAuth 흐름을 연결하는 호스트 전용 쿠키 데이터를 만듭니다.
 * @param value 로그인 전 상호작용 식별자.
 * @param secure 반드시 true인 보안 설정.
 * @returns 상호작용 쿠키 객체.
 * @throws 검증 실패 시 AUTH_COOKIE_INVALID.
 */
export function interactionCookie(value: string, secure: boolean): AuthCookie {
  return cookie(INTERACTION_COOKIE_NAME, value, secure);
}

/** Removes only a known authentication cookie while preserving its host-only scope. */
/**
 * 인증 쿠키를 즉시 만료시키는 데이터를 만듭니다. 이름과 보안 범위는 기존 쿠키와 일치시킵니다.
 * @param name 삭제할 세션 또는 상호작용 쿠키 이름.
 * @param secure 반드시 true인 보안 설정.
 * @returns 빈 값과 maxAge 0을 가진 쿠키 객체.
 * @throws 알 수 없는 이름 또는 비보안 설정이면 AUTH_COOKIE_INVALID.
 */
export function clearAuthCookie(name: AuthCookie["name"], secure: boolean): AuthCookie & Readonly<{ maxAge: 0 }> {
  if ((name !== SESSION_COOKIE_NAME && name !== INTERACTION_COOKIE_NAME) || secure !== true) return invalidCookie();
  return { name, value: "", httpOnly: true, secure: true, sameSite: "lax", path: "/", priority: "high", maxAge: 0 };
}
