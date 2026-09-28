import { sql } from "drizzle-orm/sql";
import { check, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appBank, bankScopeChecks } from "./bank-shared.js";

/** 사용자에게 귀속된 은행 연결 메타데이터. 실제 계좌번호·토큰은 포함하지 않는다. */
export const bankConnections = appBank.table("bank_connections", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  provider: text("provider", { enum: ["kftc"] }).notNull(),
  environment: text("environment", { enum: ["fake", "test", "live"] }).notNull(),
  status: text("status", { enum: ["active", "revoked", "reauth_required"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
},
/** @param table 연결 열. @returns 소유자 복합키·공급자·상태·유한 시각 제약. */
(table) => [
  unique("bank_connections_binding").on(table.id, table.userId, table.provider, table.environment),
  ...bankScopeChecks("bank_connections", table),
  check("bank_connections_status", sql`${table.status} in ('active', 'revoked', 'reauth_required')`),
  check("bank_connections_times", sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt}) and ${table.updatedAt} >= ${table.createdAt} and (${table.consentExpiresAt} is null or isfinite(${table.consentExpiresAt}))`),
]).enableRLS();
