import { sql } from "drizzle-orm/sql";
import {
  boolean,
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appLedger, ledgerBytea, ownerForeignKey } from "./ledger-shared.js";
import { ledgerTransactions } from "./ledger-transactions.js";

/** 알림 원문/금액 사본 없는 불변 접수 근거. 같은 소유자의 원장에만 연결된다. */
export const notificationReceipts = appLedger
  .table(
    "notification_receipts",
    {
      userId: uuid("user_id").notNull(),
      eventId: uuid("event_id").notNull(),
      transactionId: uuid("transaction_id").notNull(),
      requestFingerprint: ledgerBytea("request_fingerprint").notNull(),
      sourceApp: text("source_app").notNull(),
      parserVersion: text("parser_version").notNull(),
      receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
      timeNeedsReview: boolean("time_needs_review").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .default(sql`clock_timestamp()`),
    },
    /** @param t 최소 접수 열. @returns 소유자 결합·동일 ID 제한·시간과 판독 버전 검사. */
    (t) => [
      ownerForeignKey("notification_receipts", t.userId),
      primaryKey({ columns: [t.userId, t.eventId] }),
      foreignKey({
        name: "notification_receipts_transaction_fk",
        columns: [t.transactionId, t.userId],
        foreignColumns: [ledgerTransactions.id, ledgerTransactions.userId],
      }).onDelete("restrict"),
      index("notification_receipts_transaction").on(t.transactionId, t.userId),
      check(
        "notification_receipts_event_v4",
        sql`${t.eventId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
      ),
      check(
        "notification_receipts_fingerprint",
        sql`octet_length(${t.requestFingerprint})=32`,
      ),
      check(
        "notification_receipts_parser",
        sql`${t.sourceApp}='com.kbstar.kbbank' and ${t.parserVersion}='kb-v1'`,
      ),
      check(
        "notification_receipts_time",
        sql`isfinite(${t.createdAt}) and isfinite(${t.receivedAt}) and ${t.receivedAt} between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00' and ${t.receivedAt}=date_trunc('milliseconds',${t.receivedAt},'UTC')`,
      ),
    ],
  )
  .enableRLS();
