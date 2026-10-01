import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { test } from "node:test";
import { createLocalAuthConfig, childEnvironment, parseSetupUrl, assertEmptySetup } from "./config.mjs";

const migrationUrl = "postgresql://postgres.tjtamaazsilaegvvovhg:test-only-admin@aws-0-test.pooler.supabase.com:5432/postgres";
const input = { migrationUrl, caPath: "C:/private/root ca.pem", publishableKey: "sb_publishable_test-only" };

test("runtime URLs replace the owner with different least-privilege credentials and verify TLS", () => {
  const { web, api } = createLocalAuthConfig(input);
  assert.equal(typeof web.DATABASE_URL, "string");
  assert.equal(typeof api.API_DATABASE_URL, "string");
  const bff = new URL(web.DATABASE_URL);
  const backend = new URL(api.API_DATABASE_URL);
  assert.equal(bff.username, "app_bff_login.tjtamaazsilaegvvovhg");
  assert.equal(backend.username, "app_api.tjtamaazsilaegvvovhg");
  assert.notEqual(bff.password, backend.password);
  for (const url of [bff, backend]) {
    assert.notEqual(url.password, "test-only-admin");
    assert.equal(Buffer.from(url.password, "base64url").length, 32);
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    assert.equal(url.searchParams.get("sslrootcert"), "C:/private/root ca.pem");
  }
});

test("independent token, CSRF and signing keys are generated; API receives only the public key", () => {
  const { web, api } = createLocalAuthConfig(input);
  assert.equal(typeof web.AUTH_TOKEN_KEY, "string");
  assert.equal(Buffer.from(web.AUTH_TOKEN_KEY, "base64url").length, 32);
  assert.equal(Buffer.from(web.AUTH_CSRF_HMAC_KEY, "base64url").length, 32);
  assert.notEqual(web.AUTH_TOKEN_KEY, web.AUTH_CSRF_HMAC_KEY);
  const privateKey = createPrivateKey({ key: Buffer.from(web.BFF_JWT_PRIVATE_KEY, "base64url"), type: "pkcs8", format: "der" });
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  assert.equal(JSON.parse(api.BFF_JWT_PUBLIC_KEYS)[web.BFF_JWT_KEY_ID], publicKey);
  assert.deepEqual(JSON.parse(api.BFF_JWT_ACCEPTED_KIDS), [web.BFF_JWT_KEY_ID]);
  assert.equal(api.BFF_JWT_PRIVATE_KEY, undefined);
  assert.equal(api.AUTH_TOKEN_KEY, undefined);
  assert.equal(api.DATABASE_URL, undefined);
  assert.equal(web.API_DATABASE_URL, undefined);
  assert.equal(JSON.stringify({ web, api }).includes("test-only-admin"), false);
});

test("a foreign project, deceptive host, port, path and query overrides are rejected without input reflection", () => {
  for (const value of [
    migrationUrl.replace("postgres.tjtamaazsilaegvvovhg", "postgres.someotherproject"),
    migrationUrl.replace("pooler.supabase.com", "pooler.supabase.com.evil.test"),
    migrationUrl.replace(":5432/", ":6543/"),
    migrationUrl.replace("/postgres", "/other"),
    migrationUrl + "?sslmode=disable", migrationUrl + "?options=-c%20role=postgres",
    migrationUrl + "#secret", " " + migrationUrl, "not-a-url",
  ]) assert.throws(() => parseSetupUrl(value), /^Error: LOCAL_AUTH_CONFIG_INVALID$/);
  assert.equal(parseSetupUrl(migrationUrl).port, "5432");
});

test("child environments do not inherit admin secrets, other role secrets, or Node preload/TLS overrides", () => {
  const config = createLocalAuthConfig(input);
  const parent = { Path: "node-bin", SystemRoot: "C:/Windows", TEMP: "temp", NODE_OPTIONS: "--require malicious", NODE_TLS_REJECT_UNAUTHORIZED: "0", MIGRATION_DATABASE_URL: migrationUrl, API_DATABASE_URL: "parent-api", SECRET: "parent-secret" };
  for (const kind of ["web", "api"]) {
    const env = childEnvironment(kind, config[kind], parent);
    assert.equal(env.Path, "node-bin");
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.MIGRATION_DATABASE_URL, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
    assert.equal(env.SECRET, undefined);
    assert.equal(kind === "web" ? env.API_DATABASE_URL : env.DATABASE_URL, undefined);
    assert.throws(() => childEnvironment(kind, { ...config[kind], NODE_OPTIONS: "--require malicious" }, parent), /LOCAL_AUTH_CONFIG_INVALID/);
  }
});

test("provisioning refuses existing app state, non-owner execution or either unencrypted hop", () => {
  const empty = { schemas: [], roles: [], currentUser: "postgres", clientTls: true, databaseTls: true };
  assert.doesNotThrow(() => assertEmptySetup(empty));
  for (const mutation of [{ schemas: ["app_private"] }, { schemas: ["app_bank"] }, { roles: ["app_api"] }, { currentUser: "app_api" }, { clientTls: false }, { databaseTls: false }]) {
    assert.throws(() => assertEmptySetup({ ...empty, ...mutation }), /LOCAL_AUTH_PREFLIGHT_FAILED/);
  }
});

test("social login defaults off, accepts only explicit web config, and never inherits parent activation", () => {
  const { web, api } = createLocalAuthConfig(input);
  assert.equal(web.AUTH_ENABLED_PROVIDERS, "[]");
  const legacy = { ...web };
  delete legacy.AUTH_ENABLED_PROVIDERS;
  const parent = { AUTH_ENABLED_PROVIDERS: '["google","kakao","naver"]' };
  assert.equal(childEnvironment("web", legacy, parent).AUTH_ENABLED_PROVIDERS, "[]");
  assert.equal(childEnvironment("web", { ...web, AUTH_ENABLED_PROVIDERS: '["google"]' }, parent).AUTH_ENABLED_PROVIDERS, '["google"]');
  assert.equal(childEnvironment("api", api, parent).AUTH_ENABLED_PROVIDERS, undefined);
  assert.throws(() => childEnvironment("api", { ...api, AUTH_ENABLED_PROVIDERS: "[]" }, parent), /LOCAL_AUTH_CONFIG_INVALID/);
});

test("local social activation rejects malformed or unknown providers before starting servers", () => {
  const { web } = createLocalAuthConfig(input);
  for (const value of ["", "google", '["github"]', '["google","google"]', 'null', '{}']) {
    assert.throws(() => childEnvironment("web", { ...web, AUTH_ENABLED_PROVIDERS: value }, {}), /^Error: LOCAL_AUTH_CONFIG_INVALID$/);
  }
});
