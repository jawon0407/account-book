import { Temporal } from "@js-temporal/polyfill";
import {
  LedgerTimeZoneSchema,
  LocalDateSchema,
  ManualLedgerTimeInputSchema,
  type ManualLedgerTimeInput,
} from "@account-book/contracts";
import { ManualInputError } from "./manual-input-error";

export type ClockChoice = "earlier" | "later";
export type ClockResolution =
  | { status: "resolved"; time: ManualLedgerTimeInput }
  | {
      status: "ambiguous";
      options: Array<{
        choice: ClockChoice;
        offset: string;
        occurredAt: string;
      }>;
    };

/**
 * @param date 거래 발생 지역의 날짜. @param clock 사용자가 입력한 HH:mm.
 * @param zone 명시적 IANA 시간대. @param choice DST 중복 시 사용자가 선택한 앞/뒤 순간.
 * @returns 정확한 분 단위 UTC 또는 선택 후보. OS 기본 시간대로 해석하거나 gap을 자동 보정하지 않는다.
 */
export function resolveManualClock(
  date: string,
  clock: string,
  zone: string,
  choice?: ClockChoice,
): ClockResolution {
  if (
    !LocalDateSchema.safeParse(date).success ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(clock)
  )
    throw new ManualInputError("clock", "TIME_INVALID");
  if (!LedgerTimeZoneSchema.safeParse(zone).success)
    throw new ManualInputError("sourceTimeZone", "TIME_ZONE_INVALID");
  try {
    const plain = Temporal.PlainDateTime.from(`${date}T${clock}:00`, {
      overflow: "reject",
    });
    const earlier = plain.toZonedDateTime(zone, { disambiguation: "earlier" });
    const later = plain.toZonedDateTime(zone, { disambiguation: "later" });
    // gap의 earlier/later는 다른 벽시계 시각으로 이동한다. 사용자가 적은 시각과 같아야 한다.
    if (
      !earlier.toPlainDateTime().equals(plain) ||
      !later.toPlainDateTime().equals(plain)
    )
      throw new ManualInputError("clock", "TIME_DOES_NOT_EXIST");
    const toUtc = (value: Temporal.ZonedDateTime) =>
      value.toInstant().toString({ fractionalSecondDigits: 3 });
    if (
      earlier.epochNanoseconds !== later.epochNanoseconds &&
      choice === undefined
    )
      return {
        status: "ambiguous",
        options: [
          {
            choice: "earlier",
            offset: earlier.offset,
            occurredAt: toUtc(earlier),
          },
          { choice: "later", offset: later.offset, occurredAt: toUtc(later) },
        ],
      };
    const parsed = ManualLedgerTimeInputSchema.safeParse({
      occurredAt: toUtc(choice === "later" ? later : earlier),
      precision: "minute",
      sourceTimeZone: zone,
    });
    if (!parsed.success)
      throw new ManualInputError("clock", "TIME_PRECISION_UNSUPPORTED");
    return { status: "resolved", time: parsed.data };
  } catch (error) {
    if (error instanceof ManualInputError) throw error;
    throw new ManualInputError("clock", "TIME_INVALID");
  }
}
