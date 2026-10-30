import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LedgerSession } from "../../features/ledger/session.js";

export const metadata: Metadata = { title: "내 장부 · Account Book", robots: { index: false, follow: false } };

/** @param children 경로별 관리 화면. 서버 비밀값 없이 클라이언트 인증 경계 안에 배치한다. */
export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <LedgerSession>{children}</LedgerSession>;
}
