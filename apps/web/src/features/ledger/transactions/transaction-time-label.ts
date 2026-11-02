import type { Transaction } from "@account-book/contracts";

/** @param row 저장된 공개 snapshot. 브라우저 현재 위치 대신 기록 당시 시간대와 알고 있는 정밀도로 표시한다. */
export function transactionTimeLabel(row: Transaction): string {
  const time = row.time;
  if (!time || time.occurredAt === null) return "시간 미확인";
  try {
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: time.ledgerTimeZone,
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn",
      ...(time.precision === "minute" ? {} : { second: "2-digit" }),
      ...(time.precision === "millisecond" ? { fractionalSecondDigits: 3 } : {}) }).format(new Date(time.occurredAt));
    return `${clock} · ${time.ledgerTimeZone}${time.source === "device_received" ? " · 수신 시각 추정" : ""}`;
  } catch { return "시각 표시를 확인해 주세요"; }
}
