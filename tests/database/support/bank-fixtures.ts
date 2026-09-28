import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const AT = "2026-09-28T00:00:00.000Z";
// 형식 검사 전용 가짜 봉투다. 실제 토큰이나 유효한 GCM 암호문이 아니다.
export const ENVELOPE = { version: 1, kid: "fixture", nonce: Buffer.alloc(12).toString("base64url"), ciphertext: "YQ", tag: Buffer.alloc(16).toString("base64url") };

/** @param db 폐기용 관리자. @param userId 소유자. @returns 새 연결 ID. 실제 공급자 호출 없이 SQL 제약만 검사한다. */
export async function seedConnection(db: Client, userId = USER_A): Promise<string> {
  const id = randomUUID();
  await db.query("insert into app_bank.bank_connections (id,user_id,provider,environment,status,created_at,updated_at) values ($1,$2,'kftc','fake','active',$3,$3)", [id, userId, AT]);
  return id;
}

/** @param db 폐기용 관리자. @param changes 고정 fixture의 열별 경계값. @returns 새 요청 ID. 원문 state/proof는 만들지 않는다. */
export async function seedRequest(db: Client, changes: Record<string, unknown> = {}): Promise<string> {
  const row = { id: randomUUID(), user_id: USER_A, session_id: randomUUID(), provider: "kftc", environment: "fake", channel: "web", state_digest: randomBytes(32), proof_digest: randomBytes(32), status: "awaiting_callback", created_at: AT, expires_at: "2026-09-28T00:05:00Z", callback_received_at: null, code_expires_at: null, encrypted_code: null, connection_id: null };
  const columns = Object.keys(row);
  // 열 이름은 고정 row에서만 가져오며 changes는 값만 바꾼다.
  const values = columns.map((name) => Object.hasOwn(changes, name) ? changes[name] : row[name as keyof typeof row]);
  await db.query(`insert into app_bank.bank_connection_requests (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`, values);
  return (changes.id ?? row.id) as string;
}

/** @param db 폐기용 관리자. @param connectionId 부모 연결. @param userId 소유자. @param environment 테스트 환경. @returns SQL 삽입 결과. */
export async function seedCredentials(db: Client, connectionId: string, userId = USER_A, environment = "fake"): Promise<void> {
  await db.query(`insert into app_bank.bank_connection_credentials
    (connection_id,user_id,provider,environment,encrypted_provider_subject,encrypted_access_token,encrypted_refresh_token,access_expires_at,refresh_expires_at,created_at,updated_at)
    values ($1,$2,'kftc',$3,$4,$4,null,'2026-09-28T01:00:00Z',null,$5,$5)`, [connectionId, userId, environment, ENVELOPE, AT]);
}
