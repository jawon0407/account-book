import { z } from "zod";
import { LocalDateSchema } from "./ledger-common.js";

/** IANA 이름 또는 UTC만 받는다. 기기의 기본 시간대·축약 이름·고정 오프셋을 추측하지 않는다. */
export const LedgerTimeZoneSchema = z.string().min(1).max(128)
  .regex(/^(?:UTC|[A-Za-z_]+\/[A-Za-z0-9_+\-/]+)$/u)
  .refine(zone => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; }
    catch { return false; }
  }, { message: "TIME_ZONE_INVALID" });

/** 비교 가능한 UTC 표기 하나만 허용한다. 형식 정규화·없는 시각 생성은 호출자의 책임이 아니다. */
export const UtcInstantSchema = z.iso.datetime({ precision: 3 }).length(24).refine(value => {
  try { return !value.startsWith("0000-") && new Date(value).toISOString() === value; }
  catch { return false; }
}, { message: "TIME_INSTANT_INVALID" });

const precisionMilliseconds = { minute: 60_000, second: 1_000, millisecond: 1 } as const;
const timedShape = {
  occurredAt: UtcInstantSchema,
  precision: z.enum(["minute", "second", "millisecond"]),
  source: z.enum(["user", "notification", "device_received"]),
  sourceTimeZone: LedgerTimeZoneSchema.nullable(),
};

/**
 * @param value 검증할 실제/추정 순간과 정밀도. 분/초 미만 자릿수를 버리지 않고 오류로 알린다.
 * @param context Zod 문제 수집기. 서버 도착 시각을 대신 넣거나 반올림하지 않는다.
 */
function checkPrecision(value: { occurredAt: string; precision: keyof typeof precisionMilliseconds }, context: z.RefinementCtx) {
  if (Date.parse(value.occurredAt) % precisionMilliseconds[value.precision] !== 0)
    context.addIssue({ code: "custom", path: ["occurredAt"], message: "TIME_PRECISION_MISMATCH" });
}

export const TimedLedgerEvidenceSchema = z.object(timedShape).strict().superRefine(checkPrecision);
export type TimedLedgerEvidence = z.infer<typeof TimedLedgerEvidenceSchema>;

const DateOnlyLedgerTimeSchema = z.object({
  occurredOn: LocalDateSchema,
  occurredAt: z.null(),
  precision: z.literal("day"),
  source: z.enum(["legacy_date", "user"]),
  sourceTimeZone: z.null(),
  ledgerTimeZone: LedgerTimeZoneSchema.nullable(),
}).strict();

/**
 * @param instant 명시적인 UTC 시각. @param timeZone 확정한 장부 시간대.
 * @returns ISO 달력 날짜. OS 기본 설정을 사용하지 않으며 서기 1~9999년 밖은 실패한다.
 */
function calendarDateAt(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, calendar: "iso8601", numberingSystem: "latn",
    era: "short", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  if (part("era") !== "AD") throw new RangeError("TIME_DATE_OUT_OF_RANGE");
  return LocalDateSchema.parse(`${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`);
}

const TimedLedgerTimeSchema = z.object({
  ...timedShape,
  occurredOn: LocalDateSchema,
  ledgerTimeZone: LedgerTimeZoneSchema,
}).strict().superRefine((value, context) => {
  checkPrecision(value, context);
  try {
    if (calendarDateAt(value.occurredAt, value.ledgerTimeZone) === value.occurredOn) return;
  } catch { /* 잘못된 날짜/시간대도 안전한 고정 검증 코드로 반환한다. */ }
  context.addIssue({ code: "custom", path: ["occurredOn"], message: "TIME_LEDGER_DATE_MISMATCH" });
});

/** 저장 전 새 snapshot의 무결성 계약. 이미 저장한 과거 날짜의 조회 시 재계산 용도가 아니다. */
export const LedgerTimeEvidenceSchema = z.union([DateOnlyLedgerTimeSchema, TimedLedgerTimeSchema]);
export type LedgerTimeEvidence = z.infer<typeof LedgerTimeEvidenceSchema>;

/** @param date 기존 DATE 값. 시간대·자정·초 단위 정확도를 추가하지 않고 그대로 보존한다. */
export function preserveDateOnlyLedgerTime(date: unknown): z.infer<typeof DateOnlyLedgerTimeSchema> {
  return DateOnlyLedgerTimeSchema.parse({
    occurredOn: date, occurredAt: null, precision: "day", source: "legacy_date",
    sourceTimeZone: null, ledgerTimeZone: null,
  });
}

/**
 * @param evidence 검증할 UTC 순간·근거·정밀도·출처 시간대.
 * @param ledgerTimeZone 서버 이력 조회 또는 사용자 확인으로 정한 장부 시간대.
 * @returns 장부 날짜가 함께 있는 새 snapshot. 인증/DB 저장/기존 거래 변경은 수행하지 않는다.
 */
export function buildTimedLedgerTime(evidence: unknown, ledgerTimeZone: unknown): z.infer<typeof TimedLedgerTimeSchema> {
  const value = TimedLedgerEvidenceSchema.parse(evidence), zone = LedgerTimeZoneSchema.parse(ledgerTimeZone);
  return TimedLedgerTimeSchema.parse({ ...value, ledgerTimeZone: zone, occurredOn: calendarDateAt(value.occurredAt, zone) });
}

/** 첫 기준은 null, 나머지는 UTC 오름차순. 초과/중복 이력을 잘라내거나 자동 정렬하지 않는다. */
// array.max만으로는 항목 검사를 막지 못한다. 값 복제/Intl 호출 전에 컨테이너 크기를 거부한다.
const BoundedHistorySchema = z.custom<unknown[]>(value =>
  Array.isArray(value) && value.length >= 1 && value.length <= 256,
{ message: "TIME_HISTORY_SIZE_INVALID" });
export const ResidenceTimeHistorySchema = BoundedHistorySchema.pipe(z.array(z.object({
  effectiveFrom: UtcInstantSchema.nullable(),
  timeZone: LedgerTimeZoneSchema,
}).strict()).min(1).max(256).superRefine((history, context) => {
  if (history[0]?.effectiveFrom !== null)
    context.addIssue({ code: "custom", path: [0, "effectiveFrom"], message: "TIME_HISTORY_BASELINE_REQUIRED" });
  for (let index = 1; index < history.length; index++) {
    const current = history[index]!.effectiveFrom, previous = history[index - 1]!.effectiveFrom;
    if (current === null || (previous !== null && current <= previous))
      context.addIssue({ code: "custom", path: [index, "effectiveFrom"], message: "TIME_HISTORY_ORDER_INVALID" });
  }
}));
export type ResidenceTimeHistory = z.infer<typeof ResidenceTimeHistorySchema>;
export type ResidenceTimeSelection =
  | { status: "resolved"; timeZone: string }
  | { status: "confirmation_required"; reason: "estimated_time" | "precision_crosses_change" };

/**
 * @param evidence 실제 또는 추정 발생 시각. 날짜만 아는 기록은 이 함수에 넣지 않는다.
 * @param history 인증 소유자의 거주 이력. 사용자/권한 확인은 DB 경계가 별도로 맡는다.
 * @returns 당시 적용 시간대 또는 확인 필요. 시각 구간은 시작 포함·끝 제외다.
 */
export function selectResidenceTimeZone(evidence: unknown, history: unknown): ResidenceTimeSelection {
  const value = TimedLedgerEvidenceSchema.parse(evidence), changes = ResidenceTimeHistorySchema.parse(history);
  if (value.source === "device_received" && changes.length > 1)
    return { status: "confirmation_required", reason: "estimated_time" };
  const start = Date.parse(value.occurredAt), end = start + precisionMilliseconds[value.precision];
  let timeZone = changes[0]!.timeZone;
  for (const change of changes.slice(1)) {
    const boundary = Date.parse(change.effectiveFrom!);
    if (boundary <= start) timeZone = change.timeZone;
    else {
      if (boundary < end) return { status: "confirmation_required", reason: "precision_crosses_change" };
      break;
    }
  }
  return { status: "resolved", timeZone };
}
