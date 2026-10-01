import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaywrightServerEnvironments } from "./playwright-environment.js";

test("Playwright server environments isolate mixed-case trust-boundary input and map only explicit delegated values", () => {
  const inherited = {
    api_database_url: "inherited-api-database",
    APP_origin: "inherited-origin",
    Auth_Csrf_Hmac_Key: "inherited-csrf-key",
    auth_fake_provider_url: "inherited-provider-url",
    AUTH_JWKS_URL: "inherited-legacy-jwks",
    AUTH_JWT_ALGORITHM: "inherited-legacy-algorithm",
    AUTH_ENABLED_PROVIDERS: '["github"]',
    bFf_Database_Url: "inherited-bff-database",
    Bff_Jwt_Private_Key: "inherited-bff-private-key",
    BFF_JWT_PUBLIC_KEYS: "inherited-bff-public-keys",
    Migration_Database_Url: "inherited-migration-database",
    sUpAbAsE_Anon_Key: "inherited-provider-key",
    Test_Database_Url: "inherited-test-database",
    PATH: "toolchain-path",
  };

  const environments = buildPlaywrightServerEnvironments({
    apiDatabaseUrl: "api-only-database",
    baseURL: "https://web.example.test",
    csrfKey: "web-csrf-key",
    databaseUrl: "web-bff-database",
    delegatedPrivateKey: "web-private-key",
    delegatedPublicKey: "api-public-key",
    inherited,
    sessionKey: "web-session-key",
  });
  const { api, idp, web } = environments;

  assert.equal(api.PATH, "toolchain-path");
  assert.equal(idp.PATH, "toolchain-path");
  assert.equal(web.PATH, "toolchain-path");
  for (const environment of [idp, api, web]) {
    assert.equal(environment.api_database_url, undefined);
    assert.equal(environment.APP_origin, undefined);
    assert.equal(environment.Auth_Csrf_Hmac_Key, undefined);
    assert.equal(environment.auth_fake_provider_url, undefined);
    assert.equal(environment.bFf_Database_Url, undefined);
    assert.equal(environment.Bff_Jwt_Private_Key, undefined);
    assert.equal(environment.Migration_Database_Url, undefined);
    assert.equal(environment.sUpAbAsE_Anon_Key, undefined);
    assert.equal(environment.Test_Database_Url, undefined);
  }
  assert.deepEqual(Object.keys(idp).filter((key) => /^(?:API_|AUTH_|BFF_|SUPABASE_|TEST_DATABASE_|MIGRATION_DATABASE_)|(?:^|_)DATABASE_URL$|^APP_ORIGIN$/iu.test(key)), []);
  assert.equal(api.BFF_JWT_PRIVATE_KEY, undefined);
  assert.equal(api.BFF_JWT_KEY_ID, undefined);
  assert.equal(api.AUTH_CSRF_HMAC_KEY, undefined);
  assert.equal(api.AUTH_TOKEN_KEY, undefined);
  assert.equal(api.AUTH_ENABLED_PROVIDERS, undefined);
  assert.equal(api.API_DATABASE_URL, "api-only-database");
  assert.equal(api.BFF_JWT_ACCEPTED_KIDS, '["e2e-bff-a"]');
  assert.equal(api.BFF_JWT_PUBLIC_KEYS, '{"e2e-bff-a":"api-public-key"}');
  assert.equal(api.BFF_AUTH_DISABLED, "false");
  assert.equal(web.API_DATABASE_URL, undefined);
  assert.equal(web.BFF_AUTH_DISABLED, undefined);
  assert.equal(web.BFF_JWT_ACCEPTED_KIDS, undefined);
  assert.equal(web.BFF_JWT_PUBLIC_KEYS, undefined);
  assert.equal(web.BFF_JWT_KEY_ID, "e2e-bff-a");
  assert.equal(web.BFF_JWT_PRIVATE_KEY, "web-private-key");
  assert.equal(web.AUTH_CSRF_HMAC_KEY, "web-csrf-key");
  assert.equal(web.AUTH_TOKEN_KEY, "web-session-key");
  assert.equal(web.DATABASE_URL, "web-bff-database");
  assert.equal(web.AUTH_FAKE_PROVIDER_URL, "http://127.0.0.1:4510/token");
  assert.equal(web.AUTH_ENABLED_PROVIDERS, '["google","kakao","naver"]');
});
