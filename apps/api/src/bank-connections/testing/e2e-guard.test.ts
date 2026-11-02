import { expect, it } from "vitest";
import { assertBankE2e } from "./e2e-guard.js";
const safe = { NODE_ENV: "test", BANK_E2E: "true", API_HOST: "127.0.0.1", API_PORT: "4511", BFF_AUTH_DISABLED: "false", API_DATABASE_URL: "postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_core_test" };
it("고정 폐기용 설정만 허용하고 기본·운영·공인 주소·인증 우회·다른 DB는 거부한다", () => {
  expect(() => assertBankE2e(safe)).not.toThrow();
  for (const env of [{}, { ...safe, NODE_ENV: "production" }, { ...safe, BANK_E2E: undefined },
    { ...safe, API_HOST: "0.0.0.0" }, { ...safe, API_PORT: "3001" },
    { ...safe, BFF_AUTH_DISABLED: "true" }, { ...safe, API_DATABASE_URL: safe.API_DATABASE_URL + "?sslmode=disable" }]) {
    expect(() => assertBankE2e(env)).toThrow("BANK_E2E_CONFIGURATION_INVALID");
  }
});
