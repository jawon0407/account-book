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

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value);
}

function toRecord(value: unknown): AuthSessionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as AuthSessionRecord;
  return {
    id: row.id,
    selectorHash: Uint8Array.from(row.selectorHash),
    userId: row.userId,
    supabaseSessionId: row.supabaseSessionId,
    encryptedAccessToken: row.encryptedAccessToken as TokenEnvelope,
    encryptedRefreshToken: row.encryptedRefreshToken as TokenEnvelope,
    accessTokenExpiresAt: new Date(row.accessTokenExpiresAt),
    createdAt: new Date(row.createdAt),
    lastSeenAt: new Date(row.lastSeenAt),
    absoluteExpiresAt: new Date(row.absoluteExpiresAt),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt),
    revocationPendingAt: row.revocationPendingAt === null ? null : new Date(row.revocationPendingAt),
    rotationVersion: row.rotationVersion,
  };
}

/** PostgreSQL adapter for encrypted opaque sessions; callers own connection lifecycle. */
export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly database: AuthSessionDatabase) {}

  /** Inserts every encrypted and non-secret column in one statement. */
  public async create(input: NewSessionRecord): Promise<void> {
    await this.database.insert(authSessions).values({
      ...input,
      selectorHash: toBuffer(input.selectorHash),
      accessTokenExpiresAt: new Date(input.accessTokenExpiresAt),
      createdAt: new Date(input.createdAt),
      lastSeenAt: new Date(input.lastSeenAt),
      absoluteExpiresAt: new Date(input.absoluteExpiresAt),
      revokedAt: input.revokedAt === null ? null : new Date(input.revokedAt),
      revocationPendingAt: input.revocationPendingAt === null ? null : new Date(input.revocationPendingAt),
    });
  }

  /** Returns at most one active row matching the exact SHA-256 selector digest. */
  public async findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<AuthSessionRecord | null> {
    if (hash.length !== 32) return null;
    const rows = await this.database.select().from(authSessions).where(and(
      eq(authSessions.selectorHash, toBuffer(hash)),
      isNull(authSessions.revokedAt),
      gt(authSessions.absoluteExpiresAt, now),
      gt(authSessions.lastSeenAt, new Date(now.getTime() - IDLE_LIFETIME_MS)),
    )).limit(1);
    return toRecord(rows[0]);
  }

  /** Atomically swaps both encrypted tokens only when the rotation CAS still matches. */
  public async rotate(input: RotateSessionInput): Promise<boolean> {
    if (!isUuid(input.sessionId) || !isUuid(input.expectedSupabaseSessionId)) return false;
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
      gt(authSessions.lastSeenAt, new Date(input.now.getTime() - IDLE_LIFETIME_MS)),
    )).returning();
    return rows.length === 1;
  }

  /** Locally revokes an active session exactly once. */
  public async revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean> {
    if (hash.length !== 32) return false;
    const rows = await this.database.update(authSessions).set({ revokedAt: new Date(now) }).where(and(
      eq(authSessions.selectorHash, toBuffer(hash)),
      isNull(authSessions.revokedAt),
    )).returning();
    return rows.length === 1;
  }

  /** Locally revokes every still-active session for one user and returns the affected count. */
  public async revokeAllForUser(userId: string, now: Date): Promise<number> {
    const rows = await this.database.update(authSessions).set({ revokedAt: new Date(now) }).where(and(
      eq(authSessions.userId, userId),
      isNull(authSessions.revokedAt),
    )).returning();
    return rows.length;
  }

  /** Marks external revocation work only after the local revocation has succeeded. */
  public async markRevocationPending(sessionId: string, now: Date): Promise<void> {
    await this.database.update(authSessions).set({ revocationPendingAt: new Date(now) }).where(and(
      eq(authSessions.id, sessionId),
      isNotNull(authSessions.revokedAt),
    )).returning();
  }
}
