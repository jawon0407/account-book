import { describe, expect, it } from "vitest";

const csrfModule = await import("./csrf.js").catch(() => ({} as Record<string, unknown>));
const issueCsrfToken = csrfModule.issueCsrfToken as ((context: unknown, now: Date, key: Uint8Array) => string) | undefined;
const verifyCsrfToken = csrfModule.verifyCsrfToken as ((token: string, context: unknown, now: Date, key: Uint8Array) => void) | undefined;
const AuthRequestRejectedError = csrfModule.AuthRequestRejectedError as (new () => Error) | undefined;

const selector = Buffer.alloc(32, 8).toString("base64url");
const otherSelector = Buffer.alloc(32, 9).toString("base64url");
const key = Buffer.alloc(32, 10);
const otherKey = Buffer.alloc(32, 11);
const now = new Date("2040-01-01T00:00:00.000Z");
const context = { selector };
const nonCanonical32ByteBase64url = `${selector.slice(0, -1)}${selector.endsWith("A") ? "B" : "A"}`;

function issuedToken(): string {
  expect(issueCsrfToken).toBeTypeOf("function");
  return issueCsrfToken?.(context, now, key) ?? "";
}

function expectRejected(action: () => void): void {
  expect(AuthRequestRejectedError).toBeTypeOf("function");
  expect(action).toThrow(AuthRequestRejectedError);
  expect(action).toThrow("AUTH_CSRF_REJECTED");
}

describe("CSRF tokens", () => {
  it("issues a short-lived HMAC-bound token with a fresh canonical nonce", () => {
    const first = issuedToken();
    const second = issuedToken();
    const [version, expiry, nonce, signature] = first.split(".");

    expect([version, expiry, nonce, signature]).toEqual([
      "v1",
      "2208989100",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    ]);
    expect(second).not.toBe(first);
    expect(verifyCsrfToken).toBeTypeOf("function");
    expect(() => verifyCsrfToken?.(first, context, new Date("2040-01-01T00:04:59.999Z"), key)).not.toThrow();
  });

  it("expires at the exact expiry boundary", () => {
    const token = issuedToken();
    expectRejected(() => verifyCsrfToken?.(token, context, new Date("2040-01-01T00:05:00.000Z"), key));
  });

  it.each([
    () => verifyCsrfToken?.(issuedToken(), { selector: otherSelector }, now, key),
    () => verifyCsrfToken?.(issuedToken(), context, now, otherKey),
    () => issueCsrfToken?.(context, new Date("invalid"), key),
    () => issueCsrfToken?.(context, now, Buffer.alloc(31)),
    () => issueCsrfToken?.(context, now, Buffer.alloc(33)),
    () => issueCsrfToken?.({ selector: "bad" }, now, key),
    () => issueCsrfToken?.(null as unknown as typeof context, now, key),
    () => issueCsrfToken?.(context, new Date("1969-12-31T23:59:59.000Z"), key),
    () => verifyCsrfToken?.(issuedToken(), context, now, Buffer.alloc(31)),
    () => verifyCsrfToken?.(issuedToken(), context, now, Buffer.alloc(33)),
  ])("rejects invalid binding, key, selector, or time without leaking inputs", (action) => {
    expectRejected(action);
  });

  it.each([
    "",
    "v1.2208989100",
    "v1.2208989100.nonce.signature.extra",
    "v2.2208989100.A".repeat(1),
    "v1.02208989100.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "v1.2208989100.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "v1.2208989100.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "v1.2208989100.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "v1.2208989100.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "v1.2208989100.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
    `v2.2208989100.${selector}.${selector}`,
    `v1.not-a-number.${selector}.${selector}`,
    `v1.999999999999999999999999999999999999.${selector}.${selector}`,
    `v1.2208989100.${nonCanonical32ByteBase64url}.${selector}`,
  ])("rejects malformed or non-canonical token parts", (token) => {
    expectRejected(() => verifyCsrfToken?.(token, context, now, key));
  });

  it("rejects tampered expiry, nonce, and signature before accepting a token", () => {
    const [version, expiry, nonce, signature] = issuedToken().split(".") as [string, string, string, string];
    const tamper = (value: string): string => `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;
    for (const token of [
      `${version}.${Number(expiry) + 1}.${nonce}.${signature}`,
      `${version}.${expiry}.${tamper(nonce)}.${signature}`,
      `${version}.${expiry}.${nonce}.${tamper(signature)}`,
      `${version}.${expiry}.${nonce}.${Buffer.alloc(31).toString("base64url")}`,
    ]) {
      expectRejected(() => verifyCsrfToken?.(token, context, now, key));
    }
  });

  it("keeps its rejection message fixed and free of token material", () => {
    const supplied = "v1.0.secret.secret";
    try {
      verifyCsrfToken?.(supplied, context, now, key);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthRequestRejectedError as new () => Error);
      expect((error as Error).message).toBe("AUTH_CSRF_REJECTED");
      expect((error as Error).message).not.toContain(supplied);
    }
  });

  it("rejects non-string token input", () => {
    expectRejected(() => verifyCsrfToken?.(null as unknown as string, context, now, key));
  });
});
