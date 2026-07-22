import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";

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
  server.addHook("onRequest", (request, reply, done) => {
    reply.header("X-Request-Id", request.id);
    done();
  });
}
