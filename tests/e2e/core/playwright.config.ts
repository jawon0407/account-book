import { defineConfig } from "@playwright/test";
import base from "../playwright.config.js";

// 기존 auth E2E와 달리 별도 core DB를 생성/정리한다. hosted DB는 setup 경계에서 거부된다.
export default defineConfig({
  ...base,
  testDir: ".",
  // Next 개발 모드의 최초 route 컴파일 시간을 허용한다. 운영 응답 시간 목표로 사용하지 않는다.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  projects: [{ name: "core-desktop", testMatch: "core-web.spec.ts", use: { viewport: { width: 1440, height: 900 } } }],
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    env: {
      ...server.env,
      ...(server.env?.DATABASE_URL ? { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/account_book_core_test" } : {}),
      ...(server.env?.API_DATABASE_URL ? { API_DATABASE_URL: "postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_core_test" } : {}),
    },
  })),
});
