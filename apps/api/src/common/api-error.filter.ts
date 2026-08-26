import type { ApiError } from "@account-book/contracts";
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AccessTokenVerificationUnavailableError, InvalidAccessTokenError } from "../auth/jwt-verifier.js";
import { responseRequestId } from "./request-context.js";

const FASTIFY_BODY_TOO_LARGE_MESSAGE = "Request body is too large";

/** Allows only Nest's exact wrapper for Fastify's parser limit error to retain status 413. */
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
   * Sends a no-store authentication or fixed operational error.
   * @param exception - Untrusted thrown value used only for safe failure classification.
   * @param host - Nest HTTP host containing the Fastify request and response.
   * @returns Nothing after sending a status-only 413 or one strict `ApiError` response.
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
    const authenticationFailure = exception instanceof InvalidAccessTokenError;
    const unavailable = exception instanceof AccessTokenVerificationUnavailableError;
    const body: ApiError = {
      code: authenticationFailure ? "AUTH_SESSION_EXPIRED" : "AUTH_PROVIDER_UNAVAILABLE",
      message: authenticationFailure ? "Authentication session has expired." : "Authentication service is unavailable.",
      requestId,
      retryable: unavailable || !authenticationFailure,
      fieldErrors: [],
    };
    reply
      .header("X-Request-Id", requestId)
      .header("Cache-Control", "private, no-store")
      .status(authenticationFailure ? 401 : 503)
      .send(body);
  }
}
