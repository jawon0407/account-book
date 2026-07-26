import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { createE2eChildEnvironment } from "./playwright-environment.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined || process.env.TEST_DATABASE_DISPOSABLE !== "true") {
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_DISPOSABLE=true are required for browser E2E");
}
if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== databaseUrl) {
  throw new Error("DATABASE_URL must match the disposable TEST_DATABASE_URL for browser E2E");
}

const baseURL = "https://127.0.0.1:4512";
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const testKey = () => randomBytes(32).toString("base64url");

/**
 * Creates a one-run P-256 trust boundary: the BFF receives only PKCS8 private DER,
 * while the API receives only SPKI public DER. These values remain process-local and
 * disappear when the Playwright config process exits.
 */
function createDelegatedJwtKeys(): Readonly<{ privateKey: string; publicKey: string }> {
  const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: Buffer.from(keyPair.privateKey.export({ format: "der", type: "pkcs8" })).toString("base64url"),
    publicKey: Buffer.from(keyPair.publicKey.export({ format: "der", type: "spki" })).toString("base64url"),
  };
}

const delegatedJwtKeys = createDelegatedJwtKeys();
const idpEnvironment = createE2eChildEnvironment(process.env, {});
const apiEnvironment = createE2eChildEnvironment(process.env, {
  API_DATABASE_URL: "postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_test",
  API_HOST: "127.0.0.1",
  API_PORT: "4511",
  BFF_AUTH_DISABLED: "false",
  BFF_JWT_ACCEPTED_KIDS: JSON.stringify(["e2e-bff-a"]),
  BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "e2e-bff-a": delegatedJwtKeys.publicKey }),
});
const webEnvironment = createE2eChildEnvironment(process.env, {
  API_INTERNAL_URL: "http://127.0.0.1:4511",
  APP_ORIGIN: baseURL,
  AUTH_ADAPTER_MODE: "fake",
  AUTH_CSRF_HMAC_KEY: testKey(),
  AUTH_FAKE_PROVIDER_URL: "http://127.0.0.1:4510/token",
  AUTH_TOKEN_KEY: testKey(),
  AUTH_TOKEN_KEY_ID: "e2e-current",
  BFF_JWT_KEY_ID: "e2e-bff-a",
  BFF_JWT_PRIVATE_KEY: delegatedJwtKeys.privateKey,
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
});

export default defineConfig({
  testDir: ".",
  testMatch: "auth.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL, browserName: "chromium", ignoreHTTPSErrors: true, trace: "retain-on-failure" },
  projects: [
    { name: "mobile-390x844", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop-1440x900", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/test-idp-server.ts",
      cwd: workspaceRoot,
      env: idpEnvironment,
      url: "http://127.0.0.1:4510/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @account-book/api build && pnpm --filter @account-book/api start",
      cwd: workspaceRoot,
      env: apiEnvironment,
      url: "http://127.0.0.1:4511/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @account-book/web dev --hostname 127.0.0.1 --port 4512 --experimental-https",
      cwd: workspaceRoot,
      env: webEnvironment,
      url: `${baseURL}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
