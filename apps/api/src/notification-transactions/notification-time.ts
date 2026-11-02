import {
  buildTimedLedgerTime,
  selectResidenceTimeZone,
  type NotificationIngestionInput,
  type TimedLedgerEvidence,
} from "@account-book/contracts";
import type { DbClient } from "../core/user-database.js";
import { CoreError } from "../core/core-error.js";
import { isoTimestamp } from "../core/serialization.js";

/**
 * @param client 소유자 RLS transaction. @param userId 인증 회원. @param value 최소 판독 시각 근거.
 * @returns 서버 도착 시각을 사용하지 않는 거주 기준 snapshot. 불명확한 시간대 변경은 확인 오류다.
 */
export async function resolveNotificationTime(
  client: DbClient,
  userId: string,
  value: NotificationIngestionInput,
) {
  const owner = await client.query(
    'select user_id from "user".users where user_id=$1 and deleted_at is null for update',
    [userId],
  );
  if (!owner.rows[0]) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
  const evidence: TimedLedgerEvidence = value.transactionTime
    ? { ...value.transactionTime, source: "notification" }
    : {
        occurredAt: value.receivedAt,
        precision: "millisecond",
        source: "device_received",
        sourceTimeZone: null,
      };
  if (evidence.source === "device_received") {
    // 수신 시각만 알 때는 과거 거주 변경을 숨기지 않는다. 2행이면 변경이 있었음이 확실하다.
    const history = await client.query(
      'select time_zone from "user".ledger_time_history where user_id=$1 order by revision desc limit 2',
      [userId],
    );
    if (!history.rows[0])
      throw new CoreError("LEDGER_TIME_SETUP_REQUIRED", 409);
    if (history.rows.length > 1)
      throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409);
    try {
      return buildTimedLedgerTime(evidence, history.rows[0].time_zone);
    } catch {
      throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409);
    }
  }
  const previous = await client.query(
    `select time_zone from "user".ledger_time_history where user_id=$1
    and (effective_from is null or effective_from<=$2::timestamptz) order by revision desc limit 1`,
    [userId, evidence.occurredAt],
  );
  if (!previous.rows[0]) throw new CoreError("LEDGER_TIME_SETUP_REQUIRED", 409);
  const next = await client.query(
    `select time_zone,effective_from from "user".ledger_time_history
    where user_id=$1 and effective_from>$2::timestamptz order by effective_from limit 1`,
    [userId, evidence.occurredAt],
  );
  const selection = selectResidenceTimeZone(evidence, [
    { timeZone: previous.rows[0].time_zone, effectiveFrom: null },
    ...next.rows.map((row) => ({
      timeZone: row.time_zone,
      effectiveFrom: isoTimestamp(row.effective_from),
    })),
  ]);
  if (selection.status !== "resolved")
    throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409);
  try {
    return buildTimedLedgerTime(evidence, selection.timeZone);
  } catch {
    throw new CoreError("LEDGER_TIME_REVIEW_REQUIRED", 409);
  }
}
