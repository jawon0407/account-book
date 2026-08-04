import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RESPONSE_REQUEST_ID = Symbol("responseRequestId");

type CorrelatedRequest = import("fastify").FastifyRequest & {
  [RESPONSE_REQUEST_ID]?: string;
};

/** Returns a safe request identifier without ever reflecting unverified header data. */
function safeRequestId(value: unknown): string {
  return typeof value === "string" && CANONICAL_UUID.test(value) ? value : randomUUID();
}

/**
 * Selects and memoizes one server-trusted response correlation ID for the full response lifecycle.
 * @param request - Fastify request whose verified principal or local ID may be used once validated.
 * @returns The same canonical ID for filters and response hooks without reading inbound header values.
 */
export function responseRequestId(request: CorrelatedRequest): string {
  const existing = request[RESPONSE_REQUEST_ID];
  if (existing !== undefined) return existing;
  const selected = safeRequestId(request.principal?.requestId ?? request.id);
  request[RESPONSE_REQUEST_ID] = selected;
  return selected;
}

/**
 * Creates the Fastify adapter with server-owned UUID request IDs and request logging disabled.
 * @returns A fresh adapter that ignores inbound request-ID headers and fails closed to local IDs.
 */
export function createApiFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    genReqId: () => randomUUID(),
    logger: false,
    requestIdHeader: false,
  });
}

/**
 * Adds the already generated server request ID to every response.
 * @param server - The private Fastify instance owned by the Nest application.
 * @returns Nothing; the hook runs before application handlers and never reads inbound ID headers.
 */
export function registerRequestContext(server: FastifyInstance): void {
  server.addHook("onSend", (request, reply, _payload, done) => {
    // Principal data is usable only after the guard has completed verification and replay consumption.
    reply.header("X-Request-Id", responseRequestId(request));
    done();
  });
}
