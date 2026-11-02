import { unavailable } from "./core-error.js";

/** @param value PostgreSQL bigint/numeric의 정수 문자열. @returns 정밀도 손실 없는 JSON 정수, 초과 시 고정 오류. */
export function safeInteger(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "bigint") || !/^-?\d+$/u.test(String(value))) throw unavailable();
  const number = BigInt(value);
  if (number < BigInt(Number.MIN_SAFE_INTEGER) || number > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
  return Number(number);
}
/** @param value pg 드라이버의 timestamp Date. @returns 유효한 ISO UTC 시각. */
export function isoTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable();
  return value.toISOString();
}
/** @param rows 조회 행. @returns 최대 1000개 전체 목록; 잘린 목록을 정상 결과로 숨기지 않는다. */
export function boundedRows<T>(rows: T[]): T[] {
  if (rows.length > 1000) throw unavailable();
  return rows;
}
