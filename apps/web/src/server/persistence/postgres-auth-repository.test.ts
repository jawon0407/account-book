import { randomBytes } from "node:crypto";
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

function inspect(value: unknown): string {
  const seen = new WeakSet<object>();
  const fragments: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (typeof candidate === "string") {
      fragments.push(candidate);
      return;
    }
    if (candidate === null || typeof candidate !== "object" || depth > 8 || seen.has(candidate)) return;
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      if (typeof key === "string") fragments.push(key);
      try {
        visit(Reflect.get(candidate, key), depth + 1);
      } catch {
        // Drizzle table symbols can be getter-backed; their visible fields suffice for this contract test.
      }
    }
  };
  visit(value, 0);
  return fragments.join(" ");
}

function subject(database = new FakeDatabase()) {
  expect(PostgresAuthRepository).toBeTypeOf("function");
  return { database, repository: new PostgresAuthRepository!(database) };
}

describe("PostgresAuthRepository", () => {
  it("inserts encrypted records and copies the mutable selector digest", async () => {
    const { database, repository } = subject();
    const input = session();
    const digest = input.selectorHash as Uint8Array;
    await repository.create(input);
    digest.fill(0);

    const values = database.calls[0]?.values;
    expect(values?.selectorHash).toEqual(expect.any(Buffer));
    expect(values?.selectorHash).not.toEqual(digest);
    expect(values).not.toHaveProperty("accessToken");
    expect(values).not.toHaveProperty("refreshToken");
  });

  it("finds only an active exact selector under both expiry policies", async () => {
    const { database, repository } = subject();
    database.rows = [session()];
    await repository.findActiveBySelectorHash(randomBytes(32), now);
    const query = inspect(database.calls[0]?.predicates);

    expect(query).toContain("selector_hash");
    expect(query).toContain("revoked_at");
    expect(query).toContain("absolute_expires_at");
    expect(query).toContain("last_seen_at");
  });

  it("fails closed for malformed rows and invalid selector digests", async () => {
    const { database, repository } = subject();
    database.rows = [null];
    await expect(repository.findActiveBySelectorHash(randomBytes(32), now)).resolves.toBeNull();
    expect(database.calls).toHaveLength(1);
    await expect(repository.findActiveBySelectorHash(randomBytes(31), now)).resolves.toBeNull();
    await expect(repository.revokeBySelectorHash(randomBytes(31), now)).resolves.toBe(false);
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
    const query = inspect(update?.predicates);

    expect(update?.values).toMatchObject({ encryptedAccessToken: envelope, encryptedRefreshToken: envelope, rotationVersion: expect.anything() });
    expect(query).toContain("rotation_version");
    expect(query).toContain("supabase_session_id");
    expect(query).toContain("revoked_at");
    expect(query).toContain("absolute_expires_at");
    expect(query).toContain("last_seen_at");

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
    const queries = database.calls.map((call) => inspect(call.predicates));

    expect(queries[0]).toContain("revoked_at");
    expect(queries[1]).toContain("revoked_at");
    expect(queries[2]).toContain("revoked_at");
    expect(database.calls[2]?.values).toHaveProperty("revocationPendingAt");
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
});
