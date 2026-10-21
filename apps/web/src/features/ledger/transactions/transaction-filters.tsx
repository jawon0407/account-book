"use client";
import { useState, type FormEvent } from "react";
import { TransactionListQuerySchema, type Account, type Category, type TransactionListQuery } from "@account-book/contracts";
import { Feedback } from "../feedback.js";
import styles from "../ledger.module.css";
export const transactionLabels = { income: "수입", expense: "지출", transfer_in: "이체 입금", transfer_out: "이체 출금", opening_balance: "시작 잔액" };
const empty = { from: "", to: "", accountId: "", categoryId: "", type: "" };
/** @param props 조회 선택지와 적용 콜백. 입력 중에는 요청하지 않고 제출 때만 strict 필터를 적용한다. */
export function TransactionFilters({ accounts, categories, onApply }: Readonly<{ accounts: Account[]; categories: Category[]; onApply(value: TransactionListQuery): void }>) {
  const [draft, setDraft] = useState(empty), [error, setError] = useState(false);
  /** @param event 조회 폼. 역전 날짜나 잘못된 값을 서버에 보내지 않는다. */
  function submit(event: FormEvent) {
    event.preventDefault(); const parsed = TransactionListQuerySchema.safeParse(Object.fromEntries(Object.entries(draft).filter(([,value]) => value !== "")));
    setError(!parsed.success); if (parsed.success) onApply(parsed.data);
  }
  return <form className={styles.filters} aria-label="거래 필터" onSubmit={submit}>
    <label>시작일<input type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
    <label>종료일<input type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
    <label>계좌 필터<select value={draft.accountId} onChange={e => setDraft({ ...draft, accountId: e.target.value })}><option value="">모든 계좌</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}{row.archivedAt ? " (보관)" : ""}</option>)}</select></label>
    <label>카테고리 필터<select value={draft.categoryId} onChange={e => setDraft({ ...draft, categoryId: e.target.value })}><option value="">모든 카테고리</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}{row.archivedAt ? " (보관)" : ""}</option>)}</select></label>
    <label>종류 필터<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}><option value="">모든 종류</option>{Object.entries(transactionLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className={styles.actions}><button className={styles.primary}>조회하기</button><button className={styles.button} type="button" onClick={() => { setDraft(empty); setError(false); onApply({}); }}>필터 초기화</button></div>
    {error && <Feedback error message="조회 시작일이 종료일보다 늦지 않은지 확인해 주세요." />}
  </form>;
}
