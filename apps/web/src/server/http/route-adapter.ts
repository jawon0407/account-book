import "server-only";

import { createRequestContainer, type RequestContainer } from "../container.js";

const OPERATIONS = new Set(["csrf", "signUp", "signIn", "emailCallback", "oauthStart", "oauthCallback", "session", "refresh", "signOut", "passwordResetRequest", "passwordCallback", "passwordUpdate", "me"]);

type RouteContext = Readonly<{ params?: Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>> }>;
type ContainerFactory = () => RequestContainer;

/**
 * Creates one dependency graph, resolves trusted filesystem route parameters, and delegates to the controller.
 * @param operation - Fixed operation name selected by a route module, never by request input.
 * @param request - The standard request passed unchanged to the controller.
 * @param context - Optional Next route context containing only path parameters.
 * @param factory - Request-scoped container factory; injectable for deterministic tests.
 * @returns The controller response without route-level domain logic.
 */
export async function handleAuthRoute(operation: string, request: Request, context: RouteContext = {}, factory: ContainerFactory = createRequestContainer): Promise<Response> {
  if (!OPERATIONS.has(operation)) throw new Error("AUTH_ROUTE_INVALID");
  const container = factory();
  const candidate = (container.authController as unknown as Record<string, unknown>)[operation];
  if (typeof candidate !== "function") throw new Error("AUTH_ROUTE_INVALID");
  const parameters = context.params === undefined ? {} : await context.params;
  return (candidate as (request: Request, parameters: Readonly<Record<string, string>>) => Promise<Response>).call(container.authController, request, parameters);
}
