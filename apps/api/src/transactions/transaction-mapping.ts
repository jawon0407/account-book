import { TransactionSchema, type Transaction } from "@account-book/contracts";
import { isoTimestamp, safeInteger } from "../core/serialization.js";

/** @param row SQL DATE를 text로 받은 DB 행. @returns 내부 소유자/열을 제거하고 금액 정확성·variant 계약을 확인한 거래. */
export function transaction(row: Record<string, unknown>): Transaction {
  return TransactionSchema.parse({ id: row.id, accountId: row.account_id, kind: row.kind,
    categoryId: row.category_id, transferId: row.transfer_id, amountKrw: safeInteger(row.amount_krw),
    occurredOn: row.occurred_on, memo: row.memo, version: safeInteger(row.version),
    deletedAt: row.deleted_at === null ? null : isoTimestamp(row.deleted_at),
    createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at),
    ...(row.kind === "opening_balance" ? { direction: row.opening_direction } : {}) });
}
