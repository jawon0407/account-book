import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { buildPlaywrightServerEnvironments } from "./playwright-environment.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined || process.env.TEST_DATABASE_DISPOSABLE !== "true") {
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_DISPOSABLE=true are required for browser E2E");
}
if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== databaseUrl) {
  throw new Error("DATABASE_URL must match the disposable TEST_DATABASE_URL for browser E2E");
}

const baseURL = "https://127.0.0.1:4512";
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
/**
 * 한 E2E 실행에서 사용할 무작위 32바이트 키를 생성한다.
 * @returns base64url 문자열. 파일에 저장하지 않으며 암호학적 난수 생성 실패는 전파한다.
 */
const testKey = () => randomBytes(32).toString("base64url");

/**
 * 한 실행에 사용할 P-256 위임 서명 키 쌍을 생성한다.
 * @returns privateKey는 PKCS8 DER, publicKey는 SPKI DER를 base64url로 표현한 객체다.
 * @remarks 키는 프로세스 메모리에만 만든다. 암호화 라이브러리 실패는 전파한다.
 */
function createDelegatedJwtKeys(): Readonly<{ privateKey: string; publicKey: string }> {
  const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: Buffer.from(keyPair.privateKey.export({ format: "der", type: "pkcs8" })).toString("base64url"),
    publicKey: Buffer.from(keyPair.publicKey.export({ format: "der", type: "spki" })).toString("base64url"),
  };
}

const delegatedJwtKeys = createDelegatedJwtKeys();
const { api: apiEnvironment, idp: idpEnvironment, web: webEnvironment } = buildPlaywrightServerEnvironments({
  apiDatabaseUrl: "postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_test",
  baseURL,
  csrfKey: testKey(),
  databaseUrl,
  delegatedPrivateKey: delegatedJwtKeys.privateKey,
  delegatedPublicKey: delegatedJwtKeys.publicKey,
  inherited: process.env,
  sessionKey: testKey(),
});

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    ignoreHTTPSErrors: true,
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  projects: [
    {
      name: "ui-mobile-390x844",
      testMatch: "ui/auth-ui.spec.ts",
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "ui-desktop-1440x900",
      testMatch: "ui/auth-ui.spec.ts",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "layout-desktop-width-boundaries",
      testMatch: "layout/auth-shell-width.spec.ts",
      use: { viewport: { width: 1080, height: 900 } },
    },
    {
      name: "http-contract",
      testMatch: "auth-response.spec.ts",
    },
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
