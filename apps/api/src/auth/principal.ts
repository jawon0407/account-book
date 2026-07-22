/** Principal derived exclusively from a fully verified access JWT. */
export type AuthPrincipal = Readonly<{ userId: string; sessionId: string }>;

declare module "fastify" {
  interface FastifyRequest {
    principal?: AuthPrincipal;
  }
}
