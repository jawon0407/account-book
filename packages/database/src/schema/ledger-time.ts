import { sql } from "drizzle-orm/sql";
import { check, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

/** @returns 거래 순간과 그 근거. 날짜-only 기본값은 자정·시간대를 만들어 넣지 않는다. */
export function ledgerTimeColumns() {
  return {
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    timePrecision: text("time_precision", { enum: ["day", "minute", "second", "millisecond"] }).notNull().default("day"),
    timeSource: text("time_source", { enum: ["legacy_date", "user", "notification", "device_received"] }).notNull().default("legacy_date"),
    sourceTimeZone: text("source_time_zone"), ledgerTimeZone: text("ledger_time_zone"),
  };
}

/** @param t 시각 근거 열. @returns 정밀도/근거 CHECK. 날짜 snapshot 입력 검사는 SQL trigger가 담당한다. */
export function ledgerTimeChecks(t: { occurredAt: AnyPgColumn; timePrecision: AnyPgColumn; timeSource: AnyPgColumn; sourceTimeZone: AnyPgColumn; ledgerTimeZone: AnyPgColumn }) {
  return [
    check("transactions_time_shape", sql`(${t.timePrecision}='day' and ${t.occurredAt} is null and ${t.timeSource} in ('legacy_date','user') and ${t.sourceTimeZone} is null) or (${t.timePrecision} in ('minute','second','millisecond') and ${t.occurredAt} is not null and ${t.timeSource} in ('user','notification','device_received') and ${t.ledgerTimeZone} is not null)`),
    check("transactions_time_zones", sql`(${t.sourceTimeZone} is null or "user".is_ledger_time_zone(${t.sourceTimeZone})) and (${t.ledgerTimeZone} is null or "user".is_ledger_time_zone(${t.ledgerTimeZone}))`),
    check("transactions_time_instant", sql`${t.occurredAt} is null or (isfinite(${t.occurredAt}) and ${t.occurredAt} between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00' and ${t.occurredAt}=date_trunc(case ${t.timePrecision} when 'minute' then 'minute' when 'second' then 'second' else 'milliseconds' end,${t.occurredAt},'UTC'))`),
  ];
}
