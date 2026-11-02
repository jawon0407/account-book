import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { CORE_URL, openCoreDatabase, type CoreDatabase } from "./core-database.js";

/** @returns 이번 호출이 만든 폐기용 DB. owner 권한은 합성 테스트 역할에만 부여한다. */
export async function openCollectorDatabase(): Promise<CoreDatabase> {
  const db = await openCoreDatabase();
  try {
    await db.admin.query(await readFile(new URL("../../../supabase/migrations/20261016040532_native_session_channel.sql", import.meta.url), "utf8"));
    await db.admin.query(`grant usage,create on schema app_private to app_core_test_owner;
      grant select,update,references on app_private.auth_sessions to app_core_test_owner;
      set role app_core_test_owner`);
    await db.admin.query(await readFile(new URL("../../../supabase/migrations/20261016053724_collector_lease.sql", import.meta.url), "utf8"));
    await db.admin.query("reset role");
    return db;
  } catch (error) { await db.admin.query("reset role"); await db.close(); throw error; }
}

/** @param admin 테스트 DB. @param userId 합성 회원. @param channel 서버 세션 채널. @returns 합성 session UUID. */
export async function seedCollectorSession(admin: Client, userId: string, channel = "android"): Promise<string> {
  const id = randomUUID();
  await admin.query(`insert into app_private.auth_sessions(id,selector_hash,user_id,supabase_session_id,
    encrypted_access_token,encrypted_refresh_token,access_token_expires_at,created_at,last_seen_at,
    absolute_expires_at,client_channel,device_id) values($1,$2,$3,$4,'{}','{}',now()+interval '1 hour',
    now()-interval '1 minute',now(),now()+interval '1 day',$5,$6)`,
  [id,randomBytes(32),userId,randomUUID(),channel,channel === "android" ? randomUUID() : null]);
  return id;
}

/** @param userId 합성 사용자. @returns 별도 transaction을 시작한 실제 API 역할 연결. 호출자가 rollback/end한다. */
export async function collectorClient(userId: string): Promise<Client> {
  const client = new Client({ connectionString: CORE_URL });
  await client.connect();
  await client.query("set session authorization app_api; begin; set local lock_timeout='3s'; set local statement_timeout='5s'");
  await client.query("select set_config('app.user_id',$1,true)", [userId]);
  return client;
}

/** @param userId 합성 소유자. @param operation 같은 API 연결에서 실행할 작업. @returns commit된 결과. */
export async function withCollectorClient<T>(userId: string, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = await collectorClient(userId);
  try { const result = await operation(client); await client.query("commit"); return result; }
  finally { await client.query("rollback"); await client.end(); }
}

/** @param client 실제 연결. @param sid 서버 세션. @param version CAS. @param action 활성/해제. @param replace 다른 활성 세션 교체 승인. @returns 공개 상태만. */
export async function changeCollector(client: Client, sid: string, version: number | null, action = "activate", replace = false) {
  return (await client.query("select * from app_private.collector_change($1,$2,$3,$4)", [sid,version,action,replace])).rows[0];
}
