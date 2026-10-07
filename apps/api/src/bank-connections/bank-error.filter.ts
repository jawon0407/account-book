import { buildApiError } from "@account-book/contracts";
import { Catch, type ArgumentsHost } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorFilter } from "../common/api-error.filter.js";
import { responseRequestId } from "../common/request-context.js";
import { BankError } from "./bank-error.js";

/** 은행 오류는 고정 계약으로, 인증 오류는 기존 필터로 처리한다. URL/코드/토큰은 출력하지 않는다. */
@Catch()
export class BankErrorFilter extends ApiErrorFilter {
  /** @param exception 원문을 출력하지 않을 예외. @param host HTTP 문맥. @returns no-store/no-referrer 오류 응답. */
  public override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp(), reply = http.getResponse<FastifyReply>();
    reply.header("Referrer-Policy", "no-referrer");
    if (!(exception instanceof BankError)) { super.catch(exception, host); return; }
    const requestId = responseRequestId(http.getRequest<FastifyRequest>());
    if (exception.status === 429 && exception.retryAfter !== undefined) reply.header("Retry-After", String(exception.retryAfter));
    reply.header("X-Request-Id", requestId).header("Cache-Control", "private, no-store")
      .status(exception.status).send(buildApiError({ code: exception.code, requestId,
        retryable: exception.status === 429 || exception.status === 503, fieldErrors: [] }));
  }
}
