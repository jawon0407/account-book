import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createApiFastifyAdapter, registerRequestContext } from "./request-context.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const verifiedId = "123e4567-e89b-12d3-a456-426614174002";

/**
 * 등록되는 onSend 훅을 잡아 직접 호출하고 응답 추적 헤더를 관찰한다.
 * @param request - 정상·잘못된 ID를 담은 요청 대역.
 * @returns 훅이 설정한 X-Request-Id. 실제 HTTP 응답은 보내지 않는다.
 */
function run(request: Record<string, unknown>): string | undefined {
  let hook: ((request: never, reply: never, payload: unknown, done: () => void) => void) | undefined;
  const server = { addHook: vi.fn((_name: string, value: typeof hook) => { hook = value; }) } as unknown as FastifyInstance;
  const headers = new Map<string, string>();
  registerRequestContext(server);
  hook!(request as never, { header: (name: string, value: string) => { headers.set(name, value); } } as never, undefined, () => undefined);
  return headers.get("X-Request-Id");
}

describe("request context", () => {
  it("does not use an inbound X-Request-Id as Fastify's local request ID", async () => {
    const adapter = createApiFastifyAdapter();
    const server = adapter.getInstance();
    server.get("/request-id", (request) => ({ requestId: request.id }));
    await server.ready();
    const response = await server.inject({ method: "GET", url: "/request-id", headers: { "x-request-id": "attacker-owned" } });
    await server.close();

    expect(response.json().requestId).toMatch(UUID);
    expect(response.json().requestId).not.toBe("attacker-owned");
  });

  it("uses the verified delegated request ID only after principal attachment", () => {
    expect(run({ id: "attacker-owned", principal: { requestId: verifiedId } })).toBe(verifiedId);
  });

  it.each([
    ["public", { id: "123e4567-e89b-12d3-a456-426614174003" }],
    ["rejected", { id: "123e4567-e89b-12d3-a456-426614174004", principal: undefined }],
    ["malformed internal", { id: "unsafe", principal: { requestId: "unsafe" } }],
  ])("returns a canonical local ID for %s requests", (_name, request) => {
    expect(run(request)).toMatch(UUID);
  });
});
