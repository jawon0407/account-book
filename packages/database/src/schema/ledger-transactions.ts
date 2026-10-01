import { sql } from "drizzle-orm/sql";
import { bigint, check, date, foreignKey, index, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ledgerAccounts } from "./ledger-accounts.js";
import { ledgerCategories } from "./ledger-categories.js";
import { ledgerTransfers } from "./ledger-transfers.js";
import { appLedger, moneyChecks, ownerForeignKey, versionTimeChecks } from "./ledger-shared.js";

/** 돈의 움직임 한 행. bigint는 API가 안전 정수 범위를 확인한 뒤 응답 number로 변환해야 한다. */
export const ledgerTransactions = appLedger.table("transaction_history", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull(), accountId: uuid("account_id").notNull(),
  kind: text("kind", { enum: ["income", "expense", "transfer_out", "transfer_in", "opening_balance"] }).notNull(),
  amountKrw: bigint("amount_krw", { mode: "bigint" }).notNull(), occurredOn: date("occurred_on").notNull(), memo: text("memo"),
  categoryId: uuid("category_id"), transferId: uuid("transfer_id"), openingDirection: text("opening_direction", { enum: ["asset", "liability"] }),
  version: bigint("version", { mode: "bigint" }).notNull().default(1n), deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 원장 열. @returns 행 종류별 필수 관계, 금액 경계, 시작 잔액 중복 제한 및 목록 인덱스. */
t => [
  ownerForeignKey("transactions",t.userId), unique("transactions_binding").on(t.id,t.userId),
  foreignKey({ name: "transactions_account_fk", columns: [t.accountId,t.userId], foreignColumns: [ledgerAccounts.id,ledgerAccounts.userId] }),
  foreignKey({ name: "transactions_category_fk", columns: [t.categoryId,t.userId,t.kind], foreignColumns: [ledgerCategories.id,ledgerCategories.userId,ledgerCategories.kind] }),
  foreignKey({ name: "transactions_transfer_fk", columns: [t.transferId,t.userId], foreignColumns: [ledgerTransfers.id,ledgerTransfers.userId] }),
  check("transactions_shape", sql`(${t.kind} in ('income','expense') and ${t.categoryId} is not null and ${t.transferId} is null and ${t.openingDirection} is null) or (${t.kind} in ('transfer_out','transfer_in') and ${t.categoryId} is null and ${t.transferId} is not null and ${t.openingDirection} is null and ${t.deletedAt} is null) or (${t.kind}='opening_balance' and ${t.categoryId} is null and ${t.transferId} is null and ${t.openingDirection} is not null and ${t.openingDirection} in ('asset','liability'))`),
  ...moneyChecks("transactions",t), ...versionTimeChecks("transactions",t,t.deletedAt),
  uniqueIndex("transactions_one_opening").on(t.accountId).where(sql`${t.kind}='opening_balance' and ${t.deletedAt} is null`),
  index("transactions_owner_date").on(t.userId,t.occurredOn.desc(),t.id.desc()).where(sql`${t.deletedAt} is null`),
  index("transactions_account_date").on(t.userId,t.accountId,t.occurredOn.desc(),t.id.desc()).where(sql`${t.deletedAt} is null`),
  index("transactions_category_date").on(t.userId,t.categoryId,t.occurredOn.desc(),t.id.desc()).where(sql`${t.deletedAt} is null`),
  index("transactions_transfer").on(t.transferId),
]).enableRLS();
