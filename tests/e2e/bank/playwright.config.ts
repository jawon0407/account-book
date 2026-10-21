import { defineConfig } from "@playwright/test";
import base from "../core/playwright.config.js";

export default defineConfig({
  ...base,
  testDir: ".",
  projects: [{ name: "bank-desktop", testMatch: "bank-connection.spec.ts", use: { viewport: { width: 1440, height: 900 } } }],
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map(server => {
    if (server.env?.API_DATABASE_URL) return { ...server,
      command: "pnpm --filter @account-book/api build && node apps/api/dist/bank-connections/testing/e2e-server.js",
      env: { ...server.env, NODE_ENV: "test", BANK_E2E: "true" },
    };
    if (server.env?.DATABASE_URL) return { ...server,
      env: { ...server.env, BANK_E2E: "true", DATABASE_URL: "postgresql://app_session_bff:account-book-e2e-only@127.0.0.1:5432/account_book_core_test" },
    };
    return server;
  }),
});
