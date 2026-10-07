"use client";
import { useState, type FormEvent } from "react";
import { UpdateTransactionInputSchema, type Account, type Category, type Transaction, type UpdateTransactionInput } from "@account-book/contracts";
import { Feedback } from "../feedback.js";
import { useTransactionChange } from "./use-transaction-change.js";
import styles from "../ledger.module.css";
type Props = Readonly<{ row: Transaction; accounts: Account[]; categories: Category[]; onSave(value: UpdateTransactionInput): Promise<unknown>; onSaved(): void; onClose(): void; onPending?(value: boolean): void }>;

/** @param props 편집을 시작할 때의 거래 snapshot과 참조 목록. 원본 버전은 저장/재조회 전까지 바꾸지 않는다. */
export function TransactionEditForm({ row, accounts, categories, onSave, onSaved, onClose, onPending }: Props) {
  const [type, setType] = useState<"income" | "expense">(row.kind === "income" ? "income" : "expense");
  const [accountId, setAccount] = useState(row.accountId), [categoryId, setCategory] = useState(row.categoryId ?? "");
  const [amount, setAmount] = useState(String(row.amountKrw)), [date, setDate] = useState(row.occurredOn), [memo, setMemo] = useState(row.memo ?? ""), [validation, setValidation] = useState("");
  const change = useTransactionChange(onSaved, onPending);
  const availableAccounts = accounts.filter(item => !item.archivedAt || item.id === row.accountId);
  const availableCategories = categories.filter(item => item.kind === type && (!item.archivedAt || (item.id === row.categoryId && type === row.kind)));
  const editable = row.kind === "income" || row.kind === "expense";
  /** @param event 제출 이벤트. 공용 strict 계약으로 검사하고 빈 메모는 명시적인 null로 지운다. */
  function submit(event: FormEvent) {
    event.preventDefault(); if (!editable || change.pending || change.blocked) return;
    const parsed = UpdateTransactionInputSchema.safeParse({ expectedVersion: row.version, type, accountId, categoryId, amountKrw: /^\d+$/u.test(amount) ? Number(amount) : NaN, occurredOn: date, memo: memo.trim() ? memo : null });
    if (!parsed.success) { setValidation("계좌·카테고리·날짜와 1원 이상의 정수 금액을 확인해 주세요. 메모는 500자까지 입력할 수 있어요."); return; }
    setValidation(""); void change.run(() => onSave(parsed.data));
  }
  if (!editable) return <Feedback error message="이체와 시작 잔액은 일반 거래로 수정할 수 없어요." />;
  return <form className={styles.form} aria-label="거래 수정" onSubmit={submit}>
    <fieldset disabled={change.pending || change.blocked}>
      <label htmlFor="edit-type">거래 종류</label><select id="edit-type" value={type} onChange={e => { const next = e.target.value as "income" | "expense"; setType(next); setCategory(categories.find(item => item.kind === next && !item.archivedAt)?.id ?? ""); }}><option value="expense">지출</option><option value="income">수입</option></select>
      <label htmlFor="edit-account">계좌</label><select id="edit-account" value={accountId} onChange={e => setAccount(e.target.value)}><option value="">계좌 선택</option>{availableAccounts.map(item => <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? " (보관됨)" : ""}</option>)}</select>
      <label htmlFor="edit-category">카테고리</label><select id="edit-category" value={categoryId} onChange={e => setCategory(e.target.value)}><option value="">카테고리 선택</option>{availableCategories.map(item => <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? " (보관됨)" : ""}</option>)}</select>
      <label htmlFor="edit-amount">금액 (원)</label><input id="edit-amount" inputMode="numeric" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)} />
      <label htmlFor="edit-date">거래일</label><input id="edit-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
      <label htmlFor="edit-memo">메모 (선택)</label><textarea id="edit-memo" rows={3} maxLength={500} autoComplete="off" value={memo} onChange={e => setMemo(e.target.value)} />
    </fieldset>
    {validation && <Feedback error message={validation} />}{change.message && <Feedback error message={change.message} />}
    <div className={styles.actions}><button type="button" className={styles.button} disabled={change.pending} onClick={onClose}>{change.blocked ? "닫고 목록 확인" : "취소"}</button><button className={styles.primary} disabled={change.pending || change.blocked}>{change.pending ? "저장 중…" : "저장하기"}</button></div>
  </form>;
}
