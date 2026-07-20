import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TOKEN_KINDS = new Set(["access", "refresh", "pkce", "recovery"]);

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
  public constructor() {
    super("TOKEN_ENVELOPE_INVALID");
    this.name = "TokenEnvelopeError";
  }
}

function invalidTokenEnvelope(): never {
  throw new TokenEnvelopeError();
}

function validKeyId(value: unknown): string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    return invalidTokenEnvelope();
  }
  return value;
}

function validContext(context: TokenContext): TokenContext {
  if (!UUID_PATTERN.test(context.recordId) || !TOKEN_KINDS.has(context.tokenKind)) {
    return invalidTokenEnvelope();
  }
  return context;
}

function aad(context: TokenContext): Buffer {
  const { recordId, tokenKind } = validContext(context);
  return Buffer.from(`v1\0${recordId}\0${tokenKind}`, "utf8");
}

function keyFor(keyring: TokenKeyring, keyId: unknown): Uint8Array {
  const safeKeyId = validKeyId(keyId);
  const key = keyring.keys.get(safeKeyId);
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    return invalidTokenEnvelope();
  }
  return key;
}

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

function validEnvelope(value: unknown): TokenEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidTokenEnvelope();
  }

  const envelope = value as Record<string, unknown>;
  const fields = Object.keys(envelope);
  if (fields.length !== 5 || !["version", "keyId", "iv", "ciphertext", "tag"].every((field) => Object.hasOwn(envelope, field))) {
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
