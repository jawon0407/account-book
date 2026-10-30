import { sql } from "drizzle-orm/sql";
import { bigint, check, date, foreignKey, index, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { ledgerAccounts } from "./ledger-accounts.js";
import { appLedger, moneyChecks, ownerForeignKey } from "./ledger-shared.js";

/** 두 계좌의 이동을 묶는 header. 두 자식 행의 검사는 SQL deferred trigger가 담당한다. */
export const ledgerTransfers = appLedger.table("account_transfers", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull(), fromAccountId: uuid("from_account_id").notNull(), toAccountId: uuid("to_account_id").notNull(),
  amountKrw: bigint("amount_krw", { mode: "bigint" }).notNull(), occurredOn: date("occurred_on").notNull(), memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 이체 열. @returns 같은 소유자의 서로 다른 계좌를 참조하는 제약. */
t => [
  ownerForeignKey("transfers",t.userId), unique("transfers_binding").on(t.id,t.userId),
  foreignKey({ name: "transfers_from_fk", columns: [t.fromAccountId,t.userId], foreignColumns: [ledgerAccounts.id,ledgerAccounts.userId] }),
  foreignKey({ name: "transfers_to_fk", columns: [t.toAccountId,t.userId], foreignColumns: [ledgerAccounts.id,ledgerAccounts.userId] }),
  check("transfers_accounts", sql`${t.fromAccountId}<>${t.toAccountId}`), ...moneyChecks("transfers",t), check("transfers_time", sql`isfinite(${t.createdAt})`),
  index("transfers_owner_time").on(t.userId,t.createdAt.desc(),t.id.desc()),
]).enableRLS();
