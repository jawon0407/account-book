import { Controller, Get, Header, HttpCode, Inject, Param, Post, Req, UseFilters, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireDelegatedScope } from "../auth/delegated-scope.js";
import { InvalidAccessTokenError } from "../auth/jwt-verifier.js";
import { BankError, bankUnavailable } from "./bank-error.js";
import { BankErrorFilter } from "./bank-error.filter.js";
import type { BankConnectionService } from "./bank-service.js";
import { BANK_SERVICE } from "./bank.tokens.js";

/** BFF 전용 경계. 사용자와 세션은 30초 위임 JWT의 principal에서만 얻는다. */
@Controller("v1/bank-connections")
@UseGuards(AuthGuard)
@UseFilters(BankErrorFilter)
export class BankController {
  /** @param service 공급자 설정이 검증되지 않으면 null인 서비스. */
  public constructor(@Inject(BANK_SERVICE) private readonly service: BankConnectionService | null) {}
  /** @param request 시작 JSON과 검증된 principal. @returns 은행 인가 이동 URL과 요청 ID. */
  @Post("kftc/start")
  @HttpCode(200)
  @RequireDelegatedScope("bank-connection:write")
  @Header("Cache-Control", "private, no-store")
  @Header("Referrer-Policy", "no-referrer")
  public start(@Req() request: FastifyRequest) {
    const who = this.identity(request);
    if (!this.service) throw bankUnavailable();
    return this.service.start(who, request.body);
  }
  /** @param request 요청 ID·BFF proof 지문. @returns 교환 완료 상태. */
  @Post("kftc/complete")
  @HttpCode(200)
  @RequireDelegatedScope("bank-connection:write")
  @Header("Cache-Control", "private, no-store")
  @Header("Referrer-Policy", "no-referrer")
  public complete(@Req() request: FastifyRequest) {
    const who = this.identity(request);
    if (!this.service) throw bankUnavailable();
    return this.service.complete(who, request.body);
  }
  /** @param id 요청 UUID. @param request 검증된 본인. @returns 같은 세션의 공개 상태만. */
  @Get("requests/:requestId")
  @RequireDelegatedScope("bank-connection:read")
  @Header("Cache-Control", "private, no-store")
  @Header("Referrer-Policy", "no-referrer")
  public status(@Param("requestId") id: string, @Req() request: FastifyRequest) {
    const who = this.identity(request);
    if (!this.service) throw bankUnavailable();
    return this.service.status(who, id);
  }
  /** @param request 가드를 통과한 요청. @returns 클라이언트가 바꿀 수 없는 본인/세션. 추가 query는 거절. */
  private identity(request: FastifyRequest) {
    if (!request.principal) throw new InvalidAccessTokenError();
    if (Object.keys(request.query as object).length) throw new BankError("BANK_INVALID_REQUEST", 400);
    const { userId, sessionId } = request.principal;
    return { userId, sessionId };
  }
}
