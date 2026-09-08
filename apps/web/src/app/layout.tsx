import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers.js";
import "./globals.css";

export const metadata: Metadata = {
  title: "Account Book",
  description: "PC와 모바일에서 안전하게 동기화하는 개인 가계부",
};

/**
 * 모든 페이지에 한국어 HTML 문서와 공통 서버 상태 문맥을 제공한다.
 * Providers가 자식 화면의 TanStack Query 인스턴스를 공유한다.
 * @param props - children은 Next.js가 현재 URL에 맞춰 전달한 페이지다.
 * @returns html/body와 Providers를 포함한 루트 UI. 직접 요청하거나 저장하지 않는다.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
