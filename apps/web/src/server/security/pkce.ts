import { createHash, randomBytes } from "node:crypto";

const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * PKCE 비밀값을 노출하지 않는 고정 오류를 던집니다.
 * @returns 반환하지 않습니다.
 * @throws AUTH_PKCE_INVALID.
 */
function fail(): never {
  throw new Error("AUTH_PKCE_INVALID");
}

/**
 * Creates a fresh 256-bit RFC 7636 verifier.
 * @returns A canonical unpadded base64url verifier.
 * @throws When the platform CSPRNG cannot produce bytes.
 */
/**
 * 암호학적 난수 32바이트를 만들어 인증 요청과 콜백을 연결할 비밀 검증값으로 인코딩합니다.
 * @returns 패딩 없는 base64url 검증값.
 * @throws 운영체제 난수 생성 실패.
 */
export function createPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Derives a canonical RFC 7636 S256 challenge.
 * @param verifier - A 43-128 character unreserved verifier.
 * @returns The canonical SHA-256 base64url challenge.
 * @throws `AUTH_PKCE_INVALID` for malformed verifier input without echoing it.
 */
/**
 * PKCE 검증값의 문자와 길이를 확인한 뒤 SHA-256 해시를 base64url로 바꿉니다.
 * @param verifier 43~128자의 허용 문자로 된 비밀 검증값.
 * @returns 제공자에게 보낼 S256 챌린지.
 * @throws 형식이 잘못되면 AUTH_PKCE_INVALID.
 */
export function derivePkceChallenge(verifier: string): string {
  if (typeof verifier !== "string" || !VERIFIER_PATTERN.test(verifier)) return fail();
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Validates a canonical 256-bit S256 challenge.
 * @param challenge - The challenge crossing the provider port.
 * @returns The unchanged canonical challenge.
 * @throws `AUTH_PKCE_INVALID` for malformed input without echoing it.
 */
/**
 * 챌린지가 정확히 32바이트를 표현하는 표준 base64url인지 확인합니다.
 * @param challenge 제공자 경계에서 검사할 챌린지.
 * @returns 검증된 원래 문자열.
 * @throws 형식이나 길이가 다르면 AUTH_PKCE_INVALID.
 */
export function validatePkceChallenge(challenge: string): string {
  if (typeof challenge !== "string" || !CHALLENGE_PATTERN.test(challenge)) return fail();
  const decoded = Buffer.from(challenge, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== challenge) return fail();
  return challenge;
}
