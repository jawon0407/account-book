import { ApiErrorSchema } from "@account-book/contracts";
import type { ArgumentsHost } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AccessTokenVerificationUnavailableError, InvalidAccessTokenError } from "../auth/jwt-verifier.js";
import { ApiErrorFilter } from "./api-error.filter.js";
import { registerRequestContext } from "./request-context.js";

function run(exception: unknown, requestId = "unsafe\r\ninbound", principal?: { requestId: string }) {
  const headers = new Map<string, string>();
  let status = 0;
  let body: unknown;
  const reply = {
    header(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
    status(value: number) { status = value; return this; },
    send(value: unknown) { body = value; return this; },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId, principal, headers: { authorization: "Bearer response-secret" } }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  new ApiErrorFilter().catch(exception, host);
  return { get body() { return body; }, get status() { return status; }, headers };
}

describe("ApiErrorFilter", () => {
  it("maps authentication failures to one no-store shared envelope", () => {
    const response = run(new InvalidAccessTokenError());
    const parsed = ApiErrorSchema.parse(response.body);

    expect(response.status).toBe(401);
    expect(parsed).toMatchObject({ code: "AUTH_SESSION_EXPIRED", retryable: false, fieldErrors: [] });
    expect(parsed.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe(parsed.requestId);
  });

  it("fails closed on unexpected errors without leaking exception or request data", () => {
    const response = run(new Error("provider-message?token=exception-secret"));
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true, fieldErrors: [] });
    expect(serialized).not.toMatch(/provider-message|exception-secret|response-secret|unsafe|inbound/iu);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses a verified principal correlation ID and maps unavailable verification to a fixed 503", () => {
    const verifiedId = "123e4567-e89b-12d3-a456-426614174002";
    const response = run(new AccessTokenVerificationUnavailableError(), "123e4567-e89b-12d3-a456-426614174003", { requestId: verifiedId });
    const parsed = ApiErrorSchema.parse(response.body);

    expect(response.status).toBe(503);
    expect(parsed).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true, requestId: verifiedId });
    expect(response.headers.get("x-request-id")).toBe(verifiedId);
  });

  it("preserves the error envelope fallback ID when onSend runs after a malformed internal candidate", () => {
    let hook: ((request: never, reply: never, payload: unknown, done: () => void) => void) | undefined;
    const server = { addHook: vi.fn((_name: string, value: typeof hook) => { hook = value; }) } as unknown as FastifyInstance;
    const headers = new Map<string, string>();
    let body: unknown;
    const request = { id: "unsafe", principal: { requestId: "also-unsafe" } };
    const reply = {
      header(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
      status() { return this; },
      send(value: unknown) { body = value; return this; },
    };
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ArgumentsHost;

    new ApiErrorFilter().catch(new InvalidAccessTokenError(), host);
    registerRequestContext(server);
    hook!(request as never, reply as never, undefined, () => undefined);

    expect(headers.get("x-request-id")).toBe(ApiErrorSchema.parse(body).requestId);
  });
});
