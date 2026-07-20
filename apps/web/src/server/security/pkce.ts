import { createHash, randomBytes } from "node:crypto";

const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function fail(): never {
  throw new Error("AUTH_PKCE_INVALID");
}

/**
 * Creates a fresh 256-bit RFC 7636 verifier.
 * @returns A canonical unpadded base64url verifier.
 * @throws When the platform CSPRNG cannot produce bytes.
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
export function validatePkceChallenge(challenge: string): string {
  if (typeof challenge !== "string" || !CHALLENGE_PATTERN.test(challenge)) return fail();
  const decoded = Buffer.from(challenge, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== challenge) return fail();
  return challenge;
}
