import { BankConnectionRequestIdSchema, BankConnectionRequestStatusSchema, buildApiError } from "@account-book/contracts";
import type { KyInstance } from "ky";
import { z } from "zod";
import { apiClient, apiError, ApiClientError } from "../../../lib/http/api-client.js";

const csrf = z.strictObject({ csrfToken: z.string().min(1).max(1024) });
const start = z.strictObject({ requestId: BankConnectionRequestIdSchema, authorizationUrl: z.url().refine(s => { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password && !u.hash; }) });

/** @param userId 화면의 사용자 일치 조건(인증은 BFF 세션). @param http ky 전송. proof는 JS로 읽거나 전송하지 않는다. */
export function createBankApi(userId: string, http: KyInstance = apiClient) {
  const client = http.extend({ credentials: "same-origin", cache: "no-store", retry: 0, timeout: 15_000, headers: { "X-Account-Book-User": BankConnectionRequestIdSchema.parse(userId) } });
  /** @param path 고정 BFF 경로. @param schema 응답 계약. @param input POST일 때만 JSON. @param signal 조회 취소. */
  async function send<T>(path: string, schema: z.ZodType<T>, input?: unknown, signal?: AbortSignal): Promise<T> {
    try {
      if (input === undefined) return schema.parse(await client.get(path, { ...(signal ? { signal } : {}) }).json());
      const { csrfToken } = csrf.parse(await client.get("auth/csrf").json());
      return schema.parse(await client.post(path, { json: input, headers: { "X-CSRF-Token": csrfToken } }).json());
    } catch (error) {
      if (signal?.aborted) throw error;
      const safe = await apiError(error);
      throw safe.code === "AUTH_PROVIDER_UNAVAILABLE" ? new ApiClientError(buildApiError({ code: "BANK_UNAVAILABLE", retryable: false })) : safe;
    }
  }
  /** @param requestId 검증할 요청. 상태가 다른 ID를 가리키면 네트워크 오류처럼 안전하게 거부한다. */
  function statusSchema(requestId: string) { return BankConnectionRequestStatusSchema.refine(result => result.requestId === requestId); }
  return {
    start: () => send("bank-connections/kftc/start", start, {}),
    complete: (requestId: string) => send("bank-connections/kftc/complete", statusSchema(BankConnectionRequestIdSchema.parse(requestId)).refine(result => result.status === "connected"), { requestId }),
    status: (requestId: string, signal?: AbortSignal) => send(`bank-connections/requests/${BankConnectionRequestIdSchema.parse(requestId)}`, statusSchema(requestId), undefined, signal),
  };
}
