import { sql } from "drizzle-orm/sql";
import { bigint, check, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appLedger, ownerForeignKey, versionTimeChecks } from "./ledger-shared.js";

/** 사용자별 수입/지출 카테고리. 이름 중복은 허용하고 UUID로 구분한다. */
export const ledgerCategories = appLedger.table("transaction_categories", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull(),
  kind: text("kind", { enum: ["income", "expense"] }).notNull(), name: text("name").notNull(), sortOrder: integer("sort_order").notNull().default(0),
  version: bigint("version", { mode: "bigint" }).notNull().default(1n), archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 분류 열. @returns 소유자·종류 복합키와 분류 입력/정렬 경계. */
t => [
  ownerForeignKey("categories",t.userId), unique("categories_binding").on(t.id,t.userId,t.kind),
  check("categories_kind", sql`${t.kind} in ('income','expense')`), check("categories_name", sql`${t.name}=btrim(${t.name}) and char_length(${t.name}) between 1 and 50`),
  check("categories_sort", sql`${t.sortOrder} between 0 and 10000`), ...versionTimeChecks("categories",t,t.archivedAt), index("categories_owner_sort").on(t.userId,t.archivedAt,t.sortOrder),
]).enableRLS();
