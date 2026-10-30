import { describe, expect, it } from "vitest";
import { bankE2eEndpoint } from "./e2e-runtime.js";

const safe = {
  BANK_E2E: "true", NODE_ENV: "test", AUTH_ADAPTER_MODE: "fake",
  APP_ORIGIN: "https://127.0.0.1:4512", API_INTERNAL_URL: "http://127.0.0.1:4511",
  AUTH_FAKE_PROVIDER_URL: "http://127.0.0.1:4510/token",
  DATABASE_URL: "postgresql://app_session_bff:account-book-e2e-only@127.0.0.1:5432/account_book_core_test",
};
describe("은행 E2E 활성화 경계", () => {
  it("일반 환경은 비활성이고 정확한 폐기용 조합만 fake 인가를 허용한다", () => {
    expect(bankE2eEndpoint({})).toBeNull();
    expect(bankE2eEndpoint({ ...safe, BANK_E2E: undefined })).toBeNull();
    expect(bankE2eEndpoint(safe)?.href).toBe("https://bank.invalid/authorize");
  });
  it.each([
    ["NODE_ENV", "production"], ["NODE_ENV", undefined], ["AUTH_ADAPTER_MODE", "supabase"],
    ["APP_ORIGIN", "https://web.example.com"], ["APP_ORIGIN", "https://localhost:3000"],
    ["API_INTERNAL_URL", "https://api.example.com"], ["AUTH_FAKE_PROVIDER_URL", "http://localhost:4510/token"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/account_book_core_test"],
    ["DATABASE_URL", safe.DATABASE_URL + "?sslmode=disable"], ["BANK_E2E", "false"],
  ])("위험하거나 모호한 %s=%s 조합을 거부한다", (key, value) => {
    expect(() => bankE2eEndpoint({ ...safe, [key]: value })).toThrow("BANK_E2E_CONFIGURATION_INVALID");
  });
});
