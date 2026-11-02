import { buildApiError } from "@account-book/contracts";
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AccessTokenVerificationUnavailableError, InvalidAccessTokenError } from "../auth/jwt-verifier.js";
import { responseRequestId } from "./request-context.js";
import { CoreError } from "../core/core-error.js";

const FASTIFY_BODY_TOO_LARGE_MESSAGE = "Request body is too large";

/**
 * Fastify 본문 크기 초과를 감싼 정확한 Nest 오류만 특별한 413 응답 대상으로 인정한다.
 * @param exception - 신뢰하지 않는 예외 값.
 * @returns 생성자·이름·메시지·상태·응답·원인까지 기대한 형태와 일치하면 true.
 */
function isFastifyBodyTooLargeError(exception: unknown): boolean {
  return exception instanceof HttpException
    && exception.constructor === HttpException
    && exception.name === "HttpException"
    && exception.message === FASTIFY_BODY_TOO_LARGE_MESSAGE
    && exception.getStatus() === 413
    && exception.getResponse() === FASTIFY_BODY_TOO_LARGE_MESSAGE
    && exception.cause === undefined;
}

/**
 * Converts every thrown HTTP-boundary failure into a fixed shared error envelope.
 * Authentication classification precedes the generic operational fallback, and neither branch
 * serializes the exception, request headers/body, URLs, tokens, or environment values.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  /**
   * 예외를 안전한 고정 응답으로 바꾸고 브라우저 캐시를 금지한다.
   * @param exception - 분류에만 사용할 예외. 원문이나 스택은 응답에 넣지 않는다.
   * @param host - Fastify 요청과 응답이 들어 있는 Nest HTTP 문맥.
   * @returns 반환값 없음. 본문 없는 413, 인증 실패 401, 그 외 503 응답을 직접 전송한다.
   */
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = responseRequestId(request);
    if (isFastifyBodyTooLargeError(exception)) {
      reply
        .header("X-Request-Id", requestId)
        .header("Cache-Control", "private, no-store")
        .status(413)
        .send();
      return;
    }
    if (exception instanceof CoreError) {
      reply.header("X-Request-Id", requestId).header("Cache-Control", "private, no-store")
        .status(exception.status).send(buildApiError({ code: exception.code, requestId, retryable: exception.retryable, fieldErrors: [] }));
      return;
    }
    const authenticationFailure = exception instanceof InvalidAccessTokenError;
    const unavailable = exception instanceof AccessTokenVerificationUnavailableError;
    const body = buildApiError({
      code: authenticationFailure ? "AUTH_SESSION_EXPIRED" : "AUTH_PROVIDER_UNAVAILABLE",
      requestId,
      retryable: unavailable || !authenticationFailure,
      fieldErrors: [],
    });
    reply
      .header("X-Request-Id", requestId)
      .header("Cache-Control", "private, no-store")
      .status(authenticationFailure ? 401 : 503)
      .send(body);
  }
}
