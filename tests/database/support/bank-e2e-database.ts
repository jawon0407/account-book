import { Client } from "pg";

/** @param operation 고정 폐기용 DB에서 수행할 검증. pg 의존성을 가진 DB 테스트 패키지가 연결을 소유한다. */
export async function inspectBankE2eDatabase<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  if (process.env.TEST_DATABASE_DISPOSABLE !== "true"
    || process.env.TEST_DATABASE_URL !== "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test") throw new Error("BANK_E2E_DATABASE_INVALID");
  const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/account_book_core_test" });
  await client.connect();
  try { return await operation(client); } finally { await client.end(); }
}
