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
      useFactory: () => {
        const environment = getApiEnvironment();
        return new Pool({
          connectionString: environment.apiDatabaseUrl,
          max: 5,
          connectionTimeoutMillis: 2_000,
          idleTimeoutMillis: 10_000,
          allowExitOnIdle: true,
        });
      },
    },
    {
      provide: REPLAY_STORE,
      inject: [API_DATABASE_POOL],
      useFactory: (pool: Pool) => new PostgresReplayStore(pool),
    },
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [REPLAY_STORE],
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
