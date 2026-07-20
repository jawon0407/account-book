import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { authSessions } from "@account-book/database";
import type { AuthRepository, AuthSessionRecord, NewSessionRecord, RotateSessionInput } from "./auth-repository.js";
import type { TokenEnvelope } from "../security/token-envelope.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_LIFETIME_MS = 7 * DAY_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type AuthSessionDatabase = Readonly<{
  insert(table: typeof authSessions): { values(values: Record<string, unknown>): Promise<unknown> };
  select(): { from(table: typeof authSessions): { where(predicate: unknown): { limit(amount: number): Promise<unknown[]> } } };
  update(table: typeof authSessions): { set(values: Record<string, unknown>): { where(predicate: unknown): { returning(): Promise<unknown[]> } } };
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
}
