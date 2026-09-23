import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TOKEN_KINDS = new Set(["access", "refresh", "pkce", "recovery"]);
const ENVELOPE_FIELDS = ["version", "keyId", "iv", "ciphertext", "tag"];

export type TokenContext = Readonly<{
  recordId: string;
  tokenKind: "access" | "refresh" | "pkce" | "recovery";
}>;

export type TokenEnvelope = Readonly<{
  version: 1;
  keyId: string;
  iv: string;
  ciphertext: string;
  tag: string;
}>;

export type TokenKeyring = Readonly<{
  currentKeyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
}>;

/** A fail-closed error that never reveals encrypted material or validation details. */
export class TokenEnvelopeError extends Error {
  /**
   * 암호문이나 키 정보가 담기지 않는 고정 암호화 오류를 만듭니다.
   */
  public constructor() {
    super("TOKEN_ENVELOPE_INVALID");
    this.name = "TokenEnvelopeError";
  }
}

/**
 * 암호화 관련 실패를 한 종류의 안전한 오류로 중단합니다.
 * @returns 반환하지 않습니다.
 * @throws TokenEnvelopeError.
 */
function invalidTokenEnvelope(): never {
  throw new TokenEnvelopeError();
}

/**
 * 키 식별자가 허용 문자로 된 1~128자 문자열인지 확인합니다.
 * @param value 검사할 키 식별자.
 * @returns 검증된 문자열.
 * @throws 잘못된 형식이면 TokenEnvelopeError.
 */
function validKeyId(value: unknown): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    return invalidTokenEnvelope();
  }
  return value;
}

/**
 * 암호문을 묶을 레코드 UUID 형식과 토큰 종류를 검사합니다.
 * @param context 저장 레코드 ID와 access·refresh·pkce·recovery 종류.
 * @returns 검증된 원래 컨텍스트.
 * @throws 허용되지 않는 값이면 TokenEnvelopeError.
 */
function validContext(context: TokenContext): TokenContext {
  if (!UUID_PATTERN.test(context.recordId) || !TOKEN_KINDS.has(context.tokenKind)) {
    return invalidTokenEnvelope();
  }
  return context;
}

/**
 * 암호문을 다른 레코드나 용도로 옮겨 쓸 수 없도록 버전·레코드 ID·종류를 인증용 바이트로 만듭니다.
 * @param context 암호문 소유 레코드와 용도.
 * @returns AES-GCM에 넣을 추가 인증 데이터(AAD).
 * @throws 컨텍스트가 잘못되면 TokenEnvelopeError.
 */
function aad(context: TokenContext): Buffer {
  const { recordId, tokenKind } = validContext(context);
  return Buffer.from(`v1\0${recordId}\0${tokenKind}`, "utf8");
}

/**
 * 키 보관함에서 지정된 키를 찾고 AES-256에 필요한 32바이트인지 확인합니다.
 * @param keyring 현재·이전 키를 담은 보관함.
 * @param keyId 선택할 키 ID.
 * @returns 선택한 키 바이트.
 * @throws 키가 없거나 형식·길이가 다르면 TokenEnvelopeError.
 */
function keyFor(keyring: TokenKeyring, keyId: unknown): Uint8Array {
  const safeKeyId = validKeyId(keyId);
  const key = keyring.keys.get(safeKeyId);
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    return invalidTokenEnvelope();
  }
  return key;
}

/**
 * 암호문 구성요소의 표준 인코딩과 선택적 길이를 검증하며 해독합니다.
 * @param value 인코딩된 구성요소.
 * @param expectedLength 지정한 경우 필요한 바이트 길이.
 * @returns 해독된 버퍼.
 * @throws 빈 값·잘못된 표기·길이 불일치 시 TokenEnvelopeError.
 */
function decodeBase64url(value: unknown, expectedLength?: number): Buffer {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
    return invalidTokenEnvelope();
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    return invalidTokenEnvelope();
  }
  return decoded;
}

/**
 * 암호화 봉투에 정해진 5개 필드만 있는지와 버전·IV·암호문·인증 태그 형식을 검사합니다. 실제 진위 확인은 복호화 단계에서 합니다.
 * @param value 저장소에서 읽은 알 수 없는 값.
 * @returns 구조가 검증된 봉투.
 * @throws 구조나 인코딩이 잘못되면 TokenEnvelopeError.
 */
function validEnvelope(value: unknown): TokenEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidTokenEnvelope();
  }

  const envelope = value as Record<string, unknown>;
  const fields = Reflect.ownKeys(envelope);
  if (fields.length !== 5 || !fields.every((field) => typeof field === "string" && ENVELOPE_FIELDS.includes(field)) || !ENVELOPE_FIELDS.every((field) => Object.hasOwn(envelope, field))) {
    return invalidTokenEnvelope();
  }
  if (envelope.version !== 1) {
    return invalidTokenEnvelope();
  }

  validKeyId(envelope.keyId);
  decodeBase64url(envelope.iv, 12);
  decodeBase64url(envelope.ciphertext);
  decodeBase64url(envelope.tag, 16);
  return envelope as TokenEnvelope;
}

/** Encrypts a non-empty server token with AES-256-GCM and context-bound AAD. */
/**
 * 서버 토큰을 AES-256-GCM으로 암호화합니다. 매번 새 IV를 만들고 레코드·용도에 묶어 저장 가능한 봉투로 돌려줍니다.
 * @param plaintext 비어 있지 않은 원문 토큰.
 * @param context 저장 레코드 ID와 토큰 종류.
 * @param keyring 현재 암호화 키와 이전 키 목록.
 * @returns 버전·키 ID·IV·암호문·인증 태그를 담은 봉투.
 * @throws 모든 검증·암호화 실패를 TokenEnvelopeError로 통일합니다.
 */
export function encryptToken(plaintext: string, context: TokenContext, keyring: TokenKeyring): TokenEnvelope {
  try {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      return invalidTokenEnvelope();
    }

    const keyId = validKeyId(keyring.currentKeyId);
    const key = keyFor(keyring, keyId);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    return {
      version: 1,
      keyId,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    };
  } catch {
    return invalidTokenEnvelope();
  }
}

/** Decrypts a persisted envelope only when its schema, key, and AAD all authenticate. */
/**
 * 봉투에 기록된 키로 복호화하며 인증 태그와 레코드·용도가 일치하는지 확인합니다.
 * @param envelope 저장소에서 읽은 암호화 봉투.
 * @param context 암호화 때와 같아야 하는 레코드·용도.
 * @param keyring 현재 및 이전 복호화 키 목록.
 * @returns 복원한 서버 전용 원문 토큰.
 * @throws 손상·다른 컨텍스트·누락된 키 등 모든 실패 시 TokenEnvelopeError.
 */
export function decryptToken(envelope: unknown, context: TokenContext, keyring: TokenKeyring): string {
  try {
    const parsed = validEnvelope(envelope);
    const decipher = createDecipheriv("aes-256-gcm", keyFor(keyring, parsed.keyId), decodeBase64url(parsed.iv, 12));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(decodeBase64url(parsed.tag, 16));
    return Buffer.concat([decipher.update(decodeBase64url(parsed.ciphertext)), decipher.final()]).toString("utf8");
  } catch {
    return invalidTokenEnvelope();
  }
}
