import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const EXPIRY_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const LIFETIME_SECONDS = 300;

/** Binds a CSRF token to the current opaque session or interaction selector. */
export type CsrfContext = Readonly<{ selector: string }>;

/** A fixed public rejection that never exposes request, token, or cryptographic values. */
export class AuthRequestRejectedError extends Error {
  /**
   * 요청이나 토큰 내용을 담지 않는 CSRF 거부 오류를 만듭니다.
   */
  public constructor() {
    super("AUTH_CSRF_REJECTED");
    this.name = "AuthRequestRejectedError";
  }
}

/**
 * 상세 검증 정보를 노출하지 않고 요청을 거부합니다.
 * @returns 반환하지 않습니다.
 * @throws AuthRequestRejectedError.
 */
function rejected(): never {
  throw new AuthRequestRejectedError();
}

/**
 * base64url을 바이트로 해독한 뒤 다시 인코딩해 표기가 정확히 일치하는지 확인합니다.
 * @param value 검사할 인코딩 문자열.
 * @param length 지정한 경우 요구하는 바이트 길이.
 * @returns 해독된 바이트 버퍼.
 * @throws 빈 값·잘못된 표기·길이 불일치 시 CSRF 거부 오류.
 */
function canonicalBase64url(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return rejected();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || (length !== undefined && decoded.length !== length) || decoded.toString("base64url") !== value) return rejected();
  return decoded;
}

/**
 * 컨텍스트에서 32바이트 세션 또는 상호작용 식별자를 검증합니다.
 * @param context 식별자를 담아야 하는 외부 객체.
 * @returns 검증된 식별자 문자열.
 * @throws 객체나 식별자가 잘못되면 CSRF 거부 오류.
 */
function validSelector(context: unknown): string {
  if (context === null || typeof context !== "object") return rejected();
  const selector = (context as { selector?: unknown }).selector;
  canonicalBase64url(selector, 32);
  return selector as string;
}

/**
 * HMAC 서명에 사용할 32바이트 키인지 확인합니다.
 * @param value 검사할 키.
 * @returns 검증된 키 바이트.
 * @throws 키 타입이나 길이가 다르면 CSRF 거부 오류.
 */
function validKey(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) return rejected();
  return value;
}

/**
 * 유효한 날짜를 1970년 기준의 정수 초로 바꿉니다.
 * @param date 변환할 Date 객체.
 * @returns 음수가 아닌 안전한 정수 초.
 * @throws 유효하지 않거나 범위를 벗어나면 CSRF 거부 오류.
 */
function seconds(date: unknown): number {
  if (!(date instanceof Date) || !Number.isSafeInteger(date.getTime())) return rejected();
  const value = Math.floor(date.getTime() / 1000);
  if (!Number.isSafeInteger(value) || value < 0) return rejected();
  return value;
}

/**
 * 식별자와 토큰 앞부분을 함께 HMAC-SHA256으로 서명해 다른 브라우저에서의 재사용을 막습니다.
 * @param selector 토큰을 묶을 식별자.
 * @param prefix 버전·만료 시각·난수로 구성한 토큰 앞부분.
 * @param key 32바이트 서명 키.
 * @returns 서명 바이트.
 * @throws 키 검증 실패 시 CSRF 거부 오류.
 */
function signature(selector: string, prefix: string, key: Uint8Array): Buffer {
  return createHmac("sha256", validKey(key)).update(`${selector}\0${prefix}`, "utf8").digest();
}

/**
 * 점으로 구분된 CSRF 토큰의 버전·만료 시각·난수·서명을 검증하고 분리합니다.
 * @param token 검사할 토큰 문자열.
 * @returns 버전, 만료 초, 난수, 서명, 서명 대상 앞부분의 순서로 된 튜플.
 * @throws 구조나 인코딩이 잘못되면 CSRF 거부 오류.
 */
function parts(token: unknown): readonly [string, number, string, string, string] {
  if (typeof token !== "string") return rejected();
  const values = token.split(".");
  if (values.length !== 4 || values[0] !== "v1" || !EXPIRY_PATTERN.test(values[1] as string)) return rejected();
  const expiry = Number(values[1]);
  if (!Number.isSafeInteger(expiry)) return rejected();
  canonicalBase64url(values[2], 32);
  canonicalBase64url(values[3]);
  return [values[0], expiry, values[2] as string, values[3] as string, `${values[0]}.${values[1]}.${values[2]}`];
}

/** Issues a five-minute HMAC token bound to a canonical opaque selector. */
/**
 * 32바이트 난수와 5분 뒤 만료 시각을 만들고 현재 식별자에 묶인 서명을 붙입니다.
 * @param context 토큰을 사용할 세션 또는 상호작용 식별자.
 * @param now 발급 기준 시각.
 * @param key 32바이트 HMAC 키.
 * @returns 브라우저에 전달할 CSRF 토큰.
 * @throws 입력·난수·서명 처리 실패를 CSRF 거부 오류로 통일합니다.
 */
export function issueCsrfToken(context: CsrfContext, now: Date, key: Uint8Array): string {
  try {
    const expiry = seconds(now) + LIFETIME_SECONDS;
    const prefix = `v1.${expiry}.${randomBytes(32).toString("base64url")}`;
    return `${prefix}.${signature(validSelector(context), prefix, key).toString("base64url")}`;
  } catch {
    return rejected();
  }
}

/** Verifies token syntax, five-minute expiry, selector binding, and HMAC in constant time. */
/**
 * 토큰 구조와 만료 여부를 확인하고 현재 식별자로 다시 만든 서명을 시간 차이를 줄이는 방식으로 비교합니다.
 * @param token 요청에서 받은 토큰.
 * @param context 현재 브라우저 식별자.
 * @param now 만료 판단 시각.
 * @param key 발급 때 사용한 HMAC 키.
 * @returns 성공하면 값 없이 종료합니다.
 * @throws 만료 또는 서명·입력 불일치 시 CSRF 거부 오류.
 */
export function verifyCsrfToken(token: string, context: CsrfContext, now: Date, key: Uint8Array): void {
  try {
    const [, expiry, , encodedSignature, prefix] = parts(token);
    if (seconds(now) >= expiry) return rejected();
    const provided = canonicalBase64url(encodedSignature);
    const expected = signature(validSelector(context), prefix, key);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return rejected();
  } catch {
    return rejected();
  }
}
