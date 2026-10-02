"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLedgerUser } from "../session.js";
import { Feedback } from "../feedback.js";
import { createBankApi } from "./api.js";
import { bankMessage } from "./status-copy.js";
import styles from "../ledger.module.css";
import bankStyles from "./bank.module.css";

/** @param enabled 서버가 정한 준비 여부. A6 검증 전 기본 false; 브라우저 설정으로 활성화하지 않는다. */
export function BankStartPage({ enabled = false }: Readonly<{ enabled?: boolean }>) {
  const userId = useLedgerUser(), [api] = useState(() => createBankApi(userId));
  const sent = useRef(false);
  const active = useRef(false);
  // 인증 경계가 닫히면 이전 요청의 응답으로 은행 화면을 열지 않는다. StrictMode 재실행도 허용한다.
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const start = useMutation({ mutationFn: () => api.start(), retry: false, gcTime: 0,
    onSuccess: result => { if (active.current) window.location.assign(result.authorizationUrl); } });
  /** 한 화면에서 한 번만 시작한다. 결과가 불확실하면 새로고침 후 새 의도로 시작한다. */
  function connect() { if (!enabled || sent.current) return; sent.current = true; start.mutate(); }
  return <>
    <div className={styles.heading}><div><h1>은행 연결</h1><p>계좌 조회 동의를 통해 잔액과 입출금 내역을 확인하기 위한 연결이에요.</p></div></div>
    <section className={`${styles.panel} ${styles.profile} ${styles.form} ${bankStyles.content}`} aria-label="은행 연결 안내">
      <h2>내 계좌를 안전하게 연결해요</h2>
      <p>장부에 직접 추가한 계좌와 은행 연결은 별개예요. 은행 비밀번호를 이 앱에 입력하지 않으며, 송금·출금 기능은 제공하지 않아요.</p>
      {!enabled && <Feedback message="은행 연결은 준비 중이에요. 공식 테스트 연동을 확인한 후 사용할 수 있어요." />}
      <p className={styles.hint}>자동 수집은 아직 제공하지 않아요. 지금은 계좌와 거래를 직접 기록할 수 있어요.</p>
      {start.isError && <Feedback error message={bankMessage(start.error)} />}
      {start.isPending && <p role="status">안전한 은행 인증 화면을 준비하고 있어요…</p>}
      <div className={styles.actions}><a className={styles.button} href="/app">내 계좌로</a><button className={styles.primary} disabled={!enabled || start.isPending || sent.current} onClick={connect}>{!enabled ? "은행 연결 준비 중" : start.isPending ? "연결 준비 중…" : "은행 연결 시작"}</button></div>
    </section>
  </>;
}
