import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const EXPIRY_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const LIFETIME_SECONDS = 300;

/** Binds a CSRF token to the current opaque session or interaction selector. */
export type CsrfContext = Readonly<{ selector: string }>;

/** A fixed public rejection that never exposes request, token, or cryptographic values. */
export class AuthRequestRejectedError extends Error {
  public constructor() {
    super("AUTH_CSRF_REJECTED");
    this.name = "AuthRequestRejectedError";
  }
}

function rejected(): never {
  throw new AuthRequestRejectedError();
}

function canonicalBase64url(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return rejected();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || (length !== undefined && decoded.length !== length) || decoded.toString("base64url") !== value) return rejected();
  return decoded;
}

function validSelector(context: unknown): string {
  if (context === null || typeof context !== "object") return rejected();
  const selector = (context as { selector?: unknown }).selector;
  canonicalBase64url(selector, 32);
  return selector as string;
}

function validKey(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) return rejected();
  return value;
}

function seconds(date: unknown): number {
  if (!(date instanceof Date) || !Number.isSafeInteger(date.getTime())) return rejected();
  const value = Math.floor(date.getTime() / 1000);
  if (!Number.isSafeInteger(value) || value < 0) return rejected();
  return value;
}

function signature(selector: string, prefix: string, key: Uint8Array): Buffer {
  return createHmac("sha256", validKey(key)).update(`${selector}\0${prefix}`, "utf8").digest();
}

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
