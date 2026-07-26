import { createPublicKey } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { parseApiEnvironment } from "./environment.js";

let publicKey: string;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicKey = Buffer.from(createPublicKey({ key: await exportJWK(pair.publicKey), format: "jwk" }).export({ format: "der", type: "spki" })).toString("base64url");
});

function validEnvironment(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    API_DATABASE_URL: "postgresql://app_api:local-test-password@127.0.0.1:5432/account_book?sslmode=disable",
    BFF_AUTH_DISABLED: "false",
    BFF_JWT_ACCEPTED_KIDS: '["local-test"]',
    BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "local-test": publicKey }),
    ...overrides,
  };
}

describe("parseApiEnvironment", () => {
  it("creates an immutable local static-keyring configuration", () => {
    const result = parseApiEnvironment(validEnvironment());

    expect(result).toMatchObject({
      apiHost: "127.0.0.1",
      apiPort: 3001,
      apiDatabaseUrl: "postgresql://app_api:local-test-password@127.0.0.1:5432/account_book?sslmode=disable",
      bffAuthDisabled: false,
      bffJwtAcceptedKids: ["local-test"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.bffJwtAcceptedKids)).toBe(true);
    expect(Object.isFrozen(result.bffJwtPublicKeys)).toBe(true);
    expect(result.bffJwtPublicKeys["local-test"]?.asymmetricKeyType).toBe("ec");
  });

  it.each([
    ["missing runtime database role", { API_DATABASE_URL: "postgresql://other:password@127.0.0.1/db?sslmode=disable" }],
    ["missing database credential", { API_DATABASE_URL: "postgresql://app_api@127.0.0.1/db?sslmode=disable" }],
    ["unencrypted public database URL", { API_DATABASE_URL: "postgresql://app_api:password@db.example.test/db" }],
    ["database fragment", { API_DATABASE_URL: "postgresql://app_api:password@127.0.0.1/db?sslmode=disable#fragment" }],
    ["internal credential whitespace", { API_DATABASE_URL: "postgresql://app_api:literal space@127.0.0.1/db?sslmode=disable" }],
    ["repeated contradictory loopback TLS modes", { API_DATABASE_URL: "postgresql://app_api:password@127.0.0.1/db?sslmode=require&sslmode=disable" }],
    ["repeated contradictory public TLS modes", { API_DATABASE_URL: "postgresql://app_api:password@db.example.test/db?sslmode=require&sslmode=disable" }],
    ["unsupported public TLS mode", { API_DATABASE_URL: "postgresql://app_api:password@db.example.test/db?sslmode=disable" }],
    ["disabled value outside exact boolean spelling", { BFF_AUTH_DISABLED: "FALSE" }],
    ["duplicate accepted key IDs", { BFF_JWT_ACCEPTED_KIDS: '["local-test","local-test"]' }],
    ["unknown accepted key ID", { BFF_JWT_ACCEPTED_KIDS: '["unknown"]' }],
    ["unsafe key ID", { BFF_JWT_ACCEPTED_KIDS: '["unsafe key"]' }],
    ["noncanonical key encoding", { BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "local-test": `${publicKey}=` }) }],
    ["duplicate key object member", { BFF_JWT_PUBLIC_KEYS: `{"local-test":"${publicKey}","local-test":"${publicKey}"}` }],
  ])("rejects %s without revealing configuration input", (_name, override) => {
    expect(() => parseApiEnvironment(validEnvironment(override))).toThrow("API_CONFIGURATION_INVALID");
    expect(() => parseApiEnvironment(validEnvironment(override))).not.toThrow(/password|unsafe key|fragment/u);
  });
});
