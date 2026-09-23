import { createHash, randomBytes } from "node:crypto";

const SELECTOR_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * 잘못된 식별자를 원문 없이 고정 오류로 처리합니다.
 * @returns 반환하지 않습니다.
 * @throws SESSION_SELECTOR_INVALID.
 */
function invalidSelector(): never {
  throw new Error("SESSION_SELECTOR_INVALID");
}

/** Creates a 256-bit opaque browser session selector in canonical base64url. */
/**
 * 추측하기 어려운 32바이트 난수를 만들어 브라우저용 식별자로 인코딩합니다.
 * @returns 43자의 표준 base64url 식별자.
 * @throws 암호학적 난수 생성 실패.
 */
export function createSessionSelector(): string {
  return randomBytes(32).toString("base64url");
}

/** Returns the SHA-256 digest of a canonical 256-bit session selector. */
/**
 * 식별자의 형식과 32바이트 길이를 검증한 뒤 문자열 자체의 SHA-256 해시를 계산합니다. DB에는 원문 대신 이 해시를 저장합니다.
 * @param selector 브라우저 쿠키에서 받은 식별자.
 * @returns 32바이트 SHA-256 해시.
 * @throws 검증·해시 실패 시 SESSION_SELECTOR_INVALID.
 */
export function hashSessionSelector(selector: string): Uint8Array {
  try {
    if (!SELECTOR_PATTERN.test(selector)) {
      return invalidSelector();
    }

    const bytes = Buffer.from(selector, "base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== selector) {
      return invalidSelector();
    }

    return createHash("sha256").update(selector, "utf8").digest();
  } catch {
    return invalidSelector();
  }
}
