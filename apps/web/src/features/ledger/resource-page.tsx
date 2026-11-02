"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, Category } from "@account-book/contracts";
import { useLedgerApi, useLedgerUser } from "./session.js";
import { coreKeys, resourceQuery, type Resource } from "./query-options.js";
import { ResourceDialog } from "./resource-dialog.js";
import { Feedback, Loading } from "./feedback.js";
import styles from "./ledger.module.css";

const kindLabels: Readonly<Record<string, string>> = { bank: "은행 계좌", cash: "현금", card: "카드", income: "수입", expense: "지출" };
const krw = new Intl.NumberFormat("ko-KR");

/** @param resource 계좌 또는 분류. 조회/필터/버전 스냅샷 선택을 담당하고 편집 폼은 분리한다. */
export function ResourcePage({ resource }: Readonly<{ resource: Resource }>) {
  const userId = useLedgerUser();
  const client = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<{ item?: Account | Category; archive?: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const query = useQuery(resourceQuery(userId, resource, includeArchived, useLedgerApi()));
  const account = resource === "accounts";
  const noun = account ? "계좌" : "카테고리";
  const items = (query.data?.items ?? []).filter((item) => kind === "all" || item.kind === kind);
  /** 요청 성공 후 모든 보관 필터 캐시를 무효화한다. 실제 서버 응답 전에 성공을 예측하지 않는다. */
  function saved() {
    setSelected(null); setMessage("저장했어요. 최신 목록을 불러옵니다.");
    void client.invalidateQueries({ queryKey: [...coreKeys(userId), resource] });
  }
  return <>
    <div className={styles.heading}><div><h1>{account ? "내 계좌" : "카테고리"}</h1><p>{account ? "현금부터 은행 계좌, 카드까지. 장부에서 사용할 계좌를 관리하세요." : "나에게 맞는 수입·지출 기준으로 거래를 정리하세요."}</p></div><button className={styles.primary} onClick={() => { setMessage(""); setSelected({}); }}><span aria-hidden="true">+ </span>{noun} 추가</button></div>
    {message && <Feedback message={message} />}
    <section className={styles.panel} aria-label={`${noun} 목록`}>
      <div className={styles.toolbar}><h2>등록한 {noun}</h2><label><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />보관 항목 포함</label><label>종류 필터<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">모든 종류</option>{(account ? ["bank", "cash", "card"] : ["income", "expense"]).map((value) => <option value={value} key={value}>{kindLabels[value]}</option>)}</select></label><button className={styles.button} disabled={query.isFetching} onClick={() => { void query.refetch(); }}>새로고침</button></div>
      {query.isPending ? <Loading /> : query.isError ? <div className={styles.loading}><Feedback error message="목록을 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요." /></div> : <>
        {query.isFetching && <p className={styles.hint} role="status">최신 정보를 확인하는 중…</p>}
        {items.length === 0 ? <div className={styles.empty}><h3>{query.data?.items.length ? "조건에 맞는 항목이 없어요" : `등록한 ${noun}가 없어요`}</h3><p>{query.data?.items.length ? "종류 필터를 바꿔 확인해 보세요." : account ? "첫 계좌를 추가하고 장부 정리를 시작해 보세요." : "식비, 교통비, 월급 등 나만의 분류를 추가해 보세요."}</p><button className={styles.button} onClick={() => setSelected({})}>{noun} 추가</button></div> : <div className={styles.tableScroll} role="region" aria-label={`${noun} 표`} tabIndex={0}><table className={styles.table}><thead><tr><th scope="col">{noun} 이름</th><th scope="col">종류</th><th scope="col" className={styles.number}>{account ? "장부 잔액" : "정렬 순서"}</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className={styles.name}>{item.name}</td><td>{kindLabels[item.kind]}</td><td className={styles.number}>{"currentBalanceKrw" in item ? `${krw.format(item.currentBalanceKrw)}원` : item.sortOrder}</td><td><span className={`${styles.badge} ${item.archivedAt ? styles.archived : ""}`}>{item.archivedAt ? "보관됨" : "사용 중"}</span></td><td><div className={styles.rowActions}><button className={styles.button} disabled={Boolean(item.archivedAt) || query.isFetching} onClick={() => setSelected({ item })}>수정</button><button className={styles.button} disabled={Boolean(item.archivedAt) || query.isFetching} onClick={() => setSelected({ item, archive: true })}>보관</button></div></td></tr>)}</tbody></table></div>}
      </>}
    </section>
    {account && <p className={styles.hint}>장부 잔액은 기록된 거래를 기준으로 계산돼요. 은행의 실제 잔액과는 다를 수 있어요.</p>}
    {selected && <ResourceDialog resource={resource} {...selected} onClose={() => setSelected(null)} onSaved={saved} />}
  </>;
}
