import {
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@account-book/database", () => ({ createDatabaseClient: vi.fn(() => ({ sharedDatabase: true })) }));
const module = await import("./container.js").catch(() => ({} as Record<string, unknown>));
const resolveAuthRuntime = module.resolveAuthRuntime as ((environment: Readonly<Record<string, string | undefined>>) => { mode: string; origin: URL }) | undefined;
const createRequestContainer = module.createRequestContainer as ((environment: Readonly<Record<string, string | undefined>>) => {
  authController: unknown;
  delegatedApiClient: { request: unknown };
  delegatedJwtSigner: { sign: unknown };
}) | undefined;
const { createDatabaseClient } = await import("@account-book/database");

const key = Buffer.alloc(32, 7).toString("base64url");
const csrfKey = Buffer.alloc(32, 8).toString("base64url");
const previousKey = Buffer.alloc(32, 9).toString("base64url");

/**
 * Wraps a chosen 32-byte P-256 scalar in a canonical PKCS8 key to exercise byte-level secret separation.
 * @param scalar Symmetric-key bytes intentionally reused as the EC private scalar.
 * @returns Canonical PKCS8 DER encoded as unpadded base64url.
 */
function p256Pkcs8FromScalar(scalar: Buffer): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const publicPoint = ecdh.getPublicKey(undefined, "uncompressed");
  const privateKey = createPrivateKey({
    format: "jwk",
    key: {
      crv: "P-256",
      d: scalar.toString("base64url"),
      kty: "EC",
      x: publicPoint.subarray(1, 33).toString("base64url"),
      y: publicPoint.subarray(33, 65).toString("base64url"),
    },
  });
  return privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
}

const signingPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signingPrivateKeyDer = signingPair.privateKey.export({ format: "der", type: "pkcs8" });
const signingPrivateKey = signingPrivateKeyDer.toString("base64url");
const noncanonicalPrivateKeyDer = Buffer.concat([signingPrivateKeyDer, Buffer.from([0])]).toString("base64url");
const p384PrivateKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" })
  .privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const rsaPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeyDer = signingPair.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const delegatedEnvironment = {
  BFF_JWT_KEY_ID: "bff-test-a",
  BFF_JWT_PRIVATE_KEY: signingPrivateKey,
} as const;
const runtimeEnvironment = {
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  AUTH_ADAPTER_MODE: "fake",
  DATABASE_URL: "postgres://database.example.test/account_book",
  API_INTERNAL_URL: "https://api.internal.test",
  AUTH_TOKEN_KEY_ID: "current",
  AUTH_TOKEN_KEY: key,
  AUTH_CSRF_HMAC_KEY: csrfKey,
  ...delegatedEnvironment,
} as const;

describe("authentication runtime selection", () => {
  it("defaults to the Supabase adapter", () => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(resolveAuthRuntime!({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.test" })).toMatchObject({ mode: "supabase", origin: new URL("https://app.example.test") });
  });

  it.each([
    { NODE_ENV: "production", APP_ORIGIN: "https://localhost", AUTH_ADAPTER_MODE: "fake" },
    { NODE_ENV: "development", APP_ORIGIN: "https://app.example.test", AUTH_ADAPTER_MODE: "fake" },
    { NODE_ENV: "test", APP_ORIGIN: "http://localhost.evil.test", AUTH_ADAPTER_MODE: "fake" },
  ])("rejects fake mode outside non-production exact loopback %#", (environment) => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(() => resolveAuthRuntime!(environment)).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("allows fake mode on non-production loopback %s", (hostname) => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(resolveAuthRuntime!({ NODE_ENV: "test", APP_ORIGIN: `http://${hostname}:3000`, AUTH_ADAPTER_MODE: "fake" })).toMatchObject({ mode: "fake" });
  });

  it("accepts only the exact test IDP token bridge on 127.0.0.1:4510", () => {
    expect(() => createRequestContainer!({ ...runtimeEnvironment, AUTH_FAKE_PROVIDER_URL: "http://127.0.0.1:4510/token" })).not.toThrow();
    for (const value of [
      "http://localhost:4510/token",
      "http://127.1:4510/token",
      "http://127.0.0.1:04510/token",
      "http://127.0.0.1:4511/token",
      "http://127.0.0.1:4510/other",
      "http://127.0.0.1:4510/token?detail=1",
      "http://user:pass@127.0.0.1:4510/token",
      "https://127.0.0.1:4510/token",
    ]) expect(() => createRequestContainer!({ ...runtimeEnvironment, AUTH_FAKE_PROVIDER_URL: value })).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it("rejects a production fake bridge before constructing an authentication request graph", () => {
    expect(() => createRequestContainer!({
      ...runtimeEnvironment,
      APP_ORIGIN: "https://localhost",
      AUTH_FAKE_PROVIDER_URL: "http://127.0.0.1:4510/token",
      NODE_ENV: "production",
    })).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it.each([
    "https://user:pass@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?query=1",
    "https://app.example.test#fragment",
    "http://app.example.test",
  ])("rejects a non-canonical application origin %s", (origin) => {
    expect(resolveAuthRuntime).toBeTypeOf("function");
    expect(() => resolveAuthRuntime!({ NODE_ENV: "development", APP_ORIGIN: origin })).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it("reuses one lazy database pool while rebuilding the request-owned graph", async () => {
    expect(createRequestContainer).toBeTypeOf("function");
    const first = createRequestContainer!(runtimeEnvironment);
    const second = createRequestContainer!(runtimeEnvironment);
    expect(first.authController).not.toBe(second.authController);
    expect(createDatabaseClient).toHaveBeenCalledTimes(1);
    const csrf = await (first.authController as { csrf(request: Request): Promise<Response> }).csrf(new Request("http://localhost:3000/api/auth/csrf"));
    expect(csrf.headers.get("Set-Cookie")).toMatch(/__Host-ab_interaction=.*; Secure;/u);
    expect(() => createRequestContainer!({ ...runtimeEnvironment, DATABASE_URL: "postgres://other.example.test/account_book" })).toThrow("AUTH_CONFIGURATION_INVALID");
    expect(createDatabaseClient).toHaveBeenCalledTimes(1);
  });

  it("wires one request-owned delegated client to the request-owned signer and controller", () => {
    const first = createRequestContainer!(runtimeEnvironment);
    const second = createRequestContainer!(runtimeEnvironment);
    const firstControllerDependencies = (first.authController as {
      dependencies?: Readonly<{ delegatedApiClient?: unknown }>;
    }).dependencies;
    const secondControllerDependencies = (second.authController as {
      dependencies?: Readonly<{ delegatedApiClient?: unknown }>;
    }).dependencies;
    const firstClientSigner = (first.delegatedApiClient as unknown as { signer?: unknown }).signer;
    const secondClientSigner = (second.delegatedApiClient as unknown as { signer?: unknown }).signer;

    expect(first.delegatedJwtSigner.sign).toBeTypeOf("function");
    expect(first.delegatedApiClient.request).toBeTypeOf("function");
    expect(first.delegatedJwtSigner).not.toBe(second.delegatedJwtSigner);
    expect(first.delegatedApiClient).not.toBe(second.delegatedApiClient);
    expect(firstClientSigner).toBe(first.delegatedJwtSigner);
    expect(secondClientSigner).toBe(second.delegatedJwtSigner);
    expect(firstControllerDependencies?.delegatedApiClient).toBe(first.delegatedApiClient);
    expect(secondControllerDependencies?.delegatedApiClient).toBe(second.delegatedApiClient);
  });

  it.each([
    ["missing kid", { BFF_JWT_KEY_ID: undefined }],
    ["blank kid", { BFF_JWT_KEY_ID: "" }],
    ["unsafe kid", { BFF_JWT_KEY_ID: "key/../../x" }],
    ["missing private key", { BFF_JWT_PRIVATE_KEY: undefined }],
    ["non-base64 key", { BFF_JWT_PRIVATE_KEY: "not-a-key" }],
    ["noncanonical base64url key", { BFF_JWT_PRIVATE_KEY: `${signingPrivateKey}=` }],
    ["noncanonical PKCS8 DER", { BFF_JWT_PRIVATE_KEY: noncanonicalPrivateKeyDer }],
    ["wrong curve", { BFF_JWT_PRIVATE_KEY: p384PrivateKey }],
    ["non-EC private key", { BFF_JWT_PRIVATE_KEY: rsaPrivateKey }],
    ["public key", { BFF_JWT_PRIVATE_KEY: publicKeyDer }],
    ["raw symmetric token secret", { BFF_JWT_PRIVATE_KEY: key }],
    ["current token key used as private scalar", {
      BFF_JWT_PRIVATE_KEY: p256Pkcs8FromScalar(Buffer.from(key, "base64url")),
    }],
    ["previous token key used as private scalar", {
      AUTH_TOKEN_PREVIOUS_KEYS: JSON.stringify({ previous: previousKey }),
      BFF_JWT_PRIVATE_KEY: p256Pkcs8FromScalar(Buffer.from(previousKey, "base64url")),
    }],
    ["CSRF key used as private scalar", {
      BFF_JWT_PRIVATE_KEY: p256Pkcs8FromScalar(Buffer.from(csrfKey, "base64url")),
    }],
  ] satisfies ReadonlyArray<readonly [string, Readonly<Record<string, string | undefined>>]>)("rejects delegated signer configuration: %s", (_name, override) => {
    expect(() => createRequestContainer!({ ...runtimeEnvironment, ...override }))
      .toThrow(/^AUTH_CONFIGURATION_INVALID$/u);
  });
});
