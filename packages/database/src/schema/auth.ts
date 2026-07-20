import { sql } from "drizzle-orm/sql";
import {
  check,
  customType,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const appPrivate = pgSchema("app_private");

export const authSessions = appPrivate.table(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    selectorHash: bytea("selector_hash").notNull().unique(),
    userId: uuid("user_id").notNull(),
    supabaseSessionId: uuid("supabase_session_id").notNull(),
    encryptedAccessToken: jsonb("encrypted_access_token").notNull(),
    encryptedRefreshToken: jsonb("encrypted_refresh_token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationPendingAt: timestamp("revocation_pending_at", { withTimezone: true }),
    rotationVersion: integer("rotation_version").notNull().default(0),
  },
  (table) => [
    check("auth_sessions_selector_hash_length", sql`octet_length(${table.selectorHash}) = 32`),
    check("auth_sessions_rotation_version_nonnegative", sql`${table.rotationVersion} >= 0`),
    check("auth_sessions_absolute_expiry", sql`${table.absoluteExpiresAt} > ${table.createdAt}`),
    uniqueIndex("auth_sessions_provider_session_unique")
      .on(table.supabaseSessionId)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const oauthTransactions = appPrivate.table(
  "oauth_transactions",
  {
    id: uuid("id").primaryKey(),
    stateHash: bytea("state_hash").notNull().unique(),
    interactionHash: bytea("interaction_hash").notNull().unique(),
    provider: text("provider", { enum: ["google", "kakao", "naver"] }).notNull(),
    encryptedPkceVerifier: jsonb("encrypted_pkce_verifier").notNull(),
    returnPath: text("return_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    check("oauth_transactions_state_hash_length", sql`octet_length(${table.stateHash}) = 32`),
    check("oauth_transactions_interaction_hash_length", sql`octet_length(${table.interactionHash}) = 32`),
    check("oauth_transactions_provider", sql`${table.provider} in ('google', 'kakao', 'naver')`),
    check("oauth_transactions_return_path", sql`${table.returnPath} like '/%' and ${table.returnPath} not like '//%' and char_length(${table.returnPath}) between 1 and 2048`),
    check("oauth_transactions_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const authRecoveryTransactions = appPrivate.table(
  "auth_recovery_transactions",
  {
    id: uuid("id").primaryKey(),
    interactionHash: bytea("interaction_hash").notNull().unique(),
    userId: uuid("user_id").notNull(),
    encryptedRecoveryToken: jsonb("encrypted_recovery_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    check("auth_recovery_transactions_interaction_hash_length", sql`octet_length(${table.interactionHash}) = 32`),
    check("auth_recovery_transactions_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const authRateLimits = appPrivate.table(
  "auth_rate_limits",
  {
    fingerprint: bytea("fingerprint").notNull(),
    kind: text("kind", { enum: ["sign_in", "sign_up", "password_reset", "oauth_start"] }).notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    count: integer("count").notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.fingerprint, table.kind, table.windowStartedAt] }),
    check("auth_rate_limits_fingerprint_length", sql`octet_length(${table.fingerprint}) = 32`),
    check("auth_rate_limits_kind", sql`${table.kind} in ('sign_in', 'sign_up', 'password_reset', 'oauth_start')`),
    check("auth_rate_limits_window_seconds_positive", sql`${table.windowSeconds} > 0`),
    check("auth_rate_limits_count_nonnegative", sql`${table.count} >= 0`),
  ],
);
