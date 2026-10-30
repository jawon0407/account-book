import { BankConnectionStatusSchema } from "@account-book/contracts";
import { z } from "zod";
import type { BankDatabase } from "./bank-database.js";
import type { BankCredentials, BankEnvironment, BankIdentity, BankRequestContext } from "./bank-repository.types.js";
import type { BankTokenEnvelope } from "./security/token-envelope.js";

const Id = z.uuid();
const Environment = z.enum(["fake", "test"]);
const Limit = z.object({ allowed: z.boolean(), retryAfterSeconds: z.number().int().min(0).max(300) });
const Context = z.object({ requestId: Id, status: BankConnectionStatusSchema, environment: Environment });
const CallbackContext = z.object({ id: Id, userId: Id, environment: Environment });
const Envelope = z.strictObject({ version: z.literal(1), kid: z.string(), nonce: z.string(), ciphertext: z.string(), tag: z.string() });

/** SQL 함수당 짧은 transaction 하나. quota와 claim을 다음 작업과 묶지 않는다. */
export class BankRepository {
  /** @param database 최소 권한 transaction 실행기. */
  public constructor(private readonly database: BankDatabase) {}
  /** @param who 검증된 본인. @returns 별도 commit된 사용자별 요청 한도. */
  public consumeStart(who: BankIdentity) {
    return this.database.user(who.userId, async c => Limit.parse((await c.query('select allowed,retry_after_seconds as "retryAfterSeconds" from app_bank.consume_start_limit()')).rows[0]));
  }
  /** @param digest 서버가 만든 주소 HMAC. @returns 별도 commit된 Callback 한도. */
  public consumeCallback(digest: Buffer) {
    return this.database.callback(async c => Limit.parse((await c.query('select allowed,retry_after_seconds as "retryAfterSeconds" from app_bank.consume_callback_limit($1)', [digest])).rows[0]));
  }
  /** @param who 본인/세션. @param id 새 UUID. @param environment 서버 환경. @param state state 지문. @param proof BFF 확인 지문. @returns 새 요청 또는 교환 중 충돌 null. */
  public start(who: BankIdentity, id: string, environment: BankEnvironment, state: Buffer, proof: Buffer): Promise<string | null> {
    return this.database.user(who.userId, async c => Id.nullable().parse((await c.query("select app_bank.start_request($1,$2,$3,$4,$5) as id", [id, who.sessionId, environment, state, proof])).rows[0]?.id));
  }
  /** @param digest state 지문. @returns 코드 암호화용 최소 문맥 또는 null. 공개 응답에 사용하지 않는다. */
  public callbackContext(digest: Buffer) {
    return this.database.callback(async c => {
      const row = (await c.query('select id,user_id as "userId",environment from app_bank.callback_context($1)', [digest])).rows[0];
      return row ? CallbackContext.parse(row) : null;
    });
  }
  /** @param digest state 지문. @param envelope 요청에 묶인 암호문/거절 시 null. @param denied 은행 동의 거절. @returns 수락한 요청 ID. */
  public receiveCallback(digest: Buffer, envelope: BankTokenEnvelope | null, denied: boolean) {
    return this.database.callback(async c => Id.nullable().parse((await c.query("select app_bank.receive_callback($1,$2,$3) as id", [digest, envelope, denied])).rows[0]?.id));
  }
  /** @param who 본인/세션. @param id 요청 UUID. @returns 토큰 없는 문맥. 만료는 DB 현재 시각에서 판정한다. */
  public context(who: BankIdentity, id: string): Promise<BankRequestContext | null> {
    return this.database.user(who.userId, async c => {
      const row = (await c.query(`select id as "requestId",environment,
        case when status in ('awaiting_callback','awaiting_completion','exchanging')
          and least(expires_at,code_expires_at)<=clock_timestamp() then 'expired' else status end as status
        from app_bank.bank_connection_requests where id=$1 and user_id=$2 and session_id=$3`, [id, who.userId, who.sessionId])).rows[0];
      return row ? Context.parse(row) : null;
    });
  }
  /** @param who 본인/세션. @param id 요청 UUID. @param proof 확인 지문. @returns commit 이후 단 한 번의 암호문 또는 null. */
  public claim(who: BankIdentity, id: string, proof: Buffer): Promise<BankTokenEnvelope | null> {
    return this.database.user(who.userId, async c => Envelope.nullable().parse((await c.query("select app_bank.claim_exchange($1,$2,$3) as code", [id, who.sessionId, proof])).rows[0]?.code));
  }
  /** @param who 본인/세션. @param id 요청 UUID. @param proof 확인 지문. @param tokens 새 연결 ID에 결속한 암호문과 검증한 수명. @returns 원자 저장 성공 여부. */
  public finish(who: BankIdentity, id: string, proof: Buffer, tokens: BankCredentials): Promise<boolean> {
    return this.database.user(who.userId, async c => z.boolean().parse((await c.query("select app_bank.finish_exchange($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as ok", [id, who.sessionId, proof, tokens.connectionId, tokens.subject, tokens.access, tokens.refresh, tokens.accessExpiresAt, tokens.refreshExpiresAt, tokens.consentExpiresAt])).rows[0]?.ok));
  }
  /** @param who 본인/세션. @param id 요청 UUID. @param proof 확인 지문. @returns 교환 실패 종료. 이미 종료한 결과는 바꾸지 않는다. */
  public async fail(who: BankIdentity, id: string, proof: Buffer): Promise<void> {
    await this.database.user(who.userId, async c => { await c.query("select app_bank.end_request($1,$2,$3,'fail')", [id, who.sessionId, proof]); });
  }
}
export type BankRepositoryPort = Pick<BankRepository, "consumeStart" | "consumeCallback" | "start" | "callbackContext" | "receiveCallback" | "context" | "claim" | "finish" | "fail">;
