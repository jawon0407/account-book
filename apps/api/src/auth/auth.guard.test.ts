import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard.js";
import { InvalidAccessTokenError, type AccessTokenVerifier } from "./jwt-verifier.js";

const principal = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  sessionId: "123e4567-e89b-12d3-a456-426614174001",
} as const;

function request(rawHeaders: string[]): FastifyRequest {
  return { raw: { rawHeaders } } as unknown as FastifyRequest;
}

function context(value: FastifyRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => value }) } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  it("verifies one canonical Bearer value and attaches only the verified principal", async () => {
    const verify = vi.fn(async () => principal);
    const guard = new AuthGuard({ verify } satisfies AccessTokenVerifier);
    const incoming = request(["Authorization", "Bearer aaa.bbb.ccc"]);

    await expect(guard.canActivate(context(incoming))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith("aaa.bbb.ccc");
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
    const guard = new AuthGuard({ verify });
    const incoming = request(rawHeaders as string[]);

    await expect(guard.canActivate(context(incoming))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(verify).not.toHaveBeenCalled();
    expect(incoming.principal).toBeUndefined();
  });

  it("does not attach a principal when verification fails", async () => {
    const verifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new InvalidAccessTokenError(); }) };
    const guard = new AuthGuard(verifier);
    const incoming = request(["Authorization", "Bearer aaa.bbb.ccc"]);

    await expect(guard.canActivate(context(incoming))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(incoming.principal).toBeUndefined();
  });
});
