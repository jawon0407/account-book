import { DELEGATED_JSON_BODY_MAX_BYTES } from "@account-book/contracts/internal-api";
import type { FastifyInstance } from "fastify";

function invalidRequestError(): Error & { statusCode: number } {
  return Object.assign(new Error("DELEGATED_REQUEST_INVALID"), { statusCode: 400 });
}

/**
 * Replaces Fastify's JSON parser so delegated mutation requests retain the exact validated bytes.
 * @param server - Nest's Fastify instance, configured once before it initializes routes.
 */
export function registerRawJsonBody(server: FastifyInstance): void {
  server.removeContentTypeParser("application/json");
  server.addContentTypeParser(
    "application/json",
    {
      // Buffer parsing preserves the request bytes that will be verified.
      parseAs: "buffer",
      // Reject oversized bodies before retaining them in memory.
      bodyLimit: DELEGATED_JSON_BODY_MAX_BYTES,
    },
    (request, body, done) => {
      try {
        if (!Buffer.isBuffer(body)) return done(invalidRequestError());
        const bytes = new Uint8Array(body);
        // Fatal decoding rejects malformed UTF-8 instead of replacing its bytes.
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const parsed = JSON.parse(text) as unknown;
        // Retained only for verification; controllers must not log or return rawBody.
        request.rawBody = bytes;
        done(null, parsed);
      } catch {
        done(invalidRequestError());
      }
    },
  );
}
