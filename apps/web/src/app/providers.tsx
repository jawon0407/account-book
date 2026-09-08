"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * 한 앱 마운트에서 공유할 메모리 서버 상태 관리자를 생성한다.
 * 조회와 변경 요청 모두 라이브러리 자동 재시도를 꺼 중복 요청을 방지한다.
 * @returns 새 QueryClient. 호출만으로 네트워크 요청이나 영구 저장은 하지 않는다.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/**
 * 자식 컴포넌트가 같은 QueryClient를 사용하도록 React 문맥을 제공한다.
 * useState의 초기화 함수로 한 마운트 동안 인스턴스를 유지한다.
 * @param props - children은 query/mutation을 사용할 하위 화면과 컴포넌트다.
 * @returns QueryClientProvider로 감싼 자식 UI. 별도 영구 저장소를 만들지 않는다.
 */
export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
