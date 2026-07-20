import { createHash, randomBytes } from "node:crypto";

const SELECTOR_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function invalidSelector(): never {
  throw new Error("SESSION_SELECTOR_INVALID");
}

/** Creates a 256-bit opaque browser session selector in canonical base64url. */
export function createSessionSelector(): string {
  return randomBytes(32).toString("base64url");
}

/** Returns the SHA-256 digest of a canonical 256-bit session selector. */
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
