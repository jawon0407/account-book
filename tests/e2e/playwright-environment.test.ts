import assert from "node:assert/strict";
import test from "node:test";
import { createE2eChildEnvironment } from "./playwright-environment.js";

test("E2E child environments retain toolchain variables but isolate opposite trust-boundary settings", () => {
  const inherited = {
    API_DATABASE_URL: "inherited-api-database",
    AUTH_CSRF_HMAC_KEY: "inherited-csrf-key",
    AUTH_JWKS_URL: "inherited-legacy-jwks",
    AUTH_JWT_ALGORITHM: "inherited-legacy-algorithm",
    AUTH_TOKEN_KEY: "inherited-session-key",
    BFF_AUTH_DISABLED: "inherited-kill-switch",
    BFF_JWT_ACCEPTED_KIDS: "inherited-accepted-kids",
    BFF_JWT_KEY_ID: "inherited-bff-key-id",
    BFF_JWT_PRIVATE_KEY: "inherited-bff-private-key",
    BFF_JWT_PUBLIC_KEYS: "inherited-bff-public-keys",
    PATH: "toolchain-path",
  };

  const api = createE2eChildEnvironment(inherited, {
    API_DATABASE_URL: "api-only-database",
    BFF_AUTH_DISABLED: "false",
    BFF_JWT_ACCEPTED_KIDS: "api-only-accepted-kids",
    BFF_JWT_PUBLIC_KEYS: "api-only-public-keys",
  });
  const web = createE2eChildEnvironment(inherited, {
    AUTH_CSRF_HMAC_KEY: "web-only-csrf-key",
    AUTH_TOKEN_KEY: "web-only-session-key",
    BFF_JWT_KEY_ID: "web-only-bff-key-id",
    BFF_JWT_PRIVATE_KEY: "web-only-bff-private-key",
    DATABASE_URL: "web-only-database",
  });

  assert.equal(api.PATH, "toolchain-path");
  assert.equal(web.PATH, "toolchain-path");
  assert.equal(api.BFF_JWT_PRIVATE_KEY, undefined);
  assert.equal(api.BFF_JWT_KEY_ID, undefined);
  assert.equal(api.AUTH_CSRF_HMAC_KEY, undefined);
  assert.equal(api.AUTH_TOKEN_KEY, undefined);
  assert.equal(api.AUTH_JWKS_URL, undefined);
  assert.equal(api.AUTH_JWT_ALGORITHM, undefined);
  assert.equal(web.API_DATABASE_URL, undefined);
  assert.equal(web.BFF_AUTH_DISABLED, undefined);
  assert.equal(web.BFF_JWT_ACCEPTED_KIDS, undefined);
  assert.equal(web.BFF_JWT_PUBLIC_KEYS, undefined);
  assert.equal(web.AUTH_JWKS_URL, undefined);
  assert.equal(web.AUTH_JWT_ALGORITHM, undefined);
  assert.equal(api.API_DATABASE_URL, "api-only-database");
  assert.equal(web.BFF_JWT_PRIVATE_KEY, "web-only-bff-private-key");
});
