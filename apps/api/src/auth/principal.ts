import type { DelegatedClientChannel, DelegatedScope } from "@account-book/contracts/internal-api";

/** Principal derived only after a delegated JWT, its request binding, and replay state all verify. */
export type AuthPrincipal = Readonly<{
  clientChannel: DelegatedClientChannel;
  userId: string;
  sessionId: string;
  scope: DelegatedScope;
  requestId: string;
}>;

declare module "fastify" {
  interface FastifyRequest {
    principal?: AuthPrincipal;
  }
}
