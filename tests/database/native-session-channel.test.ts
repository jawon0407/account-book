import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuthRepository } from "../../apps/web/src/server/persistence/postgres-auth-repository.js";
import type { AuthSessionRecord, RotateSessionInput } from "../../apps/web/src/server/persistence/auth-repository.js";
import { CORE_URL, openCoreDatabase, type CoreDatabase } from "./support/core-database.js";

let database: CoreDatabase;
let repository: PostgresAuthRepository;
const legacyId = randomUUID();
const now = new Date("2026-10-16T04:00:00Z");
const envelope = { version: 1 as const, keyId: "test", iv: Buffer.alloc(12).toString("base64url"), ciphertext: "AA", tag: Buffer.alloc(16).toString("base64url") };

/** 합성 암호문만 사용하는 세션. 기기 UUID는 인증 수단이 아니라 설치 구분값이다. */
function session(clientChannel: "web" | "android", userId = randomUUID()): AuthSessionRecord {
  return { id: randomUUID(), selectorHash: randomBytes(32), userId, supabaseSessionId: randomUUID(),
    encryptedAccessToken: envelope, encryptedRefreshToken: envelope,
    accessTokenExpiresAt: new Date(now.getTime() + 3600_000), createdAt: now, lastSeenAt: now,
    absoluteExpiresAt: new Date(now.getTime() + 86400_000), revokedAt: null, revocationPendingAt: null, rotationVersion: 0,
    clientChannel, deviceId: clientChannel === "android" ? randomUUID() : null };
}

/** 저장된 세션에서 원자적 갱신용 합성 입력을 만든다. 실제 토큰은 사용하지 않는다. */
function rotation(input: AuthSessionRecord): RotateSessionInput {
  return { sessionId: input.id, expectedRotationVersion: input.rotationVersion, expectedSupabaseSessionId: input.supabaseSessionId,
    encryptedAccessToken: { ...envelope, ciphertext: "AQ" }, encryptedRefreshToken: { ...envelope, ciphertext: "Ag" },
    supabaseSessionId: randomUUID(), accessTokenExpiresAt: new Date(now.getTime() + 7200_000), now,
    ...(input.clientChannel === "android" ? { selectorRotation: { expectedHash: input.selectorHash, replacementHash: randomBytes(32), deviceId: input.deviceId! } } : {}) };
}

/** 실제 세션 주체로 실행하고 복원한다. 동일 연결을 병렬 사용하지 않는다. */
async function asRole<T>(role: "app_session_bff" | "app_api" | "anon" | "authenticated" | "service_role", action: () => Promise<T>): Promise<T> {
  await database.admin.query(`set session authorization ${role}`);
  try { return await action(); } finally { await database.admin.query("reset session authorization"); }
}

beforeAll(async () => {
  database = await openCoreDatabase();
  await database.admin.query(`insert into app_private.auth_sessions
    (id,selector_hash,user_id,supabase_session_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,created_at,last_seen_at,absolute_expires_at)
    values($1,$2,$3,$4,'{}','{}',$5,$5,$5,$6)`, [legacyId, randomBytes(32), randomUUID(), randomUUID(), now, new Date(now.getTime() + 86400_000)]);
  for (const name of ["202607200002_server_pkce_transactions.sql", "202607200003_user_security_state.sql", "20261016040532_native_session_channel.sql"]) {
    await database.admin.query(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  repository = new PostgresAuthRepository(drizzle(database.admin));
});
afterAll(async () => { await database?.close(); });

describe("native session channel migration and runtime boundary", () => {
  it("keeps pre-migration sessions as web and preserves the legacy INSERT shape", async () => {
    expect((await database.admin.query("select client_channel,device_id from app_private.auth_sessions where id=$1", [legacyId])).rows)
      .toEqual([{ client_channel: "web", device_id: null }]);
    const inserted = await asRole("app_session_bff", () => database.admin.query(`insert into app_private.auth_sessions
      (id,selector_hash,user_id,supabase_session_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,created_at,last_seen_at,absolute_expires_at)
      values($1,$2,$3,$4,'{}','{}',$5,$5,$5,$6) returning client_channel,device_id`,
    [randomUUID(), randomBytes(32), randomUUID(), randomUUID(), now, new Date(now.getTime() + 86400_000)]));
    expect(inserted.rows).toEqual([{ client_channel: "web", device_id: null }]);
  });

  it.each([
    ["android", null], ["web", "11111111-1111-4111-8111-111111111111"], ["ios", null],
  ])("rejects invalid persisted context %s/%s", async (channel, device) => {
    await expect(asRole("app_session_bff", () => database.admin.query(`insert into app_private.auth_sessions
      (id,selector_hash,user_id,supabase_session_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,created_at,last_seen_at,absolute_expires_at,client_channel,device_id)
      values($1,$2,$3,$4,'{}','{}',$5,$5,$5,$6,$7,$8)`,
    [randomUUID(), randomBytes(32), randomUUID(), randomUUID(), now, new Date(now.getTime() + 86400_000), channel, device]))).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["app_api", "anon", "authenticated", "service_role"] as const)("does not expose session columns to %s", async role => {
    await expect(asRole(role, () => database.admin.query("select client_channel,device_id from app_private.auth_sessions"))).rejects.toMatchObject({ code: "42501" });
  });

  it("persists and resolves Android metadata using the BFF role", async () => {
    const input = session("android");
    await asRole("app_session_bff", async () => {
      await expect(repository.createSession(input, Math.floor(now.getTime() / 1000))).resolves.toBe(true);
      await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toMatchObject({ clientChannel: "android", deviceId: input.deviceId });
    });
  });

  it("rejects cross-channel revocation in both directions without changing the live session", async () => {
    await asRole("app_session_bff", async () => {
      for (const channel of ["android", "web"] as const) {
        const input = session(channel);
        await repository.createSession(input, Math.floor(now.getTime() / 1000));
        await expect(repository.revokeBySelectorHash(input.selectorHash, now, channel === "android" ? "web" : "android")).resolves.toBe(false);
        await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toMatchObject({ id: input.id, revokedAt: null });
        await expect(repository.revokeBySelectorHash(input.selectorHash, now, channel)).resolves.toBe(true);
        await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toBeNull();
      }
    });
  });

  it("preserves the channel and device during provider-token rotation", async () => {
    const input = session("android");
    const change = rotation(input);
    await asRole("app_session_bff", async () => {
      await repository.createSession(input, Math.floor(now.getTime() / 1000));
      await expect(repository.rotate(change)).resolves.toBe(true);
      await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toBeNull();
      await expect(repository.revokeBySelectorHash(input.selectorHash, now, "android")).resolves.toBe(false);
      await expect(repository.findActiveBySelectorHash(change.selectorRotation!.replacementHash, now)).resolves.toMatchObject({ clientChannel: "android", deviceId: input.deviceId, rotationVersion: 1,
        encryptedAccessToken: change.encryptedAccessToken, encryptedRefreshToken: change.encryptedRefreshToken,
        supabaseSessionId: change.supabaseSessionId, absoluteExpiresAt: input.absoluteExpiresAt, createdAt: input.createdAt });
    });
  });

  it.each(["missing", "device", "digest", "channel"] as const)("rejects native rotation with incorrect %s context", async mismatch => {
    const input = session(mismatch === "channel" ? "web" : "android");
    const change = { ...rotation(input), selectorRotation: { expectedHash: input.selectorHash, replacementHash: randomBytes(32), deviceId: input.deviceId ?? randomUUID() } };
    const { selectorRotation, ...withoutNative } = change;
    const invalid = mismatch === "missing" ? withoutNative : { ...change, selectorRotation: { ...selectorRotation,
      ...(mismatch === "device" ? { deviceId: randomUUID() } : {}), ...(mismatch === "digest" ? { expectedHash: randomBytes(32) } : {}) } };
    await asRole("app_session_bff", async () => {
      await repository.createSession(input, Math.floor(now.getTime() / 1000));
      await expect(repository.rotate(invalid)).resolves.toBe(false);
      await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toMatchObject({ id: input.id, rotationVersion: 0, encryptedAccessToken: envelope });
    });
  });

  it("allows one native CAS winner and preserves the web selector", async () => {
    await asRole("app_session_bff", async () => {
      const input = session("android");
      await repository.createSession(input, Math.floor(now.getTime() / 1000));
      const changes = [rotation(input), rotation(input)];
      // 독립적인 두 연결에서 경쟁시킨다. 한 연결의 직렬 큐만 확인하는 테스트가 아니다.
      const competitors = changes.map(() => new Client({ connectionString: CORE_URL }));
      let outcomes: boolean[];
      try {
        await Promise.all(competitors.map(async client => {
          await client.connect();
          await client.query("set session authorization app_session_bff");
        }));
        outcomes = await Promise.all(competitors.map((client, index) => new PostgresAuthRepository(drizzle(client)).rotate(changes[index]!)));
      } finally {
        await Promise.all(competitors.map(client => client.end()));
      }
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      for (const [index, change] of changes.entries()) {
        const record = await repository.findActiveBySelectorHash(change.selectorRotation!.replacementHash, now);
        if (outcomes[index]) expect(record).toMatchObject({ rotationVersion: 1, encryptedAccessToken: change.encryptedAccessToken });
        else expect(record).toBeNull();
      }
      const web = session("web");
      await repository.createSession(web, Math.floor(now.getTime() / 1000));
      await expect(repository.rotate(rotation(web))).resolves.toBe(true);
      await expect(repository.findActiveBySelectorHash(web.selectorHash, now)).resolves.toMatchObject({ id: web.id, clientChannel: "web", rotationVersion: 1 });
    });
  });

  it("rolls back the entire native token pair when the replacement digest conflicts", async () => {
    const input = session("android");
    const other = session("android");
    await asRole("app_session_bff", async () => {
      for (const record of [input, other]) await repository.createSession(record, Math.floor(now.getTime() / 1000));
      const change = rotation(input);
      await expect(repository.rotate({ ...change, selectorRotation: { ...change.selectorRotation!, replacementHash: other.selectorHash } })).rejects.toMatchObject({ cause: { code: "23505" } });
      await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toMatchObject({ rotationVersion: 0,
        encryptedAccessToken: input.encryptedAccessToken, encryptedRefreshToken: input.encryptedRefreshToken, supabaseSessionId: input.supabaseSessionId });
      await expect(repository.findActiveBySelectorHash(other.selectorHash, now)).resolves.toMatchObject({ id: other.id, rotationVersion: 0 });
    });
  });

  it.each(["revoked", "absolute", "idle"] as const)("does not rotate a %s native session", async state => {
    const input = session("android");
    const change = rotation(input);
    await asRole("app_session_bff", async () => {
      await repository.createSession(input, Math.floor(now.getTime() / 1000));
      if (state === "revoked") await repository.revokeBySelectorHash(input.selectorHash, now, "android");
      if (state === "idle") await database.admin.query("update app_private.auth_sessions set created_at=$1,last_seen_at=$1 where id=$2", [new Date(now.getTime() - 7 * 86400_000), input.id]);
      await expect(repository.rotate({ ...change, now: state === "absolute" ? input.absoluteExpiresAt : now })).resolves.toBe(false);
      const row = (await database.admin.query("select rotation_version,selector_hash,encrypted_access_token from app_private.auth_sessions where id=$1", [input.id])).rows[0];
      expect(row).toMatchObject({ rotation_version: 0, selector_hash: input.selectorHash, encrypted_access_token: input.encryptedAccessToken });
    });
  });

  it.each(["logout", "recovery"])("revokes both channels on %s but leaves another account untouched", async action => {
    const userId = randomUUID();
    const owned = [session("web", userId), session("android", userId)];
    const other = session("android");
    await asRole("app_session_bff", async () => {
      for (const input of [...owned, other]) await repository.createSession(input, Math.floor(now.getTime() / 1000));
      if (action === "logout") {
        await expect(repository.revokeAllForUser(userId, now)).resolves.toBe(2);
      } else {
        const transactionId = randomUUID();
        await repository.createRecoveryTransaction({ id: transactionId, interactionHash: randomBytes(32), encryptedPkceVerifier: null,
          userId, encryptedRecoveryToken: envelope, createdAt: now, expiresAt: new Date(now.getTime() + 600_000),
          exchangeClaimedAt: now, exchangedAt: now, passwordUpdateClaimedAt: now, consumedAt: null });
        await expect(repository.consumeRecoveryAndRevokeSessions({ transactionId, userId, expectedPasswordUpdateClaimedAt: now, now })).resolves.toBe(true);
      }
      for (const input of owned) await expect(repository.findActiveBySelectorHash(input.selectorHash, now)).resolves.toBeNull();
      await expect(repository.findActiveBySelectorHash(other.selectorHash, now)).resolves.toMatchObject({ id: other.id });
    });
  });
});
