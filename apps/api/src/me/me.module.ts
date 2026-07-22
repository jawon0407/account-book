import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  ACCESS_TOKEN_VERIFIER,
  createRemoteAccessTokenVerifier,
} from "../auth/jwt-verifier.js";
import { getApiEnvironment } from "../environment.js";
import { MeController } from "./me.controller.js";

/** Wires the protected current-user route to the singleton remote-JWKS verifier. */
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useFactory: () => {
        const environment = getApiEnvironment();
        return createRemoteAccessTokenVerifier({
          jwksUrl: environment.authJwksUrl,
          issuer: environment.authJwtIssuer,
          audience: environment.authJwtAudience,
          algorithm: environment.authJwtAlgorithm,
        });
      },
    },
    AuthGuard,
  ],
})
export class MeModule {}
