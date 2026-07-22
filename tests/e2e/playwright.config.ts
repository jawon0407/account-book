import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

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
      url: "http://127.0.0.1:4510/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @account-book/api build && pnpm --filter @account-book/api start",
      cwd: workspaceRoot,
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: "4511",
        AUTH_JWKS_URL: "http://127.0.0.1:4510/jwks",
        AUTH_JWT_ALGORITHM: "ES256",
        AUTH_JWT_AUDIENCE: "account-book-api",
        AUTH_JWT_ISSUER: "http://127.0.0.1:4510",
      },
      url: "http://127.0.0.1:4511/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @account-book/web dev --hostname 127.0.0.1 --port 4512 --experimental-https",
      cwd: workspaceRoot,
      env: {
        ...process.env,
        API_INTERNAL_URL: "http://127.0.0.1:4511",
        APP_ORIGIN: baseURL,
        AUTH_ADAPTER_MODE: "fake",
        AUTH_CSRF_HMAC_KEY: testKey(),
        AUTH_FAKE_PROVIDER_URL: "http://127.0.0.1:4510/token",
        AUTH_TOKEN_KEY: testKey(),
        AUTH_TOKEN_KEY_ID: "e2e-current",
        DATABASE_URL: databaseUrl,
        NODE_ENV: "test",
      },
      url: `${baseURL}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
