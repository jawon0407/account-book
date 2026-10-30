import { sql } from "drizzle-orm/sql";
import { bigint, check, index, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appLedger, ownerForeignKey, versionTimeChecks } from "./ledger-shared.js";

/** 수동 장부 계좌. 실제 은행 연결 자격정보나 중복된 잔액 캐시를 포함하지 않는다. */
export const ledgerAccounts = appLedger.table("accounts", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull(),
  kind: text("kind", { enum: ["cash", "bank", "card"] }).notNull(), name: text("name").notNull(),
  currency: text("currency", { enum: ["KRW"] }).notNull().default("KRW"), version: bigint("version", { mode: "bigint" }).notNull().default(1n),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 계좌 열. @returns 소유자 연결·이름·종류·통화·버전·보관 시각 제약. */
t => [
  ownerForeignKey("accounts", t.userId), unique("accounts_binding").on(t.id,t.userId),
  check("accounts_kind", sql`${t.kind} in ('cash','bank','card')`), check("accounts_name", sql`${t.name}=btrim(${t.name}) and char_length(${t.name}) between 1 and 80`),
  check("accounts_currency", sql`${t.currency}='KRW'`), ...versionTimeChecks("accounts",t,t.archivedAt), index("accounts_owner_archive").on(t.userId,t.archivedAt),
]).enableRLS();
