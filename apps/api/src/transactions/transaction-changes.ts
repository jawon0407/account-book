import { TransactionTombstoneSchema, type UpdateTransactionInput } from "@account-book/contracts";
import type { DbClient } from "../core/user-database.js";
import { CoreError } from "../core/core-error.js";
import { transaction } from "./transaction-mapping.js";
import { changedTime } from "./transaction-time.js";

/** @param client 본인 RLS transaction. @param userId 인증 소유자. @param id 거래 UUID. @param version 화면이 읽은 버전. 한 행을 잠가 경쟁 수정·삭제를 직렬화한다. */
async function locked(client: DbClient, userId: string, id: string, version: number) {
  const result = await client.query("select *,occurred_on::text as occurred_on from finance.transaction_history where user_id=$1 and id=$2 and deleted_at is null for update", [userId, id]);
  if (!result.rows[0]) throw new CoreError("LEDGER_NOT_FOUND", 404);
  const row = transaction(result.rows[0]);
  if (row.kind !== "income" && row.kind !== "expense") throw new CoreError("LEDGER_VALIDATION_FAILED", 400);
  if (row.version !== version) throw new CoreError("LEDGER_VERSION_CONFLICT", 409);
  return row;
}

/** @param client 사용자 transaction. @param userId 소유자. @param id 대상. @param value 검증한 변경값. 생략은 유지, 명시 null은 관계·상대명·메모를 비운다. */
export async function updateTransaction(client: DbClient, userId: string, id: string, value: UpdateTransactionInput) {
  const row = await locked(client, userId, id, value.expectedVersion);
  const time = await changedTime(client, userId, row, value);
  const accountId = value.accountId === undefined ? row.accountId : value.accountId;
  const categoryId = value.categoryId === undefined ? row.categoryId : value.categoryId, kind = value.type ?? row.kind;
  // 보관된 기존 참조는 유지 가능하다. 새 참조만 DB trigger와 같은 계좌 → 분류 잠금 순서로 검사한다.
  if (accountId !== null && accountId !== row.accountId) {
    const result = await client.query("select archived_at from finance.accounts where user_id=$1 and id=$2 for update", [userId, accountId]);
    if (!result.rows[0]) throw new CoreError("LEDGER_NOT_FOUND", 404);
    if (result.rows[0].archived_at !== null) throw new CoreError("LEDGER_ACCOUNT_UNAVAILABLE", 409);
  }
  if (categoryId !== null && (categoryId !== row.categoryId || kind !== row.kind)) {
    const result = await client.query("select kind,archived_at from finance.transaction_categories where user_id=$1 and id=$2 for update", [userId, categoryId]);
    if (!result.rows[0]) throw new CoreError("LEDGER_NOT_FOUND", 404);
    if (result.rows[0].archived_at !== null || result.rows[0].kind !== kind) throw new CoreError("LEDGER_CATEGORY_UNAVAILABLE", 409);
  }
  const result = await client.query(`update finance.transaction_history set account_id=$3,category_id=$4,kind=$5,amount_krw=$6,occurred_on=$7,memo=$8,counterparty_name=$9,
    occurred_at=$10,time_precision=$11,time_source=$12,source_time_zone=$13,ledger_time_zone=$14
    where user_id=$1 and id=$2 returning *,occurred_on::text as occurred_on`,
  [userId, id, accountId, categoryId, kind, value.amountKrw ?? row.amountKrw, time.occurredOn, value.memo === undefined ? row.memo : value.memo, value.counterpartyName === undefined ? row.counterpartyName : value.counterpartyName,
    time.occurredAt,time.precision,time.source,time.sourceTimeZone,time.ledgerTimeZone]);
  return transaction(result.rows[0]);
}

/** @param client 사용자 transaction. @param userId 소유자. @param id 대상. @param version 기대 버전. 물리 삭제 없이 목록·잔액에서 제외하고 최소 tombstone만 반환한다. */
export async function deleteTransaction(client: DbClient, userId: string, id: string, version: number) {
  await locked(client, userId, id, version);
  const result = await client.query("update finance.transaction_history set deleted_at=clock_timestamp() where user_id=$1 and id=$2 returning *,occurred_on::text as occurred_on", [userId, id]);
  const row = transaction(result.rows[0]);
  return TransactionTombstoneSchema.parse({ id: row.id, version: row.version, deletedAt: row.deletedAt });
}
