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

  public async create(input: SessionRecord): Promise<void> {
    this.calls.legacyCreate += 1;
    if (this.fail) throw new Error("database-secret");
    this.record = copyRecord(input);
  }

  public async createSession(input: SessionRecord, providerIssuedAtSeconds: number): Promise<boolean> {
    this.calls.createSession += 1;
    if (this.fail) throw new Error("database-secret");
    if (providerIssuedAtSeconds < this.minimumAcceptedIat) return false;
    this.record = copyRecord(input);
    return true;
  }

  public async findActiveBySelectorHash(hash: Uint8Array): Promise<SessionRecord | null> {
    this.calls.find += 1;
    if (this.fail) throw new Error("database-secret");
    if (this.record === null || !Buffer.from(this.record.selectorHash).equals(Buffer.from(hash))) return null;
    return copyRecord(this.record);
  }

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

  public async revokeBySelectorHash(): Promise<boolean> {
    this.calls.revoke += 1;
    if (this.fail) throw new Error("database-secret");
    if (this.record === null || this.record.revokedAt !== null) return false;
    this.record = { ...this.record, revokedAt: new Date(now) };
    return true;
  }

  public async revokeAllForUser(user: string): Promise<number> {
    this.calls.revokeAll += 1;
    if (this.fail) throw new Error("database-secret");
    if (this.record === null || this.record.userId !== user || this.record.revokedAt !== null) return 0;
    this.record = { ...this.record, revokedAt: new Date(now) };
    return 1;
  }

  public async markRevocationPending(): Promise<void> {
    this.calls.pending += 1;
    if (this.fail) throw new Error("database-secret");
  }
}

class SerializedSecurityRepository extends TestRepository {
  private tail: Promise<void> = Promise.resolve();
  private readonly pauses: Partial<Record<"session" | "recovery", { reached: () => void; release: Promise<void> }>> = {};

  public pauseNext(kind: "session" | "recovery"): Readonly<{ reached: Promise<void>; release: () => void }> {
    let reached!: () => void;
    let release!: () => void;
    const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    this.pauses[kind] = { reached, release: releasePromise };
    return { reached: reachedPromise, release };
  }

  public override async createSession(input: SessionRecord, providerIssuedAtSeconds: number): Promise<boolean> {
    return this.exclusive(async () => {
      await this.pauseAt("session");
      return super.createSession(input, providerIssuedAtSeconds);
    });
  }

  public async completeRecovery(user: string, completedAt: Date): Promise<void> {
    await this.exclusive(async () => {
      await this.pauseAt("recovery");
      this.minimumAcceptedIat = Math.max(this.minimumAcceptedIat, Math.floor(completedAt.getTime() / 1000) + 1);
      if (this.record?.userId === user && this.record.revokedAt === null) this.record = { ...this.record, revokedAt: new Date(completedAt) };
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async pauseAt(kind: "session" | "recovery"): Promise<void> {
    const pause = this.pauses[kind];
    if (pause === undefined) return;
    delete this.pauses[kind];
    pause.reached();
    await pause.release;
  }
}

function service(repository = new TestRepository(), refresher = vi.fn(async () => tokenPair({ accessToken: "new-access", refreshToken: "new-refresh" })), clock: () => Date = () => new Date(now)) {
  expect(SessionService).toBeTypeOf("function");
  return { repository, refresher, service: new SessionService!(repository, keyring, refresher, () => id, clock) };
}

async function createSession(repository = new TestRepository()) {
  const setup = service(repository);
  const created = await setup.service.create(tokenPair(), now);
  return { ...setup, created };
}

function expectSafeFailure(action: () => Promise<unknown>, ...secrets: string[]): Promise<void> {
  expect(SessionOperationError).toBeTypeOf("function");
  return expect(action()).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof (SessionOperationError as new (reason: SessionFailureReason) => TypedSessionError))) return false;
    return secrets.every((secret) => !error.message.includes(secret));
  });
}

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
