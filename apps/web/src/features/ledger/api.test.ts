import { describe, expect, it } from "vitest";
import ky from "ky";
import { buildApiError } from "@account-book/contracts";

const module = await import("./api.js").catch(() => null);
const id = "11111111-1111-4111-8111-111111111111";
const account = { id, kind: "bank", name: "생활비", currentBalanceKrw: -1200, version: 1, archivedAt: null, createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z" };

/** 실제 ky의 네트워크 경계만 교체한다. 호출 경로/헤더/본문을 기록해 API 동작을 검사한다. */
function setup(responses: unknown[]) {
  const requests: Request[] = [];
  const http = ky.create({ prefix: "https://local.example.test/api", retry: 0, fetch: async (input) => {
    requests.push((input as Request).clone());
    const next = responses.shift();
    return next instanceof Response ? next : Response.json(next);
  } });
  expect(module?.createLedgerApi).toBeTypeOf("function");
  return { api: module!.createLedgerApi(http, id), requests };
}

describe("ledger browser boundary", () => {
  it("reads only the fixed BFF list with includeArchived and no HTTP cache", async () => {
    const { api, requests } = setup([{ items: [account] }]);
    await expect(api.accounts.list(true, new AbortController().signal)).resolves.toEqual({ items: [account] });
    expect(requests[0]?.url).toBe("https://local.example.test/api/accounts?includeArchived=true");
    expect(requests[0]?.cache).toBe("no-store");
    expect(requests[0]?.headers.get("X-Account-Book-User")).toBe(id);
  });
  it("gets CSRF before creating and preserves the caller's idempotency key", async () => {
    const { api, requests } = setup([{ csrfToken: "test-only-csrf" }, account]);
    const input = { idempotencyKey: id, kind: "bank" as const, name: " 생활비 " };
    await expect(api.accounts.create(input)).resolves.toEqual(account);
    expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([["GET", "/api/auth/csrf"], ["POST", "/api/accounts"]]);
    expect(requests[1]?.headers.get("X-CSRF-Token")).toBe("test-only-csrf");
    expect(requests.every((request) => request.headers.get("X-Account-Book-User") === id)).toBe(true);
    expect(await requests[1]?.json()).toEqual({ ...input, name: "생활비" });
  });
  it("rejects invalid identifiers and privilege fields before making a request", async () => {
    const { api, requests } = setup([]);
    await expect(api.accounts.update("../profile", { name: "x", expectedVersion: 1 })).rejects.toBeDefined();
    await expect(api.profile.update({ nickname: "x", expectedVersion: 1, role: "admin" } as never)).rejects.toBeDefined();
    expect(requests).toHaveLength(0);
  });
  it("does not display malformed data as a successful list", async () => {
    const { api } = setup([{ items: [{ ...account, currentBalanceKrw: "secret" }] }]);
    await expect(api.accounts.list(false)).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
  });
  it("never retries a write conflict or retains the raw exception", async () => {
    const conflict = buildApiError({ code: "LEDGER_VERSION_CONFLICT", retryable: false });
    const { api, requests } = setup([{ csrfToken: "test-only" }, Response.json(conflict, { status: 409 })]);
    await expect(api.accounts.update(id, { name: "변경", expectedVersion: 1 })).rejects.toMatchObject({ code: "LEDGER_VERSION_CONFLICT" });
    expect(requests).toHaveLength(2);
  });
  it("uses POST for archive with expectedVersion", async () => {
    const { api, requests } = setup([{ csrfToken: "test-only" }, { ...account, archivedAt: account.updatedAt }]);
    await api.accounts.archive(id, { expectedVersion: 1 });
    expect(requests[1]?.method).toBe("POST");
    expect(new URL(requests[1]!.url).pathname).toBe(`/api/accounts/${id}/archive`);
    expect(await requests[1]?.json()).toEqual({ expectedVersion: 1 });
  });
});
