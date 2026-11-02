import {
  AccountSchema, ArchiveAccountInputSchema, CreateAccountInputSchema, UpdateAccountInputSchema,
  CategorySchema, ArchiveCategoryInputSchema, CreateCategoryInputSchema, UpdateCategoryInputSchema,
  ProfileSchema, UpdateProfileInputSchema, LedgerIdSchema, buildApiError,
} from "@account-book/contracts";
import type { KyInstance } from "ky";
import { z } from "zod";
import { apiClient, ApiClientError, apiError } from "../../lib/http/api-client.js";

const csrfSchema = z.object({ csrfToken: z.string().min(1).max(1024) }).strict();

/**
 * 같은 출처 BFF를 이용하는 장부 전용 클라이언트. 입력과 응답 모두 공유 계약을 검사한다.
 * @param http 기본 ky 인스턴스. 테스트에서는 네트워크 fetch 경계만 교체한다.
 * @param expectedUserId 화면을 열 때 확인한 사용자. 서버는 쿠키의 실제 사용자와 다르면 거부한다.
 * @returns 닫힌 profile/accounts/categories 작업. URL/인증 토큰을 사용자 입력으로 받지 않는다.
 */
export function createLedgerApi(http: KyInstance = apiClient, expectedUserId?: string) {
  if (expectedUserId) http = http.extend({ headers: { "X-Account-Book-User": LedgerIdSchema.parse(expectedUserId) } });
  /** @param path 고정 내부 경로. @param schema 성공 계약. @param signal 조회 취소 신호. */
  async function read<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    try {
      return schema.parse(await http.get(path, { cache: "no-store", retry: 0, ...(signal ? { signal } : {}) }).json());
    } catch (error) {
      if (signal?.aborted) throw error;
      throw await safeFailure(error);
    }
  }

  /** @param path 고정 변경 경로. @param method POST/PATCH. @param input 검증된 본문. @param schema 성공 계약. */
  async function write<T>(path: string, method: "POST" | "PATCH", input: unknown, schema: z.ZodType<T>): Promise<T> {
    try {
      const { csrfToken } = await read("auth/csrf", csrfSchema);
      const result = await http(path, { method, json: input, headers: { "X-CSRF-Token": csrfToken }, cache: "no-store", retry: 0 }).json();
      return schema.parse(result);
    } catch (error) { throw await safeFailure(error); }
  }

  /** 고정 두 리소스의 공통 HTTP 절차만 재사용하며 각 타입별 입력 계약은 유지한다. */
  function resource<T, C, U>(path: "accounts" | "categories", item: z.ZodType<T>, create: z.ZodType<C>, update: z.ZodType<U>) {
    return {
      /** @param includeArchived 보관 항목 포함 여부. @param signal 화면 이탈 시 조회를 취소한다. */
      list: (includeArchived: boolean, signal?: AbortSignal) => read(`${path}?includeArchived=${includeArchived}`, z.object({ items: z.array(item) }).strict(), signal),
      /** @param input 생성 의도의 멱등키와 필드. 자동 재시도하지 않는다. */
      create: async (input: C) => write(path, "POST", create.parse(input), item),
      /** @param id 대상 UUID. @param input 읽었던 version과 실제 변경 필드. */
      update: async (id: string, input: U) => write(`${path}/${LedgerIdSchema.parse(id)}`, "PATCH", update.parse(input), item),
      /** @param id 대상 UUID. @param input 충돌 검사용 expectedVersion. 보관은 삭제가 아니다. */
      archive: async (id: string, input: z.infer<typeof ArchiveAccountInputSchema>) => write(`${path}/${LedgerIdSchema.parse(id)}/archive`, "POST", (path === "accounts" ? ArchiveAccountInputSchema : ArchiveCategoryInputSchema).parse(input), item),
    };
  }
  return {
    profile: {
      get: (signal?: AbortSignal) => read("profile", ProfileSchema, signal),
      update: async (input: z.infer<typeof UpdateProfileInputSchema>) => write("profile", "PATCH", UpdateProfileInputSchema.parse(input), ProfileSchema),
    },
    accounts: resource("accounts", AccountSchema, CreateAccountInputSchema, UpdateAccountInputSchema),
    categories: resource("categories", CategorySchema, CreateCategoryInputSchema, UpdateCategoryInputSchema),
  };
}

/** @param error 임의의 전송/검증 오류. 원문을 제거하고 공개 계약 또는 고정 장애 코드만 남긴다. */
async function safeFailure(error: unknown): Promise<ApiClientError> {
  const safe = await apiError(error);
  return safe.code === "AUTH_PROVIDER_UNAVAILABLE"
    ? new ApiClientError(buildApiError({ code: "LEDGER_SERVICE_UNAVAILABLE", retryable: false }))
    : safe;
}

export type LedgerApi = ReturnType<typeof createLedgerApi>;
