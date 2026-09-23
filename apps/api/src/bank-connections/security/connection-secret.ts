import { createHash, randomBytes } from "node:crypto";

/** 연결 요청이 유효한 시간(5분, 밀리초)이다. */
export const CONNECTION_REQUEST_TTL_MS = 300_000;

/** 임시 인가 코드가 유효한 최대 시간(1분, 밀리초)이다. */
export const AUTHORIZATION_CODE_TTL_MS = 60_000;

/**
 * 연결 요청의 비밀값으로 사용할 독립적인 32바이트 난수를 생성한다.
 * @returns 패딩 없는 표준 base64url 문자열이다.
 */
export function createConnectionSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 원문 연결 비밀값을 비교용 SHA-256 지문으로 만든다.
 * @param value 32바이트를 나타내는 표준 base64url 문자열이다.
 * @returns 소문자 16진수 SHA-256 지문이다.
 * @throws 값이 아니거나 길이·문자·디코딩 결과가 표준 형식이 아니면 BANK_CONNECTION_SECRET_INVALID 오류를 던진다.
 */
export function hashConnectionSecret(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error("BANK_CONNECTION_SECRET_INVALID");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new Error("BANK_CONNECTION_SECRET_INVALID");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 만료 시각에 도달하기 전인지 확인한다.
 * @param now 현재 시각이다.
 * @param expiresAt 만료 시각이다.
 * @returns 양쪽 시각이 유효한 0 이상의 정수 밀리초이고 현재 시각이 만료 시각보다 이르면 true이다.
 */
export function isUnexpired(now: Date, expiresAt: Date): boolean {
  if (!(now instanceof Date) || !(expiresAt instanceof Date)) return false;
  const current = now.getTime();
  const expiry = expiresAt.getTime();
  return Number.isSafeInteger(current) && Number.isSafeInteger(expiry)
    && current >= 0 && expiry > current;
}
