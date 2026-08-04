import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

const security = await import("./token-envelope.js").catch(() => ({} as Record<string, unknown>));
const encryptToken = security.encryptToken as ((plaintext: string, context: TokenContext, keyring: TokenKeyring) => TokenEnvelope) | undefined;
const decryptToken = security.decryptToken as ((envelope: unknown, context: TokenContext, keyring: TokenKeyring) => string) | undefined;
const TokenEnvelopeError = security.TokenEnvelopeError as (new () => Error) | undefined;

type TokenContext = Readonly<{ recordId: string; tokenKind: "access" | "refresh" | "pkce" | "recovery" }>;
type TokenEnvelope = Readonly<{ version: 1; keyId: string; iv: string; ciphertext: string; tag: string }>;
type TokenKeyring = Readonly<{ currentKeyId: string; keys: ReadonlyMap<string, Uint8Array> }>;

const recordId = "123e4567-e89b-12d3-a456-426614174000";
const context: TokenContext = { recordId, tokenKind: "access" };
const keyring: TokenKeyring = { currentKeyId: "current.key", keys: new Map([["current.key", randomBytes(32)]]) };

function encrypt(plaintext = "provider-token", tokenContext = context, keys = keyring): TokenEnvelope {
  expect(encryptToken).toBeTypeOf("function");
  return encryptToken?.(plaintext, tokenContext, keys) as TokenEnvelope;
}

function decrypt(envelope: unknown, tokenContext = context, keys = keyring): string {
  expect(decryptToken).toBeTypeOf("function");
  return decryptToken?.(envelope, tokenContext, keys) as string;
}

function expectSafeFailure(action: () => unknown, ...values: string[]): void {
  expect(TokenEnvelopeError).toBeTypeOf("function");
  expect(action).toThrow(TokenEnvelopeError);
  expect(action).toThrow("TOKEN_ENVELOPE_INVALID");
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TokenEnvelopeError as new () => Error);
    for (const value of values) {
      expect((error as Error).message).not.toContain(value);
    }
  }
}

function mutateBase64url(value: string): string {
  const last = value.at(-1);
  return `${value.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

describe("token envelopes", () => {
  it.each(["access", "refresh", "pkce", "recovery"] as const)("round-trips a %s token", (tokenKind) => {
    const token = `token-for-${tokenKind}`;
    const envelope = encrypt(token, { recordId, tokenKind });

    expect(envelope).toMatchObject({ version: 1, keyId: "current.key" });
    expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]{16}$/u);
    expect(envelope.tag).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(envelope.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decrypt(envelope, { recordId, tokenKind })).toBe(token);
  });

  it("uses fresh IVs and ciphertexts for repeated encryption", () => {
    const first = encrypt();
    const second = encrypt();

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("encrypts with the current key and decrypts a previous key", () => {
    const previousKeyring: TokenKeyring = { currentKeyId: "previous", keys: new Map([["previous", randomBytes(32)]]) };
    const oldEnvelope = encrypt("old-token", context, previousKeyring);
    const rotatingKeyring: TokenKeyring = {
      currentKeyId: "current",
      keys: new Map([["current", randomBytes(32)], ["previous", previousKeyring.keys.get("previous") as Uint8Array]]),
    };

    expect(encrypt("new-token", context, rotatingKeyring).keyId).toBe("current");
    expect(decrypt(oldEnvelope, context, rotatingKeyring)).toBe("old-token");
  });

  it.each([
    (envelope: TokenEnvelope) => decrypt(envelope, { ...context, recordId: "123e4567-e89b-12d3-a456-426614174001" }),
    (envelope: TokenEnvelope) => decrypt(envelope, { ...context, tokenKind: "refresh" }),
    (envelope: TokenEnvelope) => decrypt({ ...envelope, ciphertext: mutateBase64url(envelope.ciphertext) }),
    (envelope: TokenEnvelope) => decrypt({ ...envelope, tag: mutateBase64url(envelope.tag) }),
    (envelope: TokenEnvelope) => decrypt({ ...envelope, iv: mutateBase64url(envelope.iv) }),
  ])("fails closed when authenticated data or ciphertext changes", (attempt) => {
    expectSafeFailure(() => attempt(encrypt()), recordId);
  });

  it.each([
    null,
    [],
    { version: 1, keyId: "current.key", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(22), extra: true },
    { version: 2, keyId: "current.key", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(22) },
    { version: 1, keyId: "bad key", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(22) },
    { version: 1, keyId: "current.key", iv: `${"A".repeat(15)}=`, ciphertext: "A", tag: "A".repeat(22) },
    { version: 1, keyId: "current.key", iv: "A".repeat(15), ciphertext: "A", tag: "A".repeat(22) },
    { version: 1, keyId: "current.key", iv: "A".repeat(16), ciphertext: "", tag: "A".repeat(22) },
    { version: 1, keyId: "current.key", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(21) },
  ])("rejects malformed persisted envelope JSON", (envelope) => {
    expectSafeFailure(() => decrypt(envelope), "current.key");
  });

  it("rejects non-enumerable and symbol envelope fields", () => {
    const hiddenFieldEnvelope = encrypt();
    Object.defineProperty(hiddenFieldEnvelope, "hidden", { value: true });
    const symbolFieldEnvelope = encrypt();
    Object.defineProperty(symbolFieldEnvelope, Symbol("hidden"), { value: true });

    expectSafeFailure(() => decrypt(hiddenFieldEnvelope), "hidden");
    expectSafeFailure(() => decrypt(symbolFieldEnvelope), "hidden");
  });

  it.each([
    [{ currentKeyId: "missing", keys: new Map() } satisfies TokenKeyring, "missing"],
    [{ currentKeyId: "short", keys: new Map([["short", randomBytes(31)]]) } satisfies TokenKeyring, "short"],
    [{ currentKeyId: "long", keys: new Map([["long", randomBytes(33)]]) } satisfies TokenKeyring, "long"],
  ])("rejects absent or incorrectly sized encryption keys", (invalidKeyring, marker) => {
    expectSafeFailure(() => encrypt("provider-token", context, invalidKeyring), marker);
  });

  it("rejects an unknown decrypt key and invalid encryption inputs", () => {
    const envelope = encrypt();
    expectSafeFailure(() => decrypt({ ...envelope, keyId: "unknown" }), "unknown");
    expectSafeFailure(() => encrypt("", context), "provider-token");
    expectSafeFailure(() => encrypt("secret", { ...context, recordId: "invalid-id" }), "invalid-id");
    expectSafeFailure(() => encrypt("secret", { ...context, tokenKind: "other" as "access" }), "other");
  });

  it("never exposes supplied values in validation failures", () => {
    const secret = "super-secret-provider-token";
    const badContext = { recordId: "not-a-uuid-secret", tokenKind: "access" as const };

    expectSafeFailure(() => encrypt(secret, badContext), secret);
    expectSafeFailure(
      () => decrypt({ version: 1, keyId: "secret-key-id", iv: "bad", ciphertext: secret, tag: "bad" }, badContext),
      "secret-key-id",
      secret,
      badContext.recordId,
    );
  });
});
