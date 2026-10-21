import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { ENVELOPE, USER_A } from "./bank-fixtures.js";

/** @returns 테스트마다 독립적인 합성 연결 요청. 실제 사용자/은행 비밀값이 아니다. */
export function flowInput() {
  return { id: randomUUID(), session: randomUUID(), state: randomBytes(32), proof: randomBytes(32), user: USER_A };
}
export type FlowInput = ReturnType<typeof flowInput>;

/** @param db 독립 연결. @param user 검증 principal을 대신한 합성 사용자. @param operation 실제 함수 호출. @returns 커밋된 결과; 오류는 rollback한다. */
export async function flowCall<T>(db: Client, user: string | null, operation: () => Promise<T>): Promise<T> {
  await db.query("set session authorization app_api");
  try {
    await db.query("begin");
    await db.query("select set_config('app.user_id',$1,true)", [user ?? ""]);
    const result = await operation();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.query("reset session authorization");
  }
}

/** @param db 테스트 연결. @param input 합성 요청 식별자/지문. @returns 저장된 UUID 또는 교환 중 거부(NULL). */
export async function startFlow(db: Client, input = flowInput()): Promise<string | null> {
  return flowCall(db, input.user, async () => (await db.query("select app_bank.start_request($1,$2,'test',$3,$4) as id", [input.id, input.session, input.state, input.proof])).rows[0].id);
}

/** @param db 관리자 연결. @param id 합성 요청 ID. @returns 상태와 비밀값 제거 여부 검사용 행. */
export async function flowRow(db: Client, id: string) {
  return (await db.query("select * from app_bank.bank_connection_requests where id=$1", [id])).rows[0];
}

/** @param db 폐기용 연결. @param input 시작 요청. @returns Callback 수신 후 같은 fixture. */
export async function readyFlow(db: Client, input = flowInput()) {
  await startFlow(db, input);
  await flowCall(db, null, () => db.query("select app_bank.receive_callback($1,$2,false)", [input.state, ENVELOPE]));
  return input;
}

/** @param db 독립 연결. @param input 소유자·세션·proof를 포함한 합성 요청. @returns 한 번만 사용할 암호화 코드. */
export async function claimFlow(db: Client, input: FlowInput) {
  return flowCall(db, input.user, async () => (await db.query("select app_bank.claim_exchange($1,$2,$3) as code", [input.id, input.session, input.proof])).rows[0].code);
}

/** @param db 독립 연결. @param input 교환 중 요청. @param connection 새 연결 UUID. @param access 테스트 봉투. @returns 원자 저장 성공 여부. */
export async function finishFlow(db: Client, input: FlowInput, connection = randomUUID(), access: unknown = ENVELOPE): Promise<boolean> {
  return flowCall(db, input.user, async () => (await db.query("select app_bank.finish_exchange($1,$2,$3,$4,$5,$6,null,clock_timestamp()+interval '1 hour',null,null) as ok", [input.id, input.session, input.proof, connection, ENVELOPE, access])).rows[0].ok);
}

/** @param db 독립 연결. @param input 본인 요청. @param action 고정 cancel/fail/expire. @returns 최종 상태. */
export async function endFlow(db: Client, input: FlowInput, action: string): Promise<string | null> {
  return flowCall(db, input.user, async () => (await db.query("select app_bank.end_request($1,$2,$3,$4) as status", [input.id, input.session, input.proof, action])).rows[0].status);
}
