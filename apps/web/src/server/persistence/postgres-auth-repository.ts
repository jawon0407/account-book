import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { authRecoveryTransactions, authSessions, emailConfirmationTransactions, oauthTransactions } from "@account-book/database";
import type {
  AuthRepository,
  AuthSessionRecord,
  ClaimOAuthTransactionInput,
  ConsumeRecoveryInput,
  EmailConfirmationTransactionRecord,
  NewSessionRecord,
  OAuthTransactionRecord,
  PromoteRecoveryExchangeInput,
  RecoveryTransactionRecord,
  RotateSessionInput,
} from "./auth-repository.js";
import type { TokenEnvelope } from "../security/token-envelope.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_LIFETIME_MS = 7 * DAY_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type AuthTable = typeof authSessions | typeof oauthTransactions | typeof emailConfirmationTransactions | typeof authRecoveryTransactions;
type AuthSessionDatabase = Readonly<{
  insert(table: AuthTable): { values(values: Record<string, unknown>): Promise<unknown> };
  select(): { from(table: typeof authSessions): { where(predicate: unknown): { limit(amount: number): Promise<unknown[]> } } };
  update(table: AuthTable): { set(values: Record<string, unknown>): { where(predicate: unknown): { returning(): Promise<unknown[]> } } };
  transaction<T>(operation: (transaction: AuthSessionDatabase) => Promise<T>): Promise<T>;
}>;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function idleCutoff(now: Date): Date | null {
  if (!validDate(now)) return null;
  const cutoff = new Date(now.getTime() - IDLE_LIFETIME_MS);
  return validDate(cutoff) ? cutoff : null;
}

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value);
}

function validDigest(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === 32;
}

function validEnvelope(value: unknown): value is TokenEnvelope {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): AuthSessionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const valid = [
    typeof row.id === "string", row.selectorHash instanceof Uint8Array && row.selectorHash.length === 32,
    typeof row.userId === "string", typeof row.supabaseSessionId === "string",
    row.encryptedAccessToken !== null && typeof row.encryptedAccessToken === "object" && !Array.isArray(row.encryptedAccessToken),
    row.encryptedRefreshToken !== null && typeof row.encryptedRefreshToken === "object" && !Array.isArray(row.encryptedRefreshToken),
    validDate(row.accessTokenExpiresAt), validDate(row.createdAt), validDate(row.lastSeenAt), validDate(row.absoluteExpiresAt),
    row.revokedAt === null || validDate(row.revokedAt), row.revocationPendingAt === null || validDate(row.revocationPendingAt),
    Number.isSafeInteger(row.rotationVersion) && (row.rotationVersion as number) >= 0,
  ].every(Boolean);
  if (!valid) return null;
  return {
    id: row.id as string,
    selectorHash: Uint8Array.from(row.selectorHash as Uint8Array),
    userId: row.userId as string,
    supabaseSessionId: row.supabaseSessionId as string,
    encryptedAccessToken: row.encryptedAccessToken as TokenEnvelope,
    encryptedRefreshToken: row.encryptedRefreshToken as TokenEnvelope,
    accessTokenExpiresAt: new Date(row.accessTokenExpiresAt as Date),
    createdAt: new Date(row.createdAt as Date),
    lastSeenAt: new Date(row.lastSeenAt as Date),
    absoluteExpiresAt: new Date(row.absoluteExpiresAt as Date),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt as Date),
    revocationPendingAt: row.revocationPendingAt === null ? null : new Date(row.revocationPendingAt as Date),
    rotationVersion: row.rotationVersion as number,
  };
}

function toOAuthRecord(value: unknown): OAuthTransactionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(String(row.id)) || !validDigest(row.stateHash) || !validDigest(row.interactionHash) || !["google", "kakao", "naver"].includes(String(row.provider)) || !validEnvelope(row.encryptedPkceVerifier) || !["/app", "/settings/security"].includes(String(row.returnPath)) || !validDate(row.createdAt) || !validDate(row.expiresAt) || (row.consumedAt !== null && !validDate(row.consumedAt))) return null;
  return {
    id: row.id as string,
    stateHash: Uint8Array.from(row.stateHash),
    interactionHash: Uint8Array.from(row.interactionHash),
    provider: row.provider as OAuthTransactionRecord["provider"],
    encryptedPkceVerifier: row.encryptedPkceVerifier,
    returnPath: row.returnPath as OAuthTransactionRecord["returnPath"],
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    consumedAt: row.consumedAt === null ? null : new Date(row.consumedAt),
  };
}

function toEmailRecord(value: unknown): EmailConfirmationTransactionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(String(row.id)) || !validDigest(row.interactionHash) || !validEnvelope(row.encryptedPkceVerifier) || !validDate(row.createdAt) || !validDate(row.expiresAt) || (row.consumedAt !== null && !validDate(row.consumedAt))) return null;
  return {
    id: row.id as string,
    interactionHash: Uint8Array.from(row.interactionHash),
    encryptedPkceVerifier: row.encryptedPkceVerifier,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    consumedAt: row.consumedAt === null ? null : new Date(row.consumedAt),
  };
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  return validDate(value) ? new Date(value) : undefined;
}

function toRecoveryRecord(value: unknown): RecoveryTransactionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const exchangeClaimedAt = optionalDate(row.exchangeClaimedAt);
  const exchangedAt = optionalDate(row.exchangedAt);
  const passwordUpdateClaimedAt = optionalDate(row.passwordUpdateClaimedAt);
  const consumedAt = optionalDate(row.consumedAt);
  if (
    !isUuid(String(row.id)) || !validDigest(row.interactionHash) ||
    !(row.encryptedPkceVerifier === null || validEnvelope(row.encryptedPkceVerifier)) || !(row.userId === null || (typeof row.userId === "string" && isUuid(row.userId))) || !(row.encryptedRecoveryToken === null || validEnvelope(row.encryptedRecoveryToken)) ||
    !validDate(row.createdAt) || !validDate(row.expiresAt) || exchangeClaimedAt === undefined || exchangedAt === undefined || passwordUpdateClaimedAt === undefined || consumedAt === undefined
  ) return null;
  const pending = row.encryptedPkceVerifier !== null && row.userId === null && row.encryptedRecoveryToken === null && exchangedAt === null && passwordUpdateClaimedAt === null && consumedAt === null;
  const exchanged = row.encryptedPkceVerifier === null && typeof row.userId === "string" && row.encryptedRecoveryToken !== null && exchangeClaimedAt !== null && exchangedAt !== null && ((passwordUpdateClaimedAt === null && consumedAt === null) || passwordUpdateClaimedAt !== null);
  if (!pending && !exchanged) return null;
  return {
    id: row.id as string,
    interactionHash: Uint8Array.from(row.interactionHash),
    encryptedPkceVerifier: row.encryptedPkceVerifier as TokenEnvelope | null,
    userId: row.userId as string | null,
    encryptedRecoveryToken: row.encryptedRecoveryToken as TokenEnvelope | null,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    exchangeClaimedAt,
    exchangedAt,
    passwordUpdateClaimedAt,
    consumedAt,
  };
}

/** PostgreSQL adapter for encrypted opaque sessions; callers own connection lifecycle. */
export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly database: AuthSessionDatabase) {}

  /** Inserts every encrypted and non-secret column in one statement. */
  public async create(input: NewSessionRecord): Promise<void> {
    await this.database.insert(authSessions).values({
      id: input.id,
      selectorHash: toBuffer(input.selectorHash),
      userId: input.userId,
      supabaseSessionId: input.supabaseSessionId,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: new Date(input.accessTokenExpiresAt),
      createdAt: new Date(input.createdAt),
      lastSeenAt: new Date(input.lastSeenAt),
      absoluteExpiresAt: new Date(input.absoluteExpiresAt),
      revokedAt: input.revokedAt === null ? null : new Date(input.revokedAt),
      revocationPendingAt: input.revocationPendingAt === null ? null : new Date(input.revocationPendingAt),
      rotationVersion: input.rotationVersion,
    });
  }

  /** Returns at most one active row matching the exact SHA-256 selector digest. */
  public async findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<AuthSessionRecord | null> {
    if (hash.length !== 32) return null;
    const cutoff = idleCutoff(now);
    if (cutoff === null) return null;
    const rows = await this.database.select().from(authSessions).where(and(
      eq(authSessions.selectorHash, toBuffer(hash)),
      isNull(authSessions.revokedAt),
      gt(authSessions.absoluteExpiresAt, now),
      gt(authSessions.lastSeenAt, cutoff),
    )).limit(1);
    return toRecord(rows[0]);
  }

  /** Atomically swaps both encrypted tokens only when the rotation CAS still matches. */
  public async rotate(input: RotateSessionInput): Promise<boolean> {
    const cutoff = idleCutoff(input.now);
    if (
      cutoff === null ||
      !validDate(input.accessTokenExpiresAt) ||
      !isUuid(input.sessionId) ||
      !isUuid(input.expectedSupabaseSessionId) ||
      !isUuid(input.supabaseSessionId) ||
      !Number.isSafeInteger(input.expectedRotationVersion) ||
      input.expectedRotationVersion < 0
    ) return false;
    const rows = await this.database.update(authSessions).set({
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      supabaseSessionId: input.supabaseSessionId,
      accessTokenExpiresAt: new Date(input.accessTokenExpiresAt),
      lastSeenAt: new Date(input.now),
      rotationVersion: sql`${authSessions.rotationVersion} + 1`,
    }).where(and(
      eq(authSessions.id, input.sessionId),
      eq(authSessions.rotationVersion, input.expectedRotationVersion),
      eq(authSessions.supabaseSessionId, input.expectedSupabaseSessionId),
      isNull(authSessions.revokedAt),
      gt(authSessions.absoluteExpiresAt, input.now),
      gt(authSessions.lastSeenAt, cutoff),
    )).returning();
    return rows.length === 1;
  }

  /** Locally revokes an active session exactly once. */
  public async revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean> {
    if (hash.length !== 32 || !validDate(now)) return false;
    const rows = await this.database.update(authSessions).set({ revokedAt: new Date(now) }).where(and(
      eq(authSessions.selectorHash, toBuffer(hash)),
      isNull(authSessions.revokedAt),
    )).returning();
    return rows.length === 1;
  }

  /** Locally revokes every still-active session for one user and returns the affected count. */
  public async revokeAllForUser(userId: string, now: Date): Promise<number> {
    if (!isUuid(userId) || !validDate(now)) return 0;
    const rows = await this.database.update(authSessions).set({ revokedAt: new Date(now) }).where(and(
      eq(authSessions.userId, userId),
      isNull(authSessions.revokedAt),
    )).returning();
    return rows.length;
  }

  /** Marks external revocation work only after the local revocation has succeeded. */
  public async markRevocationPending(sessionId: string, now: Date): Promise<void> {
    if (!isUuid(sessionId) || !validDate(now)) return;
    await this.database.update(authSessions).set({ revocationPendingAt: new Date(now) }).where(and(
      eq(authSessions.id, sessionId),
      isNotNull(authSessions.revokedAt),
    )).returning();
  }

  /** Inserts one OAuth row using only SHA-256 digests and an encrypted PKCE envelope. */
  public async createOAuthTransaction(input: OAuthTransactionRecord): Promise<void> {
    await this.database.insert(oauthTransactions).values({
      id: input.id,
      stateHash: toBuffer(input.stateHash),
      interactionHash: toBuffer(input.interactionHash),
      provider: input.provider,
      encryptedPkceVerifier: input.encryptedPkceVerifier,
      returnPath: input.returnPath,
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      consumedAt: input.consumedAt === null ? null : new Date(input.consumedAt),
    });
  }

  /** Atomically consumes one exact live OAuth transaction or returns null to every claim loser. */
  public async claimOAuthTransaction(input: ClaimOAuthTransactionInput): Promise<OAuthTransactionRecord | null> {
    if (!validDigest(input.stateHash) || !validDigest(input.interactionHash) || !validDate(input.now) || !["google", "kakao", "naver"].includes(input.provider)) return null;
    const rows = await this.database.update(oauthTransactions).set({ consumedAt: new Date(input.now) }).where(and(
      eq(oauthTransactions.provider, input.provider),
      eq(oauthTransactions.stateHash, toBuffer(input.stateHash)),
      eq(oauthTransactions.interactionHash, toBuffer(input.interactionHash)),
      isNull(oauthTransactions.consumedAt),
      gt(oauthTransactions.expiresAt, input.now),
    )).returning();
    return rows.length === 1 ? toOAuthRecord(rows[0]) : null;
  }

  /** Inserts one email-confirmation row using only an interaction digest and encrypted verifier. */
  public async createEmailConfirmationTransaction(input: EmailConfirmationTransactionRecord): Promise<void> {
    await this.database.insert(emailConfirmationTransactions).values({
      id: input.id,
      interactionHash: toBuffer(input.interactionHash),
      encryptedPkceVerifier: input.encryptedPkceVerifier,
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      consumedAt: input.consumedAt === null ? null : new Date(input.consumedAt),
    });
  }

  /** Atomically consumes one exact live email-confirmation transaction. */
  public async claimEmailConfirmationTransaction(interactionHash: Uint8Array, now: Date): Promise<EmailConfirmationTransactionRecord | null> {
    if (!validDigest(interactionHash) || !validDate(now)) return null;
    const rows = await this.database.update(emailConfirmationTransactions).set({ consumedAt: new Date(now) }).where(and(
      eq(emailConfirmationTransactions.interactionHash, toBuffer(interactionHash)),
      isNull(emailConfirmationTransactions.consumedAt),
      gt(emailConfirmationTransactions.expiresAt, now),
    )).returning();
    return rows.length === 1 ? toEmailRecord(rows[0]) : null;
  }

  /** Inserts one pending recovery row with an encrypted PKCE verifier and absent user credentials. */
  public async createRecoveryTransaction(input: RecoveryTransactionRecord): Promise<void> {
    await this.database.insert(authRecoveryTransactions).values({
      id: input.id,
      interactionHash: toBuffer(input.interactionHash),
      encryptedPkceVerifier: input.encryptedPkceVerifier,
      userId: input.userId,
      encryptedRecoveryToken: input.encryptedRecoveryToken,
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      exchangeClaimedAt: input.exchangeClaimedAt,
      exchangedAt: input.exchangedAt,
      passwordUpdateClaimedAt: input.passwordUpdateClaimedAt,
      consumedAt: input.consumedAt,
    });
  }

  /** Atomically claims one live pending recovery exchange before any provider request. */
  public async claimRecoveryExchange(interactionHash: Uint8Array, now: Date): Promise<RecoveryTransactionRecord | null> {
    if (!validDigest(interactionHash) || !validDate(now)) return null;
    const rows = await this.database.update(authRecoveryTransactions).set({ exchangeClaimedAt: new Date(now) }).where(and(
      eq(authRecoveryTransactions.interactionHash, toBuffer(interactionHash)),
      isNotNull(authRecoveryTransactions.encryptedPkceVerifier),
      isNull(authRecoveryTransactions.userId),
      isNull(authRecoveryTransactions.encryptedRecoveryToken),
      isNull(authRecoveryTransactions.exchangeClaimedAt),
      isNull(authRecoveryTransactions.exchangedAt),
      isNull(authRecoveryTransactions.passwordUpdateClaimedAt),
      isNull(authRecoveryTransactions.consumedAt),
      gt(authRecoveryTransactions.expiresAt, now),
    )).returning();
    return rows.length === 1 ? toRecoveryRecord(rows[0]) : null;
  }

  /** Atomically replaces a claimed verifier with one verified user and encrypted credential pair. */
  public async promoteRecoveryExchange(input: PromoteRecoveryExchangeInput): Promise<boolean> {
    if (!isUuid(input.transactionId) || !isUuid(input.userId) || !validDate(input.expectedExchangeClaimedAt) || !validDate(input.now)) return false;
    const rows = await this.database.update(authRecoveryTransactions).set({
      encryptedPkceVerifier: null,
      userId: input.userId,
      encryptedRecoveryToken: input.encryptedRecoveryToken,
      exchangedAt: new Date(input.now),
    }).where(and(
      eq(authRecoveryTransactions.id, input.transactionId),
      eq(authRecoveryTransactions.exchangeClaimedAt, input.expectedExchangeClaimedAt),
      isNotNull(authRecoveryTransactions.encryptedPkceVerifier),
      isNull(authRecoveryTransactions.userId),
      isNull(authRecoveryTransactions.encryptedRecoveryToken),
      isNull(authRecoveryTransactions.exchangedAt),
      isNull(authRecoveryTransactions.passwordUpdateClaimedAt),
      isNull(authRecoveryTransactions.consumedAt),
      gt(authRecoveryTransactions.expiresAt, input.now),
    )).returning();
    return rows.length === 1;
  }

  /** Atomically claims one exchanged recovery row before the provider password update. */
  public async claimRecoveryPasswordUpdate(interactionHash: Uint8Array, now: Date): Promise<RecoveryTransactionRecord | null> {
    if (!validDigest(interactionHash) || !validDate(now)) return null;
    const rows = await this.database.update(authRecoveryTransactions).set({ passwordUpdateClaimedAt: new Date(now) }).where(and(
      eq(authRecoveryTransactions.interactionHash, toBuffer(interactionHash)),
      isNull(authRecoveryTransactions.encryptedPkceVerifier),
      isNotNull(authRecoveryTransactions.userId),
      isNotNull(authRecoveryTransactions.encryptedRecoveryToken),
      isNotNull(authRecoveryTransactions.exchangeClaimedAt),
      isNotNull(authRecoveryTransactions.exchangedAt),
      isNull(authRecoveryTransactions.passwordUpdateClaimedAt),
      isNull(authRecoveryTransactions.consumedAt),
      gt(authRecoveryTransactions.expiresAt, now),
    )).returning();
    return rows.length === 1 ? toRecoveryRecord(rows[0]) : null;
  }

  /** After provider success, atomically consumes recovery and revokes every active local session. */
  public async consumeRecoveryAndRevokeSessions(input: ConsumeRecoveryInput): Promise<boolean> {
    if (!isUuid(input.transactionId) || !isUuid(input.userId) || !validDate(input.expectedPasswordUpdateClaimedAt) || !validDate(input.now)) return false;
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.update(authRecoveryTransactions).set({ consumedAt: new Date(input.now) }).where(and(
        eq(authRecoveryTransactions.id, input.transactionId),
        eq(authRecoveryTransactions.userId, input.userId),
        isNull(authRecoveryTransactions.encryptedPkceVerifier),
        isNotNull(authRecoveryTransactions.encryptedRecoveryToken),
        eq(authRecoveryTransactions.passwordUpdateClaimedAt, input.expectedPasswordUpdateClaimedAt),
        isNull(authRecoveryTransactions.consumedAt),
        gt(authRecoveryTransactions.expiresAt, input.now),
      )).returning();
      if (rows.length !== 1) return false;
      await transaction.update(authSessions).set({ revokedAt: new Date(input.now) }).where(and(
        eq(authSessions.userId, input.userId),
        isNull(authSessions.revokedAt),
      )).returning();
      return true;
    });
  }
}
