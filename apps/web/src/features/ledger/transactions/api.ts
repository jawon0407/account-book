import { CreateTransactionInputSchema, LedgerIdSchema, TransactionListQuerySchema, TransactionListResponseSchema, TransactionSchema, buildApiError, type CreateTransactionInput, type TransactionListQuery } from "@account-book/contracts";
import type { KyInstance } from "ky";
import { z } from "zod";
import { apiClient, ApiClientError, apiError } from "../../../lib/http/api-client.js";
const csrfSchema = z.object({ csrfToken: z.string().min(1).max(1024) }).strict();

/** @param http 같은 출처 ky. @param expectedUserId 화면을 연 계정. @returns 조회와 생성만 허용하는 사용자 결속 클라이언트. */
export function createTransactionsApi(http: KyInstance = apiClient, expectedUserId: string) {
  const client = http.extend({ headers: { "X-Account-Book-User": LedgerIdSchema.parse(expectedUserId) } });
  /** @param operation 실제 전송. @param signal 조회 취소. @returns 원문 예외를 제거한 공개 결과. */
  async function safe<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (signal?.aborted) throw error;
      const failure = await apiError(error);
      throw failure.code === "AUTH_PROVIDER_UNAVAILABLE" ? new ApiClientError(buildApiError({ code: "LEDGER_SERVICE_UNAVAILABLE", retryable: false })) : failure;
    }
  }
  return {
    /** @param query 정규화할 필터/커서. @param signal 이전 조회 취소. 금융 정보는 HTTP 캐시에 저장하지 않는다. */
    async list(query: TransactionListQuery, signal?: AbortSignal) {
      const value = TransactionListQuerySchema.parse(query);
      const searchParams = new URLSearchParams(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)]));
      return safe(async () => TransactionListResponseSchema.parse(await client.get("transactions", { searchParams, cache: "no-store", retry: 0, ...(signal ? { signal } : {}) }).json()), signal);
    },
    /** @param input 한 생성 의도의 고정 본문/키. 서버 응답 이전에 성공을 예측하거나 자동 재시도하지 않는다. */
    async create(input: CreateTransactionInput) {
      const value = CreateTransactionInputSchema.parse(input);
      return safe(async () => {
        const { csrfToken } = csrfSchema.parse(await client.get("auth/csrf", { cache: "no-store", retry: 0 }).json());
        return TransactionSchema.parse(await client.post("transactions", { json: value, headers: { "X-CSRF-Token": csrfToken }, cache: "no-store", retry: 0 }).json());
      });
    },
  };
}
export type TransactionsApi = ReturnType<typeof createTransactionsApi>;
