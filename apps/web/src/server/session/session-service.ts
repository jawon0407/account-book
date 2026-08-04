import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createSessionSelector,
  hashSessionSelector,
} from "../security/session-selector.js";
import {
  decryptToken,
  encryptToken,
  type TokenKeyring,
} from "../security/token-envelope.js";
import type {
  AuthRepository,
  AuthSessionRecord,
  NewSessionRecord,
  RotateSessionInput,
} from "../persistence/auth-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_LIFETIME_MS = 7 * DAY_MS;
const ABSOLUTE_LIFETIME_MS = 30 * DAY_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A server-only provider token pair. It must never be returned to browser code. */
export type SessionTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  userId: string;
  supabaseSessionId: string;
  issuedAtSeconds: number;
  accessTokenExpiresAt: Date;
}>;

/** Refreshes a decrypted provider refresh token into the next complete token pair. */
export type SessionTokenRefresher = (refreshToken: string) => Promise<SessionTokenPair>;

/** Public-safe classification for expired state, provider throttling, or operational failures. */
export type SessionFailureReason = "expired" | "rate_limited" | "unavailable";

/** The only error exposed at the session-service boundary. */
export class SessionOperationError extends Error {
  public constructor(public readonly reason: SessionFailureReason) {
    super("AUTH_SESSION_OPERATION_FAILED");
    this.name = "SessionOperationError";
  }
}

type ResolvedSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: string;
  supabaseSessionId: string;
  accessTokenExpiresAt: Date;
  rotationVersion: number;
}>;

function fail(reason: SessionFailureReason = "unavailable"): never {
  throw new SessionOperationError(reason);
}

function propagateFailure(error: unknown): never {
  if (error instanceof SessionOperationError) throw error;
  return fail("unavailable");
}

function providerRefreshFailure(error: unknown): never {
  let code: unknown;
  try {
    code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  } catch {
    return fail("unavailable");
  }
  if (code === "AUTH_RATE_LIMITED") return fail("rate_limited");
  if (code === "AUTH_INVALID_CREDENTIALS" || code === "AUTH_EMAIL_VERIFICATION_REQUIRED" || code === "AUTH_OAUTH_TRANSACTION_INVALID") return fail("expired");
  return fail("unavailable");
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validTime(value: unknown): value is Date {
  return validDate(value);
}

function shiftDate(date: Date, milliseconds: number): Date {
  const shifted = new Date(date.getTime() + milliseconds);
  if (!validDate(shifted)) return fail();
  return shifted;
}

function validTokenPair(value: SessionTokenPair, now: Date, invalidReason: SessionFailureReason = "unavailable"): SessionTokenPair {
  if (value === null || typeof value !== "object") return fail(invalidReason);
  const valid = [
    typeof value.accessToken !== "string" ||
      value.accessToken.length === 0,
    typeof value.refreshToken !== "string" || value.refreshToken.length === 0,
    !validUuid(value.userId),
    !validUuid(value.supabaseSessionId),
    !Number.isSafeInteger(value.issuedAtSeconds) || value.issuedAtSeconds <= 0 || value.issuedAtSeconds > Math.floor(now.getTime() / 1000),
    !validDate(value.accessTokenExpiresAt),
    validDate(value.accessTokenExpiresAt) && value.accessTokenExpiresAt.getTime() <= now.getTime(),
    validDate(value.accessTokenExpiresAt) && value.accessTokenExpiresAt.getTime() <= value.issuedAtSeconds * 1000,
  ].every((invalid) => !invalid);
  if (!valid) return fail(invalidReason);
  return value;
}

function sameDigest(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

function validRecord(record: AuthSessionRecord, now: Date): AuthSessionRecord {
  const dates = [record.accessTokenExpiresAt, record.createdAt, record.lastSeenAt, record.absoluteExpiresAt];
  const valid = [
    validUuid(record.id), validUuid(record.userId), validUuid(record.supabaseSessionId),
    record.selectorHash instanceof Uint8Array && record.selectorHash.length === 32,
    dates.every(validDate),
    [record.revokedAt, record.revocationPendingAt].every((date) => date === null || validDate(date)),
    Number.isSafeInteger(record.rotationVersion) && record.rotationVersion >= 0,
    record.revokedAt === null,
  ].every(Boolean);
  if (!valid) return fail("expired");
  if (
    record.absoluteExpiresAt.getTime() - record.createdAt.getTime() <= 0 ||
    record.absoluteExpiresAt.getTime() - record.createdAt.getTime() > ABSOLUTE_LIFETIME_MS ||
    record.createdAt.getTime() > record.lastSeenAt.getTime() ||
    record.lastSeenAt.getTime() > record.absoluteExpiresAt.getTime() ||
    record.lastSeenAt.getTime() + IDLE_LIFETIME_MS <= now.getTime() ||
    record.absoluteExpiresAt.getTime() <= now.getTime()
  ) return fail("expired");
  return record;
}

/** Owns opaque-session creation, lookup, token refresh CAS, and local revocation policy. */
export class SessionService {
  public constructor(
    private readonly repository: AuthRepository,
    private readonly keyring: TokenKeyring,
    private readonly refreshToken: SessionTokenRefresher,
    private readonly createId: () => string = randomUUID,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Creates a 30-day opaque session and returns only the browser selector plus safe metadata. */
  public async create(tokens: SessionTokenPair, now: Date): Promise<Readonly<{ selector: string; sessionId: string; userId: string; accessTokenExpiresAt: Date; absoluteExpiresAt: Date }>> {
    try {
      if (!validTime(now)) return fail();
      const pair = validTokenPair(tokens, now);
      const id = this.createId();
      if (!validUuid(id)) return fail();
      const selector = createSessionSelector();
      const absoluteExpiresAt = shiftDate(now, ABSOLUTE_LIFETIME_MS);
      const record: NewSessionRecord = {
        id,
        selectorHash: hashSessionSelector(selector),
        userId: pair.userId,
        supabaseSessionId: pair.supabaseSessionId,
        encryptedAccessToken: encryptToken(pair.accessToken, { recordId: id, tokenKind: "access" }, this.keyring),
        encryptedRefreshToken: encryptToken(pair.refreshToken, { recordId: id, tokenKind: "refresh" }, this.keyring),
        accessTokenExpiresAt: new Date(pair.accessTokenExpiresAt),
        createdAt: new Date(now),
        lastSeenAt: new Date(now),
        absoluteExpiresAt,
        revokedAt: null,
        revocationPendingAt: null,
        rotationVersion: 0,
      };
      if (!await this.repository.createSession(record, pair.issuedAtSeconds)) return fail();
      return { selector, sessionId: id, userId: pair.userId, accessTokenExpiresAt: new Date(pair.accessTokenExpiresAt), absoluteExpiresAt };
    } catch {
      return fail();
    }
  }

  /** Resolves an active session without extending its lifetime or refreshing provider tokens. */
  public async resolve(selector: string, now: Date): Promise<ResolvedSession> {
    try {
      return await this.load(selector, now);
    } catch (error) {
      return propagateFailure(error);
    }
  }

  /** Refreshes once, then atomically replaces the encrypted token pair or reports a CAS loser. */
  public async refresh(selector: string, now: Date): Promise<Readonly<{ status: "refreshed" | "superseded" }>> {
    try {
      const session = await this.load(selector, now);
      let providerPair: SessionTokenPair;
      try {
        providerPair = await this.refreshToken(session.refreshToken);
      } catch (error) {
        return providerRefreshFailure(error);
      }
      const refreshedAtValue = this.clock();
      if (!validTime(refreshedAtValue)) return fail();
      const refreshedAt = new Date(refreshedAtValue);
      const replacement = validTokenPair(providerPair, refreshedAt, "expired");
      if (replacement.userId !== session.userId) return fail("expired");
      const rotation: RotateSessionInput = {
        sessionId: session.sessionId,
        expectedRotationVersion: session.rotationVersion,
        expectedSupabaseSessionId: session.supabaseSessionId,
        encryptedAccessToken: encryptToken(replacement.accessToken, { recordId: session.sessionId, tokenKind: "access" }, this.keyring),
        encryptedRefreshToken: encryptToken(replacement.refreshToken, { recordId: session.sessionId, tokenKind: "refresh" }, this.keyring),
        supabaseSessionId: replacement.supabaseSessionId,
        accessTokenExpiresAt: new Date(replacement.accessTokenExpiresAt),
        now: refreshedAt,
      };
      return (await this.repository.rotate(rotation)) ? { status: "refreshed" } : { status: "superseded" };
    } catch (error) {
      return propagateFailure(error);
    }
  }

  /** Locally revokes the current selector before any later external revocation attempt. */
  public async revokeCurrent(selector: string, now: Date): Promise<boolean> {
    try {
      if (!validTime(now)) return fail();
      return await this.repository.revokeBySelectorHash(hashSessionSelector(selector), new Date(now));
    } catch {
      return fail();
    }
  }

  /** Revokes every active local session for one canonical user identifier. */
  public async revokeAllForUser(userId: string, now: Date): Promise<number> {
    try {
      if (!validTime(now) || !validUuid(userId)) return fail();
      return await this.repository.revokeAllForUser(userId, new Date(now));
    } catch {
      return fail();
    }
  }

  /** Records that an already-local-revoked session still needs external revocation. */
  public async markRevocationPending(sessionId: string, now: Date): Promise<void> {
    try {
      if (!validTime(now) || !validUuid(sessionId)) return fail();
      await this.repository.markRevocationPending(sessionId, new Date(now));
    } catch {
      return fail();
    }
  }

  private async load(selector: string, now: Date): Promise<ResolvedSession> {
    if (!validTime(now)) return fail("expired");
    let selectorHash: Uint8Array;
    try {
      selectorHash = hashSessionSelector(selector);
    } catch {
      return fail("expired");
    }
    let record: AuthSessionRecord | null;
    try {
      record = await this.repository.findActiveBySelectorHash(selectorHash, new Date(now));
    } catch {
      return fail("unavailable");
    }
    if (record === null || !(record.selectorHash instanceof Uint8Array) || !sameDigest(selectorHash, record.selectorHash)) return fail("expired");
    const active = validRecord(record, now);
    try {
      return {
        accessToken: decryptToken(active.encryptedAccessToken, { recordId: active.id, tokenKind: "access" }, this.keyring),
        refreshToken: decryptToken(active.encryptedRefreshToken, { recordId: active.id, tokenKind: "refresh" }, this.keyring),
        sessionId: active.id,
        userId: active.userId,
        supabaseSessionId: active.supabaseSessionId,
        accessTokenExpiresAt: new Date(active.accessTokenExpiresAt),
        rotationVersion: active.rotationVersion,
      };
    } catch {
      return fail("expired");
    }
  }
}
