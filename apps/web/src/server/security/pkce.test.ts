import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const module = await import("./pkce.js").catch(() => ({} as Record<string, unknown>));
const createPkceVerifier = module.createPkceVerifier as (() => string) | undefined;
const derivePkceChallenge = module.derivePkceChallenge as ((verifier: string) => string) | undefined;
const validatePkceChallenge = module.validatePkceChallenge as ((challenge: string) => string) | undefined;

describe("server-owned PKCE", () => {
  it("creates a high-entropy canonical RFC 7636 verifier and S256 challenge", () => {
    expect(createPkceVerifier).toBeTypeOf("function");
    expect(derivePkceChallenge).toBeTypeOf("function");
    const verifier = createPkceVerifier?.() ?? "";
    const challenge = derivePkceChallenge?.(verifier);

    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/u);
    expect(Buffer.from(verifier, "base64url")).toHaveLength(32);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(challenge).toBe(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  });

  it("accepts only a canonical 256-bit S256 challenge", () => {
    const challenge = "A".repeat(43);
    expect(validatePkceChallenge).toBeTypeOf("function");
    expect(validatePkceChallenge?.(challenge)).toBe(challenge);
    for (const invalid of ["A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, "_".repeat(43)]) {
      expect(() => validatePkceChallenge?.(invalid)).toThrow("AUTH_PKCE_INVALID");
    }
  });

  it.each(["", "A".repeat(42), "A".repeat(129), `${"A".repeat(42)}=`, `${"A".repeat(42)}+`, `${"A".repeat(42)}\n`])(
    "rejects a non-canonical verifier without echoing it",
    (verifier) => {
      expect(() => derivePkceChallenge?.(verifier)).toThrow("AUTH_PKCE_INVALID");
      try {
        derivePkceChallenge?.(verifier);
      } catch (error) {
        if (verifier.length > 0) expect((error as Error).message).not.toContain(verifier);
      }
    },
  );
});
