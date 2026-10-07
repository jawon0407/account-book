import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuthRepository } from "../../apps/web/src/server/persistence/postgres-auth-repository.js";
import type { AuthSessionRecord } from "../../apps/web/src/server/persistence/auth-repository.js";
import { validProviderIssuedAt } from "../../apps/web/src/server/security/provider-time.js";
import { openCoreDatabase, type CoreDatabase } from "./support/core-database.js";

let database: CoreDatabase;
let repository: PostgresAuthRepository;
const envelope = { version: 1 as const, keyId: "test", iv: Buffer.alloc(12).toString("base64url"), ciphertext: "AA", tag: Buffer.alloc(16).toString("base64url") };

beforeAll(async () => {
  database = await openCoreDatabase();
  for (const migration of ["202607200002_server_pkce_transactions.sql", "202607200003_user_security_state.sql"]) {
    await database.admin.query(await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
  repository = new PostgresAuthRepository(drizzle(database.admin));
});
afterAll(async () => { await database?.close(); });

/** @param userId 테스트 사용자. @param now BFF 기준 시각. @returns 비밀값 없는 정상 암호문 세션 fixture. */
function session(userId: string, now: Date): AuthSessionRecord {
  return { id: randomUUID(), selectorHash: randomBytes(32), userId, supabaseSessionId: randomUUID(), encryptedAccessToken: envelope, encryptedRefreshToken: envelope, accessTokenExpiresAt: new Date(now.getTime() + 3600_000), createdAt: now, lastSeenAt: now, absoluteExpiresAt: new Date(now.getTime() + 86_400_000), revokedAt: null, revocationPendingAt: null, rotationVersion: 0 };
}

describe("password recovery issuance barrier with separate clocks", () => {
  it.each([1, 30, 60])("blocks a pre-reset Auth token %i seconds ahead of the database after recovery", async (providerAheadSeconds) => {
    const databaseNow = (await database.admin.query("select clock_timestamp() as now")).rows[0].now as Date;
    const bffNow = new Date(databaseNow.getTime() + 500);
    const authIssuedAt = Math.floor(databaseNow.getTime() / 1000) + providerAheadSeconds;
    expect(validProviderIssuedAt(authIssuedAt, bffNow.getTime())).toBe(true);
    const userId = randomUUID();
    const transactionId = randomUUID();
    await repository.createRecoveryTransaction({ id: transactionId, interactionHash: randomBytes(32), encryptedPkceVerifier: null, userId, encryptedRecoveryToken: envelope, createdAt: databaseNow, expiresAt: new Date(databaseNow.getTime() + 600_000), exchangeClaimedAt: databaseNow, exchangedAt: databaseNow, passwordUpdateClaimedAt: databaseNow, consumedAt: null });
    const before = Number((await database.admin.query("select floor(extract(epoch from clock_timestamp()))::bigint as seconds")).rows[0].seconds);
    await expect(repository.consumeRecoveryAndRevokeSessions({ transactionId, userId, expectedPasswordUpdateClaimedAt: databaseNow, now: bffNow })).resolves.toBe(true);
    const after = Number((await database.admin.query("select floor(extract(epoch from clock_timestamp()))::bigint as seconds")).rows[0].seconds);
    const cutoff = Number((await database.admin.query("select minimum_accepted_iat from app_private.auth_user_security_state where user_id=$1", [userId])).rows[0].minimum_accepted_iat);
    expect(cutoff).toBeGreaterThanOrEqual(before + 61);
    expect(cutoff).toBeLessThanOrEqual(after + 61);
    await expect(repository.createSession(session(userId, bffNow), authIssuedAt)).resolves.toBe(false);
    await expect(repository.createSession(session(userId, new Date((cutoff + 1) * 1000)), authIssuedAt)).resolves.toBe(false);
    expect((await database.admin.query("select id from app_private.auth_sessions where user_id=$1", [userId])).rows).toEqual([]);
    await expect(repository.createSession(session(userId, new Date(cutoff * 1000)), cutoff)).resolves.toBe(true);
  });
});
