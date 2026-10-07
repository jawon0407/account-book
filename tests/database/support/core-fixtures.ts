import { randomUUID } from "node:crypto";
import type { Client } from "pg";

/** @param admin 테스트 연결. @param provider 인증 서버의 최초 공급자. @param metadata 신뢰하지 않는 사용자 입력. @returns 합성 회원 UUID. */
export async function seedUser(admin: Client, provider: unknown = "email", metadata: unknown = {}): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3)", [id, JSON.stringify({ provider }), JSON.stringify(metadata)]);
  return id;
}

/** @param admin 테스트 연결. @param userId 소유자. @returns 현금 계좌 UUID. */
export async function seedAccount(admin: Client, userId: string): Promise<string> {
  const r = await admin.query("insert into finance.accounts(user_id,kind,name) values($1,'bank','테스트 계좌') returning id", [userId]);
  return r.rows[0].id;
}

/** @param admin 테스트 연결. @param userId 소유자. @param kind 수입/지출 구분. @returns 카테고리 UUID. */
export async function seedCategory(admin: Client, userId: string, kind = "expense"): Promise<string> {
  const r = await admin.query("insert into finance.transaction_categories(user_id,kind,name) values($1,$2,'테스트 분류') returning id", [userId, kind]);
  return r.rows[0].id;
}
