import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

type TokenEnvelope = Readonly<{ version: 1; keyId: string; iv: string; ciphertext: string; tag: string }>;
type SessionRecord = Readonly<{
  id: string;
  selectorHash: Uint8Array;
  userId: string;
  supabaseSessionId: string;
  encryptedAccessToken: TokenEnvelope;
  encryptedRefreshToken: TokenEnvelope;
  accessTokenExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revocationPendingAt: Date | null;
  rotationVersion: number;
}>;

type TokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  userId: string;
  supabaseSessionId: string;
  issuedAtSeconds: number;
  accessTokenExpiresAt: Date;
}>;

type RotateInput = Readonly<{
  sessionId: string;
  expectedRotationVersion: number;
  expectedSupabaseSessionId: string;
  encryptedAccessToken: TokenEnvelope;
  encryptedRefreshToken: TokenEnvelope;
  supabaseSessionId: string;
  accessTokenExpiresAt: Date;
  now: Date;
}>;

const serviceModule = await import("./session-service.js").catch(() => ({} as Record<string, unknown>));
const SessionService = serviceModule.SessionService as
  | (new (
      repository: TestRepository,
      keyring: Keyring,
      refresher: (refreshToken: string) => Promise<TokenPair>,
      createId?: () => string,
      clock?: () => Date,
    ) => {
      create(tokens: TokenPair, now: Date): Promise<{ selector: string; sessionId: string }>;
      resolve(selector: string, now: Date): Promise<{ accessToken: string; refreshToken: string; sessionId: string }>;
      refresh(selector: string, now: Date): Promise<{ status: "refreshed" | "superseded" }>;
      revokeCurrent(selector: string, now: Date): Promise<boolean>;
      revokeAllForUser(userId: string, now: Date): Promise<number>;
      markRevocationPending(sessionId: string, now: Date): Promise<void>;
    })
  | undefined;
type SessionFailureReason = "expired" | "rate_limited" | "unavailable";
type TypedSessionError = Error & Readonly<{ reason: SessionFailureReason }>;
const SessionOperationError = serviceModule.SessionOperationError as (new (reason: SessionFailureReason) => TypedSessionError) | undefined;

type Keyring = Readonly<{ currentKeyId: string; keys: ReadonlyMap<string, Uint8Array> }>;
const keyring: Keyring = { currentKeyId: "current", keys: new Map([["current", randomBytes(32)]]) };
const now = new Date("2026-07-20T12:00:00.000Z");
const id = "123e4567-e89b-12d3-a456-426614174000";
const userId = "123e4567-e89b-12d3-a456-426614174001";
const providerSessionId = "123e4567-e89b-12d3-a456-426614174002";

/**
 * 정상 제공자 토큰 쌍을 기준으로 필요한 필드만 덮어써 성공·실패 사례를 만듭니다.
 * @param overrides 바꿀 토큰·사용자·시각 필드.
 * @returns 테스트 토큰 쌍.
 */
function tokenPair(overrides: Partial<TokenPair> = {}): TokenPair {
  return {
    accessToken: "provider-access-token",
    refreshToken: "provider-refresh-token",
    userId,
    supabaseSessionId: providerSessionId,
    issuedAtSeconds: Math.floor(now.getTime() / 1000),
    accessTokenExpiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

/**
 * 테스트 저장소의 외부 변경 영향을 줄이기 위해 해시와 날짜를 복사합니다. 암호문 객체는 원래 참조를 유지합니다.
 * @param record 복사할 세션 레코드.
 * @returns 해시·날짜를 복사한 레코드.
 */
function copyRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    selectorHash: Uint8Array.from(record.selectorHash),
    accessTokenExpiresAt: new Date(record.accessTokenExpiresAt),
    createdAt: new Date(record.createdAt),
    lastSeenAt: new Date(record.lastSeenAt),
    absoluteExpiresAt: new Date(record.absoluteExpiresAt),
    revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt),
    revocationPendingAt: record.revocationPendingAt === null ? null : new Date(record.revocationPendingAt),
  };
}

class TestRepository {
  public record: SessionRecord | null = null;
  public minimumAcceptedIat = 0;
  public readonly calls = { createSession: 0, legacyCreate: 0, find: 0, rotate: 0, revoke: 0, revokeAll: 0, pending: 0 };
  public fail = false;
  public failRotate = false;

  /**
   * 이전 저장 경로 호출을 계수해 새 createSession 경계가 사용되는지 검사하기 위한 대역입니다.
   * @param input 메모리에 보관할 세션.
   * @returns 복사 저장 후 값 없음.
   * @throws fail 설정 시 DB 실패를 모사합니다.
   */
  public async create(input: SessionRecord): Promise<void> {
    this.calls.legacyCreate += 1;
    if (this.fail) throw new Error("database-secret");
    this.record = copyRecord(input);
  }

  /**
   * 호출 수를 기록하고 최소 허용 발급 시각 이상인 토큰만 세션으로 저장합니다.
   * @param input 저장할 세션 레코드.
   * @param providerIssuedAtSeconds 제공자 토큰 발급 초.
   * @returns 저장하면 true, 오래된 토큰이면 false.
   * @throws fail 설정 시 DB 실패.
   */
  public async createSession(input: SessionRecord, providerIssuedAtSeconds: number): Promise<boolean> {
    this.calls.createSession += 1;
    if (this.fail) throw new Error("database-secret");
    if (providerIssuedAtSeconds < this.minimumAcceptedIat) return false;
    this.record = copyRecord(input);
    return true;
  }

  /**
   * 조회 횟수를 기록하고 해시가 일치하는 레코드 복사본을 반환합니다. 이 대역은 만료를 걸러내지 않아 서비스 자체 검증을 시험할 수 있습니다.
   * @param hash 기대하는 브라우저 식별자 해시.
   * @returns 일치하는 레코드 또는 null.
   * @throws fail 설정 시 DB 실패.
   */
  public async findActiveBySelectorHash(hash: Uint8Array): Promise<SessionRecord | null> {
    this.calls.find += 1;
    if (this.fail) throw new Error("database-secret");
    if (this.record === null || !Buffer.from(this.record.selectorHash).equals(Buffer.from(hash))) return null;
    return copyRecord(this.record);
  }

  /**
   * 세션 ID·버전·제공자 세션·미폐기 조건을 확인해 토큰을 교체하고 버전을 올리는 메모리 CAS 대역입니다.
   * @param input 기대 비교값·교체 암호문·시각.
   * @returns 비교가 맞아 갱신하면 true, 아니면 false.
   * @throws fail 또는 failRotate 설정 시 DB 실패.
   */
  public async rotate(input: RotateInput): Promise<boolean> {
    this.calls.rotate += 1;
    if (this.fail || this.failRotate) throw new Error("database-secret");
    const record = this.record;
    if (
      record === null ||
      record.id !== input.sessionId ||
      record.rotationVersion !== input.expectedRotationVersion ||
      record.supabaseSessionId !== input.expectedSupabaseSessionId ||
      record.revokedAt !== null
    ) {
      return false;
    }
    this.record = {
      ...record,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      supabaseSessionId: input.supabaseSessionId,
      accessTokenExpiresAt: new Date(input.accessTokenExpiresAt),
      lastSeenAt: new Date(input.now),
      rotationVersion: record.rotationVersion + 1,
    };
    return true;
  }

  /**
   * 호출 수를 기록하고 저장된 미폐기 레코드를 고정 테스트 시각에 폐기합니다. 입력 해시는 이 대역에서 사용하지 않습니다.
   * @returns 폐기한 레코드가 있으면 true.
   * @throws fail 설정 시 DB 실패.
   */
  public async revokeBySelectorHash(): Promise<boolean> {
    this.calls.revoke += 1;
    if (this.fail) throw new Error("database-secret");
    if (this.record === null || this.record.revokedAt !== null) return false;
    this.record = { ...this.record, revokedAt: new Date(now) };
    return true;
  }

  /**
   * 지정 사용자와 일치하는 하나의 메모리 레코드를 폐기하며 전체 폐기 호출을 계수합니다.
   * @param user 폐기 대상 사용자 ID.
   * @returns 폐기한 개수 0 또는 1.
   * @throws fail 설정 시 DB 실패.
   */
  public async revokeAllForUser(user: string): Promise<number> {
    this.calls.revokeAll += 1;
    if (this.fail) throw new Error("database-secret");
    if (this.record === null || this.record.userId !== user || this.record.revokedAt !== null) return 0;
    this.record = { ...this.record, revokedAt: new Date(now) };
    return 1;
  }

  /**
   * 외부 폐기 보류 요청 횟수만 기록합니다. 레코드의 보류 시각 자체는 변경하지 않는 대역입니다.
   * @returns 기록 후 값 없음.
   * @throws fail 설정 시 DB 실패.
   */
  public async markRevocationPending(): Promise<void> {
    this.calls.pending += 1;
    if (this.fail) throw new Error("database-secret");
  }
}

class SerializedSecurityRepository extends TestRepository {
  private tail: Promise<void> = Promise.resolve();
  private readonly pauses: Partial<Record<"session" | "recovery", { reached: () => void; release: Promise<void> }>> = {};

  /**
   * 다음 세션 생성 또는 복구 처리 중간에서 멈출 수 있는 제어 신호를 준비합니다.
   * @param kind 멈출 작업 종류 session 또는 recovery.
   * @returns 멈춤 도달을 기다릴 reached와 진행을 재개할 release 함수.
   */
  public pauseNext(kind: "session" | "recovery"): Readonly<{ reached: Promise<void>; release: () => void }> {
    let reached!: () => void;
    let release!: () => void;
    const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    this.pauses[kind] = { reached, release: releasePromise };
    return { reached: reachedPromise, release };
  }

  /**
   * 세션 생성을 직렬 실행 큐에 넣고 지정된 중간 멈춤 지점을 거친 뒤 부모 저장 대역을 호출합니다.
   * @param input 저장할 세션.
   * @param providerIssuedAtSeconds 제공자 토큰 발급 초.
   * @returns 발급 기준에 따른 저장 성공 여부.
   * @throws 부모 저장 대역 오류.
   */
  public override async createSession(input: SessionRecord, providerIssuedAtSeconds: number): Promise<boolean> {
    return this.exclusive(async () => {
      await this.pauseAt("session");
      return super.createSession(input, providerIssuedAtSeconds);
    });
  }

  /**
   * 직렬화된 복구 작업으로 최소 허용 발급 초를 올리고 같은 사용자의 기존 세션을 폐기합니다.
   * @param user 복구를 완료한 사용자 ID.
   * @param completedAt 복구 완료 시각.
   * @returns 보안 상태 변경 후 값 없음.
   */
  public async completeRecovery(user: string, completedAt: Date): Promise<void> {
    await this.exclusive(async () => {
      await this.pauseAt("recovery");
      this.minimumAcceptedIat = Math.max(this.minimumAcceptedIat, Math.floor(completedAt.getTime() / 1000) + 1);
      if (this.record?.userId === user && this.record.revokedAt === null) this.record = { ...this.record, revokedAt: new Date(completedAt) };
    });
  }

  /**
   * 앞선 작업의 완료를 기다려 전달 작업을 하나씩 실행합니다. 성공·실패 모두 다음 작업의 대기를 해제합니다.
   * @param operation 배타적으로 실행할 비동기 작업.
   * @returns 전달 작업의 결과.
   * @throws 전달 작업의 오류.
   */
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  /**
   * 예약된 멈춤 지점이 있으면 한 번 소비하고 도달 신호를 보낸 뒤 재개 신호를 기다립니다.
   * @param kind 확인할 작업 종류.
   * @returns 예약이 없으면 즉시, 있으면 재개 후 값 없이 완료합니다.
   */
  private async pauseAt(kind: "session" | "recovery"): Promise<void> {
    const pause = this.pauses[kind];
    if (pause === undefined) return;
    delete this.pauses[kind];
    pause.reached();
    await pause.release;
  }
}

/**
 * 메모리 저장소·암호화 키·고정 ID·시계를 연결해 테스트할 세션 서비스를 만듭니다.
 * @param repository 사용할 저장소 대역.
 * @param refresher 제공자 토큰 갱신 대역.
 * @param clock 제공자 완료 시각을 제어할 시계.
 * @returns 서비스와 저장소·갱신 대역.
 */
function service(repository = new TestRepository(), refresher = vi.fn(async () => tokenPair({ accessToken: "new-access", refreshToken: "new-refresh" })), clock: () => Date = () => new Date(now)) {
  expect(SessionService).toBeTypeOf("function");
  return { repository, refresher, service: new SessionService!(repository, keyring, refresher, () => id, clock) };
}

/**
 * 기본 토큰으로 실제 서비스의 생성 경로를 실행해 후속 테스트의 저장 세션을 준비합니다.
 * @param repository 세션을 저장할 대역.
 * @returns 테스트 환경과 생성 결과.
 * @throws 세션 생성 실패.
 */
async function createSession(repository = new TestRepository()) {
  const setup = service(repository);
  const created = await setup.service.create(tokenPair(), now);
  return { ...setup, created };
}

/**
 * 비동기 작업이 세션 오류로 실패하고 지정된 비밀값이 메시지에 없는지 확인합니다.
 * @param action 실패해야 하는 비동기 작업.
 * @param secrets 메시지에 없어야 할 테스트 문자열 목록.
 * @returns 검증 완료를 기다리는 Promise.
 * @throws 기대한 오류 타입·비노출 조건이 다르면 테스트 실패.
 */
function expectSafeFailure(action: () => Promise<unknown>, ...secrets: string[]): Promise<void> {
  expect(SessionOperationError).toBeTypeOf("function");
  return expect(action()).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof (SessionOperationError as new (reason: SessionFailureReason) => TypedSessionError))) return false;
    return secrets.every((secret) => !error.message.includes(secret));
  });
}

/**
 * 비동기 작업의 고정 세션 오류 메시지·사유·비밀값 비노출을 함께 검사합니다.
 * @param action 실패해야 하는 비동기 작업.
 * @param reason 기대 실패 분류.
 * @param secrets 메시지에 없어야 할 문자열 목록.
 * @returns 검증 완료 Promise.
 * @throws 예상 오류와 다르면 테스트 실패.
 */
function expectFailureReason(action: () => Promise<unknown>, reason: SessionFailureReason, ...secrets: string[]): Promise<void> {
  expect(SessionOperationError).toBeTypeOf("function");
  return expect(action()).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof (SessionOperationError as new (reason: SessionFailureReason) => TypedSessionError))) return false;
    return error.message === "AUTH_SESSION_OPERATION_FAILED" && error.reason === reason && secrets.every((secret) => !error.message.includes(secret));
  });
}

describe("SessionService", () => {
  it("persists only the selector digest and token envelopes", async () => {
    const { repository, created } = await createSession();
    const serialized = JSON.stringify(repository.record);

    expect(created.selector).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(repository.record).toMatchObject({ id, rotationVersion: 0, revokedAt: null, revocationPendingAt: null });
    expect(repository.record?.selectorHash).toHaveLength(32);
    expect(serialized).not.toContain("provider-access-token");
    expect(serialized).not.toContain("provider-refresh-token");
    expect(Object.keys(repository.record ?? {})).not.toEqual(expect.arrayContaining(["accessToken", "refreshToken"]));
  });

  it("sets exact lifetimes and rejects invalid creation input", async () => {
    const { repository, service: subject } = service();
    await subject.create(tokenPair(), now);
    expect(repository.record?.createdAt).toEqual(now);
    expect(repository.record?.lastSeenAt).toEqual(now);
    expect(repository.record?.absoluteExpiresAt).toEqual(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));

    await expectSafeFailure(() => subject.create(tokenPair({ accessTokenExpiresAt: now }), now), providerSessionId);
    await expectSafeFailure(() => subject.create(tokenPair({ userId: "not-a-uuid" }), now), "not-a-uuid");
    await expectSafeFailure(() => subject.create(tokenPair({ accessToken: "" }), now));
    await expectSafeFailure(() => subject.create(tokenPair({ refreshToken: "" }), now));
    await expectSafeFailure(() => subject.create(tokenPair({ supabaseSessionId: "not-a-uuid" }), now), "not-a-uuid");
    await expectSafeFailure(() => subject.create(tokenPair({ issuedAtSeconds: 0 }), now));
    await expectSafeFailure(() => subject.create(tokenPair({ issuedAtSeconds: 1.5 }), now));
    await expectSafeFailure(() => subject.create(tokenPair({ issuedAtSeconds: Math.floor(now.getTime() / 1000) + 1 }), now));
    await expectSafeFailure(() => subject.create(tokenPair({ accessTokenExpiresAt: new Date("invalid") }), now));
    await expectSafeFailure(() => subject.create(tokenPair(), new Date("invalid")));
    const nearMaximumNow = new Date(8_640_000_000_000_000 - 1);
    await expectSafeFailure(() => subject.create(tokenPair({ accessTokenExpiresAt: new Date(8_640_000_000_000_000) }), nearMaximumNow));
    const invalidIdService = new SessionService!(new TestRepository(), keyring, async () => tokenPair(), () => "not-a-uuid");
    await expectSafeFailure(() => invalidIdService.create(tokenPair(), now), "not-a-uuid");

    const defaultIdService = new SessionService!(new TestRepository(), keyring, async () => tokenPair());
    await expect(defaultIdService.create(tokenPair(), now)).resolves.toMatchObject({ selector: expect.any(String) });
  });

  it("persists through the per-user issuance gate and rejects a provider token below its minimum", async () => {
    const { repository, service: subject } = service();
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    repository.minimumAcceptedIat = issuedAtSeconds + 1;

    await expectSafeFailure(() => subject.create(tokenPair({ issuedAtSeconds }), now));
    expect(repository.calls.createSession).toBe(1);
    expect(repository.calls.legacyCreate).toBe(0);
    expect(repository.record).toBeNull();

    repository.minimumAcceptedIat = issuedAtSeconds;
    await expect(subject.create(tokenPair({ issuedAtSeconds }), now)).resolves.toMatchObject({ sessionId: id });
    expect(repository.calls.createSession).toBe(2);
  });

  it("leaves no stale session alive under either deterministic recovery race ordering", async () => {
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);

    const sessionFirstRepository = new SerializedSecurityRepository();
    const sessionFirst = service(sessionFirstRepository).service;
    const sessionPause = sessionFirstRepository.pauseNext("session");
    const sessionCreation = sessionFirst.create(tokenPair({ issuedAtSeconds }), now);
    await sessionPause.reached;
    const recoveryAfterSession = sessionFirstRepository.completeRecovery(userId, now);
    sessionPause.release();
    await expect(sessionCreation).resolves.toMatchObject({ userId });
    await recoveryAfterSession;
    expect(sessionFirstRepository.record?.revokedAt).toEqual(now);
    expect(sessionFirstRepository.minimumAcceptedIat).toBe(issuedAtSeconds + 1);

    const recoveryFirstRepository = new SerializedSecurityRepository();
    const recoveryFirst = service(recoveryFirstRepository).service;
    const recoveryPause = recoveryFirstRepository.pauseNext("recovery");
    const recoveryBeforeSession = recoveryFirstRepository.completeRecovery(userId, now);
    await recoveryPause.reached;
    const staleCreation = recoveryFirst.create(tokenPair({ issuedAtSeconds }), now);
    recoveryPause.release();
    await recoveryBeforeSession;
    await expectSafeFailure(() => staleCreation);
    expect(recoveryFirstRepository.record).toBeNull();
    expect(recoveryFirstRepository.minimumAcceptedIat).toBe(issuedAtSeconds + 1);
  });

  it("resolves without writes or refreshes", async () => {
    const { repository, refresher, service: subject, created } = await createSession();
    await expect(subject.resolve(created.selector, now)).resolves.toMatchObject({
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token",
      sessionId: id,
    });
    expect(repository.calls.rotate).toBe(0);
    expect(refresher).not.toHaveBeenCalled();
  });

  it("classifies missing session state as expired for resolve and refresh", async () => {
    const { repository, refresher, service: subject, created } = await createSession();
    repository.record = null;

    await expectFailureReason(() => subject.resolve(created.selector, now), "expired", created.selector);
    await expectFailureReason(() => subject.refresh(created.selector, now), "expired", created.selector);
    expect(refresher).not.toHaveBeenCalled();
  });

  it.each([
    (record: SessionRecord) => ({ ...record, selectorHash: randomBytes(32) }),
    (record: SessionRecord) => ({ ...record, revokedAt: now }),
    (record: SessionRecord) => ({ ...record, lastSeenAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }),
    (record: SessionRecord) => ({ ...record, absoluteExpiresAt: now }),
    (record: SessionRecord) => ({ ...record, rotationVersion: -1 }),
    (record: SessionRecord) => ({ ...record, selectorHash: randomBytes(31) }),
    (record: SessionRecord) => ({ ...record, createdAt: new Date(now.getTime() + 1), lastSeenAt: now }),
    (record: SessionRecord) => ({ ...record, lastSeenAt: new Date(now.getTime() + 1), absoluteExpiresAt: now }),
    (record: SessionRecord) => ({ ...record, createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1), absoluteExpiresAt: now }),
    (record: SessionRecord) => ({ ...record, revocationPendingAt: new Date("invalid") }),
    (record: SessionRecord) => ({ ...record, encryptedAccessToken: { ...record.encryptedAccessToken, tag: "A".repeat(22) } }),
  ])("fails closed when a stored session invariant is invalid", async (mutate) => {
    const { repository, service: subject, created } = await createSession();
    repository.record = mutate(repository.record as SessionRecord);
    await expectFailureReason(() => subject.resolve(created.selector, now), "expired", created.selector, id);
  });

  it("replaces both encrypted tokens with one compare-and-swap", async () => {
    const { repository, refresher, service: subject, created } = await createSession();
    await expect(subject.refresh(created.selector, now)).resolves.toEqual({ status: "refreshed" });

    expect(refresher).toHaveBeenCalledWith("provider-refresh-token");
    expect(repository.record).toMatchObject({ rotationVersion: 1, lastSeenAt: now, supabaseSessionId: providerSessionId });
    expect(JSON.stringify(repository.record)).not.toContain("new-access");
    expect(JSON.stringify(repository.record)).not.toContain("new-refresh");
    expect(repository.calls.rotate).toBe(1);
  });

  it("validates and rotates with a fresh time sampled after a next-second refresh", async () => {
    const providerCompletedAt = new Date(now.getTime() + 1_000);
    const nextSecondPair = tokenPair({ issuedAtSeconds: Math.floor(providerCompletedAt.getTime() / 1000), accessToken: "next-access", refreshToken: "next-refresh" });
    const repository = new TestRepository();
    const setup = service(repository, vi.fn(async () => nextSecondPair), () => providerCompletedAt);
    const created = await setup.service.create(tokenPair(), now);

    await expect(setup.service.refresh(created.selector, now)).resolves.toEqual({ status: "refreshed" });
    expect(repository.record).toMatchObject({ lastSeenAt: providerCompletedAt, rotationVersion: 1 });
  });

  it("fails closed when the post-refresh clock is invalid", async () => {
    const setup = await createSession();
    const subject = new SessionService!(setup.repository, keyring, async () => tokenPair(), () => id, () => new Date("invalid"));
    await expectFailureReason(() => subject.refresh(setup.created.selector, now), "unavailable");
    expect(setup.repository.calls.rotate).toBe(0);
  });

  it("rejects a canonical replacement token pair for a different user before CAS", async () => {
    const replacementUserId = "123e4567-e89b-12d3-a456-426614174003";
    const { repository, created } = await createSession();
    const subject = new SessionService!(repository, keyring, async () => tokenPair({ userId: replacementUserId }), () => id, () => new Date(now));

    await expectFailureReason(() => subject.refresh(created.selector, now), "expired", replacementUserId, created.selector);
    expect(repository.calls.rotate).toBe(0);
  });

  it.each([
    ["non-object token pair", undefined as unknown as TokenPair],
    ["empty access token", tokenPair({ accessToken: "" })],
    ["expired access token", tokenPair({ accessTokenExpiresAt: now })],
  ] as const)("classifies a malformed replacement pair as expired: %s", async (_label, replacement) => {
    const { repository, created } = await createSession();
    const subject = new SessionService!(repository, keyring, async () => replacement, () => id, () => new Date(now));

    await expectFailureReason(() => subject.refresh(created.selector, now), "expired", created.selector);
    expect(repository.calls.rotate).toBe(0);
  });

  it("allows exactly one concurrent refresh CAS winner", async () => {
    const { repository, service: subject, created } = await createSession();
    const results = await Promise.all([subject.refresh(created.selector, now), subject.refresh(created.selector, now)]);

    expect(results.map((result) => result.status).sort()).toEqual(["refreshed", "superseded"]);
    expect(repository.record?.rotationVersion).toBe(1);
  });

  it("classifies refresh provider and repository failures as unavailable without leaking details", async () => {
    const failedRefresher = vi.fn(async () => Promise.reject(new Error("provider-secret")));
    const first = await createSession();
    const subject = new SessionService!(first.repository, keyring, failedRefresher, () => id, () => new Date(now));
    await expectFailureReason(() => subject.refresh(first.created.selector, now), "unavailable", "provider-secret", first.created.selector);

    const second = await createSession();
    second.repository.fail = true;
    await expectFailureReason(() => second.service.resolve(second.created.selector, now), "unavailable", "database-secret", second.created.selector);
    await expectFailureReason(() => second.service.refresh(second.created.selector, now), "unavailable", "database-secret", second.created.selector);

    const rotateFailure = await createSession();
    rotateFailure.repository.failRotate = true;
    await expectFailureReason(() => rotateFailure.service.refresh(rotateFailure.created.selector, now), "unavailable", "database-secret", rotateFailure.created.selector);
    expect(rotateFailure.repository.calls.rotate).toBe(1);

    const third = await createSession();
    third.repository.fail = true;
    await expectSafeFailure(() => third.service.revokeCurrent(third.created.selector, now), "database-secret", third.created.selector);
  });

  it.each([
    ["AUTH_INVALID_CREDENTIALS", "expired"],
    ["AUTH_EMAIL_VERIFICATION_REQUIRED", "expired"],
    ["AUTH_OAUTH_TRANSACTION_INVALID", "expired"],
    ["AUTH_RATE_LIMITED", "rate_limited"],
    ["AUTH_PROVIDER_UNAVAILABLE", "unavailable"],
  ] as const)("preserves allowlisted provider refresh code %s as %s", async (code, reason) => {
    const failedRefresher = vi.fn(async () => Promise.reject(Object.assign(new Error("provider-secret"), { code })));
    const { repository, created } = await createSession();
    const subject = new SessionService!(repository, keyring, failedRefresher, () => id, () => new Date(now));

    await expectFailureReason(() => subject.refresh(created.selector, now), reason, "provider-secret", created.selector);
    expect(repository.calls.rotate).toBe(0);
  });

  it("does not classify a provider failure by its message", async () => {
    const failedRefresher = vi.fn(async () => Promise.reject(new Error("AUTH_RATE_LIMITED")));
    const { repository, created } = await createSession();
    const subject = new SessionService!(repository, keyring, failedRefresher, () => id, () => new Date(now));

    await expectFailureReason(() => subject.refresh(created.selector, now), "unavailable", "AUTH_RATE_LIMITED", created.selector);
  });

  it.each([null, "private-provider-detail"])("safely classifies non-object provider rejection %#", async (error) => {
    const { repository, created } = await createSession();
    const subject = new SessionService!(repository, keyring, async () => { throw error; }, () => id, () => new Date(now));
    await expectFailureReason(() => subject.refresh(created.selector, now), "unavailable", "private-provider-detail");
    expect(repository.calls.rotate).toBe(0);
  });

  it("samples the default wall clock after refreshing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      const { repository, created } = await createSession();
      const subject = new SessionService!(repository, keyring, async () => tokenPair(), () => id);
      await expect(subject.refresh(created.selector, now)).resolves.toEqual({ status: "refreshed" });
      expect(repository.record?.rotationVersion).toBe(1);
      expect(repository.record?.lastSeenAt).toEqual(now);
    } finally { vi.useRealTimers(); }
  });

  it("validates and delegates revocation operations", async () => {
    const { repository, service: subject, created } = await createSession();
    await expect(subject.revokeCurrent(created.selector, now)).resolves.toBe(true);
    await expect(subject.revokeAllForUser(userId, now)).resolves.toBe(0);
    await expect(subject.markRevocationPending(id, now)).resolves.toBeUndefined();
    expect(repository.calls).toMatchObject({ revoke: 1, revokeAll: 1, pending: 1 });

    await expectSafeFailure(() => subject.revokeAllForUser("not-a-uuid", now), "not-a-uuid");
    await expectSafeFailure(() => subject.markRevocationPending("not-a-uuid", now), "not-a-uuid");
    await expectSafeFailure(() => subject.revokeCurrent(created.selector, new Date("invalid")));
    await expectSafeFailure(() => subject.resolve(created.selector, new Date("invalid")));
  });
});
