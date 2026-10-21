import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { CoreController } from "./core-controller.js";
import type { SessionService } from "../session/session-service.js";
import type { DelegatedApiRequest } from "../http/delegated-api-client.js";

const origin = "https://app.example.test", id = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222", now = new Date("2040-01-01T00:00:00Z");
const selector = Buffer.alloc(32, 73).toString("base64url"), timestamp = now.toISOString();
const profile = { id, nickname: null, avatarObjectKey: null, signupProvider: "email", role: "member", version: 1, createdAt: timestamp, updatedAt: timestamp };
const account = { id, name: "생활비", kind: "bank", currentBalanceKrw: 0, archivedAt: null, version: 1, createdAt: timestamp, updatedAt: timestamp };
const category = { id, name: "배드민턴", kind: "expense", sortOrder: 0, archivedAt: null, version: 1, createdAt: timestamp, updatedAt: timestamp };
const transaction = { id, accountId: null, categoryId: null, counterpartyName: "체육관", transferId: null, kind: "expense", amountKrw: 2000, occurredOn: "2040-01-01", memo: null, version: 1, deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
const input = { accountId: null, categoryId: null, counterpartyName: "체육관", type: "expense", amountKrw: 2000, occurredOn: "2040-01-01", idempotencyKey: id };

/** 서버 세션만 사용자·채널·설치 ID를 제공하며 외부 요청은 별도로 만든다. */
function setup(output: unknown = profile, status = 200) {
  const sessions = { resolve: vi.fn<SessionService["resolve"]>(async () => ({
    userId: id, sessionId: deviceId, deviceId, clientChannel: "android", accessToken: "private-access", refreshToken: "private-refresh",
    supabaseSessionId: id, rotationVersion: 0, accessTokenExpiresAt: new Date(now.getTime() + 120_000),
  })) };
  const limiter = { consume: vi.fn(async () => true) };
  const delegatedApiClient = { request: vi.fn<(input: DelegatedApiRequest) => Promise<Response>>(async () => Response.json(output, { status })) };
  const deps = { configuredOrigin: new URL(origin), csrfKey: new Uint8Array(32), now: () => now, sessions, delegatedApiClient };
  const controller = new CoreController(deps, { channel: "android", limiter });
  return { controller, sessions, limiter, delegatedApiClient, deps };
}
/** @param path native 경로. @param method HTTP 동작. @param body 선택적 JSON. @param headers 부정 테스트용 헤더. */
function request(path = "/api/native/profile", method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + path, { method, headers: { authorization: `Bearer ${selector}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
/** 공개 오류·캐시 금지·민감정보 비노출을 함께 확인한다. */
async function fails(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  const text = await response.text();
  expect(JSON.parse(text)).toMatchObject({ code });
  expect(text).not.toMatch(/private-access|private-refresh|private-secret/);
}

describe("native ledger boundary", () => {
  it.each([
    ["collectorGet", "/collector", "GET", undefined, {}, { version: 0, state: "inactive" }, 200],
    ["collectorChange", "/collector", "PATCH", { action: "activate", expectedVersion: 0, replaceExisting: false }, {}, { version: 1, state: "active_here" }, 200],
    ["profileGet", "/profile", "GET", undefined, {}, profile, 200],
    ["profileUpdate", "/profile", "PATCH", { nickname: null, expectedVersion: 1 }, {}, profile, 200],
    ["accountsList", "/accounts?includeArchived=true", "GET", undefined, {}, { items: [account] }, 200],
    ["accountsCreate", "/accounts", "POST", { name: "생활비", kind: "bank", idempotencyKey: id }, {}, account, 201],
    ["accountsUpdate", `/accounts/${id}`, "PATCH", { name: "생활비", expectedVersion: 1 }, { id }, account, 200],
    ["accountsArchive", `/accounts/${id}/archive`, "POST", { expectedVersion: 1 }, { id }, account, 200],
    ["categoriesList", "/categories", "GET", undefined, {}, { items: [category] }, 200],
    ["categoriesCreate", "/categories", "POST", { name: "배드민턴", kind: "expense", sortOrder: 0, idempotencyKey: id }, {}, category, 201],
    ["categoriesUpdate", `/categories/${id}`, "PATCH", { sortOrder: 0, expectedVersion: 1 }, { id }, category, 200],
    ["categoriesArchive", `/categories/${id}/archive`, "POST", { expectedVersion: 1 }, { id }, category, 200],
    ["transactionsList", "/transactions?limit=2", "GET", undefined, {}, { items: [transaction], nextCursor: null }, 200],
    ["transactionsCreate", "/transactions", "POST", input, {}, transaction, 201],
    ["transactionsUpdate", `/transactions/${id}`, "PATCH", { memo: null, expectedVersion: 1 }, { id }, transaction, 200],
    ["transactionsDelete", `/transactions/${id}`, "DELETE", { expectedVersion: 1 }, { id }, { id, version: 2, deletedAt: timestamp }, 200],
  ] as const)("binds %s to the trusted Android session", async (operation, path, method, body, params, output, status) => {
    const s = setup(output, status);
    const response = await s.controller.handle(operation, request("/api/native" + path, method, body, { "x-client-channel": "web", "x-account-book-user": id }), params);
    expect(response.status).toBe(status); expect(await response.json()).toEqual(output);
    expect(s.delegatedApiClient.request).toHaveBeenCalledOnce();
    expect(s.delegatedApiClient.request).toHaveBeenCalledWith(expect.objectContaining({ clientChannel: "android", userId: id, sessionId: deviceId, method, target: "/v1" + path }));
    expect(s.limiter.consume.mock.calls).toEqual([[method === "GET" ? "ledgerRead" : "ledgerWrite", "global", "all"], [method === "GET" ? "ledgerRead" : "ledgerWrite", "identity", `${id}:${deviceId}`]]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("rejects collector web access even if the fixed operation were accidentally wired into a web route", async () => {
    const s = setup({ version: 0, state: "inactive" }), session = await s.sessions.resolve(selector, now);
    s.sessions.resolve.mockResolvedValueOnce({ ...session, clientChannel: "web", deviceId: null });
    await fails(await new CoreController(s.deps).handle("collectorGet", new Request(origin + "/api/collector", { headers: { cookie: `__Host-ab_session=${selector}` } })), 403, "LEDGER_CHANNEL_FORBIDDEN");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each([{}, { action: "activate", expectedVersion: 0 }, { action: "deactivate", expectedVersion: 1, sessionId: id }])("rejects collector input %j before upstream", async body => {
    const s = setup(); await fails(await s.controller.handle("collectorChange", request("/api/native/collector", "PATCH", body)), 400, "COLLECTOR_VALIDATION_FAILED");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each([["COLLECTOR_VERSION_CONFLICT", 409], ["COLLECTOR_REPLACE_REQUIRED", 409], ["COLLECTOR_VALIDATION_FAILED", 400], ["COLLECTOR_SERVICE_UNAVAILABLE", 503]] as const)("preserves collector %s without retrying mutations", async (code, status) => {
    const s = setup(buildApiError({ code, retryable: true }), status);
    const response = await s.controller.handle("collectorChange", request("/api/native/collector", "PATCH", { action: "deactivate", expectedVersion: 1 }));
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code, retryable: false });
    expect(s.delegatedApiClient.request).toHaveBeenCalledOnce();
  });
  it.each([{ version: 0, state: "active_here" }, { version: 1, state: "inactive", sessionId: "private-secret" }])("rejects malformed/private collector output %j", async output => {
    const s = setup(output); await fails(await s.controller.handle("collectorGet", request("/api/native/collector")), 502, "LEDGER_SERVICE_UNAVAILABLE");
  });
  it("rejects collector query and browser context", async () => {
    const s = setup();
    await fails(await s.controller.handle("collectorGet", request("/api/native/collector?deviceId=x")), 400, "COLLECTOR_VALIDATION_FAILED");
    await fails(await s.controller.handle("collectorGet", request("/api/native/collector", "GET", undefined, { origin })), 403, "AUTH_CSRF_REJECTED");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each([{ cookie: "" }, { origin }, { "sec-fetch-site": "none" }, { "sec-fetch-mode": "cors" }])("rejects browser context before session access: %j", async headers => {
    const s = setup();
    await fails(await s.controller.handle("profileGet", request(undefined, "GET", undefined, headers)), 403, "AUTH_CSRF_REJECTED");
    expect(s.sessions.resolve).not.toHaveBeenCalled(); expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each(["", "Bearer bad", `Bearer ${selector}, Bearer ${selector}`])("rejects missing or ambiguous native bearer %s", async authorization => {
    const s = setup(); await fails(await s.controller.handle("profileGet", request(undefined, "GET", undefined, { authorization })), 401, "AUTH_SESSION_EXPIRED");
    expect(s.sessions.resolve).not.toHaveBeenCalled();
  });
  it.each(["http://app.example.test/api/native/profile", "https://evil.test/api/native/profile", origin + "/api/profile", origin + "/api/native/profile?owner=x"])( "rejects invalid transport/path/query %s", async url => {
    const s = setup(); const response = await s.controller.handle("profileGet", new Request(url, { headers: { authorization: `Bearer ${selector}` } }));
    expect([400, 403]).toContain(response.status); expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("rejects cross-channel sessions in both directions", async () => {
    const s = setup(), session = await s.sessions.resolve(selector, now); s.sessions.resolve.mockResolvedValueOnce({ ...session, clientChannel: "web", deviceId: null });
    await fails(await s.controller.handle("profileGet", request()), 401, "AUTH_SESSION_EXPIRED");
    const web = new CoreController(s.deps);
    await fails(await web.handle("profileGet", new Request(origin + "/api/profile", { headers: { cookie: `__Host-ab_session=${selector}` } })), 401, "AUTH_SESSION_EXPIRED");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("rejects stale user and near-expiry session without refreshing or forwarding", async () => {
    const s = setup();
    await fails(await s.controller.handle("transactionsCreate", request("/api/native/transactions", "POST", input, { "x-account-book-user": deviceId })), 401, "AUTH_SESSION_EXPIRED");
    const session = await s.sessions.resolve(selector, now); s.sessions.resolve.mockResolvedValueOnce({ ...session, accessTokenExpiresAt: new Date(now.getTime() + 60_000) });
    await fails(await s.controller.handle("profileGet", request()), 401, "AUTH_SESSION_REFRESH_REQUIRED"); expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("rejects a native GET advertising a body before session or rate access", async () => {
    const s = setup();
    await fails(await s.controller.handle("profileGet", request(undefined, "GET", undefined, { "content-length": "1" })), 400, "LEDGER_VALIDATION_FAILED");
    expect(s.sessions.resolve).not.toHaveBeenCalled(); expect(s.limiter.consume).not.toHaveBeenCalled();
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("fails closed on an invalid server-session expiry", async () => {
    const s = setup(), session = await s.sessions.resolve(selector, now);
    s.sessions.resolve.mockResolvedValueOnce({ ...session, accessTokenExpiresAt: new Date(Number.NaN) });
    await fails(await s.controller.handle("profileGet", request()), 503, "AUTH_PROVIDER_UNAVAILABLE");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("rejects an Android session without its server-bound device", async () => {
    const s = setup(), session = await s.sessions.resolve(selector, now);
    s.sessions.resolve.mockResolvedValueOnce({ ...session, deviceId: null });
    await fails(await s.controller.handle("profileGet", request()), 401, "AUTH_SESSION_EXPIRED");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each(["global", "identity", "db"] as const)("fails closed when the %s rate check fails", async stage => {
    const s = setup();
    if (stage === "global") s.limiter.consume.mockResolvedValueOnce(false);
    else if (stage === "identity") s.limiter.consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    else s.limiter.consume.mockRejectedValueOnce(new Error("private-secret"));
    await fails(await s.controller.handle("profileGet", request()), stage === "db" ? 503 : 429, stage === "db" ? "AUTH_PROVIDER_UNAVAILABLE" : "AUTH_RATE_LIMITED");
    expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized bodies before forwarding", async () => {
    for (const body of [{ ...input, userId: id }, { ...input, memo: "x".repeat(17000) }]) {
      const s = setup(); await fails(await s.controller.handle("transactionsCreate", request("/api/native/transactions", "POST", body)), 400, "LEDGER_VALIDATION_FAILED"); expect(s.delegatedApiClient.request).not.toHaveBeenCalled();
    }
  });
  it("checks upstream resource identity and does not replay failed mutations", async () => {
    const s = setup({ ...profile, id: deviceId });
    await fails(await s.controller.handle("profileGet", request()), 502, "LEDGER_SERVICE_UNAVAILABLE");
    s.delegatedApiClient.request.mockRejectedValueOnce(new Error("private-secret"));
    await fails(await s.controller.handle("transactionsCreate", request("/api/native/transactions", "POST", input)), 502, "LEDGER_SERVICE_UNAVAILABLE");
    expect(s.delegatedApiClient.request).toHaveBeenCalledTimes(2);
  });
});
