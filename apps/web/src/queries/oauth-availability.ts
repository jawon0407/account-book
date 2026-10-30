import { OAuthAvailabilitySchema } from "@account-book/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { apiClient, apiError, type BrowserApiClient } from "../lib/http/api-client.js";

/**
 * 같은 출처의 공개 목록을 검증하며 공급자 URL/키는 받지 않는다.
 * @param http ky 클라이언트 또는 HTTP 테스트 대역.
 * @returns 메모리 전용 조회 설정. 실패 시 재시도하지 않고 UI가 비활성 처리한다.
 */
export function oauthAvailabilityOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return queryOptions({ queryKey: ["auth", "oauth-availability"], retry: false, staleTime: 0,
    queryFn: async () => {
      try { return OAuthAvailabilitySchema.parse(await (http as BrowserApiClient).get("auth/providers").json<unknown>()); }
      catch (error) { throw await apiError(error); }
    },
  });
}

/** 인수 없이 공급자 상태를 구독한다. 재조회 중/오류 시 과거 활성 목록도 버튼에 사용하지 않는다. */
export function useOAuthAvailability() {
  const query = useQuery(oauthAvailabilityOptions());
  return {
    enabledProviders: query.isFetching || query.isError ? [] : query.data?.enabledProviders ?? [],
    availability: query.isError ? "unavailable" as const : query.isPending || query.isFetching ? "loading" as const : "ready" as const,
  };
}
