import { randomBytes } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm/sql";
import { describe, expect, it } from "vitest";

type TokenEnvelope = Readonly<{ version: 1; keyId: string; iv: string; ciphertext: string; tag: string }>;
const repositoryModule = await import("./postgres-auth-repository.js").catch(() => ({} as Record<string, unknown>));
const PostgresAuthRepository = repositoryModule.PostgresAuthRepository as
  | (new (database: FakeDatabase) => {
      createSession(input: Record<string, unknown>, providerIssuedAtSeconds: number): Promise<boolean>;
      findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<unknown>;
      rotate(input: Record<string, unknown>): Promise<boolean>;
      revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
      revokeAllForUser(userId: string, now: Date): Promise<number>;
      markRevocationPending(sessionId: string, now: Date): Promise<void>;
      createOAuthTransaction(input: Record<string, unknown>): Promise<void>;
      claimOAuthTransaction(input: Record<string, unknown>): Promise<unknown>;
      createEmailConfirmationTransaction(input: Record<string, unknown>): Promise<void>;
      claimEmailConfirmationTransaction(hash: Uint8Array, now: Date): Promise<unknown>;
      createRecoveryTransaction(input: Record<string, unknown>): Promise<void>;
      claimRecoveryExchange(hash: Uint8Array, now: Date): Promise<unknown>;
      promoteRecoveryExchange(input: Record<string, unknown>): Promise<boolean>;
      claimRecoveryPasswordUpdate(hash: Uint8Array, now: Date): Promise<unknown>;
      consumeRecoveryAndRevokeSessions(input: Record<string, unknown>): Promise<boolean>;
    })
  | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const id = "123e4567-e89b-12d3-a456-426614174000";
const userId = "123e4567-e89b-12d3-a456-426614174001";
const providerSessionId = "123e4567-e89b-12d3-a456-426614174002";
const envelope: TokenEnvelope = { version: 1, keyId: "current", iv: "A".repeat(16), ciphertext: "A", tag: "A".repeat(22) };

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    selectorHash: randomBytes(32),
    userId,
    supabaseSessionId: providerSessionId,
    encryptedAccessToken: envelope,
    encryptedRefreshToken: envelope,
    accessTokenExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    revocationPendingAt: null,
    rotationVersion: 0,
    ...overrides,
  };
}

class FakeDatabase {
  public readonly calls: Array<{ kind: string; table?: string | undefined; values?: Record<string, unknown>; predicates?: unknown; conflict?: boolean }> = [];
  public affectedRows: unknown[] = [{}];
  public securityRows: unknown[] = [{ minimumAcceptedIat: 0 }];
  public rows: unknown[] = [];

  public insert(table?: object): { values: (values: Record<string, unknown>) => Promise<void> & { onConflictDoNothing: () => Promise<void> } } {
    return { values: (values) => {
      const call: { kind: string; table?: string | undefined; values: Record<string, unknown>; conflict?: boolean } = { kind: "insert", table: table?.[Symbol.for("drizzle:Name") as never] as string | undefined, values };
      this.calls.push(call);
      return Object.assign(Promise.resolve(), { onConflictDoNothing: async () => { call.conflict = true; } });
    } };
  }

  public select(): { from: () => { where: (predicates: unknown) => { limit: () => Promise<unknown[]> } } } {
    return { from: () => ({ where: (predicates) => ({ limit: async () => { this.calls.push({ kind: "select", predicates }); return this.rows; } }) }) };
  }

  public update(table?: object): { set: (values: Record<string, unknown>) => { where: (predicates: unknown) => { returning: () => Promise<unknown[]> } } } {
    return {
      set: (values) => ({ where: (predicates) => ({ returning: async () => {
        const tableName = table?.[Symbol.for("drizzle:Name") as never] as string | undefined;
        this.calls.push({ kind: "update", table: tableName, values, predicates });
        return tableName === "auth_user_security_state" ? this.securityRows : this.affectedRows;
      } }) }),
    };
  }

  public async transaction<T>(operation: (transaction: FakeDatabase) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

function query(value: unknown): Readonly<{ sql: string; params: unknown[] }> {
  return new PgDialect().sqlToQuery(value as SQL);
}

function subject(database = new FakeDatabase()) {
  expect(PostgresAuthRepository).toBeTypeOf("function");
  return { database, repository: new PostgresAuthRepository!(database) };
}

describe("PostgresAuthRepository", () => {
  it("locks the user issuance gate before inserting an exact encrypted session allowlist", async () => {
    const { database, repository } = subject();
    const input = Object.assign(session(), { accessToken: "tainted-access-token", refreshToken: "tainted-refresh-token", extra: "tainted-extra" });
    const digest = input.selectorHash as Uint8Array;
    await expect(repository.createSession(input, Math.floor(now.getTime() / 1000))).resolves.toBe(true);
    digest.fill(0);

    expect(database.calls).toHaveLength(3);
    expect(database.calls[0]).toMatchObject({ kind: "insert", table: "auth_user_security_state", values: { userId, minimumAcceptedIat: 0 }, conflict: true });
    expect(database.calls[1]).toMatchObject({ kind: "update", table: "auth_user_security_state" });
    expect(query(database.calls[1]?.predicates).sql).toContain('"user_id" =');
    const values = database.calls[2]?.values;
    expect(values?.selectorHash).toEqual(expect.any(Buffer));
    expect(values?.selectorHash).not.toEqual(digest);
    expect(Object.keys(values ?? {}).sort()).toEqual([
      "absoluteExpiresAt", "accessTokenExpiresAt", "createdAt", "encryptedAccessToken", "encryptedRefreshToken", "id", "lastSeenAt", "revocationPendingAt", "revokedAt", "rotationVersion", "selectorHash", "supabaseSessionId", "userId",
    ]);
    expect(values).not.toHaveProperty("accessToken");
    expect(values).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(values)).not.toContain("tainted-");
  });

  it("rejects stale or noncanonical issuance times without inserting a session", async () => {
    const { database, repository } = subject();
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    database.securityRows = [{ minimumAcceptedIat: issuedAtSeconds + 1 }];
    await expect(repository.createSession(session(), issuedAtSeconds)).resolves.toBe(false);
    expect(database.calls.map((call) => call.table)).toEqual(["auth_user_security_state", "auth_user_security_state"]);

    database.calls.length = 0;
    await expect(repository.createSession(session(), 1.5)).resolves.toBe(false);
    expect(database.calls).toHaveLength(0);
  });

  it("finds only an active exact selector under both expiry policies", async () => {
    const { database, repository } = subject();
    const digest = randomBytes(32);
    database.rows = [session()];
    await repository.findActiveBySelectorHash(digest, now);
    const statement = query(database.calls[0]?.predicates);

    expect(statement.sql).toMatch(/^\(.*\s+and\s+.*\)$/u);
    expect(statement.sql).toContain('"selector_hash" = $1');
    expect(statement.sql).toContain('"revoked_at" is null');
    expect(statement.sql).toContain('"absolute_expires_at" > $2');
    expect(statement.sql).toContain('"last_seen_at" > $3');
    expect(statement.sql).not.toContain(" or ");
    expect(statement.params).toEqual([expect.any(Buffer), now.toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()]);
  });

  it("fails closed for malformed rows and invalid selector digests", async () => {
    const { database, repository } = subject();
    database.rows = [null];
    await expect(repository.findActiveBySelectorHash(randomBytes(32), now)).resolves.toBeNull();
    expect(database.calls).toHaveLength(1);
    await expect(repository.findActiveBySelectorHash(randomBytes(31), now)).resolves.toBeNull();
    await expect(repository.revokeBySelectorHash(randomBytes(31), now)).resolves.toBe(false);
    expect(database.calls).toHaveLength(1);
    await expect(repository.findActiveBySelectorHash(randomBytes(32), new Date(-8_640_000_000_000_000))).resolves.toBeNull();
    expect(database.calls).toHaveLength(1);
    await expect(repository.findActiveBySelectorHash(randomBytes(32), new Date("invalid"))).resolves.toBeNull();
    expect(database.calls).toHaveLength(1);
  });

  it("updates the complete encrypted pair using all atomic CAS predicates", async () => {
    const { database, repository } = subject();
    const rotated = await repository.rotate({
      sessionId: id,
      expectedRotationVersion: 0,
      expectedSupabaseSessionId: providerSessionId,
      encryptedAccessToken: envelope,
      encryptedRefreshToken: envelope,
      supabaseSessionId: providerSessionId,
      accessTokenExpiresAt: new Date(now.getTime() + 60_000),
      now,
    });
    expect(database.calls).toHaveLength(1);
    expect(rotated).toBe(true);
    const update = database.calls[0];
    const statement = query(update?.predicates);

    expect(update?.values).toMatchObject({ encryptedAccessToken: envelope, encryptedRefreshToken: envelope, rotationVersion: expect.anything() });
    expect(statement.sql).toMatch(/^\(.*\s+and\s+.*\)$/u);
    expect(statement.sql).toContain('"id" = $1');
    expect(statement.sql).toContain('"rotation_version" = $2');
    expect(statement.sql).toContain('"supabase_session_id" = $3');
    expect(statement.sql).toContain('"revoked_at" is null');
    expect(statement.sql).toContain('"absolute_expires_at" > $4');
    expect(statement.sql).toContain('"last_seen_at" > $5');
    expect(statement.sql).not.toContain(" or ");
    expect(statement.params).toEqual([id, 0, providerSessionId, now.toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()]);

    database.affectedRows = [];
    await expect(repository.rotate({
      sessionId: id,
      expectedRotationVersion: 0,
      expectedSupabaseSessionId: providerSessionId,
      encryptedAccessToken: envelope,
      encryptedRefreshToken: envelope,
      supabaseSessionId: providerSessionId,
      accessTokenExpiresAt: new Date(now.getTime() + 60_000),
      now,
    })).resolves.toBe(false);
    await expect(repository.rotate({
      sessionId: "not-a-uuid",
      expectedRotationVersion: 0,
      expectedSupabaseSessionId: providerSessionId,
      encryptedAccessToken: envelope,
      encryptedRefreshToken: envelope,
      supabaseSessionId: providerSessionId,
      accessTokenExpiresAt: new Date(now.getTime() + 60_000),
      now,
    })).resolves.toBe(false);
  });

  it("only revokes active rows and marks pending after local revocation", async () => {
    const { database, repository } = subject();
    await repository.revokeBySelectorHash(randomBytes(32), now);
    await repository.revokeAllForUser(userId, now);
    await repository.markRevocationPending(id, now);
    const queries = database.calls.map((call) => query(call.predicates).sql);

    expect(queries[0]).toContain('"revoked_at" is null');
    expect(queries[1]).toContain('"revoked_at" is null');
    expect(queries[2]).toContain('"revoked_at" is not null');
    expect(database.calls[2]?.values).toHaveProperty("revocationPendingAt");
  });

  it("does not persist revocation updates for invalid adapter inputs", async () => {
    const { database, repository } = subject();
    await expect(repository.revokeAllForUser("not-a-uuid", now)).resolves.toBe(0);
    await expect(repository.revokeAllForUser(userId, new Date("invalid"))).resolves.toBe(0);
    await expect(repository.markRevocationPending("not-a-uuid", now)).resolves.toBeUndefined();
    await expect(repository.markRevocationPending(id, new Date("invalid"))).resolves.toBeUndefined();
    expect(database.calls).toHaveLength(0);
  });

  it("copies optional revocation timestamps on insert", async () => {
    const { database, repository } = subject();
    await repository.createSession(session({ revokedAt: now, revocationPendingAt: now }), Math.floor(now.getTime() / 1000));
    expect(database.calls[2]?.values).toMatchObject({ revokedAt: now, revocationPendingAt: now });
  });

  it("maps non-null optional timestamps from a database row", async () => {
    const { database, repository } = subject();
    database.rows = [session({ revokedAt: now, revocationPendingAt: now })];
    await expect(repository.findActiveBySelectorHash(randomBytes(32), now)).resolves.toMatchObject({
      revokedAt: now,
      revocationPendingAt: now,
    });
  });

  it.each([{}, { selectorHash: "wrong" }, { selectorHash: randomBytes(32), createdAt: "wrong" }])("returns null for malformed database row %j", async (row) => {
    const { database, repository } = subject();
    database.rows = [row];
    await expect(repository.findActiveBySelectorHash(randomBytes(32), now)).resolves.toBeNull();
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
