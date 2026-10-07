import { sql } from "drizzle-orm/sql";
import { check, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appLedger, ledgerBytea, ownerForeignKey } from "./ledger-shared.js";

/** 성공한 생성 요청 결과. 응답 계약 검증·동일 fingerprint 재시도 반환은 repository의 후속 책임이다. */
export const ledgerIdempotencyRequests = appLedger.table("request_deduplication", {
  userId: uuid("user_id").notNull(), operation: text("operation", { enum: ["create_account", "set_opening_balance", "create_category", "create_transaction", "create_transfer"] }).notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(), requestFingerprint: ledgerBytea("request_fingerprint").notNull(), responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param t 요청 기록 열. @returns 사용자/작업별 키 격리와 저장 크기·해시 형식 제한. */
t => [
  ownerForeignKey("idempotency_requests",t.userId), primaryKey({ name: "idempotency_requests_pkey", columns: [t.userId,t.operation,t.idempotencyKey] }),
  check("idempotency_operation", sql`${t.operation} in ('create_account','set_opening_balance','create_category','create_transaction','create_transfer')`),
  check("idempotency_key_v4", sql`${t.idempotencyKey}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`),
  check("idempotency_fingerprint", sql`octet_length(${t.requestFingerprint})=32`),
  check("idempotency_response", sql`jsonb_typeof(${t.responseSnapshot})='object' and octet_length(${t.responseSnapshot}::text)<=16384`), check("idempotency_time", sql`isfinite(${t.createdAt})`),
]).enableRLS();
