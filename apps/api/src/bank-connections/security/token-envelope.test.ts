import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  decryptBankToken,
  encryptBankToken,
  type BankTokenContext,
  type BankTokenEnvelope,
} from "./token-envelope.js";

const context: BankTokenContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  resourceId: "22222222-2222-4222-8222-222222222222",
  provider: "kftc",
  environment: "test",
  purpose: "access_token",
};

it("encrypts a provider subject without allowing token-purpose substitution", () => {
  const keys = { activeKid: "subject-key", keys: new Map([["subject-key", randomBytes(32)]]) };
  const subject: BankTokenContext = { ...context, purpose: "provider_subject" };
  const envelope = encryptBankToken("fake-provider-user", subject, keys);
  expect(decryptBankToken(envelope, subject, keys)).toBe("fake-provider-user");
  expect(() => decryptBankToken(envelope, context, keys)).toThrow("BANK_TOKEN_ENVELOPE_INVALID");
  const access = encryptBankToken("fake-access-token", context, keys);
  expect(() => decryptBankToken(access, subject, keys)).toThrow("BANK_TOKEN_ENVELOPE_INVALID");
});

it("round-trips a token and refuses another owner, resource, environment, or purpose", () => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };
  const envelope = encryptBankToken("fake-token", context, keys);

  expect(decryptBankToken(envelope, context, keys)).toBe("fake-token");
  for (const other of [
    { ...context, userId: context.resourceId },
    { ...context, resourceId: context.userId },
    { ...context, environment: "live" as const },
    { ...context, purpose: "refresh_token" as const },
  ]) {
    expect(() => decryptBankToken(envelope, other, keys)).toThrow(
      "BANK_TOKEN_ENVELOPE_INVALID",
    );
  }
});

it("reads old ciphertext during rotation but refuses it after old key removal", () => {
  const oldKey = randomBytes(32);
  const before = { activeKid: "old", keys: new Map([["old", oldKey]]) };
  const envelope = encryptBankToken("fake-token", context, before);
  const current = randomBytes(32);
  const during = {
    activeKid: "current",
    keys: new Map([["old", oldKey], ["current", current]]),
  };

  expect(decryptBankToken(envelope, context, during)).toBe("fake-token");
  expect(encryptBankToken("fake-token", context, during).kid).toBe("current");
  expect(() => decryptBankToken(envelope, context, {
    activeKid: "current", keys: new Map([["current", current]]),
  })).toThrow("BANK_TOKEN_ENVELOPE_INVALID");
});

it.each(["nonce", "tag", "ciphertext"] as const)(
  "rejects a changed first byte of %s",
  (field) => {
    const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };
    const envelope = encryptBankToken("fake-token", context, keys);
    const bytes = Buffer.from(envelope[field], "base64url");
    bytes[0] ^= 1;
    const altered: BankTokenEnvelope = { ...envelope, [field]: bytes.toString("base64url") };

    expect(() => decryptBankToken(altered, context, keys)).toThrow(
      "BANK_TOKEN_ENVELOPE_INVALID",
    );
  },
);

it("rejects an unknown key identifier", () => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };
  const envelope = encryptBankToken("fake-token", context, keys);

  expect(() => decryptBankToken({ ...envelope, kid: "unknown" }, context, keys)).toThrow(
    "BANK_TOKEN_ENVELOPE_INVALID",
  );
});

it.each([31, 33])("rejects a %i-byte encryption key", (length) => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(length)]]) };

  expect(() => encryptBankToken("fake-token", context, keys)).toThrow(
    "BANK_TOKEN_ENVELOPE_INVALID",
  );
});

it("rejects empty and over-64KiB values but accepts exactly 64KiB", () => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };

  expect(() => encryptBankToken("", context, keys)).toThrow("BANK_TOKEN_ENVELOPE_INVALID");
  expect(() => encryptBankToken("x".repeat(65_537), context, keys)).toThrow(
    "BANK_TOKEN_ENVELOPE_INVALID",
  );
  const value = "x".repeat(65_536);
  expect(decryptBankToken(encryptBankToken(value, context, keys), context, keys)).toBe(value);
});

it("rejects an oversized value before allocating its UTF-8 plaintext buffer", () => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };
  const value = "x".repeat(65_537);
  const from = vi.spyOn(Buffer, "from");
  let error: unknown;
  let converted: boolean;

  try {
    try {
      encryptBankToken(value, context, keys);
    } catch (caught) {
      error = caught;
    }
    converted = from.mock.calls.some(([input]) => input === value);
  } finally {
    from.mockRestore();
  }

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("BANK_TOKEN_ENVELOPE_INVALID");
  expect(converted).toBe(false);
});

it("round-trips valid Unicode but rejects malformed UTF-16 instead of changing plaintext", () => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };
  const value = "한글🔒";

  expect(decryptBankToken(encryptBankToken(value, context, keys), context, keys)).toBe(value);

  expect(() => encryptBankToken("\uD800", context, keys)).toThrow(
    "BANK_TOKEN_ENVELOPE_INVALID",
  );
});

it("uses a fresh nonce and ciphertext for each encryption", () => {
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(32)]]) };
  const first = encryptBankToken("fake-token", context, keys);
  const second = encryptBankToken("fake-token", context, keys);

  expect(first.nonce).not.toBe(second.nonce);
  expect(first.ciphertext).not.toBe(second.ciphertext);
});

it("never includes plaintext in an encryption error", () => {
  const plaintext = "fake-sensitive-token";
  const keys = { activeKid: "key-a", keys: new Map([["key-a", randomBytes(31)]]) };

  try {
    encryptBankToken(plaintext, context, keys);
    throw new Error("Expected invalid envelope");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("BANK_TOKEN_ENVELOPE_INVALID");
    expect((error as Error).message).not.toContain(plaintext);
  }
});
