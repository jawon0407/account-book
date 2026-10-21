/** @param environment 테스트 서버 환경. @throws 폐기용 설정이 아니면 시작 전에 거부. */
export function assertBankE2e(environment: Readonly<Record<string, string | undefined>>): void {
  if (environment.NODE_ENV !== "test" || environment.BANK_E2E !== "true"
    || environment.API_HOST !== "127.0.0.1" || environment.API_PORT !== "4511"
    || environment.BFF_AUTH_DISABLED !== "false"
    || environment.API_DATABASE_URL !== "postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_core_test") {
    throw new Error("BANK_E2E_CONFIGURATION_INVALID");
  }
}
