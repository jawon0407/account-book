"use client";
import { useRef, useState, type FormEvent } from "react";
import { CreateTransactionInputSchema, type Account, type Category, type CreateTransactionInput } from "@account-book/contracts";
import { ApiClientError } from "../../../lib/http/api-client.js";
import { errorMessage, Feedback, needsReload } from "../feedback.js";
import styles from "../ledger.module.css";

type Props = Readonly<{ accounts: Account[]; categories: Category[]; onSave(value: CreateTransactionInput): Promise<unknown>; onSaved(): void; onClose(): void; onPending?(pending: boolean): void }>;
/** 브라우저 현지 달력의 오늘 날짜. UTC 변환으로 날짜가 하루 바뀌지 않게 한다. */
function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
/** @param error 공개 오류. 이 목록은 저장되지 않았음이 명확한 서버 거부만 포함한다. 알 수 없는 응답은 결과 미확정이다. */
function definitelyRejected(error: unknown): boolean {
  return error instanceof ApiClientError && ["LEDGER_VALIDATION_FAILED", "LEDGER_NOT_FOUND", "LEDGER_ACCOUNT_UNAVAILABLE", "LEDGER_CATEGORY_UNAVAILABLE", "AUTH_CSRF_REJECTED", "AUTH_RATE_LIMITED"].includes(error.code);
}
/** @param props 활성 선택지와 저장 콜백. 응답 유실 시 입력/키를 동결해 재전송을 동일 생성 의도로 유지한다. */
export function TransactionForm({ accounts, categories, onSave, onSaved, onClose, onPending }: Props) {
  const activeAccounts = accounts.filter(row => !row.archivedAt), activeCategories = categories.filter(row => !row.archivedAt);
  const [type, setType] = useState<"income" | "expense">("expense");
  const [accountId, setAccount] = useState(activeAccounts[0]?.id ?? "");
  const [categoryId, setCategory] = useState(activeCategories.find(row => row.kind === "expense")?.id ?? "");
  const [amount, setAmount] = useState(""), [date, setDate] = useState(today), [memo, setMemo] = useState("");
  const [error, setError] = useState<unknown>(), [validation, setValidation] = useState("");
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const busy = useRef(false), intent = useRef<CreateTransactionInput | null>(null);
  const available = activeCategories.filter(row => row.kind === type), missing = !activeAccounts.length || !available.length;
  /** @param event 폼 제출. 검증 후 전송하며 동시 클릭·자동 재시도를 차단한다. */
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy.current || missing || needsReload(error)) return;
    const parsed = CreateTransactionInputSchema.safeParse({ type, accountId, categoryId, amountKrw: /^\d+$/u.test(amount) ? Number(amount) : NaN, occurredOn: date, ...(memo.trim() ? { memo } : {}), idempotencyKey: intent.current?.idempotencyKey ?? crypto.randomUUID() });
    if (!parsed.success) { setValidation("계좌·카테고리·날짜와 1원 이상의 정수 금액을 확인해 주세요. 메모는 500자까지 입력할 수 있어요."); return; }
    const value = uncertain && intent.current ? intent.current : parsed.data;
    intent.current = value; busy.current = true; setPending(true); onPending?.(true); setError(undefined); setValidation("");
    try { await onSave(value); onSaved(); }
    catch (failure) { setError(failure); const unknown = !definitelyRejected(failure); setUncertain(unknown); if (!unknown) intent.current = null; }
    finally { busy.current = false; setPending(false); onPending?.(false); }
  }
  return <form className={styles.form} aria-label="거래 입력" onSubmit={event => { void submit(event); }}>
    <fieldset disabled={pending || uncertain}>
      <label htmlFor="transaction-type">거래 종류</label><select id="transaction-type" value={type} onChange={e => { const next = e.target.value as "income" | "expense"; setType(next); setCategory(activeCategories.find(row => row.kind === next)?.id ?? ""); }}><option value="expense">지출</option><option value="income">수입</option></select>
      <label htmlFor="transaction-account">계좌</label><select id="transaction-account" value={accountId} onChange={e => setAccount(e.target.value)}><option value="">계좌 선택</option>{activeAccounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <label htmlFor="transaction-category">카테고리</label><select id="transaction-category" value={categoryId} onChange={e => setCategory(e.target.value)}><option value="">카테고리 선택</option>{available.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <label htmlFor="transaction-amount">금액 (원)</label><input id="transaction-amount" inputMode="numeric" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)} />
      <label htmlFor="transaction-date">거래일</label><input id="transaction-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
      <label htmlFor="transaction-memo">메모 (선택)</label><textarea id="transaction-memo" rows={3} maxLength={500} autoComplete="off" value={memo} onChange={e => setMemo(e.target.value)} />
    </fieldset>
    {missing && <p className={styles.hint}>선택한 종류의 활성 계좌와 카테고리가 필요해요. <a href="/app">계좌 관리</a> · <a href="/app/categories">카테고리 관리</a></p>}
    {validation && <Feedback error message={validation} />}
    {error !== undefined && <Feedback error message={errorMessage(error)} />}
    {uncertain && <p className={styles.hint}>저장 여부가 미확정이라 입력을 잠갔어요. 같은 내용으로 재시도하면 중복 저장을 막을 수 있어요. 닫거나 새로고침했다면 새 거래를 입력하기 전에 목록을 확인해 주세요.</p>}
    <div className={styles.actions}><button type="button" className={styles.button} disabled={pending} onClick={onClose}>{uncertain ? "닫고 목록 확인" : "취소"}</button><button className={styles.primary} disabled={pending || missing || needsReload(error)}>{pending ? "저장 중…" : uncertain ? "같은 내용으로 재시도" : "저장하기"}</button></div>
  </form>;
}
