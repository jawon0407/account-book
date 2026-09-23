import { sql } from "drizzle-orm/sql";
import {
  bigint,
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
  /** @returns 해시 등 Buffer 데이터를 담는 PostgreSQL 바이너리 열 형식 이름. DB 호출은 없다. */
  dataType: () => "bytea",
});

const appPrivate = pgSchema("app_private");

export const authUserSecurityState = appPrivate.table(
  "auth_user_security_state",
  {
    userId: uuid("user_id").primaryKey(),
    minimumAcceptedIat: bigint("minimum_accepted_iat", { mode: "number" }).notNull().default(0),
  },
  /**
   * @param table - 사용자 보안 상태 열.
   * @returns 최소 허용 발급 시각이 음수가 아님을 보장할 제약.
   */
  (table) => [
    check("auth_user_security_state_minimum_iat_nonnegative", sql`${table.minimumAcceptedIat} >= 0`),
  ],
);

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
  /**
   * @param table - 암호화된 토큰과 만료·철회 상태를 담은 세션 열.
   * @returns 해시 길이, 회전 버전, 만료 순서와 활성 제공자 세션의 중복을 막을 DB 제약.
   */
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
  /**
   * @param table - OAuth 왕복 요청의 해시·암호화된 PKCE·복귀 경로 열.
   * @returns 해시 길이, 허용 제공자·복귀 경로, 만료 순서를 제한할 DB 제약.
   */
  (table) => [
    check("oauth_transactions_state_hash_length", sql`octet_length(${table.stateHash}) = 32`),
    check("oauth_transactions_interaction_hash_length", sql`octet_length(${table.interactionHash}) = 32`),
    check("oauth_transactions_provider", sql`${table.provider} in ('google', 'kakao', 'naver')`),
    check("oauth_transactions_return_path", sql`${table.returnPath} in ('/app', '/settings/security')`),
    check("oauth_transactions_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const authRecoveryTransactions = appPrivate.table(
  "auth_recovery_transactions",
  {
    id: uuid("id").primaryKey(),
    interactionHash: bytea("interaction_hash").notNull().unique(),
    encryptedPkceVerifier: jsonb("encrypted_pkce_verifier"),
    userId: uuid("user_id"),
    encryptedRecoveryToken: jsonb("encrypted_recovery_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    exchangeClaimedAt: timestamp("exchange_claimed_at", { withTimezone: true }),
    exchangedAt: timestamp("exchanged_at", { withTimezone: true }),
    passwordUpdateClaimedAt: timestamp("password_update_claimed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  /**
   * 비밀번호 복구가 코드 교환 전/후 중 유효한 상태에만 머물고 처리 시각이 역행하지 않게 한다.
   * @param table - 복구 시도 식별자와 각 단계의 암호문·처리 시각 열.
   * @returns 해시·만료·필드 조합·단계별 시간 순서에 대한 DB 제약. 복구를 실행하지는 않는다.
   */
  (table) => [
    check("auth_recovery_transactions_interaction_hash_length", sql`octet_length(${table.interactionHash}) = 32`),
    check("auth_recovery_transactions_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
    check("auth_recovery_transactions_stage", sql`(
      (${table.encryptedPkceVerifier} is not null and ${table.userId} is null and ${table.encryptedRecoveryToken} is null and ${table.exchangedAt} is null and ${table.passwordUpdateClaimedAt} is null and ${table.consumedAt} is null)
      or
      (${table.encryptedPkceVerifier} is null and ${table.userId} is not null and ${table.encryptedRecoveryToken} is not null and ${table.exchangeClaimedAt} is not null and ${table.exchangedAt} is not null and ((${table.passwordUpdateClaimedAt} is null and ${table.consumedAt} is null) or ${table.passwordUpdateClaimedAt} is not null))
    )`),
    check("auth_recovery_transactions_stage_order", sql`(${table.exchangeClaimedAt} is null or ${table.exchangeClaimedAt} >= ${table.createdAt}) and (${table.exchangedAt} is null or ${table.exchangedAt} >= ${table.exchangeClaimedAt}) and (${table.passwordUpdateClaimedAt} is null or ${table.passwordUpdateClaimedAt} >= ${table.exchangedAt}) and (${table.consumedAt} is null or (${table.passwordUpdateClaimedAt} is not null and ${table.consumedAt} >= ${table.passwordUpdateClaimedAt}))`),
  ],
);

export const emailConfirmationTransactions = appPrivate.table(
  "email_confirmation_transactions",
  {
    id: uuid("id").primaryKey(),
    interactionHash: bytea("interaction_hash").notNull().unique(),
    encryptedPkceVerifier: jsonb("encrypted_pkce_verifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  /**
   * @param table - 이메일 확인 트랜잭션 열.
   * @returns 해시 길이와 생성 후 만료를 보장할 DB 제약.
   */
  (table) => [
    check("email_confirmation_transactions_interaction_hash_length", sql`octet_length(${table.interactionHash}) = 32`),
    check("email_confirmation_transactions_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
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
  /**
   * @param table - 요청 종류별 시간 구간과 시도 횟수 열.
   * @returns 구간별 복합키, 해시 길이, 허용 종류, 양수 구간 길이, 0 이상 횟수 제약.
   */
  (table) => [
    primaryKey({ columns: [table.fingerprint, table.kind, table.windowStartedAt] }),
    check("auth_rate_limits_fingerprint_length", sql`octet_length(${table.fingerprint}) = 32`),
    check("auth_rate_limits_kind", sql`${table.kind} in ('sign_in', 'sign_up', 'password_reset', 'oauth_start')`),
    check("auth_rate_limits_window_seconds_positive", sql`${table.windowSeconds} > 0`),
    check("auth_rate_limits_count_nonnegative", sql`${table.count} >= 0`),
  ],
);
