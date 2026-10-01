import { describe, expect, it } from "vitest";
import ky from "ky";
import { createTransactionsApi } from "./api.js";
import { transactionQuery } from "./query-options.js";
const id = "11111111-1111-4111-8111-111111111111";
const input = { accountId: id, categoryId: id, type: "expense" as const, amountKrw: 100, occurredOn: "2026-10-01", idempotencyKey: id };
const row = { id, accountId: id, categoryId: id, kind: "expense", amountKrw: 100, occurredOn: "2026-10-01", memo: null, transferId: null, deletedAt: null, version: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
/** @param responses 合成 응답. @returns 실제 ky 요청을 기록하는 테스트 경계. */
function setup(responses: unknown[]) {
  const calls: Request[] = [];
  const http = ky.create({ prefix: "https://test.local/api", fetch: async value => { calls.push((value as Request).clone()); return Response.json(responses.shift()); } });
  return { calls, api: createTransactionsApi(http, id) };
}
describe("transaction browser transport", () => {
  it("binds user/filter/cursor and no-store without automatic retries", async () => {
    const { api, calls } = setup([{ items: [row], nextCursor: null }]);
    expect((await api.list({ type: "expense", limit: 2 })).items).toHaveLength(1);
    expect(calls[0]?.url).toContain("limit=2"); expect(calls[0]?.cache).toBe("no-store");
    expect(calls[0]?.headers.get("X-Account-Book-User")).toBe(id);
    const query = transactionQuery(id, { type: "expense" }, api);
    expect(query.queryKey).toEqual(["ledger", id, "transactions", { type: "expense" }]);
  });
  it("gets CSRF, validates body, and preserves idempotency", async () => {
    const { api, calls } = setup([{ csrfToken: "test" }, row]);
    await api.create(input);
    expect(calls[1]?.headers.get("X-CSRF-Token")).toBe("test"); expect(await calls[1]?.json()).toEqual(input);
    await expect(api.create({ ...input, userId: id } as never)).rejects.toBeDefined();
    expect(calls).toHaveLength(2);
  });
  it("fails closed on malformed response or query", async () => {
    const { api, calls } = setup([{ items: [{ ...row, userId: id }], nextCursor: null }]);
    await expect(api.list({})).rejects.toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
    await expect(api.list({ limit: 0 })).rejects.toBeDefined(); expect(calls).toHaveLength(1);
  });
});
