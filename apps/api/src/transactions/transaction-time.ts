import { buildTimedLedgerTime, preserveDateOnlyLedgerTime, selectResidenceTimeZone,
  type ManualLedgerTimeInput, type TransactionTimeSnapshot, type Transaction, type UpdateTransactionInput } from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import { isoTimestamp } from "../core/serialization.js";
import type { DbClient } from "../core/user-database.js";

/** @param date 사용자가 정한 날짜. 자정이나 거주 시간대를 추측하지 않는 신규 날짜-only snapshot. */
export function manualDateOnly(date: string): TransactionTimeSnapshot {
  return { ...preserveDateOnlyLedgerTime(date), source: "user" };
}
/**
 * @param client 사용자 RLS transaction. @param userId 인증 소유자. @param date 사용자가 확인한 장부 날짜.
 * @param time 수기 UTC 시각/정밀도. 거주 변경과 같은 profile 잠금 아래 최대 두 구간만 읽는다.
 * @returns 당시 거주 시간대의 snapshot. history 개수에 따른 잘림이나 현재 기기 시간대 추측은 없다.
 */
export async function resolveManualTime(client: DbClient, userId: string, date: string, time?: ManualLedgerTimeInput): Promise<TransactionTimeSnapshot> {
  if (time === undefined) return manualDateOnly(date);
  const owner = await client.query('select user_id from "user".users where user_id=$1 and deleted_at is null for update', [userId]);
  if (!owner.rows[0]) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
  const previous = await client.query(`select time_zone from "user".ledger_time_history
    where user_id=$1 and (effective_from is null or effective_from<=$2::timestamptz) order by revision desc limit 1`, [userId, time.occurredAt]);
  if (!previous.rows[0]) throw new CoreError("LEDGER_TIME_SETUP_REQUIRED", 409);
  const next = await client.query(`select time_zone,effective_from from "user".ledger_time_history
    where user_id=$1 and effective_from>$2::timestamptz order by effective_from limit 1`, [userId, time.occurredAt]);
  const history = [{ timeZone: previous.rows[0].time_zone, effectiveFrom: null },
    ...next.rows.map(row => ({ timeZone: row.time_zone, effectiveFrom: isoTimestamp(row.effective_from) }))];
  const evidence = { ...time, source: "user" as const }, selection = selectResidenceTimeZone(evidence, history);
  if (selection.status !== "resolved") throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409);
  let snapshot: TransactionTimeSnapshot;
  try { snapshot = buildTimedLedgerTime(evidence, selection.timeZone); }
  catch { throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409); }
  if (snapshot.occurredOn !== date) throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409);
  return snapshot;
}
/** @param client 사용자 DB 연결. @param userId 소유자. @param row 잠근 원본. @param value 명시한 수정 필드. 생략은 과거 snapshot 보존이다. */
export async function changedTime(client: DbClient, userId: string, row: Transaction, value: UpdateTransactionInput): Promise<TransactionTimeSnapshot> {
  const date = value.occurredOn ?? row.occurredOn;
  if (value.time === null) return manualDateOnly(date);
  if (value.time !== undefined) return resolveManualTime(client, userId, date, value.time);
  if (date === row.occurredOn) return row.time ?? preserveDateOnlyLedgerTime(row.occurredOn);
  if (row.time?.occurredAt != null) throw new CoreError("LEDGER_TIME_CHANGE_REQUIRED", 409);
  return manualDateOnly(date);
}
