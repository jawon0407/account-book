import "server-only";

import { derivePkceChallenge, validatePkceChallenge } from "../../security/pkce.js";
import { fail } from "./error-mapper.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Supabase 공개 엔드포인트와 anon 키를 검증한 서버 설정입니다. service-role 자격 증명은 포함하지 않습니다. */
export type SupabaseServerConfig = Readonly<{ url: string; anonKey: string }>;

/**
 * 외부 값이 null이나 배열이 아닌 객체인지 검사합니다.
 * @param value 검사할 응답 후보.
 * @returns 문자열 키의 객체로 좁힌 값.
 * @throws 객체가 아니면 제공자 가용성 오류.
 */
export function object(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }

/**
 * ASCII 제어문자 포함 여부를 찾습니다.
 * @param value 검사할 문자열.
 * @returns 제어문자가 있으면 true.
 */
function hasControlCharacter(value: string): boolean { return Array.from(value).some((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127; }); }

/**
 * 빈 문자열·과도한 길이·앞뒤 공백·제어문자를 거부합니다.
 * @param value 검사할 문자열 후보.
 * @param max 허용 최대 문자 수; 기본 16384.
 * @returns 검증된 문자열.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
function nonEmpty(value: unknown, max = 16_384): string { if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || hasControlCharacter(value)) return fail(); return value; }

/**
 * 서버 토큰에 공통 문자열 제한을 적용합니다.
 * @param value 토큰 후보.
 * @returns 검증된 토큰 문자열.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
export function token(value: unknown): string { return nonEmpty(value); }

/**
 * 사용자 또는 제공자 세션 ID의 소문자 UUID 형식을 확인합니다.
 * @param value 검사할 ID.
 * @returns 검증된 UUID 문자열.
 * @throws 형식이 다르면 제공자 가용성 오류.
 */
export function uuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) return fail(); return value; }

/**
 * HTTP(S) URL을 복사하며 인증정보·해시를 금지합니다. HTTP는 명시적으로 허용한 로컬 호스트에서만 가능합니다.
 * @param value URL 객체 또는 문자열.
 * @param allowDevelopmentHttp 로컬 HTTP를 허용할지 여부.
 * @returns 검증된 URL.
 * @throws 잘못된 URL이면 제공자 가용성 오류.
 */
export function safeUrl(value: unknown, allowDevelopmentHttp: boolean): URL {
  if (!(value instanceof URL) && typeof value !== "string") return fail();
  let url: URL;
  try { url = new URL(value.toString()); } catch { return fail(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username !== "" || url.password !== "" || url.hash !== "" || !(url.protocol === "https:" || (allowDevelopmentHttp && local && url.protocol === "http:")) || hasControlCharacter(url.href)) return fail();
  return url;
}

/**
 * Supabase 기본 URL을 루트 경로로 제한하고 공개 anon 키의 문자열 형식을 검사합니다.
 * @param input 서버용 공개 URL과 anon 키.
 * @returns 정규화된 URL과 검증한 키.
 * @throws 설정 검증 실패 시 제공자 가용성 오류.
 */
export function config(input: SupabaseServerConfig): SupabaseServerConfig {
  const url = safeUrl(input?.url, true);
  if (url.pathname !== "/" || url.search !== "") return fail();
  return { url: url.toString(), anonKey: nonEmpty(input?.anonKey) };
}

/**
 * 인증 코드를 최대 4096자의 공통 문자열 규칙으로 검사합니다.
 * @param value 외부 인증 코드.
 * @returns 검증된 코드.
 * @throws 검증 실패 시 트랜잭션 오류.
 */
export function code(value: unknown): string {
  try { return nonEmpty(value, 4096); } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
}

/**
 * PKCE 비밀값의 문자열 제한을 검사하고 챌린지 계산을 통해 RFC 허용 형식인지 확인합니다.
 * @param value 서버가 보관한 PKCE 검증값.
 * @returns 검증된 비밀 문자열.
 * @throws 검증 실패 시 트랜잭션 오류.
 */
export function verifier(value: unknown): string {
  try {
    const safe = nonEmpty(value, 128);
    derivePkceChallenge(safe);
    return safe;
  } catch { return fail("AUTH_OAUTH_TRANSACTION_INVALID"); }
}

/**
 * 챌린지가 정확한 길이의 표준 S256 base64url인지 확인합니다.
 * @param value 챌린지 후보.
 * @returns 검증된 문자열.
 * @throws 검증 실패 시 제공자 가용성 오류.
 */
export function challenge(value: unknown): string {
  try { return validatePkceChallenge(nonEmpty(value, 43)); } catch { return fail(); }
}
