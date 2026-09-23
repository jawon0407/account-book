import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { now, id, userId, envelope, query, subject } from "./postgres-auth-repository.test-fixtures.js";

const digest = Buffer.alloc(32, 4);
const expiresAt = new Date(now.getTime() + 900_000);

/**
 * 정상 복구 교환 결과를 만들고 날짜·상태 변형을 적용합니다.
 * @param overrides 잘못된 DB 행을 재현하기 위해 교체할 필드.
 * @returns 실제 DB 컬럼 이름을 사용하는 복구 테스트 행.
 */
function recoveryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, interactionHash: digest, encryptedPkceVerifier: null, userId,
    encryptedRecoveryToken: envelope, createdAt: now, expiresAt,
    exchangeClaimedAt: now, exchangedAt: now, passwordUpdateClaimedAt: now,
    consumedAt: null, ...overrides };
}

describe("PostgresAuthRepository authentication transactions", () => {
  it.each([null, [], "invalid-row"])("rejects non-record results from all claim paths %#", async (row) => {
    const { database, repository } = subject();
    database.affectedRows = [row];
    await expect(repository.claimOAuthTransaction({ provider: "google", stateHash: digest, interactionHash: digest, now })).resolves.toBeNull();
    await expect(repository.claimEmailConfirmationTransaction(digest, now)).resolves.toBeNull();
    await expect(repository.claimRecoveryExchange(digest, now)).resolves.toBeNull();
    await expect(repository.claimRecoveryPasswordUpdate(digest, now)).resolves.toBeNull();
  });

  it.each([{ rows: [] }, { rows: [{}, {}] }])("rejects zero or multiple claimed rows and stops later writes %#", async ({ rows }) => {
    const { database, repository } = subject();
    database.affectedRows = rows;
    await expect(repository.claimOAuthTransaction({ provider: "google", stateHash: digest, interactionHash: digest, now })).resolves.toBeNull();
    await expect(repository.claimEmailConfirmationTransaction(digest, now)).resolves.toBeNull();
    await expect(repository.claimRecoveryExchange(digest, now)).resolves.toBeNull();
    await expect(repository.claimRecoveryPasswordUpdate(digest, now)).resolves.toBeNull();
    await expect(repository.promoteRecoveryExchange({ transactionId: id, userId, expectedExchangeClaimedAt: now, now, encryptedRecoveryToken: envelope })).resolves.toBe(false);
    database.calls.length = 0;
    await expect(repository.consumeRecoveryAndRevokeSessions({ transactionId: id, userId, expectedPasswordUpdateClaimedAt: now, now })).resolves.toBe(false);
    expect(database.calls.map((call) => call.table)).toEqual(["auth_recovery_transactions"]);
  });

  it.each([null, now])("copies optional consumed timestamps on inserts and returned rows %#", async (consumedAt) => {
    const { database, repository } = subject();
    const email = { id, interactionHash: digest, encryptedPkceVerifier: envelope, createdAt: now, expiresAt, consumedAt };
    const oauth = { ...email, provider: "google", stateHash: digest, returnPath: "/app" };
    await repository.createOAuthTransaction(oauth);
    await repository.createEmailConfirmationTransaction(email);
    await repository.createRecoveryTransaction(recoveryRow({ consumedAt }));
    expect(database.calls.map((call) => call.table)).toEqual(["oauth_transactions", "email_confirmation_transactions", "auth_recovery_transactions"]);
    expect(database.calls[0]?.values).toMatchObject(oauth);
    expect(database.calls[1]?.values).toMatchObject(email);
    expect(database.calls[2]?.values).toMatchObject({ id, consumedAt });
    if (consumedAt !== null) {
      expect(database.calls[0]?.values?.consumedAt).not.toBe(consumedAt);
      expect(database.calls[1]?.values?.consumedAt).not.toBe(consumedAt);
    }
    database.affectedRows = [oauth];
    const oauthResult = await repository.claimOAuthTransaction({ provider: "google", stateHash: digest, interactionHash: digest, now }) as Record<string, unknown>;
    database.affectedRows = [email];
    const emailResult = await repository.claimEmailConfirmationTransaction(digest, now) as Record<string, unknown>;
    expect(oauthResult).toMatchObject({ consumedAt, interactionHash: Uint8Array.from(digest) });
    expect(emailResult).toMatchObject({ consumedAt, interactionHash: Uint8Array.from(digest) });
    expect(oauthResult.interactionHash).not.toBe(digest);
    expect(emailResult.createdAt).not.toBe(now);
    if (consumedAt !== null) {
      expect(oauthResult.consumedAt).not.toBe(consumedAt);
      expect(emailResult.consumedAt).not.toBe(consumedAt);
    }
  });

  it.each([
    { exchangeClaimedAt: "invalid" }, { exchangedAt: "invalid" },
    { passwordUpdateClaimedAt: "invalid" }, { consumedAt: "invalid" },
    { consumedAt: now, passwordUpdateClaimedAt: null },
    { consumedAt: new Date(now.getTime() - 1) }, { consumedAt: expiresAt },
    { encryptedPkceVerifier: envelope },
    { encryptedPkceVerifier: null, userId: null, encryptedRecoveryToken: null,
      exchangeClaimedAt: null, exchangedAt: null, passwordUpdateClaimedAt: null },
  ])("rejects inconsistent recovery chronology or state %#", async (override) => {
    const { database, repository } = subject();
    database.affectedRows = [recoveryRow(override)];
    await expect(repository.claimRecoveryPasswordUpdate(digest, now)).resolves.toBeNull();
  });

  it("copies every valid recovery timestamp including final consumption", async () => {
    const { database, repository } = subject();
    database.affectedRows = [recoveryRow({ consumedAt: now })];
    const result = await repository.claimRecoveryPasswordUpdate(digest, now) as Record<string, unknown>;
    for (const field of ["createdAt", "exchangeClaimedAt", "exchangedAt", "passwordUpdateClaimedAt", "consumedAt"]) {
      expect(result[field]).toEqual(now);
      expect(result[field]).not.toBe(now);
    }
  });

  it("accepts an exchanged record before its password update is claimed", async () => {
    const { database, repository } = subject();
    database.affectedRows = [recoveryRow({ passwordUpdateClaimedAt: null })];
    await expect(repository.claimRecoveryPasswordUpdate(digest, now)).resolves.toMatchObject({ userId, passwordUpdateClaimedAt: null, consumedAt: null });
  });

  it.each([
    [Buffer.alloc(31), now], [digest, new Date("invalid")],
  ] as const)("rejects invalid claim inputs before issuing SQL %#", async (hash, at) => {
    const { database, repository } = subject();
    await expect(repository.claimOAuthTransaction({ provider: "google", stateHash: hash, interactionHash: hash, now: at })).resolves.toBeNull();
    await expect(repository.claimEmailConfirmationTransaction(hash, at)).resolves.toBeNull();
    await expect(repository.claimRecoveryExchange(hash, at)).resolves.toBeNull();
    await expect(repository.claimRecoveryPasswordUpdate(hash, at)).resolves.toBeNull();
    expect(database.calls).toEqual([]);
  });

  it.each([
    { transactionId: "invalid" }, { userId: "invalid" },
    { now: new Date("invalid") },
    { expectedExchangeClaimedAt: new Date("invalid"), expectedPasswordUpdateClaimedAt: new Date("invalid") },
  ])("rejects invalid recovery transition inputs before issuing SQL %#", async (override) => {
    const { database, repository } = subject();
    const input = { transactionId: id, userId, now, expectedExchangeClaimedAt: now, expectedPasswordUpdateClaimedAt: now, encryptedRecoveryToken: envelope, ...override };
    await expect(repository.promoteRecoveryExchange(input)).resolves.toBe(false);
    await expect(repository.consumeRecoveryAndRevokeSessions(input)).resolves.toBe(false);
    expect(database.calls).toEqual([]);
  });

  it.each([{ rows: [] }, { rows: [{}, {}] }])("stops revocation if the security-state lock returns an invalid row count %#", async ({ rows }) => {
    const { database, repository } = subject();
    database.securityRows = rows;
    await expect(repository.consumeRecoveryAndRevokeSessions({ transactionId: id, userId, expectedPasswordUpdateClaimedAt: now, now }))
      .rejects.toThrow("AUTH_USER_SECURITY_STATE_LOCK_FAILED");
    expect(database.calls.some((call) => call.table === "auth_sessions")).toBe(false);
  });

  it("claims OAuth with one conditional update over every binding predicate", async () => {
    const { database, repository } = subject();
    const stateHash = randomBytes(32);
    const interactionHash = randomBytes(32);
    database.affectedRows = [{
      id,
      stateHash,
      interactionHash,
      provider: "google",
      encryptedPkceVerifier: envelope,
      returnPath: "/app",
      createdAt: now,
      expiresAt: new Date(now.getTime() + 600_000),
      consumedAt: now,
    }];
    await expect(repository.claimOAuthTransaction({ provider: "google", stateHash, interactionHash, now })).resolves.toMatchObject({ id, consumedAt: now });
    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]).toMatchObject({ kind: "update", table: "oauth_transactions", values: { consumedAt: now } });
    const statement = query(database.calls[0]?.predicates).sql;
    for (const fragment of ['"provider" =', '"state_hash" =', '"interaction_hash" =', '"consumed_at" is null', '"expires_at" >']) expect(statement).toContain(fragment);
    expect(statement).not.toContain(" or ");

    database.affectedRows = [{}];
    await expect(repository.claimOAuthTransaction({ provider: "google", stateHash, interactionHash, now })).resolves.toBeNull();
    await expect(repository.claimOAuthTransaction({ provider: "google", stateHash: randomBytes(31), interactionHash, now })).resolves.toBeNull();
    expect(database.calls).toHaveLength(2);
  });

  it("claims email confirmation with one live interaction-bound update", async () => {
    const { database, repository } = subject();
    const interactionHash = randomBytes(32);
    database.affectedRows = [{ id, interactionHash, encryptedPkceVerifier: envelope, createdAt: now, expiresAt: new Date(now.getTime() + 900_000), consumedAt: now }];
    await expect(repository.claimEmailConfirmationTransaction(interactionHash, now)).resolves.toMatchObject({ id, consumedAt: now });
    const call = database.calls[0];
    expect(call).toMatchObject({ kind: "update", table: "email_confirmation_transactions", values: { consumedAt: now } });
    const statement = query(call?.predicates).sql;
    expect(statement).toContain('"interaction_hash" =');
    expect(statement).toContain('"consumed_at" is null');
    expect(statement).toContain('"expires_at" >');
    expect(statement).not.toContain(" or ");
  });

  it("fails closed for impossible email and recovery transaction chronology", async () => {
    const { database, repository } = subject();
    const interactionHash = randomBytes(32);
    database.affectedRows = [{ id, interactionHash, encryptedPkceVerifier: envelope, createdAt: now, expiresAt: now, consumedAt: now }];
    await expect(repository.claimEmailConfirmationTransaction(interactionHash, new Date(now.getTime() - 1))).resolves.toBeNull();

    database.affectedRows = [{
      id,
      interactionHash,
      encryptedPkceVerifier: envelope,
      userId: null,
      encryptedRecoveryToken: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 900_000),
      exchangeClaimedAt: new Date(now.getTime() - 1),
      exchangedAt: null,
      passwordUpdateClaimedAt: null,
      consumedAt: null,
    }];
    await expect(repository.claimRecoveryExchange(interactionHash, now)).resolves.toBeNull();
  });

  it("claims and promotes recovery exchange with auditable single-statement CAS predicates", async () => {
    const { database, repository } = subject();
    const interactionHash = randomBytes(32);
    const pending = {
      id,
      interactionHash,
      encryptedPkceVerifier: envelope,
      userId: null,
      encryptedRecoveryToken: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 900_000),
      exchangeClaimedAt: now,
      exchangedAt: null,
      passwordUpdateClaimedAt: null,
      consumedAt: null,
    };
    database.affectedRows = [pending];
    await expect(repository.claimRecoveryExchange(interactionHash, now)).resolves.toMatchObject({ id, exchangeClaimedAt: now });
    const claim = database.calls[0];
    expect(claim).toMatchObject({ kind: "update", table: "auth_recovery_transactions", values: { exchangeClaimedAt: now } });
    const claimSql = query(claim?.predicates).sql;
    for (const fragment of ['"interaction_hash" =', '"encrypted_pkce_verifier" is not null', '"user_id" is null', '"encrypted_recovery_token" is null', '"exchange_claimed_at" is null', '"exchanged_at" is null', '"password_update_claimed_at" is null', '"consumed_at" is null', '"expires_at" >']) expect(claimSql).toContain(fragment);

    database.affectedRows = [{}];
    await expect(repository.promoteRecoveryExchange({ transactionId: id, expectedExchangeClaimedAt: now, userId, encryptedRecoveryToken: envelope, now })).resolves.toBe(true);
    const promote = database.calls[1];
    expect(promote).toMatchObject({ kind: "update", table: "auth_recovery_transactions", values: { encryptedPkceVerifier: null, userId, encryptedRecoveryToken: envelope, exchangedAt: now } });
    const promoteSql = query(promote?.predicates).sql;
    for (const fragment of ['"id" =', '"exchange_claimed_at" =', '"encrypted_pkce_verifier" is not null', '"user_id" is null', '"encrypted_recovery_token" is null', '"exchanged_at" is null', '"consumed_at" is null', '"expires_at" >']) expect(promoteSql).toContain(fragment);
  });

  it("claims password update once and atomically consumes it with local session revocation", async () => {
    const { database, repository } = subject();
    const interactionHash = randomBytes(32);
    const exchanged = {
      id,
      interactionHash,
      encryptedPkceVerifier: null,
      userId,
      encryptedRecoveryToken: envelope,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 900_000),
      exchangeClaimedAt: now,
      exchangedAt: now,
      passwordUpdateClaimedAt: now,
      consumedAt: null,
    };
    database.affectedRows = [exchanged];
    await expect(repository.claimRecoveryPasswordUpdate(interactionHash, now)).resolves.toMatchObject({ id, passwordUpdateClaimedAt: now });
    const claimSql = query(database.calls[0]?.predicates).sql;
    for (const fragment of ['"interaction_hash" =', '"encrypted_pkce_verifier" is null', '"user_id" is not null', '"encrypted_recovery_token" is not null', '"exchange_claimed_at" is not null', '"exchanged_at" is not null', '"password_update_claimed_at" is null', '"consumed_at" is null', '"expires_at" >']) expect(claimSql).toContain(fragment);

    database.calls.length = 0;
    database.affectedRows = [{}];
    await expect(repository.consumeRecoveryAndRevokeSessions({ transactionId: id, userId, expectedPasswordUpdateClaimedAt: now, now })).resolves.toBe(true);
    expect(database.calls).toHaveLength(4);
    expect(database.calls[0]).toMatchObject({ table: "auth_recovery_transactions", values: { consumedAt: now } });
    expect(database.calls[1]).toMatchObject({ table: "auth_user_security_state", values: { userId, minimumAcceptedIat: 0 }, conflict: true });
    expect(database.calls[2]).toMatchObject({ table: "auth_user_security_state" });
    const issuanceGate = query(database.calls[2]?.values?.minimumAcceptedIat);
    expect(issuanceGate.sql).toContain("greatest");
    expect(issuanceGate.sql).toContain("clock_timestamp()");
    expect(issuanceGate.sql).toContain("+ 1");
    expect(issuanceGate.params).toEqual([]);
    expect(database.calls[3]).toMatchObject({ table: "auth_sessions", values: { revokedAt: now } });
    const consumeSql = query(database.calls[0]?.predicates).sql;
    for (const fragment of ['"id" =', '"user_id" =', '"password_update_claimed_at" =', '"consumed_at" is null', '"expires_at" >']) expect(consumeSql).toContain(fragment);
    const revokeSql = query(database.calls[3]?.predicates).sql;
    expect(revokeSql).toContain('"user_id" =');
    expect(revokeSql).toContain('"revoked_at" is null');
  });
});
