/** @param environment 서버 설정. @returns 테스트 전용 인가 endpoint 또는 비활성 null. */
export function bankE2eEndpoint(environment: Readonly<Record<string, string | undefined>>): URL | null {
  if (environment.BANK_E2E === undefined) return null;
  if (environment.BANK_E2E !== "true" || !["test", "development"].includes(environment.NODE_ENV ?? "")
    || environment.AUTH_ADAPTER_MODE !== "fake"
    || environment.APP_ORIGIN !== "https://127.0.0.1:4512"
    || environment.API_INTERNAL_URL !== "http://127.0.0.1:4511"
    || environment.AUTH_FAKE_PROVIDER_URL !== "http://127.0.0.1:4510/token"
    || environment.DATABASE_URL !== "postgresql://app_session_bff:account-book-e2e-only@127.0.0.1:5432/account_book_core_test") {
    throw new Error("BANK_E2E_CONFIGURATION_INVALID");
  }
  return new URL("https://bank.invalid/authorize");
}
