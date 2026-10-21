import type { Pool, PoolClient } from "pg";
import { CoreError, unavailable } from "./core-error.js";

export type DbClient = Pick<PoolClient, "query">;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** 검증된 사용자 문맥을 하나의 DB transaction에만 붙인다. 풀 수명은 기존 replay 저장소가 소유한다. */
export class UserDatabase {
  /** @param pool API 전용 최소 권한 연결 풀. 이 클래스는 별도 풀을 만들거나 종료하지 않는다. */
  public constructor(private readonly pool: Pick<Pool, "connect">) {}

  /**
   * 활성 수집 세션과 버전을 잠근 뒤 같은 transaction에서만 자동 기록을 허용한다.
   * @param userId 검증된 JWT sub. @param sessionId 검증된 JWT sid(요청 본문의 기기 ID가 아님).
   * @param version 활성화/교체 응답의 양수 버전. @param operation 같은 연결로 실행할 수집 저장 작업.
   * @returns 권한 검사와 저장 commit까지 성공한 결과. 수기 입력은 이 메서드가 아닌 run을 사용한다.
   */
  public async runCollector<T>(userId: string, sessionId: string, version: number, operation: (client: DbClient) => Promise<T>): Promise<T> {
    if (!USER_ID.test(sessionId) || !Number.isInteger(version) || version < 1 || version > 2147483647)
      throw new CoreError("AUTH_SESSION_EXPIRED", 401);
    return this.run(userId, async client => {
      const result = await client.query<{ allowed: boolean }>("select app_private.lock_active_collector($1,$2) as allowed", [sessionId,version]);
      if (result.rows[0]?.allowed !== true) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
      return operation(client);
    });
  }

  /**
   * 활성 회원만 작업을 실행하고 성공 시 commit, 실패 시 rollback한다.
   * @param userId AuthGuard의 검증된 소문자 UUID. @param operation 동일 연결로 실행할 저장소 작업.
   * @returns commit까지 성공한 작업 결과. 불확실한 commit 결과는 성공처럼 반환하지 않는다.
   */
  public async run<T>(userId: string, operation: (client: DbClient) => Promise<T>): Promise<T> {
    if (!USER_ID.test(userId)) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
    let client: PoolClient | undefined, discard = false;
    try {
      client = await this.pool.connect();
      await client.query("begin");
      await client.query("set local statement_timeout='5s'; set local lock_timeout='1s'; set local idle_in_transaction_session_timeout='5s'");
      await client.query("select set_config('app.user_id',$1,true)", [userId]);
      const active = await client.query<{ active: boolean }>("select \"user\".is_active_user() as active");
      if (active.rows[0]?.active !== true) throw new CoreError("AUTH_SESSION_EXPIRED", 401);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      if (client) { try { await client.query("rollback"); } catch { discard = true; } }
      throw error instanceof CoreError ? error : unavailable();
    } finally { client?.release(discard); }
  }
}
