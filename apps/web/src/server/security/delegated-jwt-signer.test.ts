import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  assertDelegatedJwtSize,
  DelegatedJwtSigner,
} from "./delegated-jwt-signer.js";

const p256 = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const now = new Date("2026-07-23T00:00:00.000Z");

const validInput = {
  body: new Uint8Array(),
  contentType: null,
  method: "GET",
  scope: "me:read",
  sessionId: "123e4567-e89b-42d3-a456-426614174001",
  target: "/v1/me?z=2&a=1",
  userId: "123e4567-e89b-42d3-a456-426614174002",
} as const;

function signer(
  override: Partial<Readonly<{
    keyId: string;
    privateKey: KeyObject;
    now: () => Date;
    randomBytes: (size: number) => Buffer;
    randomUUID: () => string;
  }>> = {},
): DelegatedJwtSigner {
  return new DelegatedJwtSigner({
    keyId: "bff-2026-07-a",
    privateKey: p256.privateKey,
    now: () => now,
    randomBytes: () => Buffer.alloc(16, 7),
    randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    ...override,
  });
}

describe("DelegatedJwtSigner", () => {
  it("mints one request-bound 30-second ES256 token", async () => {
    const result = await signer().sign(validInput);
    const verified = await jwtVerify(result.token, p256.publicKey, {
      algorithms: ["ES256"],
      audience: "urn:account-book:api",
      currentDate: now,
      issuer: "urn:account-book:bff",
    });

    expect(decodeProtectedHeader(result.token)).toEqual({
      alg: "ES256",
      kid: "bff-2026-07-a",
      typ: "at+jwt",
    });
    expect(verified.payload).toEqual({
      aud: "urn:account-book:api",
      exp: 1_784_764_830,
      iat: 1_784_764_800,
      iss: "urn:account-book:bff",
      jti: "BwcHBwcHBwcHBwcHBwcHBw",
      nbf: 1_784_764_800,
      rbh: verified.payload.rbh,
      rid: result.requestId,
      scp: "me:read",
      sid: "123e4567-e89b-42d3-a456-426614174001",
      sub: "123e4567-e89b-42d3-a456-426614174002",
    });
    expect(verified.payload.rbh).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.byteLength(result.token, "utf8")).toBeLessThanOrEqual(4_096);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("binds the canonical sorted request target and exact request ID", async () => {
    const first = await signer().sign(validInput);
    const equivalent = await signer().sign({
      ...validInput,
      target: "/v1/me?a=1&z=2",
    });
    const differentRequest = await signer({
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174003",
    }).sign(validInput);
    const firstPayload = (await jwtVerify(first.token, p256.publicKey, { currentDate: now })).payload;
    const equivalentPayload = (await jwtVerify(equivalent.token, p256.publicKey, { currentDate: now })).payload;
    const differentPayload = (await jwtVerify(differentRequest.token, p256.publicKey, { currentDate: now })).payload;

    expect(equivalentPayload.rbh).toBe(firstPayload.rbh);
    expect(differentPayload.rbh).not.toBe(firstPayload.rbh);
  });

  it("uses unique default request IDs and token IDs", async () => {
    const productionSigner = new DelegatedJwtSigner({
      keyId: "bff-2026-07-a",
      privateKey: p256.privateKey,
      now: () => now,
    });
    const first = await productionSigner.sign(validInput);
    const second = await productionSigner.sign(validInput);
    const firstPayload = (await jwtVerify(first.token, p256.publicKey, { currentDate: now })).payload;
    const secondPayload = (await jwtVerify(second.token, p256.publicKey, { currentDate: now })).payload;

    expect(first.requestId).not.toBe(second.requestId);
    expect(firstPayload.jti).not.toBe(secondPayload.jti);
    expect(firstPayload.jti).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  });

  it.each([
    ["blank kid", { keyId: "" }],
    ["whitespace kid", { keyId: " key" }],
    ["path-like kid", { keyId: "key/../../x" }],
    ["oversized kid", { keyId: "a".repeat(129) }],
    ["public EC key", { privateKey: p256.publicKey }],
    ["RSA private key", { privateKey: rsa.privateKey }],
    ["wrong EC curve", { privateKey: p384.privateKey }],
  ])("rejects unsafe constructor configuration: %s", (_name, override) => {
    expect(() => signer(override)).toThrow(/^AUTH_CONFIGURATION_INVALID$/u);
  });

  it.each([
    ["invalid user UUID", { userId: "not-a-uuid" }],
    ["noncanonical user UUID", { userId: "123E4567-E89B-42D3-A456-426614174002" }],
    ["invalid session UUID", { sessionId: "not-a-uuid" }],
    ["invalid scope", { scope: "admin:all" }],
    ["invalid method", { method: "get" }],
    ["absolute target", { target: "https://evil.test/v1/me" }],
    ["invalid content type", { contentType: "text/plain" }],
  ])("rejects invalid signing input with a fixed safe error: %s", async (_name, override) => {
    await expect(signer().sign({ ...validInput, ...override } as typeof validInput))
      .rejects.toThrow(/^DELEGATED_JWT_INVALID$/u);
  });

  it.each([
    ["invalid date", () => new Date(Number.NaN)],
    ["infinite date", () => ({ getTime: () => Number.POSITIVE_INFINITY }) as Date],
  ])("rejects an invalid clock with a fixed safe error: %s", async (_name, clock) => {
    await expect(signer({ now: clock }).sign(validInput)).rejects.toThrow(/^DELEGATED_JWT_INVALID$/u);
  });

  it.each([
    ["short random bytes", () => Buffer.alloc(15)],
    ["long random bytes", () => Buffer.alloc(17)],
    ["invalid random value", () => "secret" as unknown as Buffer],
  ])("rejects invalid token randomness with a fixed safe error: %s", async (_name, randomBytes) => {
    await expect(signer({ randomBytes }).sign(validInput)).rejects.toThrow(/^DELEGATED_JWT_INVALID$/u);
  });

  it("rejects an invalid generated request ID with a fixed safe error", async () => {
    await expect(signer({ randomUUID: () => "not-a-uuid" }).sign(validInput))
      .rejects.toThrow(/^DELEGATED_JWT_INVALID$/u);
  });

  it("rejects oversized compact output without including it in the error", () => {
    const oversized = "sensitive.".repeat(512);
    expect(() => assertDelegatedJwtSize(oversized)).toThrow(/^DELEGATED_JWT_INVALID$/u);
    try {
      assertDelegatedJwtSize(oversized);
    } catch (error) {
      expect(String(error)).not.toContain(oversized);
    }
  });
});
