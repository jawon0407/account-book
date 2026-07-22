import { describe, expect, it } from "vitest";
import { parseApiEnvironment } from "./environment.js";

const required = {
  AUTH_JWKS_URL: "https://id.example.test/.well-known/jwks.json",
  AUTH_JWT_ISSUER: "https://id.example.test/auth/v1",
  AUTH_JWT_AUDIENCE: "authenticated",
  AUTH_JWT_ALGORITHM: "ES256",
};

describe("parseApiEnvironment", () => {
  it("applies internal listener defaults and freezes validated values", () => {
    const result = parseApiEnvironment(required);

    expect(result).toEqual({
      apiHost: "127.0.0.1",
      apiPort: 3001,
      authJwksUrl: required.AUTH_JWKS_URL,
      authJwtIssuer: required.AUTH_JWT_ISSUER,
      authJwtAudience: required.AUTH_JWT_AUDIENCE,
      authJwtAlgorithm: "ES256",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("allows exact loopback HTTP URLs and the private-container host", () => {
    expect(parseApiEnvironment({
      ...required,
      API_HOST: "0.0.0.0",
      API_PORT: "65535",
      AUTH_JWKS_URL: "http://127.0.0.1:54321/.well-known/jwks.json",
      AUTH_JWT_ISSUER: "http://localhost:54321/auth/v1",
      AUTH_JWT_ALGORITHM: "RS256",
    })).toMatchObject({ apiHost: "0.0.0.0", apiPort: 65535, authJwtAlgorithm: "RS256" });
  });

  it.each([
    ["public HTTP JWKS", { AUTH_JWKS_URL: "http://id.example.test/jwks" }],
    ["public HTTP issuer", { AUTH_JWT_ISSUER: "http://id.example.test/auth/v1" }],
    ["abbreviated loopback host", { AUTH_JWKS_URL: "http://127.1/jwks" }],
    ["integer loopback host", { AUTH_JWKS_URL: "http://2130706433/jwks" }],
    ["URL credentials", { AUTH_JWKS_URL: "https://user:pass@id.example.test/jwks" }],
    ["URL fragment", { AUTH_JWT_ISSUER: "https://id.example.test/auth/v1#secret" }],
    ["unsupported protocol", { AUTH_JWKS_URL: "file:///tmp/jwks.json" }],
    ["unsafe host", { API_HOST: "example.test" }],
    ["invalid port", { API_PORT: "65536" }],
    ["padded port", { API_PORT: " 3001" }],
    ["scientific port", { API_PORT: "3e3" }],
    ["padded audience", { AUTH_JWT_AUDIENCE: " authenticated" }],
    ["control character", { AUTH_JWT_AUDIENCE: "authenticated\nsecret" }],
    ["unsupported algorithm", { AUTH_JWT_ALGORITHM: "HS256" }],
  ])("rejects %s", (_name, override) => {
    expect(() => parseApiEnvironment({ ...required, ...override })).toThrow("API_CONFIGURATION_INVALID");
  });
});
