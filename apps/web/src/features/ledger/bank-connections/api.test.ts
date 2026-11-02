import { describe, expect, it, vi } from "vitest";
import ky from "ky";
import { createBankApi } from "./api.js";
const id = "123e4567-e89b-42d3-a456-426614174001";

describe("bank browser client", () => {
  it("uses same-origin BFF, fresh CSRF and expected user, without retrying completion", async () => {
    const seen: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push(request.clone());
      return Response.json(request.url.endsWith("/auth/csrf") ? { csrfToken: "test-csrf" } : { requestId: id, status: "connected" });
    });
    const api = createBankApi(id, ky.create({ prefix: "https://app.invalid/api", fetch: fetcher }));
    expect(await api.complete(id)).toEqual({ requestId: id, status: "connected" });
    expect(seen.map(r => new URL(r.url).pathname)).toEqual(["/api/auth/csrf", "/api/bank-connections/kftc/complete"]);
    expect(seen[1]!.headers.get("x-csrf-token")).toBe("test-csrf"); expect(seen[1]!.headers.get("x-account-book-user")).toBe(id);
    expect(await seen[1]!.json()).toEqual({ requestId: id }); expect(seen[1]!.credentials).toBe("same-origin"); expect(seen[1]!.cache).toBe("no-store");
  });
  it("does not retry failed mutations or leak raw errors", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => new Request(input, init).url.endsWith("csrf") ? Response.json({ csrfToken: "test" }) : new Response("private failure", { status: 503 }));
    const api = createBankApi(id, ky.create({ prefix: "https://app.invalid/api", fetch: fetcher }));
    await expect(api.start()).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([{ requestId: id, status: "connected", token: "secret" }, { requestId: "123e4567-e89b-42d3-a456-426614174002", status: "connected" }])("rejects extra secrets and mismatched status IDs", async result => {
    const api = createBankApi(id, ky.create({ prefix: "https://app.invalid/api", fetch: async () => Response.json(result) }));
    await expect(api.status(id)).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
  });
});
