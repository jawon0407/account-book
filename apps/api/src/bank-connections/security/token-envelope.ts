import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type BankTokenContext = Readonly<{
  userId: string;
  resourceId: string;
  provider: "kftc";
  environment: "fake" | "test" | "live";
  purpose: "authorization_code" | "access_token" | "refresh_token";
}>;

export type BankTokenKeyring = Readonly<{
  activeKid: string;
  keys: ReadonlyMap<string, Uint8Array>;
}>;

export type BankTokenEnvelope = Readonly<{
  version: 1;
  kid: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;

const INVALID = "BANK_TOKEN_ENVELOPE_INVALID";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KID = /^[A-Za-z0-9._-]{1,128}$/u;

/**
 * 키 목록에서 지정한 식별자의 AES-256 키를 얻는다.
 * @param keys 서버가 주입한 키 목록이다.
 * @param kid 봉투 또는 활성 키의 식별자이다.
 * @returns 원본 키와 메모리를 공유하지 않는 32바이트 키다.
 * @throws 식별자나 키 길이·형식이 유효하지 않으면 봉투 오류를 던진다.
 */
function keyFor(keys: BankTokenKeyring, kid: string): Buffer {
  const key = keys.keys.get(kid);
  if (!KID.test(kid) || !(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error(INVALID);
  }
  return Buffer.from(key);
}

/**
 * 암호문을 소유자·자원·환경·용도에 묶는 추가 인증 데이터를 만든다.
 * @param context 암호문이 속한 사용자와 연결 자원의 문맥이다.
 * @param kid 사용한 키의 식별자이다.
 * @returns 인증에 포함할 UTF-8 바이트다.
 * @throws 문맥이 허용된 값이 아니면 봉투 오류를 던진다.
 */
function aad(context: BankTokenContext, kid: string): Buffer {
  if (!UUID.test(context.userId) || !UUID.test(context.resourceId)
    || context.provider !== "kftc"
    || !["fake", "test", "live"].includes(context.environment)
    || !["authorization_code", "access_token", "refresh_token"].includes(context.purpose)) {
    throw new Error(INVALID);
  }
  return Buffer.from(JSON.stringify([
    1, kid, context.userId, context.resourceId,
    context.provider, context.environment, context.purpose,
  ]), "utf8");
}

/**
 * 봉투 필드의 표준 base64url 인코딩을 엄격히 해석한다.
 * @param value 해석할 봉투 필드다.
 * @param expectedLength 고정 길이 필드일 때 요구되는 바이트 수다.
 * @returns 해석한 바이트다.
 * @throws 문자가 비표준이거나 길이가 범위를 벗어나면 봉투 오류를 던진다.
 */
function decode(value: string, expectedLength?: number): Buffer {
  if (typeof value !== "string" || value.length > 90_000
    || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(INVALID);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value
    || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new Error(INVALID);
  }
  return decoded;
}

/**
 * API 전용 AES-256-GCM 키로 은행 인가 코드 또는 토큰을 암호화한다.
 * @param value 암호화할 비어 있지 않은 UTF-8 문자열이다.
 * @param context 소유자·자원·공급자·환경·용도를 담은 인증 문맥이다.
 * @param keys 서버가 주입한 키 목록과 활성 키 식별자다.
 * @returns 새 12바이트 nonce를 사용한 인증 암호화 봉투다.
 * @throws 값이 64KiB를 넘거나 손실 없이 UTF-8로 표현할 수 없거나 키·문맥이 유효하지 않으면 봉투 오류를 던진다.
 */
export function encryptBankToken(
  value: string, context: BankTokenContext, keys: BankTokenKeyring,
): BankTokenEnvelope {
  try {
    if (typeof value !== "string" || value.length === 0
      || Buffer.byteLength(value, "utf8") > 65_536) throw new Error(INVALID);
    const plaintext = Buffer.from(value, "utf8");
    if (plaintext.toString("utf8") !== value) {
      throw new Error(INVALID);
    }
    const kid = keys.activeKid;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyFor(keys, kid), nonce);
    cipher.setAAD(aad(context, kid));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Object.freeze({
      version: 1, kid, nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    });
  } catch {
    throw new Error(INVALID);
  }
}

/**
 * 인증 태그와 문맥을 확인한 뒤 API 내부에서만 은행 토큰 원문을 복원한다.
 * @param envelope 암호화 당시 반환한 봉투다.
 * @param context 복호화 요청의 소유자·자원·공급자·환경·용도다.
 * @param keys 구키를 포함할 수 있는 서버 키 목록이다.
 * @returns 태그 검증이 끝난 뒤의 토큰 원문이다.
 * @throws 버전·키·형식·문맥·인증 태그가 유효하지 않으면 봉투 오류를 던진다.
 */
export function decryptBankToken(
  envelope: BankTokenEnvelope, context: BankTokenContext, keys: BankTokenKeyring,
): string {
  try {
    if (envelope.version !== 1) throw new Error(INVALID);
    const ciphertext = decode(envelope.ciphertext);
    if (ciphertext.length === 0 || ciphertext.length > 65_536) throw new Error(INVALID);
    const decipher = createDecipheriv(
      "aes-256-gcm", keyFor(keys, envelope.kid),
      decode(envelope.nonce, 12), { authTagLength: 16 },
    );
    decipher.setAAD(aad(context, envelope.kid));
    decipher.setAuthTag(decode(envelope.tag, 16));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(INVALID);
  }
}
