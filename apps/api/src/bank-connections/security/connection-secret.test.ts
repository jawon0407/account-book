import { expect, it } from "vitest";
import {
  AUTHORIZATION_CODE_TTL_MS,
  CONNECTION_REQUEST_TTL_MS,
  createConnectionSecret,
  hashConnectionSecret,
  isUnexpired,
} from "./connection-secret.js";

it("creates independent canonical 32-byte secrets", () => {
  const first = createConnectionSecret();
  const second = createConnectionSecret();

  expect(Buffer.from(first, "base64url")).toHaveLength(32);
  expect(Buffer.from(first, "base64url").toString("base64url")).toBe(first);
  expect(first).not.toBe(second);
  expect(hashConnectionSecret(first)).toMatch(/^[0-9a-f]{64}$/u);
});

it("hashes a known canonical secret to its independent SHA-256 vector", () => {
  expect(hashConnectionSecret("A".repeat(43))).toBe(
    "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925",
  );
});

it.each([
  "",
  "a".repeat(42),
  "a".repeat(44),
  "=".repeat(43),
  "a".repeat(43),
  `${"A".repeat(43)} `,
  `${"A".repeat(43)}=`,
  ` ${"A".repeat(43)}`,
])("rejects invalid or noncanonical secrets", (value) => {
  expect(() => hashConnectionSecret(value)).toThrow(
    "BANK_CONNECTION_SECRET_INVALID",
  );
});

it("changes the hash when a valid secret's final significant character changes", () => {
  const value = createConnectionSecret();
  const finalCharacters = "AEIMQUYcgkosw048";
  const lastCharacter = value.at(-1) ?? "";
  const nextCharacter =
    finalCharacters[(finalCharacters.indexOf(lastCharacter) + 1) % finalCharacters.length];
  const changed = `${value.slice(0, -1)}${nextCharacter}`;

  expect(hashConnectionSecret(changed)).not.toBe(hashConnectionSecret(value));
});

it("rejects exact expiry, invalid dates, and negative timestamps", () => {
  const deadline = new Date(60_000);

  expect(isUnexpired(new Date(59_999), deadline)).toBe(true);
  expect(isUnexpired(deadline, deadline)).toBe(false);
  expect(isUnexpired(new Date(60_001), deadline)).toBe(false);
  expect(isUnexpired(new Date("invalid"), deadline)).toBe(false);
  expect(isUnexpired(new Date(-1), deadline)).toBe(false);
  expect(isUnexpired(new Date(0), new Date(-1))).toBe(false);
});

it("exposes the bounded request and authorization-code lifetimes", () => {
  expect(CONNECTION_REQUEST_TTL_MS).toBe(300_000);
  expect(AUTHORIZATION_CODE_TTL_MS).toBe(60_000);
});
