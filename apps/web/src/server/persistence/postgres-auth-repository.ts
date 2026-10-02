import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { authRecoveryTransactions, authSessions, authUserSecurityState, emailConfirmationTransactions, oauthTransactions } from "@account-book/database";
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
import { PROVIDER_CLOCK_SKEW_SECONDS } from "../security/provider-time.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_LIFETIME_MS = 7 * DAY_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type AuthTable = typeof authSessions | typeof authUserSecurityState | typeof oauthTransactions | typeof emailConfirmationTransactions | typeof authRecoveryTransactions;
type InsertOperation = PromiseLike<unknown> & { onConflictDoNothing(): Promise<unknown> };
type AuthSessionDatabase = Readonly<{
  /**
   * 지정 인증 테이블에 값을 넣는 쿼리를 시작하는 DB 경계입니다.
   * @param table 삽입할 인증 테이블.
   * @returns values로 입력을 받고 중복 무시 옵션을 선택할 삽입 빌더.
   */
  insert(table: AuthTable): { values(values: Record<string, unknown>): InsertOperation };
  /**
   * 인증 세션을 조회하는 쿼리를 시작하는 DB 경계입니다.
   * @returns 테이블·조건·조회 한도를 지정할 빌더.
   */
  select(): { from(table: typeof authSessions): { where(predicate: unknown): { limit(amount: number): Promise<unknown[]> } } };
  /**
   * 지정 인증 테이블을 갱신하는 쿼리를 시작하는 DB 경계입니다.
   * @param table 갱신 대상 인증 테이블.
   * @returns 변경값·조건을 지정하고 결과 행을 받는 빌더.
   */
  update(table: AuthTable): { set(values: Record<string, unknown>): { where(predicate: unknown): { returning(): Promise<unknown[]> } } };
  /**
   * 여러 저장 작업을 하나의 원자적 단위로 실행하는 DB 경계입니다.
   * @param operation 같은 트랜잭션 연결로 실행할 비동기 작업.
   * @returns 작업의 결과; 실패 시 묶인 변경을 롤백합니다.
   * @throws 작업 또는 DB 오류.
   */
  transaction<T>(operation: (transaction: AuthSessionDatabase) => Promise<T>): Promise<T>;
}>;

/**
 * 문자열이 소문자 UUID 표기 형식인지 검사합니다.
 * @param value 검사할 문자열.
 * @returns 형식이 일치하면 true.
 */
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * 값이 Date이며 유효한 시각인지 검사합니다.
 * @param value 검사할 값.
 * @returns 유효한 날짜이면 true.
 */
function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * 현재 시각에서 7일을 빼 마지막 사용 시각의 허용 하한을 계산합니다.
 * @param now 조회·갱신 기준 시각.
 * @returns 유휴 만료 기준 Date, 시각이 잘못되면 null.
 */
function idleCutoff(now: Date): Date | null {
  if (!validDate(now)) return null;
  const cutoff = new Date(now.getTime() - IDLE_LIFETIME_MS);
  return validDate(cutoff) ? cutoff : null;
}

/**
 * DB 바이너리 컬럼에 넘길 수 있도록 바이트 배열을 Buffer로 복사합니다.
 * @param value 변환할 바이트 배열.
 * @returns 복사된 Buffer.
 */
function toBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value);
}

/**
 * 해시가 Uint8Array이며 정확히 32바이트인지 확인합니다.
 * @param value 검사할 해시 후보.
 * @returns 기본 해시 구조가 맞으면 true.
 */
function validDigest(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === 32;
}

/**
 * 암호화 봉투 후보가 null이나 배열이 아닌 객체인지 최소한으로 확인합니다. 필드·인증 태그 검증은 암호화 계층이 맡습니다.
 * @param value DB에서 읽은 봉투 후보.
 * @returns 객체 형태이면 true.
 */
function validEnvelope(value: unknown): value is TokenEnvelope {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * DB 세션 행의 기본 필드·날짜·버전을 검사하고 바이트 및 날짜를 복사해 도메인 레코드로 바꿉니다.
 * @param value 알 수 없는 DB 행.
 * @returns 기본 구조가 맞는 세션 레코드 또는 null.
 */
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

/**
 * OAuth DB 행의 식별자·해시·제공자·복귀 경로·날짜를 검사하고 변경 가능한 값은 복사합니다.
 * @param value 알 수 없는 OAuth DB 행.
 * @returns 검증된 레코드 또는 null.
 */
function toOAuthRecord(value: unknown): OAuthTransactionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.intent !== "sign_in" && row.intent !== "sign_up") return null;
  if (!isUuid(String(row.id)) || !validDigest(row.stateHash) || !validDigest(row.interactionHash) || !["google", "kakao", "naver"].includes(String(row.provider)) || !validEnvelope(row.encryptedPkceVerifier) || !["/app", "/settings/security"].includes(String(row.returnPath)) || !validDate(row.createdAt) || !validDate(row.expiresAt) || (row.consumedAt !== null && !validDate(row.consumedAt))) return null;
  return {
    id: row.id as string,
    stateHash: Uint8Array.from(row.stateHash),
    interactionHash: Uint8Array.from(row.interactionHash),
    provider: row.provider as OAuthTransactionRecord["provider"],
    intent: row.intent,
    encryptedPkceVerifier: row.encryptedPkceVerifier,
    returnPath: row.returnPath as OAuthTransactionRecord["returnPath"],
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    consumedAt: row.consumedAt === null ? null : new Date(row.consumedAt),
  };
}

/**
 * 이메일 확인 DB 행을 검사하며 소비 시각이 생성 이후·만료 이전인지 확인합니다.
 * @param value 알 수 없는 이메일 확인 행.
 * @returns 복사된 레코드 또는 null.
 */
function toEmailRecord(value: unknown): EmailConfirmationTransactionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(String(row.id)) || !validDigest(row.interactionHash) || !validEnvelope(row.encryptedPkceVerifier) || !validDate(row.createdAt) || !validDate(row.expiresAt) || row.expiresAt.getTime() <= row.createdAt.getTime() || (row.consumedAt !== null && (!validDate(row.consumedAt) || row.consumedAt.getTime() < row.createdAt.getTime() || row.consumedAt.getTime() >= row.expiresAt.getTime()))) return null;
  return {
    id: row.id as string,
    interactionHash: Uint8Array.from(row.interactionHash),
    encryptedPkceVerifier: row.encryptedPkceVerifier,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    consumedAt: row.consumedAt === null ? null : new Date(row.consumedAt),
  };
}

/**
 * 선택적 날짜 필드를 세 가지 결과로 구분합니다.
 * @param value DB 필드 값.
 * @returns null은 그대로, 유효 날짜는 복사본, 잘못된 값은 undefined.
 */
function optionalDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  return validDate(value) ? new Date(value) : undefined;
}

/**
 * 복구 DB 행의 필드·날짜 순서와 대기/교환 완료 단계 조합을 검증합니다.
 * @param value 알 수 없는 복구 행.
 * @returns 일관된 복구 레코드 또는 null.
 */
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
    !validDate(row.createdAt) || !validDate(row.expiresAt) || row.expiresAt.getTime() <= row.createdAt.getTime() || exchangeClaimedAt === undefined || exchangedAt === undefined || passwordUpdateClaimedAt === undefined || consumedAt === undefined ||
    (exchangeClaimedAt !== null && (exchangeClaimedAt.getTime() < row.createdAt.getTime() || exchangeClaimedAt.getTime() >= row.expiresAt.getTime())) ||
    (exchangedAt !== null && (exchangeClaimedAt === null || exchangedAt.getTime() < exchangeClaimedAt.getTime() || exchangedAt.getTime() >= row.expiresAt.getTime())) ||
    (passwordUpdateClaimedAt !== null && (exchangedAt === null || passwordUpdateClaimedAt.getTime() < exchangedAt.getTime() || passwordUpdateClaimedAt.getTime() >= row.expiresAt.getTime())) ||
    (consumedAt !== null && (passwordUpdateClaimedAt === null || consumedAt.getTime() < passwordUpdateClaimedAt.getTime() || consumedAt.getTime() >= row.expiresAt.getTime()))
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
  /**
   * 호출자가 수명과 연결 종료를 관리하는 DB 클라이언트를 저장소에 연결합니다.
   * @param database 인증 테이블 쿼리와 트랜잭션을 제공하는 연결.
   */
  public constructor(private readonly database: AuthSessionDatabase) {}

  /** Serializes on the user's issuance gate and inserts only when the provider JWT is still accepted. */
  /**
   * 사용자의 토큰 발급 허용 기준을 잠금으로 확인하고 암호화된 앱 세션을 저장합니다. 오래된 제공자 토큰으로 세션이 재생성되는 것을 막습니다.
   * @param input 저장할 세션 레코드; 토큰은 암호화된 상태.
   * @param providerIssuedAtSeconds 제공자 JWT 발급 시각(초).
   * @returns 저장 성공 시 true, 입력·발급 기준 거부 시 false.
   * @throws DB 오류는 호출자에게 전달됩니다.
   */
  public async createSession(input: NewSessionRecord, providerIssuedAtSeconds: number): Promise<boolean> {
    if (!isUuid(input.userId) || !Number.isSafeInteger(providerIssuedAtSeconds) || providerIssuedAtSeconds <= 0) return false;
    return this.database.transaction(async (transaction) => {
      await transaction.insert(authUserSecurityState).values({ userId: input.userId, minimumAcceptedIat: 0 }).onConflictDoNothing();
      const gates = await transaction.update(authUserSecurityState).set({
        minimumAcceptedIat: sql`${authUserSecurityState.minimumAcceptedIat}`,
      }).where(eq(authUserSecurityState.userId, input.userId)).returning();
      const minimumAcceptedIat = (gates[0] as Record<string, unknown> | undefined)?.minimumAcceptedIat;
      if (typeof minimumAcceptedIat !== "number" || !Number.isSafeInteger(minimumAcceptedIat) || minimumAcceptedIat < 0 || providerIssuedAtSeconds < minimumAcceptedIat) return false;
      await transaction.insert(authSessions).values({
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
      return true;
    });
  }

  /** Returns at most one active row matching the exact SHA-256 selector digest. */
  /**
   * 식별자 해시로 폐기되지 않고 절대 만료·7일 유휴 만료를 지나지 않은 세션을 최대 한 개 조회합니다. 조회만으로 수명은 늘어나지 않습니다.
   * @param hash 브라우저 식별자의 32바이트 해시.
   * @param now 활성 여부 판단 시각.
   * @returns 활성 레코드 또는 없거나 잘못된 데이터이면 null.
   * @throws DB 조회 오류.
   */
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
  /**
   * 기대 버전과 제공자 세션 ID가 여전히 일치하는 활성 세션만 두 암호화 토큰으로 교체합니다. 버전과 마지막 사용 시각도 갱신합니다.
   * @param input 비교 조건·교체할 암호문·만료 및 현재 시각.
   * @returns 정확히 한 행을 갱신하면 true, 검증 실패나 경합 시 false.
   * @throws DB 갱신 오류.
   */
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
  /**
   * 식별자 해시가 일치하는 미폐기 세션에 폐기 시각을 기록합니다. 제공자 로그아웃 요청은 하지 않습니다.
   * @param hash 폐기할 브라우저 식별자 해시.
   * @param now 기록할 폐기 시각.
   * @returns 정확히 한 행을 폐기하면 true.
   * @throws DB 갱신 오류.
   */
  public async revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean> {
    if (hash.length !== 32 || !validDate(now)) return false;
    const rows = await this.database.update(authSessions).set({ revokedAt: new Date(now) }).where(and(
      eq(authSessions.selectorHash, toBuffer(hash)),
      isNull(authSessions.revokedAt),
    )).returning();
    return rows.length === 1;
  }

  /** Locally revokes every still-active session for one user and returns the affected count. */
  /**
   * 한 사용자에게 속한 미폐기 로컬 세션 전부에 폐기 시각을 기록합니다.
   * @param userId 대상 사용자 UUID.
   * @param now 폐기 기준 시각.
   * @returns 변경된 세션 수; 잘못된 입력은 0.
   * @throws DB 갱신 오류.
   */
  public async revokeAllForUser(userId: string, now: Date): Promise<number> {
    if (!isUuid(userId) || !validDate(now)) return 0;
    const rows = await this.database.update(authSessions).set({ revokedAt: new Date(now) }).where(and(
      eq(authSessions.userId, userId),
      isNull(authSessions.revokedAt),
    )).returning();
    return rows.length;
  }

  /** Marks external revocation work only after the local revocation has succeeded. */
  /**
   * 이미 로컬에서 폐기된 세션에 제공자 로그아웃 재처리가 필요함을 기록합니다.
   * @param sessionId 대상 앱 세션 UUID.
   * @param now 보류 상태 기록 시각.
   * @returns 완료 후 값 없음; 잘못된 입력은 변경 없이 종료합니다.
   * @throws DB 갱신 오류.
   */
  public async markRevocationPending(sessionId: string, now: Date): Promise<void> {
    if (!isUuid(sessionId) || !validDate(now)) return;
    await this.database.update(authSessions).set({ revocationPendingAt: new Date(now) }).where(and(
      eq(authSessions.id, sessionId),
      isNotNull(authSessions.revokedAt),
    )).returning();
  }

  /** Inserts one OAuth row using only SHA-256 digests and an encrypted PKCE envelope. */
  /**
   * OAuth 연결용 해시와 암호화된 PKCE 비밀값을 새 트랜잭션으로 저장합니다.
   * @param input 저장할 OAuth 트랜잭션.
   * @returns 저장이 끝나면 값 없이 완료합니다.
   * @throws DB 저장 오류.
   */
  public async createOAuthTransaction(input: OAuthTransactionRecord): Promise<void> {
    await this.database.insert(oauthTransactions).values({
      id: input.id,
      stateHash: toBuffer(input.stateHash),
      interactionHash: toBuffer(input.interactionHash),
      provider: input.provider,
      intent: input.intent,
      encryptedPkceVerifier: input.encryptedPkceVerifier,
      returnPath: input.returnPath,
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      consumedAt: input.consumedAt === null ? null : new Date(input.consumedAt),
    });
  }

  /** Atomically consumes one exact live OAuth transaction or returns null to every claim loser. */
  /**
   * 제공자·state·브라우저 해시가 일치하는 미사용·미만료 OAuth 요청을 한 번의 갱신으로 소비합니다.
   * @param input 정확한 조회 조건과 소비 시각.
   * @returns 한 행을 얻으면 소비된 레코드, 재사용·만료·경합 등은 null.
   * @throws DB 갱신 오류.
   */
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
  /**
   * 브라우저 해시와 암호화한 PKCE 비밀값으로 이메일 확인 요청을 저장합니다.
   * @param input 이메일 확인 레코드.
   * @returns 저장이 끝나면 값 없이 완료합니다.
   * @throws DB 저장 오류.
   */
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
  /**
   * 현재 브라우저의 미사용·미만료 이메일 확인 요청을 갱신하면서 소비해 재사용을 막습니다.
   * @param interactionHash 브라우저 식별자 해시.
   * @param now 소비 및 만료 판단 시각.
   * @returns 정확히 한 행이 소비되면 레코드, 아니면 null.
   * @throws DB 갱신 오류.
   */
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
  /**
   * 복구 PKCE 비밀값과 단계별 상태를 새 복구 트랜잭션으로 저장합니다.
   * @param input 초기 복구 레코드.
   * @returns 저장이 끝나면 값 없이 완료합니다.
   * @throws DB 저장 오류.
   */
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
  /**
   * 아직 코드 교환되지 않은 유효 복구 레코드에 선점 시각을 기록합니다. 이후 다른 요청은 같은 교환을 선점할 수 없습니다.
   * @param interactionHash 브라우저 식별자 해시.
   * @param now 선점 및 만료 판단 시각.
   * @returns 선점한 한 레코드 또는 null.
   * @throws DB 갱신 오류.
   */
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
  /**
   * 선점 시각이 일치하는 레코드의 PKCE 비밀값을 지우고 검증된 사용자·암호화 복구 토큰·교환 완료 시각을 저장합니다.
   * @param input 대상 ID·기대 선점 시각·사용자·암호문·현재 시각.
   * @returns 정확히 한 행이 다음 단계로 바뀌면 true.
   * @throws DB 갱신 오류.
   */
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
  /**
   * 코드 교환은 완료됐지만 비밀번호 변경은 아직 선점되지 않은 유효 복구 레코드를 선점합니다.
   * @param interactionHash 현재 브라우저 식별자 해시.
   * @param now 선점 및 만료 판단 시각.
   * @returns 선점한 레코드 또는 null.
   * @throws DB 갱신 오류.
   */
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
  /**
   * 복구 소비·사용자의 최소 허용 토큰 발급 시각 상향·모든 로컬 세션 폐기를 하나의 DB 트랜잭션으로 처리합니다.
   * @param input 복구 ID·사용자·기대 갱신 선점 시각·현재 시각.
   * @returns 모든 저장이 성공하면 true, 입력이나 소비 조건이 불일치하면 false.
   * @throws DB 오류 또는 사용자 보안 상태 잠금 실패; 트랜잭션을 롤백합니다.
   */
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
      await transaction.insert(authUserSecurityState).values({ userId: input.userId, minimumAcceptedIat: 0 }).onConflictDoNothing();
      const gates = await transaction.update(authUserSecurityState).set({
        // Auth가 DB보다 최대 허용 오차만큼 앞서 발급한 변경 전 토큰도 다시 세션이 되지 못하게 한다.
        minimumAcceptedIat: sql`greatest(${authUserSecurityState.minimumAcceptedIat}, floor(extract(epoch from clock_timestamp()))::bigint + ${PROVIDER_CLOCK_SKEW_SECONDS} + 1)`,
      }).where(eq(authUserSecurityState.userId, input.userId)).returning();
      if (gates.length !== 1) throw new Error("AUTH_USER_SECURITY_STATE_LOCK_FAILED");
      await transaction.update(authSessions).set({ revokedAt: new Date(input.now) }).where(and(
        eq(authSessions.userId, input.userId),
        isNull(authSessions.revokedAt),
      )).returning();
      return true;
    });
  }
}
