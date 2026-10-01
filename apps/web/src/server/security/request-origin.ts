import { AuthRequestRejectedError, verifyCsrfToken } from "./csrf.js";

const FETCH_MODES = new Set(["cors", "no-cors", "same-origin"]);

/** A framework-neutral request shape compatible with standard Request and Headers objects. */
export type AuthRequest = Readonly<{
  method: string;
  headers: Readonly<{ get(name: string): string | null }>;
}>;

/** Server-only inputs required to validate a state-changing browser request. */
export type CsrfRequestPolicy = Readonly<{
  now: Date;
  key: Uint8Array;
  allowedOrigins: ReadonlySet<string>;
}>;

export { AuthRequestRejectedError };

/**
 * 출처나 헤더 세부값 없이 요청을 거부합니다.
 * @returns 반환하지 않습니다.
 * @throws AuthRequestRejectedError.
 */
function rejected(): never {
  throw new AuthRequestRejectedError();
}

/**
 * 문자열에 ASCII 제어문자가 있는지 찾습니다.
 * @param value 검사할 문자열.
 * @returns 제어문자가 하나라도 있으면 true.
 */
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/**
 * URL이 경로나 인증정보 없는 정확한 HTTP(S) 출처 문자열인지 검사합니다.
 * @param value 검사할 출처.
 * @returns 원래 출처 문자열.
 * @throws 표기·스킴·공백 등이 잘못되면 CSRF 거부 오류.
 */
function exactOrigin(value: unknown): string {
  if (typeof value !== "string" || hasControlCharacter(value) || value.trim() !== value) return rejected();
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.origin !== value) return rejected();
    return value;
  } catch {
    return rejected();
  }
}

/**
 * 정책의 출처 목록이 비어 있지 않은 Set인지 확인하고 각 출처를 검증합니다.
 * @param policy 서버가 제공한 CSRF 정책.
 * @returns 검증된 허용 출처 집합.
 * @throws 정책이나 출처가 잘못되면 CSRF 거부 오류.
 */
function allowedOrigins(policy: unknown): ReadonlySet<string> {
  if (policy === null || typeof policy !== "object") return rejected();
  const values = (policy as { allowedOrigins?: unknown }).allowedOrigins;
  if (!(values instanceof Set) || values.size === 0) return rejected();
  for (const origin of values) exactOrigin(origin);
  return values as ReadonlySet<string>;
}

/**
 * 표준 get 메서드로 헤더를 읽고 제어문자가 없는 문자열 또는 null인지 확인합니다.
 * @param request 헤더 접근자를 가진 요청.
 * @param name 읽을 헤더 이름.
 * @returns 헤더 문자열 또는 없으면 null.
 * @throws 요청 형태나 헤더 값이 잘못되면 CSRF 거부 오류.
 */
function header(request: unknown, name: string): string | null {
  if (request === null || typeof request !== "object") return rejected();
  const headers = (request as { headers?: unknown }).headers;
  if (headers === null || typeof headers !== "object" || typeof (headers as { get?: unknown }).get !== "function") return rejected();
  const value = (headers as { get(name: string): unknown }).get(name);
  if (value !== null && (typeof value !== "string" || hasControlCharacter(value))) return rejected();
  return value;
}

/**
 * 미디어 타입이 application/json인지, 부가 매개변수가 이름=값 형태인지 확인합니다.
 * @param value Content-Type 헤더 또는 null.
 * @returns JSON 헤더 형식을 통과하면 true.
 */
function jsonContentType(value: string | null): boolean {
  if (value === null || value.includes(",")) return false;
  const [mediaType, ...parameters] = value.split(";");
  return mediaType?.trim().toLowerCase() === "application/json" && parameters.every((parameter) => /^\s*[^=\s]+\s*=\s*.+\s*$/u.test(parameter));
}

/**
 * 출처 표기를 검증한 후 서버 허용 목록과 정확히 비교합니다.
 * @param value 요청의 Origin 값.
 * @param origins 허용된 출처 집합.
 * @returns 허용 목록에 있으면 true.
 * @throws 출처 자체가 잘못되면 CSRF 거부 오류.
 */
function allowedOrigin(value: string, origins: ReadonlySet<string>): boolean {
  return origins.has(exactOrigin(value));
}

/**
 * Origin이 없을 때 Referer URL에서 출처를 추출해 허용 목록과 비교합니다.
 * @param value Referer 헤더 또는 null.
 * @param origins 허용된 출처 집합.
 * @returns 안전한 URL이며 출처가 허용되면 true, 나머지는 false.
 */
function refererAllowed(value: string | null, origins: ReadonlySet<string>): boolean {
  if (value === null || hasControlCharacter(value) || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password && origins.has(parsed.origin);
  } catch {
    return false;
  }
}

/** Rejects a non-POST, cross-origin, non-JSON, or CSRF-invalid browser request before mutation. */
/**
 * 변경 요청이 POST·JSON·허용 출처인지 먼저 확인하고 Fetch Metadata와 식별자에 묶인 CSRF 토큰을 검증합니다.
 * @param request 브라우저 요청의 메서드와 헤더.
 * @param context 현재 세션 또는 상호작용 식별자.
 * @param policy 현재 시각·서명 키·허용 출처.
 * @returns 모두 통과하면 값 없이 종료합니다.
 * @throws 검증 실패를 AuthRequestRejectedError로 통일합니다.
 */
export function verifyCsrfRequest(request: AuthRequest, context: Readonly<{ selector: string }>, policy: CsrfRequestPolicy): void {
  verifyRequest(request, context, policy, false);
}

/**
 * 금융 변경 경계에서 POST/PATCH만 허용하고 인증과 동일한 출처·세션 결합 검사를 적용합니다.
 * @param request JSON 변경 요청. @param context 세션 식별자. @param policy 서버 시각·키·출처.
 * @throws 검사 실패 시 세부값 없는 CSRF 오류. 기존 인증 경로의 POST 제한은 유지합니다.
 */
export function verifyMutationCsrfRequest(request: AuthRequest, context: Readonly<{ selector: string }>, policy: CsrfRequestPolicy): void {
  verifyRequest(request, context, policy, true);
}

/** @param request 검증할 요청. @param context 토큰 결합 문맥. @param policy 서버 정책. @param allowPatch 금융 경계의 PATCH 허용 여부. */
function verifyRequest(request: AuthRequest, context: Readonly<{ selector: string }>, policy: CsrfRequestPolicy, allowPatch: boolean): void {
  try {
    const origins = allowedOrigins(policy);
    const contentType = header(request, "Content-Type");
    const method = (request as { method?: unknown }).method;
    if (!(method === "POST" || (allowPatch && method === "PATCH")) || !jsonContentType(contentType)) return rejected();
    const origin = header(request, "Origin");
    if (origin === null ? !refererAllowed(header(request, "Referer"), origins) : !allowedOrigin(origin, origins)) return rejected();
    const site = header(request, "Sec-Fetch-Site");
    if (site !== "same-origin" && site !== "none") return rejected();
    const mode = header(request, "Sec-Fetch-Mode");
    if (mode !== null && !FETCH_MODES.has(mode)) return rejected();
    const destination = header(request, "Sec-Fetch-Dest");
    // Fetch Metadata maps fetch()'s empty destination to the literal `empty`; resource destinations remain blocked.
    if (destination !== null && destination !== "" && destination !== "empty") return rejected();
    const token = header(request, "X-CSRF-Token");
    if (token === null || token.includes(",")) return rejected();
    verifyCsrfToken(token, context, policy.now, policy.key);
  } catch {
    return rejected();
  }
}
