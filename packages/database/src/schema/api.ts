import { sql } from "drizzle-orm/sql";
import { check, customType, pgSchema, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  /** @returns Buffer 데이터를 저장할 PostgreSQL 바이너리 열 형식 이름. 쿼리를 실행하지 않는다. */
  dataType: () => "bytea",
});

const appPrivate = pgSchema("app_private");

/**
 * 위임 JWT 식별자의 단방향 해시와 만료 시각만 보관하는 테이블 정의다.
 * 기본키는 동시 삽입 중 한 번만 성공하게 하고, CHECK는 32바이트 해시와 생성 후 만료를 강제한다.
 * 이 선언만으로 테이블을 만들거나 만료된 행을 지우지는 않는다. 실제 변경은 SQL 마이그레이션이 담당한다.
 */
export const apiJwtReplays = appPrivate.table(
  "api_jwt_replays",
  {
    jtiDigest: bytea("jti_digest").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  /**
   * @param table - 위에서 선언한 재사용 차단 테이블 열들.
   * @returns 해시 길이와 만료 순서를 DB에서 검사할 제약 조건 목록.
   */
  (table) => [
    check("api_jwt_replays_digest_length", sql`octet_length(${table.jtiDigest}) = 32`),
    check("api_jwt_replays_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
