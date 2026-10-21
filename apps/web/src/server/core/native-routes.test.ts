import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ handle: vi.fn(async () => new Response(null, { status: 204 })) }));
vi.mock("../container.js", () => ({ createRequestContainer: () => ({ nativeCoreController: { handle: mocks.handle } }) }));

const routes = [
  ["collector", { GET: "collectorGet", PATCH: "collectorChange" }],
  ["profile", { GET: "profileGet", PATCH: "profileUpdate" }],
  ["accounts", { GET: "accountsList", POST: "accountsCreate" }],
  ["accounts/[id]", { PATCH: "accountsUpdate" }],
  ["accounts/[id]/archive", { POST: "accountsArchive" }],
  ["categories", { GET: "categoriesList", POST: "categoriesCreate" }],
  ["categories/[id]", { PATCH: "categoriesUpdate" }],
  ["categories/[id]/archive", { POST: "categoriesArchive" }],
  ["transactions", { GET: "transactionsList", POST: "transactionsCreate" }],
  ["transactions/[id]", { PATCH: "transactionsUpdate", DELETE: "transactionsDelete" }],
] as const;
const modules = {
  collector: () => import("../../app/api/native/collector/route.js"),
  profile: () => import("../../app/api/native/profile/route.js"),
  accounts: () => import("../../app/api/native/accounts/route.js"),
  "accounts/[id]": () => import("../../app/api/native/accounts/[id]/route.js"),
  "accounts/[id]/archive": () => import("../../app/api/native/accounts/[id]/archive/route.js"),
  categories: () => import("../../app/api/native/categories/route.js"),
  "categories/[id]": () => import("../../app/api/native/categories/[id]/route.js"),
  "categories/[id]/archive": () => import("../../app/api/native/categories/[id]/archive/route.js"),
  transactions: () => import("../../app/api/native/transactions/route.js"),
  "transactions/[id]": () => import("../../app/api/native/transactions/[id]/route.js"),
};
describe("native ledger route wiring", () => {
  it.each(routes)("fixes methods and operations at %s", async (path, operations) => {
    const module = await modules[path]() as Record<string, unknown>;
    expect(module.runtime).toBe("nodejs"); expect(module.dynamic).toBe("force-dynamic"); expect(module.maxDuration).toBe(10);
    for (const method of ["GET", "POST", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS"]) {
      mocks.handle.mockClear();
      const fn = module[method] as (request: Request, context: unknown) => Promise<Response>;
      expect(fn).toBeTypeOf("function");
      const request = new Request("https://app.example.test/api/native/" + path.replace("[id]", "123"), { method });
      const params = path.includes("[id]") ? { id: "123" } : {};
      const response = await fn(request, { params: Promise.resolve(params) });
      const operation = (operations as Record<string, string>)[method];
      if (operation) {
        expect(response.status).toBe(204);
        expect(mocks.handle).toHaveBeenCalledWith(operation, request, params);
      } else {
        expect(response.status).toBe(405); expect(mocks.handle).not.toHaveBeenCalled();
        expect(response.headers.get("cache-control")).toContain("no-store");
      }
    }
  });
});
