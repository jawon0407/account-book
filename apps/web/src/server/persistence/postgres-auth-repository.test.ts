import { randomBytes } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm/sql";
import { describe, expect, it } from "vitest";

type TokenEnvelope = Readonly<{ version: 1; keyId: string; iv: string; ciphertext: string; tag: string }>;
const repositoryModule = await import("./postgres-auth-repository.js").catch(() => ({} as Record<string, unknown>));
const PostgresAuthRepository = repositoryModule.PostgresAuthRepository as
  | (new (database: FakeDatabase) => {
      create(input: Record<string, unknown>): Promise<void>;
      findActiveBySelectorHash(hash: Uint8Array, now: Date): Promise<unknown>;
      rotate(input: Record<string, unknown>): Promise<boolean>;
      revokeBySelectorHash(hash: Uint8Array, now: Date): Promise<boolean>;
      revokeAllForUser(userId: string, now: Date): Promise<number>;
      markRevocationPending(sessionId: string, now: Date): Promise<void>;
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
  public readonly calls: Array<{ kind: string; values?: Record<string, unknown>; predicates?: unknown }> = [];
  public affectedRows: unknown[] = [{}];
  public rows: unknown[] = [];

  public insert(): { values: (values: Record<string, unknown>) => Promise<void> } {
    return { values: async (values) => { this.calls.push({ kind: "insert", values }); } };
  }

  public select(): { from: () => { where: (predicates: unknown) => { limit: () => Promise<unknown[]> } } } {
    return { from: () => ({ where: (predicates) => ({ limit: async () => { this.calls.push({ kind: "select", predicates }); return this.rows; } }) }) };
  }

  public update(): { set: (values: Record<string, unknown>) => { where: (predicates: unknown) => { returning: () => Promise<unknown[]> } } } {
    return {
      set: (values) => ({ where: (predicates) => ({ returning: async () => { this.calls.push({ kind: "update", values, predicates }); return this.affectedRows; } }) }),
    };
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
  it("inserts an exact encrypted allowlist and copies the mutable selector digest", async () => {
    const { database, repository } = subject();
    const input = Object.assign(session(), { accessToken: "tainted-access-token", refreshToken: "tainted-refresh-token", extra: "tainted-extra" });
    const digest = input.selectorHash as Uint8Array;
    await repository.create(input);
    digest.fill(0);

    const values = database.calls[0]?.values;
    expect(values?.selectorHash).toEqual(expect.any(Buffer));
    expect(values?.selectorHash).not.toEqual(digest);
    expect(Object.keys(values ?? {}).sort()).toEqual([
      "absoluteExpiresAt", "accessTokenExpiresAt", "createdAt", "encryptedAccessToken", "encryptedRefreshToken", "id", "lastSeenAt", "revocationPendingAt", "revokedAt", "rotationVersion", "selectorHash", "supabaseSessionId", "userId",
    ]);
    expect(values).not.toHaveProperty("accessToken");
    expect(values).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(values)).not.toContain("tainted-");
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
    await repository.create(session({ revokedAt: now, revocationPendingAt: now }));
    expect(database.calls[0]?.values).toMatchObject({ revokedAt: now, revocationPendingAt: now });
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
});
