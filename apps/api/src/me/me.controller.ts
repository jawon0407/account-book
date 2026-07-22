import type { CurrentUser } from "@account-book/contracts";
import { Controller, Get, Header, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthGuard } from "../auth/auth.guard.js";
import { InvalidAccessTokenError } from "../auth/jwt-verifier.js";

/** Protected current-user endpoint backed only by the verified request principal. */
@Controller("v1/me")
@UseGuards(AuthGuard)
export class MeController {
  /**
   * Builds the shared current-user response from the verified principal.
   * @param request - Fastify request populated only after the JWT guard succeeds.
   * @returns Public identity data with no arbitrary JWT profile claims.
   * @throws A fixed authentication failure if the guard invariant is ever absent.
   */
  @Get()
  @Header("Cache-Control", "private, no-store")
  public me(@Req() request: FastifyRequest): CurrentUser {
    if (request.principal === undefined) throw new InvalidAccessTokenError();
    return { id: request.principal.userId, email: null, emailVerified: true };
  }
}
