import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers.js";
import "./globals.css";

export const metadata: Metadata = {
  title: "Account Book",
  description: "PC와 모바일에서 안전하게 동기화하는 개인 가계부",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
