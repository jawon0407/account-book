import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  ACCESS_TOKEN_VERIFIER,
  DelegatedJwtVerifier,
} from "../auth/jwt-verifier.js";
import { getApiEnvironment } from "../environment.js";
import { PostgresReplayStore } from "../persistence/postgres-replay-store.js";
import { REPLAY_STORE } from "../persistence/replay-store.js";
import { MeController } from "./me.controller.js";

/** Process-owned pool token so all protected-route verifiers share one bounded database client. */
export const API_DATABASE_POOL = Symbol("API_DATABASE_POOL");

/** Wires the protected current-user route to one static-key verifier and replay store. */
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: API_DATABASE_POOL,
      /**
       * API 전용 설정으로 최대 5개 연결을 관리하는 풀을 만든다.
       * @returns 보호 경로에서 공유할 PostgreSQL 풀. 생성 시 금융 데이터를 조회하지 않는다.
       * @throws 환경 변수가 잘못되면 설정 오류.
       */
      useFactory: () => {
        const environment = getApiEnvironment();
        const pool = new Pool({
          connectionString: environment.apiDatabaseUrl,
          max: 5,
          connectionTimeoutMillis: 2_000,
          idleTimeoutMillis: 10_000,
          allowExitOnIdle: true,
        });
        let reportedIdleError = false;
        // 유휴 연결 오류를 풀별 최초 한 번의 고정 진단으로 바꾼다. 오류와 client 인수는 비밀 노출을 막기 위해 사용하지 않는다.
        pool.on("error", () => {
          if (reportedIdleError) return;
          reportedIdleError = true;
          try {
            console.error("DB_POOL_IDLE_ERROR source=api");
          } catch {
            // 진단 출력 실패가 DB 이벤트를 다시 처리되지 않은 예외로 만들지 않게 한다.
          }
        });
        return pool;
      },
    },
    {
      provide: REPLAY_STORE,
      inject: [API_DATABASE_POOL],
      /**
       * 주입된 연결 풀을 재사용 차단 저장소에 연결한다.
       * @param pool - API 프로세스가 공유하는 DB 풀.
       * @returns 풀의 종료도 책임지는 재사용 차단 저장소.
       */
      useFactory: (pool: Pool) => new PostgresReplayStore(pool),
    },
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [REPLAY_STORE],
      /**
       * API 운영 설정과 재사용 차단 저장소를 결합해 JWT 검증기를 만든다.
       * @param replayStore - 검증된 토큰 사용을 한 번만 허용할 DB 저장소.
       * @returns 로컬 공개키와 정확한 요청 결합을 사용하는 위임 JWT 검증기.
       * @throws 환경 설정 오류. 생성 자체는 토큰을 소비하지 않는다.
       */
      useFactory: (replayStore: PostgresReplayStore) => {
        const environment = getApiEnvironment();
        return new DelegatedJwtVerifier({
          authDisabled: environment.bffAuthDisabled,
          acceptedKids: environment.bffJwtAcceptedKids,
          keyring: environment.bffJwtPublicKeys,
          replayStore,
        });
      },
    },
    AuthGuard,
  ],
})
export class MeModule {}
