import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard.js";
import { DELEGATED_SCOPE } from "./delegated-scope.js";
import { InvalidAccessTokenError, type AccessTokenVerifier } from "./jwt-verifier.js";

const principal = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  sessionId: "123e4567-e89b-12d3-a456-426614174001",
  scope: "me:read",
  requestId: "123e4567-e89b-12d3-a456-426614174002",
} as const;

function request(
  rawHeaders: string[],
  options: Readonly<{ method?: string; url?: string; rawBody?: Uint8Array }> = {},
): FastifyRequest {
  return {
    method: options.method ?? "GET",
    raw: { rawHeaders, url: options.url ?? "/v1/me?view=summary" },
    rawBody: options.rawBody,
  } as unknown as FastifyRequest;
}

function context(value: FastifyRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => value }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

class Controller {}
function handler(): void {}

function guard(verifier: AccessTokenVerifier, scope: unknown = "me:read"): AuthGuard {
  const reflector = {
    getAllAndOverride: vi.fn((key: unknown) => key === DELEGATED_SCOPE ? scope : undefined),
  };
  return new AuthGuard(verifier, reflector as never);
}

describe("AuthGuard", () => {
  it.each(["POST", "PATCH", "DELETE"] as const)("passes the exact raw %s JSON mutation binding to the delegated verifier", async (method) => {
    const verify = vi.fn(async () => principal);
    const subject = guard({ verify } satisfies AccessTokenVerifier, "transaction:write");
    const exactBody = new TextEncoder().encode('{"amount":12345}');
    const requestId = "123e4567-e89b-12d3-a456-426614174002";
    const incoming = request([
      "Authorization", "Bearer aaa.bbb.ccc",
      "X-Request-Id", requestId,
      "Content-Type", "application/json; charset=utf-8",
      "Content-Length", "16",
    ], {
      method,
      url: "/v1/test-mutation?b=2&a=1",
      rawBody: exactBody,
    });

    await expect(subject.canActivate(context(incoming))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith({
      token: "aaa.bbb.ccc",
      request: {
        method,
        target: "/v1/test-mutation?b=2&a=1",
        contentType: "application/json",
        body: exactBody,
        requestId,
      },
      requiredScope: "transaction:write",
    });
    expect(verify.mock.calls[0]?.[0].request.body).toBe(exactBody);
  });

  it.each([
    ["PUT", ["Content-Type", "application/json", "Content-Length", "2"], new Uint8Array([123, 125])],
    ["POST", ["Content-Type", "application/json", "Content-Length", "0"], new Uint8Array()],
    ["POST", ["Content-Type", "text/plain", "Content-Length", "2"], new Uint8Array([123, 125])],
    ["POST", ["Content-Type", "application/json", "content-type", "application/json", "Content-Length", "2"], new Uint8Array([123, 125])],
    ["POST", ["Content-Type", "application/json", "Content-Length", "2", "Transfer-Encoding", "chunked"], new Uint8Array([123, 125])],
    ["POST", ["Content-Type", "application/json", "Content-Length", "3"], new Uint8Array([123, 125])],
    ["POST", ["Content-Type", "application/json", "Content-Length", "32769"], new Uint8Array(32_769)],
  ] as const)("rejects unsupported or ambiguously framed %s mutations before verification", async (method, headers, rawBody) => {
    const verify = vi.fn(async () => principal);
    const subject = guard({ verify } satisfies AccessTokenVerifier, "transaction:write");
    const incoming = request([
      "Authorization", "Bearer aaa.bbb.ccc",
      "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002",
      ...headers,
    ], { method, rawBody });

    await expect(subject.canActivate(context(incoming))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(verify).not.toHaveBeenCalled();
  });

  it("passes the exact raw GET request binding and request ID to the delegated verifier", async () => {
    const verify = vi.fn(async () => principal);
    const subject = guard({ verify } satisfies AccessTokenVerifier);
    const incoming = request([
      "Authorization", "Bearer aaa.bbb.ccc",
      "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002",
    ]);

    await expect(subject.canActivate(context(incoming))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith({
      token: "aaa.bbb.ccc",
      request: {
        method: "GET",
        target: "/v1/me?view=summary",
        contentType: null,
        body: new Uint8Array(),
        requestId: "123e4567-e89b-12d3-a456-426614174002",
      },
      requiredScope: "me:read",
    });
    expect(incoming.principal).toEqual(principal);
  });

  it.each([
    ["missing", []],
    ["duplicate", ["Authorization", "Bearer aaa.bbb.ccc", "authorization", "Bearer ddd.eee.fff"]],
    ["coalesced", ["Authorization", "Bearer aaa.bbb.ccc, Bearer ddd.eee.fff"]],
    ["wrong scheme", ["Authorization", "bearer aaa.bbb.ccc"]],
    ["leading whitespace", ["Authorization", " Bearer aaa.bbb.ccc"]],
    ["trailing whitespace", ["Authorization", "Bearer aaa.bbb.ccc "]],
    ["empty token", ["Authorization", "Bearer "]],
    ["control character", ["Authorization", "Bearer aaa.bbb.ccc\u0000"]],
    ["oversized", ["Authorization", `Bearer ${"a".repeat(8186)}`]],
  ])("rejects a %s Authorization value before verification", async (_name, rawHeaders) => {
    const verify = vi.fn(async () => principal);
    const subject = guard({ verify });
    const incoming = request(rawHeaders as string[]);

    await expect(subject.canActivate(context(incoming))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(verify).not.toHaveBeenCalled();
    expect(incoming.principal).toBeUndefined();
  });

  it("does not attach a principal when verification fails", async () => {
    const verifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new InvalidAccessTokenError(); }) };
    const subject = guard(verifier);
    const incoming = request(["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002"]);

    await expect(subject.canActivate(context(incoming))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(incoming.principal).toBeUndefined();
  });

  it.each([
    ["missing", null],
    ["invalid", "admin:read"],
  ])("rejects %s delegated scope before verification", async (_name, scope) => {
    const verify = vi.fn(async () => principal);
    const subject = guard({ verify }, scope);
    const incoming = request(["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002"]);

    await expect(subject.canActivate(context(incoming))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    ["missing request ID", ["Authorization", "Bearer aaa.bbb.ccc"]],
    ["duplicate request ID", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002", "x-request-id", "123e4567-e89b-12d3-a456-426614174003"]],
    ["coalesced request ID", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002, 123e4567-e89b-12d3-a456-426614174003"]],
    ["noncanonical request ID", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123E4567-E89B-12D3-A456-426614174002"]],
    ["content type", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002", "Content-Type", "application/json"]],
    ["transfer encoding", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002", "Transfer-Encoding", "chunked"]],
    ["nonzero content length", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002", "Content-Length", "1"]],
    ["duplicate content length", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002", "Content-Length", "0", "content-length", "0"]],
    ["coalesced content length", ["Authorization", "Bearer aaa.bbb.ccc", "X-Request-Id", "123e4567-e89b-12d3-a456-426614174002", "Content-Length", "0, 0"]],
  ])("rejects %s before verifier invocation", async (_name, rawHeaders) => {
    const verify = vi.fn(async () => principal);
    const subject = guard({ verify });

    await expect(subject.canActivate(context(request(rawHeaders)))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(verify).not.toHaveBeenCalled();
  });
});
