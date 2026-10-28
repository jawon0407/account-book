import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareAuthE2e } from "./prepare-auth-e2e.js";

let admin: Client;
let prepared = false;

beforeAll(async () => {
  // 준비기 자체의 엄격한 URL/폐기 동의 검증을 먼저 통과해야 DB에 접근한다.
  await prepareAuthE2e();
  prepared = true;
  admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
});

afterAll(async () => {
  try {
    if (prepared && admin) await admin.query("drop schema if exists app_private cascade");
  } finally {
    await admin?.end();
  }
});

/** 고정된 테스트 역할로 실행한다. 실패한 SQL도 rollback하고 연결의 권한을 복원한다. */
async function asRole<T>(role: "app_session_bff" | "app_api" | "anon" | "authenticated" | "service_role", action: () => Promise<T>): Promise<T> {
  await admin.query(`set session authorization ${role}`);
  try {
    await admin.query("begin");
    return await action();
  } finally {
    await admin.query("rollback");
    await admin.query("reset session authorization");
  }
}

/**
 * 합성 세션을 INSERT한다. channel 생략은 이전 웹 INSERT의 DB 기본값을 검사한다.
 * @param channel 명시할 세션 종류. 지원하지 않는 값도 DB 제약 검사용으로 전달한다.
 * @param device Android 설치 UUID 또는 null. 실제 토큰·사용자 데이터는 사용하지 않는다.
 */
async function insertSession(channel?: string, device: string | null = null) {
  const now = new Date("2026-10-28T00:00:00Z");
  const contextColumns = channel === undefined ? "" : ",client_channel,device_id";
  const contextValues = channel === undefined ? "" : ",$7,$8";
  const values: unknown[] = [randomUUID(), randomBytes(32), randomUUID(), randomUUID(), now, new Date(now.getTime() + 86400_000)];
  if (channel !== undefined) values.push(channel, device);
  return admin.query(`insert into app_private.auth_sessions
    (id,selector_hash,user_id,supabase_session_id,encrypted_access_token,encrypted_refresh_token,
     access_token_expires_at,created_at,last_seen_at,absolute_expires_at${contextColumns})
    values($1,$2,$3,$4,'{}','{}',$5,$5,$5,$6${contextValues})
    returning client_channel,device_id`, values);
}

describe("E2E prepared database supports current authentication session SQL", () => {
  it("allows BFF session queries and preserves the legacy web INSERT default", async () => {
    await asRole("app_session_bff", async () => {
      expect((await insertSession()).rows).toEqual([{ client_channel: "web", device_id: null }]);
      expect((await admin.query("select client_channel,device_id from app_private.auth_sessions")).rows)
        .toEqual([{ client_channel: "web", device_id: null }]);
    });
  });

  it("persists the Android channel with an installation UUID", async () => {
    const device = randomUUID();
    expect((await asRole("app_session_bff", () => insertSession("android", device))).rows)
      .toEqual([{ client_channel: "android", device_id: device }]);
  });

  it.each([
    ["android", null], ["web", "11111111-1111-4111-8111-111111111111"], ["ios", null],
  ])("enforces the migration's channel/device constraint for %s/%s", async (channel, device) => {
    await expect(asRole("app_session_bff", () => insertSession(channel!, device)))
      .rejects.toMatchObject({ code: "23514" });
  });

  it.each(["app_api", "anon", "authenticated", "service_role"] as const)("keeps session columns inaccessible to %s", async role => {
    await expect(asRole(role, () => admin.query("select client_channel,device_id from app_private.auth_sessions")))
      .rejects.toMatchObject({ code: "42501" });
  });
});
