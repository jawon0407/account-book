import type { Pool, PoolClient } from "pg";
import { CoreError } from "../core/core-error.js";
import { UserDatabase, type DbClient } from "../core/user-database.js";
import { bankUnavailable } from "./bank-error.js";

/** 기존 API 풀을 재사용한다. 외부 공급자 요청은 이 클래스 밖에서 실행한다. */
export class BankDatabase {
  private readonly users: UserDatabase;
  /** @param pool app_api 권한의 공유 풀. 이 클래스는 풀의 수명을 소유하지 않는다. */
  public constructor(private readonly pool: Pick<Pool, "connect">) { this.users = new UserDatabase(pool); }
  /** @param userId 검증한 사용자. @param operation 동일 transaction 작업. @returns commit 확인 후 결과. */
  public async user<T>(userId: string, operation: (client: DbClient) => Promise<T>): Promise<T> {
    try { return await this.users.run(userId, operation); }
    catch (error) { if (error instanceof CoreError && error.code === "AUTH_SESSION_EXPIRED") throw error; throw bankUnavailable(); }
  }
  /** @param operation 공개 Callback의 최소 DB 함수 호출. @returns 제한·상태 변경 commit 확인 후 결과. */
  public async callback<T>(operation: (client: DbClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined, discard = false;
    try {
      client = await this.pool.connect();
      await client.query("begin");
      await client.query("set local statement_timeout='5s'; set local lock_timeout='1s'; set local idle_in_transaction_session_timeout='5s'");
      // 풀에서 이전 사용자 문맥이 남더라도 공개 Callback은 이를 사용할 수 없다.
      await client.query("select set_config('app.user_id','',true)");
      const result = await operation(client);
      await client.query("commit"); return result;
    } catch {
      if (client) { try { await client.query("rollback"); } catch { discard = true; } }
      throw bankUnavailable();
    } finally { client?.release(discard); }
  }
}
