"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLedgerUser } from "../session.js";
import { Feedback, Loading } from "../feedback.js";
import { createBankApi } from "./api.js";
import { statusCopy, bankMessage } from "./status-copy.js";
import styles from "../ledger.module.css";
import bankStyles from "./bank.module.css";

/** @param requestId 서버 페이지가 검증한 불투명 ID. URL은 권한이 아니며 BFF가 매번 본인을 확인한다. */
export function BankResultPage({ requestId }: Readonly<{ requestId: string | null }>) {
  return <><div className={styles.heading}><div><h1>은행 연결 결과</h1><p>연결을 시작한 계정과 브라우저에서 확인해 주세요.</p></div></div>
    {requestId === null ? <><Feedback error message="연결 결과 주소가 올바르지 않아요. 은행 연결 화면에서 다시 시작해 주세요." /><a className={styles.button} href="/app/bank-connections">은행 연결로</a></> : <Result key={requestId} requestId={requestId} />}
  </>;
}
/** @param requestId 검증된 요청 ID. 한 번의 사용자 확인 후에는 조회만 허용한다. */
function Result({ requestId }: Readonly<{ requestId: string }>) {
  const userId = useLedgerUser(), [api] = useState(() => createBankApi(userId));
  const client = useQueryClient(), sent = useRef(false);
  const active = useRef(false);
  // 로그아웃/계정 변경으로 화면이 닫힌 뒤에는 지워진 사용자 캐시를 다시 만들지 않는다.
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const queryKey = ["bank-connection", userId, requestId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => api.status(requestId, signal), retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const complete = useMutation({ mutationFn: () => api.complete(requestId), retry: false, gcTime: 0,
    onSuccess: result => { if (active.current) client.setQueryData(queryKey, result); } });
  /** GET/마운트 효과는 완료를 실행하지 않는다. 동기 ref로 빠른 이중 클릭도 차단한다. */
  function confirm() { if (sent.current || query.isFetching || query.isError || query.data?.status !== "awaiting_completion") return; sent.current = true; complete.mutate(); }
  if (query.isPending) return <section className={styles.panel}><Loading label="은행 연결 상태를 확인하는 중…" /></section>;
  const state = query.data?.status, copy = state ? statusCopy[state] : null;
  const uncertain = sent.current && state === "awaiting_completion";
  return <section className={`${styles.panel} ${styles.profile} ${styles.form} ${bankStyles.content}`} aria-label="연결 상태" aria-busy={query.isFetching || complete.isPending}>
    {query.isError ? <Feedback error message={bankMessage(query.error)} /> : copy && <><h2 aria-live="polite">{uncertain ? "처리 결과를 확인해 주세요" : copy[0]}</h2><p>{uncertain ? "완료 요청은 이미 보냈어요. 상태 새로고침으로 결과를 확인하거나 새 연결을 시작해 주세요." : copy[1]}</p></>}
    {complete.isPending && <p role="status">연결을 확인하고 있어요. 화면을 닫지 말아 주세요…</p>}
    {complete.isError && state !== "connected" && <Feedback error message={bankMessage(complete.error)} />}
    {query.isFetching && <p role="status">최신 상태를 확인하고 있어요…</p>}
    <div className={styles.actions}>
      <a className={styles.button} href="/app/bank-connections">은행 연결로</a>
      {state !== "connected" && <button className={styles.button} disabled={query.isFetching || complete.isPending} onClick={() => { void query.refetch(); }}>상태 새로고침</button>}
      {!query.isError && state === "awaiting_completion" && !sent.current && <button className={styles.primary} disabled={query.isFetching} onClick={confirm}>연결 확인</button>}
      {state === "connected" && <a className={styles.primary} href="/app">내 계좌로</a>}
    </div>
  </section>;
}
