import type { ApiError } from "@account-book/contracts";
import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { InvalidAccessTokenError } from "../auth/jwt-verifier.js";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function safeRequestId(value: unknown): string {
  return typeof value === "string" && CANONICAL_UUID.test(value) ? value : randomUUID();
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
   * @returns Nothing after sending exactly one strict `ApiError` response.
   */
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = safeRequestId(request.id);
    const authenticationFailure = exception instanceof InvalidAccessTokenError;
    const body: ApiError = {
      code: authenticationFailure ? "AUTH_SESSION_EXPIRED" : "AUTH_PROVIDER_UNAVAILABLE",
      message: authenticationFailure ? "Authentication session has expired." : "Authentication service is unavailable.",
      requestId,
      retryable: !authenticationFailure,
      fieldErrors: [],
    };
    reply
      .header("X-Request-Id", requestId)
      .header("Cache-Control", "private, no-store")
      .status(authenticationFailure ? 401 : 503)
      .send(body);
  }
}
