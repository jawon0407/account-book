"use client";
import { usePathname } from "next/navigation.js";
import type { ReactNode } from "react";
import styles from "./ledger.module.css";

/** @param children 경로별 장부 화면. @param onLogout 서버 세션 종료 및 메모리 정리를 시작한다. */
export function LedgerShell({ children, onLogout }: Readonly<{ children: ReactNode; onLogout(): void }>) {
  const path = usePathname();
  return <div className={styles.workspace}>
    <a href="#ledger-main" className={styles.skip}>본문으로 건너뛰기</a>
    <header className={styles.header}><div className={styles.headerInner}>
      <a href="/app" className={styles.brand}><span className={styles.brandMark} aria-hidden="true">▤</span>Account Book</a>
      <span className={styles.hint}>나의 돈을, 나의 기준으로.</span>
      <button className={styles.button} style={{ marginLeft: "auto" }} onClick={onLogout}>로그아웃</button>
    </div></header>
    <nav className={styles.nav} aria-label="장부 메뉴">{[["/app", "계좌"], ["/app/transactions", "거래 내역"], ["/app/categories", "카테고리"], ["/app/bank-connections", "은행 연결"], ["/app/profile", "내 정보"]].map(([href, label]) => <a key={href} href={href!} aria-current={path === href || (href === "/app/bank-connections" && path.startsWith(href + "/")) ? "page" : undefined}>{label}</a>)}</nav>
    <main id="ledger-main" className={styles.main}>{children}</main>
  </div>;
}
