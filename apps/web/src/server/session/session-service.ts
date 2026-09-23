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
/**
 * 복호화한 갱신 토큰으로 제공자에 새 토큰 쌍을 요청하는 함수 형태입니다.
 * @param refreshToken 서버에서만 사용하는 제공자 갱신 토큰.
 * @returns 교체할 접근·갱신 토큰과 사용자·만료 정보.
 * @throws 제공자 자격 증명·요청 제한·가용성 오류.
 */
export type SessionTokenRefresher = (refreshToken: string) => Promise<SessionTokenPair>;

/** Public-safe classification for expired state, provider throttling, or operational failures. */
export type SessionFailureReason = "expired" | "rate_limited" | "unavailable";

/** The only error exposed at the session-service boundary. */
export class SessionOperationError extends Error {
  /**
   * 민감한 토큰 대신 만료·제한·가용성 분류만 갖는 세션 오류를 만듭니다.
   * @param reason 공개 가능한 실패 사유.
   */
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

/**
 * 고정 메시지와 제한된 실패 사유로 세션 처리를 중단합니다.
 * @param reason 실패 분류; 기본은 unavailable.
 * @returns 반환하지 않습니다.
 * @throws SessionOperationError.
 */
function fail(reason: SessionFailureReason = "unavailable"): never {
  throw new SessionOperationError(reason);
}

/**
 * 알려진 세션 오류는 유지하고 다른 오류의 세부 정보를 가용성 오류로 숨깁니다.
 * @param error 발생한 하위 계층 오류.
 * @returns 반환하지 않습니다.
 * @throws SessionOperationError.
 */
function propagateFailure(error: unknown): never {
  if (error instanceof SessionOperationError) throw error;
  return fail("unavailable");
}

/**
 * 제공자 갱신 오류 코드를 요청 제한·만료·가용성의 세 분류로 바꿉니다.
 * @param error 제공자 갱신 중 발생한 오류.
 * @returns 반환하지 않습니다.
 * @throws 분류된 SessionOperationError.
 */
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

/**
 * 값이 Date이며 유한한 시각인지 검사합니다.
 * @param value 검사할 값.
 * @returns 유효한 날짜이면 true.
 */
function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * 값이 소문자 UUID 형식인지 확인합니다.
 * @param value 검사할 사용자·세션 식별자.
 * @returns 허용 형식이면 true.
 */
function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * 세션 처리 기준 시각이 유효한 Date인지 공통 날짜 검사에 위임합니다.
 * @param value 검사할 기준 시각.
 * @returns 유효하면 true.
 */
function validTime(value: unknown): value is Date {
  return validDate(value);
}

/**
 * 기준 날짜에 밀리초를 더해 새 날짜를 만들고 범위를 확인합니다.
 * @param date 기준 날짜.
 * @param milliseconds 더할 기간.
 * @returns 새 Date 객체.
 * @throws 계산 결과가 유효하지 않으면 세션 가용성 오류.
 */
function shiftDate(date: Date, milliseconds: number): Date {
  const shifted = new Date(date.getTime() + milliseconds);
  if (!validDate(shifted)) return fail();
  return shifted;
}

/**
 * 제공자 토큰·UUID·발급 시각·만료 시각이 완전하고 현재 사용 가능한지 검사합니다.
 * @param value 검사할 제공자 토큰 쌍.
 * @param now 유효기간 판단 시각.
 * @param invalidReason 검증 실패 시 사용할 오류 분류.
 * @returns 검증된 원래 토큰 쌍.
 * @throws 검증 실패 시 지정한 사유의 세션 오류.
 */
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

/**
 * 두 32바이트 해시를 일정 시간 비교 함수로 대조합니다.
 * @param left 기대한 해시.
 * @param right 저장된 해시.
 * @returns 두 길이가 맞고 내용도 같으면 true.
 */
function sameDigest(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

/**
 * 세션 필드·폐기 여부와 30일 절대 수명·7일 유휴 수명·날짜 순서를 확인합니다.
 * @param record 저장소에서 읽은 세션.
 * @param now 수명 판단 시각.
 * @returns 검증된 세션 레코드.
 * @throws 잘못된 데이터나 만료·폐기 시 expired 오류.
 */
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
  /**
   * 암호화 세션 저장소와 제공자 갱신 함수, UUID 및 시계를 연결합니다.
   * @param repository 세션 저장·조회·갱신·폐기 기능.
   * @param keyring 제공자 토큰 암호화 키.
   * @param refreshToken 복호화한 갱신 토큰으로 새 토큰을 받는 함수.
   * @param createId 앱 세션 UUID 생성 함수.
   * @param clock 제공자 갱신이 끝난 뒤 시각을 읽는 함수.
   */
  public constructor(
    private readonly repository: AuthRepository,
    private readonly keyring: TokenKeyring,
    private readonly refreshToken: SessionTokenRefresher,
    private readonly createId: () => string = randomUUID,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Creates a 30-day opaque session and returns only the browser selector plus safe metadata. */
  /**
   * 제공자 토큰을 검증하고 접근·갱신 토큰을 각각 암호화해 30일 앱 세션을 저장합니다. 브라우저 식별자는 해시로만 저장합니다.
   * @param tokens 서버 전용 제공자 토큰 쌍.
   * @param now 생성 기준 시각.
   * @returns 브라우저 식별자·앱 세션 및 사용자 ID·만료 시각.
   * @throws 검증·암호화·DB 실패 시 세션 가용성 오류.
   */
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
  /**
   * 활성 앱 세션을 읽고 서버 전용 토큰을 복호화합니다. 수명 연장이나 제공자 토큰 갱신은 하지 않습니다.
   * @param selector 브라우저의 불투명 세션 식별자.
   * @param now 활성 여부 판단 시각.
   * @returns 복호화 토큰과 내부 세션 정보; 브라우저에 직접 반환하면 안 됩니다.
   * @throws 만료·잘못된 식별자 또는 저장소 가용성 오류.
   */
  public async resolve(selector: string, now: Date): Promise<ResolvedSession> {
    try {
      return await this.load(selector, now);
    } catch (error) {
      return propagateFailure(error);
    }
  }

  /** Refreshes once, then atomically replaces the encrypted token pair or reports a CAS loser. */
  /**
   * 기존 세션의 갱신 토큰으로 제공자를 한 번 호출한 뒤 새 토큰을 암호화합니다. 기대 버전 비교를 사용해 경합 중 오래된 응답이 덮어쓰지 못하게 합니다.
   * @param selector 현재 세션 식별자.
   * @param now 기존 세션 조회 기준 시각.
   * @returns 저장 승자는 refreshed, 비교 조건이 바뀌면 superseded.
   * @throws 만료·요청 제한·제공자 및 저장소 가용성 오류.
   */
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
  /**
   * 현재 식별자를 검증·해시화하여 로컬 세션을 폐기합니다. 제공자 폐기는 별도 단계입니다.
   * @param selector 폐기할 브라우저 식별자.
   * @param now 폐기 시각.
   * @returns 로컬 저장소에서 폐기했는지 여부.
   * @throws 입력 또는 저장소 실패 시 세션 가용성 오류.
   */
  public async revokeCurrent(selector: string, now: Date): Promise<boolean> {
    try {
      if (!validTime(now)) return fail();
      return await this.repository.revokeBySelectorHash(hashSessionSelector(selector), new Date(now));
    } catch {
      return fail();
    }
  }

  /** Revokes every active local session for one canonical user identifier. */
  /**
   * 사용자 ID와 시각을 확인하고 해당 사용자의 모든 미폐기 로컬 세션을 폐기합니다.
   * @param userId 대상 사용자 UUID.
   * @param now 폐기 시각.
   * @returns 폐기한 세션 수.
   * @throws 입력 또는 저장소 실패 시 세션 가용성 오류.
   */
  public async revokeAllForUser(userId: string, now: Date): Promise<number> {
    try {
      if (!validTime(now) || !validUuid(userId)) return fail();
      return await this.repository.revokeAllForUser(userId, new Date(now));
    } catch {
      return fail();
    }
  }

  /** Records that an already-local-revoked session still needs external revocation. */
  /**
   * 로컬 폐기 뒤 제공자 폐기가 실패한 세션에 재처리 필요 상태를 기록합니다.
   * @param sessionId 로컬 세션 UUID.
   * @param now 보류 기록 시각.
   * @returns 저장 완료 후 값 없음.
   * @throws 입력 또는 저장소 실패 시 세션 가용성 오류.
   */
  public async markRevocationPending(sessionId: string, now: Date): Promise<void> {
    try {
      if (!validTime(now) || !validUuid(sessionId)) return fail();
      await this.repository.markRevocationPending(sessionId, new Date(now));
    } catch {
      return fail();
    }
  }

  /**
   * 식별자 해시로 활성 세션을 조회하고 일치 여부·수명을 재검증한 뒤 토큰을 복호화합니다.
   * @param selector 조회할 브라우저 식별자.
   * @param now 세션 수명 판단 시각.
   * @returns 서버 전용 토큰 및 세션 정보.
   * @throws 조회 장애는 unavailable, 잘못된 식별자·레코드·암호문은 expired.
   */
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
