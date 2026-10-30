import { infiniteQueryOptions } from "@tanstack/react-query";
import { TransactionListQuerySchema, type TransactionListQuery } from "@account-book/contracts";
import { coreKeys } from "../query-options.js";
import type { TransactionsApi } from "./api.js";

/** @param userId 현재 계정. @param filters 목록 필터. @param api 계정 결속 전송. 커서는 각 pageParam에 보관하며 영구 캐시는 쓰지 않는다. */
export function transactionQuery(userId: string, filters: TransactionListQuery, api: TransactionsApi) {
  const { cursor: initialPageParam, ...query } = TransactionListQuerySchema.parse(filters);
  return infiniteQueryOptions({ queryKey: [...coreKeys(userId), "transactions", query], initialPageParam: initialPageParam as string | undefined,
    queryFn: ({ pageParam, signal }) => api.list({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false, gcTime: 0, staleTime: 0 });
}
