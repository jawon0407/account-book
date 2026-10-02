import { sql } from "drizzle-orm/sql";
import { check, index, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { appBank, bankBytea } from "./bank-shared.js";

/** 원문 주소 대신 지문별 최근 승인 시각만 보관한다. API는 직접 조회/수정하지 않는다. */
export const bankRequestLimits = appBank.table("bank_request_limits", {
  scope: text("scope", { enum: ["start", "callback"] }).notNull(),
  keyDigest: bankBytea("key_digest").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).array().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
},
/** @param table 지문·승인 시각 열. @returns 복합키/고정 크기 제약과 만료 정리 인덱스. */
(table) => [
  primaryKey({ name: "bank_request_limits_pkey", columns: [table.scope, table.keyDigest] }),
  check("bank_limits_scope", sql`${table.scope} in ('start','callback')`),
  check("bank_limits_digest", sql`octet_length(${table.keyDigest})=32`),
  check("bank_limits_hits", sql`array_ndims(${table.acceptedAt})=1 and array_lower(${table.acceptedAt},1)=1 and cardinality(${table.acceptedAt}) between 1 and case when ${table.scope}='start' then 5 else 60 end and array_position(${table.acceptedAt},null) is null`),
  check("bank_limits_expiry", sql`isfinite(${table.expiresAt}) and ${table.expiresAt}>${table.acceptedAt}[cardinality(${table.acceptedAt})]`),
  index("bank_limits_expiry_idx").on(table.expiresAt),
]).enableRLS();
