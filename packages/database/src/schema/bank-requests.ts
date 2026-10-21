import { sql } from "drizzle-orm/sql";
import { check, foreignKey, index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bankConnections } from "./bank-connections.js";
import { appBank, bankBytea, bankScopeChecks, type StoredBankEnvelope } from "./bank-shared.js";

/** 짧은 수명의 연결 요청. state/proof는 해시, 인가 코드는 잠깐 보관하는 암호문뿐이다. */
export const bankConnectionRequests = appBank.table("bank_connection_requests", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  provider: text("provider", { enum: ["kftc"] }).notNull(),
  environment: text("environment", { enum: ["fake", "test", "live"] }).notNull(),
  channel: text("channel", { enum: ["web"] }).notNull(),
  stateDigest: bankBytea("state_digest").notNull().unique("bank_connection_requests_state_digest_key"),
  proofDigest: bankBytea("proof_digest").notNull().unique("bank_connection_requests_proof_digest_key"),
  status: text("status", { enum: ["awaiting_callback", "awaiting_completion", "exchanging", "connected", "cancelled", "expired", "failed"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  callbackReceivedAt: timestamp("callback_received_at", { withTimezone: true }),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  encryptedCode: jsonb("encrypted_code").$type<StoredBankEnvelope>(),
  connectionId: uuid("connection_id"),
},
/** @param table 요청 열. @returns TTL·상태/코드 결속·복합 FK·세션별 미완료1건 규칙. 현재 시각 만료 처리는 후속 함수 책임이다. */
(table) => [
  ...bankScopeChecks("bank_requests", table),
  check("bank_requests_channel", sql`${table.channel} = 'web'`),
  check("bank_requests_digests", sql`octet_length(${table.stateDigest}) = 32 and octet_length(${table.proofDigest}) = 32`),
  check("bank_requests_status", sql`${table.status} in ('awaiting_callback', 'awaiting_completion', 'exchanging', 'connected', 'cancelled', 'expired', 'failed')`),
  check("bank_requests_ttl", sql`isfinite(${table.createdAt}) and isfinite(${table.expiresAt}) and ${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '300 seconds'`),
  check("bank_requests_callback", sql`
    (${table.callbackReceivedAt} is null or (isfinite(${table.callbackReceivedAt}) and ${table.callbackReceivedAt} >= ${table.createdAt} and ${table.callbackReceivedAt} < ${table.expiresAt}))
    and (${table.status} <> 'awaiting_callback' or ${table.callbackReceivedAt} is null)
    and (${table.status} not in ('awaiting_completion','exchanging','connected') or ${table.callbackReceivedAt} is not null)`),
  check("bank_requests_code", sql`
    (${table.status} = 'awaiting_completion' and ${table.encryptedCode} is not null and app_bank.valid_token_envelope(${table.encryptedCode})
      and ${table.codeExpiresAt} is not null and isfinite(${table.codeExpiresAt}) and ${table.callbackReceivedAt} is not null
      and ${table.codeExpiresAt} > ${table.callbackReceivedAt} and ${table.codeExpiresAt} <= ${table.callbackReceivedAt} + interval '60 seconds' and ${table.codeExpiresAt} <= ${table.expiresAt})
    or (${table.status} <> 'awaiting_completion' and ${table.encryptedCode} is null and ${table.codeExpiresAt} is null)`),
  check("bank_requests_result", sql`(${table.status} = 'connected') = (${table.connectionId} is not null)`),
  foreignKey({ name: "bank_requests_connection_fk", columns: [table.connectionId, table.userId, table.provider, table.environment], foreignColumns: [bankConnections.id, bankConnections.userId, bankConnections.provider, bankConnections.environment] }),
  uniqueIndex("bank_requests_one_pending_session").on(table.userId, table.sessionId).where(sql`${table.status} in ('awaiting_callback','awaiting_completion','exchanging')`),
  index("bank_requests_pending_deadline_idx").on(sql`least(${table.expiresAt},${table.codeExpiresAt})`).where(sql`${table.status} in ('awaiting_callback','awaiting_completion','exchanging')`),
]).enableRLS();
