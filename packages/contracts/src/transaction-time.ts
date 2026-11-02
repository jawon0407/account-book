import { z } from "zod";
import { LocalDateSchema } from "./ledger-common.js";
import { LedgerTimeZoneSchema, UtcInstantSchema } from "./ledger-time.js";

const manualShape = {
  occurredAt: UtcInstantSchema,
  precision: z.enum(["minute", "second", "millisecond"]),
  sourceTimeZone: LedgerTimeZoneSchema.nullable(),
};
/** @param value 시각과 사용자가 아는 정밀도. @param context 오류 수집기. 숨겨진 초/밀리초를 버리지 않고 거부한다. */
function precision(value: { occurredAt: string; precision: "minute" | "second" | "millisecond" }, context: z.RefinementCtx) {
  const unit = { minute: 60_000, second: 1_000, millisecond: 1 }[value.precision];
  if (Date.parse(value.occurredAt) % unit !== 0)
    context.addIssue({ code: "custom", path: ["occurredAt"], message: "TIME_PRECISION_MISMATCH" });
}
/** 수기 입력은 source/장부 시간대를 받지 않는다. 인증된 서버가 각각 user/거주 이력으로 결정한다. */
export const ManualLedgerTimeInputSchema = z.object(manualShape).strict().superRefine(precision);
export type ManualLedgerTimeInput = z.infer<typeof ManualLedgerTimeInputSchema>;

/** 조회 전용 snapshot: 구조/정밀도는 검증하되 현재 tzdb로 과거 장부 날짜를 재계산하지 않는다. */
export const TransactionTimeSnapshotSchema = z.union([
  z.object({ occurredOn: LocalDateSchema, occurredAt: z.null(), precision: z.literal("day"),
    source: z.enum(["legacy_date", "user"]), sourceTimeZone: z.null(), ledgerTimeZone: LedgerTimeZoneSchema.nullable() }).strict(),
  z.object({ ...manualShape, occurredOn: LocalDateSchema, source: z.enum(["user", "notification", "device_received"]),
    ledgerTimeZone: LedgerTimeZoneSchema }).strict().superRefine(precision),
]);
export type TransactionTimeSnapshot = z.infer<typeof TransactionTimeSnapshotSchema>;
