import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { now, id, userId, providerSessionId, envelope, session, query, subject } from "./postgres-auth-repository.test-fixtures.js";

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

});
