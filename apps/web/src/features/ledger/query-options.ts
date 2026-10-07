import { queryOptions } from "@tanstack/react-query";
import type { Account, Category } from "@account-book/contracts";
import type { LedgerApi } from "./api.js";

export type Resource = "accounts" | "categories";

/** @param userId 인증된 사용자 UUID. 사용자 사이에 서버 상태를 공유하지 않는 메모리 키다. */
export const coreKeys = (userId: string) => ["ledger", userId] as const;

/** @param userId 현재 계정. @param resource 고정 리소스. @param includeArchived 보관 필터. @param api 계정에 묶인 전송 경계. */
export function resourceQuery(userId: string, resource: Resource, includeArchived: boolean, api: LedgerApi) {
  return queryOptions({
    queryKey: [...coreKeys(userId), resource, includeArchived],
    queryFn: async ({ signal }): Promise<{ items: (Account | Category)[] }> => resource === "accounts" ? api.accounts.list(includeArchived, signal) : api.categories.list(includeArchived, signal),
    retry: false, gcTime: 0, staleTime: 0,
  });
}

/** @param userId 현재 계정. @param api 계정에 묶인 전송 경계. 프로필도 영구 저장하지 않는다. */
export function profileQuery(userId: string, api: LedgerApi) {
  return queryOptions({ queryKey: [...coreKeys(userId), "profile"], queryFn: ({ signal }) => api.profile.get(signal), retry: false, gcTime: 0, staleTime: 0 });
}
