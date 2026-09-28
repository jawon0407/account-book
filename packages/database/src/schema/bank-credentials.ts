import { sql } from "drizzle-orm/sql";
import { check, foreignKey, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bankConnections } from "./bank-connections.js";
import { appBank, bankScopeChecks, type StoredBankEnvelope } from "./bank-shared.js";

/** 연결별 API 전용 암호화 자격정보. JSON 형식 검사는 SQL, 태그/AAD 검증은 API가 맡는다. */
export const bankConnectionCredentials = appBank.table("bank_connection_credentials", {
  connectionId: uuid("connection_id").primaryKey(),
  userId: uuid("user_id").notNull(),
  provider: text("provider", { enum: ["kftc"] }).notNull(),
  environment: text("environment", { enum: ["fake", "test", "live"] }).notNull(),
  encryptedProviderSubject: jsonb("encrypted_provider_subject").$type<StoredBankEnvelope>().notNull(),
  encryptedAccessToken: jsonb("encrypted_access_token").$type<StoredBankEnvelope>().notNull(),
  encryptedRefreshToken: jsonb("encrypted_refresh_token").$type<StoredBankEnvelope>(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
/** @param table 자격정보 열. @returns 암호문 형식·기한·소유자/환경 복합 FK 제약. */
(table) => [
  ...bankScopeChecks("bank_credentials", table),
  check("bank_credentials_envelopes", sql`app_bank.valid_token_envelope(${table.encryptedProviderSubject}) and app_bank.valid_token_envelope(${table.encryptedAccessToken}) and (${table.encryptedRefreshToken} is null or app_bank.valid_token_envelope(${table.encryptedRefreshToken}))`),
  check("bank_credentials_times", sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt}) and ${table.updatedAt} >= ${table.createdAt} and isfinite(${table.accessExpiresAt}) and ${table.accessExpiresAt} > ${table.createdAt} and (${table.refreshExpiresAt} is null or (isfinite(${table.refreshExpiresAt}) and ${table.refreshExpiresAt} > ${table.createdAt} and ${table.encryptedRefreshToken} is not null))`),
  foreignKey({ name: "bank_credentials_connection_fk", columns: [table.connectionId, table.userId, table.provider, table.environment], foreignColumns: [bankConnections.id, bankConnections.userId, bankConnections.provider, bankConnections.environment] }),
]).enableRLS();
