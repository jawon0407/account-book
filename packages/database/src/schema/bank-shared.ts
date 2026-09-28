import { sql } from "drizzle-orm/sql";
import { check, customType, pgSchema, type AnyPgColumn } from "drizzle-orm/pg-core";

export const appBank = pgSchema("app_bank");
export const bankBytea = customType<{ data: Buffer; driverData: Buffer }>({
  /** @returns 해시를 저장하는 PostgreSQL 바이너리 열 형식. 변환이나 DB 호출은 하지 않는다. */
  dataType: () => "bytea",
});

/** API 암호화 봉투의 저장 형식. 이 타입 선언만으로 원문이나 인증 태그를 검증하지 않는다. */
export type StoredBankEnvelope = Readonly<{ version: 1; kid: string; nonce: string; ciphertext: string; tag: string }>;

/** @param prefix 테이블 제약 이름 접두사. @param table 공급자·환경 열. @returns 허용된 공급자/환경만 저장하는 CHECK. */
export function bankScopeChecks(prefix: string, table: { provider: AnyPgColumn; environment: AnyPgColumn }) {
  return [
    check(`${prefix}_provider`, sql`${table.provider} = 'kftc'`),
    check(`${prefix}_environment`, sql`${table.environment} in ('fake', 'test', 'live')`),
  ];
}
