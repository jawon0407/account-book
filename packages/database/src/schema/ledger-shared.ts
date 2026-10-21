import { sql } from "drizzle-orm/sql";
import { check, customType, foreignKey, pgSchema, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsersReference } from "./identity.js";

export const appLedger = pgSchema("finance");
export const ledgerBytea = customType<{ data: Buffer; driverData: Buffer }>({
  /** @returns SHA-256의 원시 32바이트를 보존하는 PostgreSQL 형식. */
  dataType: () => "bytea",
});
/** @param name 테이블명. @param userId 소유자 열. @returns Auth 삭제를 금융 데이터가 있을 때 거부하는 FK. */
export function ownerForeignKey(name: string, userId: AnyPgColumn) {
  return foreignKey({ name: `${name}_user_id_fkey`, columns: [userId], foreignColumns: [authUsersReference.id] }).onDelete("restrict");
}
/** @param name 테이블명. @param t 금액/날짜/메모 열. @returns 공개 계약과 같은 금융 값 경계. */
export function moneyChecks(name: string, t: { amountKrw: AnyPgColumn; occurredOn: AnyPgColumn; memo: AnyPgColumn }) {
  return [
    check(`${name}_amount`, sql`${t.amountKrw} between 1 and 9007199254740991`),
    check(`${name}_date`, sql`${t.occurredOn} between date '0001-01-01' and date '9999-12-31'`),
    check(`${name}_memo`, sql`${t.memo} is null or (${t.memo}=btrim(${t.memo}) and char_length(${t.memo}) between 1 and 500)`),
  ];
}
/** @param name 테이블명. @param t 버전·시각 열. @param marker archive 또는 delete 시각 열. @returns 변경 시각/안전 정수 제약. */
export function versionTimeChecks(name: string, t: { version: AnyPgColumn; createdAt: AnyPgColumn; updatedAt: AnyPgColumn }, marker: AnyPgColumn) {
  return [
    check(`${name}_version`, sql`${t.version} between 1 and 9007199254740991`),
    check(`${name}_times`, sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt}) and ${t.updatedAt}>=${t.createdAt} and (${marker} is null or (isfinite(${marker}) and ${marker}>=${t.createdAt}))`),
  ];
}
