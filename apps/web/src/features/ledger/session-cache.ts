import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../../lib/http/api-client.js";

/** @param error 공개 오류. 일반 장애와 재인증이 필요한 상태를 구분한다. */
export function isSessionError(error: unknown): boolean {
  return error instanceof ApiClientError && ["AUTH_SESSION_EXPIRED", "AUTH_SESSION_REFRESH_REQUIRED"].includes(error.code);
}

/** @param onExpired 인증 거부 시 화면을 즉시 가리는 콜백. 계정마다 새 메모리 캐시를 만든다. */
export function createPrivateClient(onExpired: () => void): QueryClient {
  const onError = (error: unknown) => { if (isSessionError(error)) onExpired(); };
  return new QueryClient({
    queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }),
    // 탭 복귀/재연결은 바깥 인증 조회가 먼저 확인한다. 이전 사용자 키로 먼저 조회하지 않는다.
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false }, mutations: { retry: false, gcTime: 0 } },
  });
}

/** @param client 현재 사용자 캐시. 진행 조회를 취소한 뒤 query/mutation 입력을 모두 제거한다. */
export async function purgePrivateClient(client: QueryClient): Promise<void> {
  await client.cancelQueries();
  client.clear();
}
