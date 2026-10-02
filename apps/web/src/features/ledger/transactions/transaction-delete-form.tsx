"use client";
import type { DeleteTransactionInput, Transaction } from "@account-book/contracts";
import { Feedback } from "../feedback.js";
import { useTransactionChange } from "./use-transaction-change.js";
import styles from "../ledger.module.css";
type Props = Readonly<{ row: Transaction; accountName: string; onDelete(value: DeleteTransactionInput): Promise<unknown>; onDeleted(): void; onClose(): void; onPending?(value: boolean): void }>;
/** @param props 삭제할 거래 snapshot과 실행 콜백. 내용을 확인한 명시적 클릭만 삭제 요청으로 보낸다. */
export function TransactionDeleteForm({ row, accountName, onDelete, onDeleted, onClose, onPending }: Props) {
  const change = useTransactionChange(onDeleted, onPending);
  const editable = row.kind === "income" || row.kind === "expense";
  return <div className={styles.form}>
    <p>{row.occurredOn} · {accountName} · {row.kind === "income" ? "수입" : "지출"} {new Intl.NumberFormat("ko-KR").format(row.amountKrw)}원</p>
    {row.memo && <p className={styles.memo}>{row.memo}</p>}
    <p>이 거래를 목록과 잔액에서 제외할까요? 기록은 서버에 보존되며 현재 화면에서는 되돌릴 수 없어요.</p>
    {change.message && <Feedback error message={change.message} />}
    <div className={styles.actions}><button type="button" className={styles.button} disabled={change.pending} onClick={onClose}>{change.blocked ? "닫고 목록 확인" : "취소"}</button><button type="button" className={styles.dangerButton} disabled={!editable || change.pending || change.blocked} onClick={() => { void change.run(() => onDelete({ expectedVersion: row.version })); }}>{change.pending ? "삭제 중…" : "삭제하기"}</button></div>
  </div>;
}
