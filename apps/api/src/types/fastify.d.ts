import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Uint8Array;
  }
}
