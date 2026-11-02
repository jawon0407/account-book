import { Controller, Get, Inject, Req, Res, UseFilters } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { bankUnavailable } from "./bank-error.js";
import { BankErrorFilter } from "./bank-error.filter.js";
import type { BankConnectionService } from "./bank-service.js";
import { BANK_SERVICE } from "./bank.tokens.js";

/** 은행 리다이렉트 전용 공개 경계. 다른 보호 경로의 JWT 가드를 해제하지 않는다. */
@Controller("v1/bank-connections/kftc")
@UseFilters(BankErrorFilter)
export class BankCallbackController {
  /** @param service 검증된 서버 설정이 없으면 null. */
  public constructor(@Inject(BANK_SERVICE) private readonly service: BankConnectionService | null) {}
  /** @param request 원본 query와 socket 주소. @param reply 고정 HTTPS 결과 페이지로 303 이동할 응답. */
  @Get("callback")
  public async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    if (!this.service) throw bankUnavailable();
    const raw = request.raw.url ?? "", index = raw.indexOf("?");
    const location = await this.service.callback(index < 0 ? "" : raw.slice(index + 1), request.raw.socket.remoteAddress ?? "");
    reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer").redirect(location, 303);
  }
}
