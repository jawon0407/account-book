import type { CurrentUser } from "@account-book/contracts";
import { All, Controller, Header, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireDelegatedScope } from "../auth/delegated-scope.js";
import { InvalidAccessTokenError } from "../auth/jwt-verifier.js";

/** Protected current-user endpoint backed only by the verified request principal. */
@Controller("v1/me")
@UseGuards(AuthGuard)
export class MeController {
  /**
   * 인증 가드가 검증한 사용자 ID로 최소한의 현재 사용자 응답을 만든다. DB나 제공자 조회는 하지 않는다.
   * @param request - JWT 검증과 재사용 차단이 끝나 principal이 붙은 Fastify 요청.
   * @returns 사용자 ID와 고정값 email: null, emailVerified: true를 담은 응답.
   * @throws principal이 없으면 InvalidAccessTokenError. 임의의 JWT 프로필 값은 사용하지 않는다.
   */
  @All()
  @RequireDelegatedScope("me:read")
  @Header("Cache-Control", "private, no-store")
  public me(@Req() request: FastifyRequest): CurrentUser {
    if (request.principal === undefined) throw new InvalidAccessTokenError();
    return { id: request.principal.userId, email: null, emailVerified: true };
  }
}
