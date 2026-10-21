import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { DbClient } from "./user-database.js";
import { CoreError, unavailable } from "./core-error.js";

type Operation = "create_account" | "create_category" | "create_transaction";
/**
 * 생성과 첫 성공 응답을 한 transaction에 저장한다. 외부 HTTP 호출이나 자동 재시도는 하지 않는다.
 * @param client UserDatabase의 연결. @param userId 검증한 소유자. @param operation 고정 생성 작업명.
 * @param key 검증한 UUIDv4 키. @param payload 정규화 후 고정 필드 순서의 의미 입력(키 제외).
 * @param schema 저장/반환할 성공 응답 계약. @param create 실제 행 생성 함수.
 * @returns 동일 요청이면 최초 snapshot, 아니면 새 생성 결과. 다른 내용의 같은 키는 409.
 */
export async function idempotentCreate<T>(
  client: DbClient, userId: string, operation: Operation, key: string, payload: unknown,
  schema: z.ZodType<T>, create: () => Promise<T>,
): Promise<T> {
  const normalizedKey = key.toLowerCase();
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest();
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${userId}:${operation}:${normalizedKey}`]);
  const old = await client.query("select request_fingerprint,response_snapshot from finance.request_deduplication where user_id=$1 and operation=$2 and idempotency_key=$3", [userId, operation, normalizedKey]);
  if (old.rows.length) {
    const digest: unknown = old.rows[0].request_fingerprint;
    if (!Buffer.isBuffer(digest) || digest.length !== 32) throw unavailable();
    if (!timingSafeEqual(digest, fingerprint)) throw new CoreError("LEDGER_IDEMPOTENCY_CONFLICT", 409);
    return schema.parse(old.rows[0].response_snapshot);
  }
  const response = schema.parse(await create());
  await client.query("insert into finance.request_deduplication(user_id,operation,idempotency_key,request_fingerprint,response_snapshot) values($1,$2,$3,$4,$5)",
    [userId, operation, normalizedKey, fingerprint, JSON.stringify(response)]);
  return response;
}
