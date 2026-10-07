import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreController } from "./core-controller.js";
import { issueCsrfToken } from "../security/csrf.js";
import { SessionOperationError } from "../session/session-service.js";

vi.mock("server-only", () => ({}));
vi.mock("../container.js", () => ({ createRequestContainer: () => ({ coreController: new CoreController({ configuredOrigin: new URL(origin), csrfKey: key, now: () => now, sessions: { resolve }, delegatedApiClient: { request: transport } }) }) }));
const origin = "https://app.example.test";
const now = new Date("2040-01-01T00:00:00.000Z");
const key = Buffer.alloc(32, 19);
const selector = Buffer.alloc(32, 20).toString("base64url");
const id = "123e4567-e89b-42d3-a456-426614174001";
const resolve = vi.fn(async () => { throw new SessionOperationError("expired"); });
const transport = vi.fn();
type Route = Record<string, (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response>;
const routes = [
  [`/transactions/${id}`, await import("../../app/api/transactions/[id]/route.js"), { PATCH: { memo: null, expectedVersion: 1 }, DELETE: { expectedVersion: 1 } }, { id }],
  ["/transactions", await import("../../app/api/transactions/route.js"), { GET: undefined, POST: { accountId: id, categoryId: id, type: "expense", amountKrw: 100, occurredOn: "2040-01-01", idempotencyKey: id } }, {}],
  ["/profile", await import("../../app/api/profile/route.js"), { GET: undefined, PATCH: { nickname: null, expectedVersion: 1 } }, {}],
  ["/accounts", await import("../../app/api/accounts/route.js"), { GET: undefined, POST: { name: "현금", kind: "cash", idempotencyKey: id } }, {}],
  [`/accounts/${id}`, await import("../../app/api/accounts/[id]/route.js"), { PATCH: { name: "현금", expectedVersion: 1 } }, { id }],
  [`/accounts/${id}/archive`, await import("../../app/api/accounts/[id]/archive/route.js"), { POST: { expectedVersion: 1 } }, { id }],
  ["/categories", await import("../../app/api/categories/route.js"), { GET: undefined, POST: { name: "식비", kind: "expense", sortOrder: 0, idempotencyKey: id } }, {}],
  [`/categories/${id}`, await import("../../app/api/categories/[id]/route.js"), { PATCH: { name: "식비", expectedVersion: 1 } }, { id }],
  [`/categories/${id}/archive`, await import("../../app/api/categories/[id]/archive/route.js"), { POST: { expectedVersion: 1 } }, { id }],
] as const;

beforeEach(() => vi.clearAllMocks());
describe.each(routes)("Next Core route %s", (path, exports, methods, params) => {
  for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
    it(`enforces the ${method} authentication/method boundary`, async () => {
      const allowed = Object.hasOwn(methods, method);
      const body = (methods as Record<string, unknown>)[method];
      const request = new Request(`${origin}/api${path}`, { method, headers: { cookie: `__Host-ab_session=${selector}`, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-csrf-token": issueCsrfToken({ selector }, now, key) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const response = await (exports as unknown as Route)[method]!(request, { params: Promise.resolve(params) });
      expect(response.status).toBe(allowed ? 401 : 405);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(resolve).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(transport).not.toHaveBeenCalled();
    });
  }
});
