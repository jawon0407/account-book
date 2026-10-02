import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { issueCsrfToken } from "../security/csrf.js";
import { SessionOperationError } from "../session/session-service.js";
import { DelegatedApiClient } from "../http/delegated-api-client.js";
import { CoreController } from "./core-controller.js";

const origin = "https://app.example.test";
const id = "123e4567-e89b-42d3-a456-426614174001";
const sessionId = "123e4567-e89b-42d3-a456-426614174002";
const key = Buffer.alloc(32, 71);
const selector = Buffer.alloc(32, 72).toString("base64url");
const now = new Date("2040-01-01T00:00:00.000Z");
const profile = { id, nickname: "테스트", avatarObjectKey: null, signupProvider: "email", role: "member", version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const account = { id, name: "현금", kind: "cash", currentBalanceKrw: 0, archivedAt: null, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const category = { id, name: "식비", kind: "expense", sortOrder: 0, archivedAt: null, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const transaction = { id, accountId: id, categoryId: id, transferId: null, kind: "expense", amountKrw: 1000, occurredOn: "2040-01-01", memo: null, version: 1, deletedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const transactionInput = { accountId: id, categoryId: id, type: "expense", amountKrw: 1000, occurredOn: "2040-01-01", idempotencyKey: id };

/** @param reply 외부 HTTP 응답. 실제 BFF/위임 클라이언트를 실행하되 DB 세션 조회와 네트워크/서명만 대역으로 분리한다. */
function setup(reply: Response = Response.json(profile)) {
  const sessions = { resolve: vi.fn(async () => ({ userId: id, sessionId, accessToken: "never-browser-access", refreshToken: "never-browser-refresh", supabaseSessionId: id, rotationVersion: 0, accessTokenExpiresAt: new Date(now.getTime() + 120_000) })) };
  const signer = { sign: vi.fn(async () => ({ requestId: sessionId, token: "server-only-delegated" })) };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply);
  const controller = new CoreController({ configuredOrigin: new URL(origin), csrfKey: key, now: () => now, sessions, delegatedApiClient: new DelegatedApiClient(new URL("https://api.example.test"), signer, fetcher) });
  return { controller, sessions, fetcher, signer };
}

/** @param path 웹 API 경로. @param method 허용할 메서드. @param body JSON 입력. @param overrides 거부 상황용 헤더 덮어쓰기. */
function request(path = "/api/profile", method = "GET", body?: unknown, overrides: Record<string, string> = {}): Request {
  return new Request(origin + path, { method, headers: { cookie: `__Host-ab_session=${selector}`, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-csrf-token": issueCsrfToken({ selector }, now, key), ...overrides }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** @param response 실패 응답. @param status 기대 HTTP 상태. @param code 공개 오류 코드. 토큰/내부 오류 비노출과 캐시 금지도 함께 검증한다. */
async function failure(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  const text = await response.text();
  expect(JSON.parse(text)).toMatchObject({ code });
  expect(text).not.toMatch(/never-browser|server-only-delegated|private-secret|postgres/);
}

afterEach(() => vi.useRealTimers());

describe("Core BFF", () => {
  it.each([
    ["profileGet", "/api/profile", "GET", undefined],
    ["profileUpdate", "/api/profile", "PATCH", { nickname: "이전 계정 입력", expectedVersion: 1 }],
    ["accountsCreate", "/api/accounts", "POST", { name: "이전 계정 계좌", kind: "cash", idempotencyKey: id }],
    ["transactionsCreate", "/api/transactions", "POST", transactionInput],
  ] as const)("rejects stale-account %s requests before delegation", async (operation, path, method, body) => {
    const { controller, fetcher, signer } = setup();
    await failure(await controller.handle(operation, request(path, method, body, { "x-account-book-user": sessionId })), 401, "AUTH_SESSION_EXPIRED");
    expect(fetcher).not.toHaveBeenCalled(); expect(signer.sign).not.toHaveBeenCalled();
  });

  it("accepts an expected-user assertion only when it matches the trusted session", async () => {
    const { controller, signer } = setup();
    expect((await controller.handle("profileGet", request(undefined, "GET", undefined, { "x-account-book-user": id }))).status).toBe(200);
    expect(signer.sign).toHaveBeenCalledWith(expect.objectContaining({ userId: id }));
  });

  it.each([
    ["profileGet", "/api/profile", "GET", undefined, {}, "profile:read", profile, 200],
    ["profileUpdate", "/api/profile", "PATCH", { nickname: " 새 이름 ", expectedVersion: 1 }, {}, "profile:write", profile, 200],
    ["accountsList", "/api/accounts?includeArchived=true", "GET", undefined, {}, "account:read", { items: [account] }, 200],
    ["accountsCreate", "/api/accounts", "POST", { name: " 현금 ", kind: "cash", idempotencyKey: id }, {}, "account:write", account, 201],
    ["accountsUpdate", `/api/accounts/${id}`, "PATCH", { name: "현금", expectedVersion: 1 }, { id }, "account:write", account, 200],
    ["accountsArchive", `/api/accounts/${id}/archive`, "POST", { expectedVersion: 1 }, { id }, "account:write", account, 200],
    ["categoriesList", "/api/categories?includeArchived=false", "GET", undefined, {}, "category:read", { items: [category] }, 200],
    ["categoriesCreate", "/api/categories", "POST", { name: "식비", kind: "expense", sortOrder: 0, idempotencyKey: id }, {}, "category:write", category, 201],
    ["categoriesUpdate", `/api/categories/${id}`, "PATCH", { sortOrder: 0, expectedVersion: 1 }, { id }, "category:write", category, 200],
    ["categoriesArchive", `/api/categories/${id}/archive`, "POST", { expectedVersion: 1 }, { id }, "category:write", category, 200],
    ["transactionsList", "/api/transactions?limit=2&type=expense", "GET", undefined, {}, "transaction:read", { items: [transaction], nextCursor: null }, 200],
    ["transactionsCreate", "/api/transactions", "POST", transactionInput, {}, "transaction:write", transaction, 201],
    ["transactionsUpdate", `/api/transactions/${id}`, "PATCH", { memo: null, expectedVersion: 1 }, { id }, "transaction:write", transaction, 200],
    ["transactionsDelete", `/api/transactions/${id}`, "DELETE", { expectedVersion: 1 }, { id }, "transaction:write", { id, version: 2, deletedAt: now.toISOString() }, 200],
  ] as const)("binds %s to its exact method/scope/target and returns only contract data", async (operation, path, method, body, params, scope, output, status) => {
    const { controller, fetcher, signer } = setup(Response.json(output, { status, headers: { "set-cookie": "upstream-secret", "x-internal": "private-secret" } }));
    const response = await controller.handle(operation, request(path, method, body, { authorization: "attacker", "x-user-id": "attacker", "x-request-id": "attacker" }), params);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(output);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toEqual(new URL(path.replace("/api/", "/v1/"), "https://api.example.test"));
    const input = signer.sign.mock.calls[0] as unknown as [{ body: Uint8Array; scope: string }];
    expect(input[0]).toMatchObject({ method, scope, userId: id, sessionId, target: path.replace("/api/", "/v1/") });
    const sent = fetcher.mock.calls[0]![1]!;
    expect(sent).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(new Headers(sent.headers).has("cookie")).toBe(false);
    if (body !== undefined) {
      expect(sent.body).toBe(input[0].body);
      const parsed = JSON.parse(new TextDecoder().decode(input[0].body));
      expect(parsed).toEqual(JSON.parse(JSON.stringify(body).replace('" 새 이름 "', '"새 이름"').replace('" 현금 "', '"현금"')));
    }
  });

  it.each(["", `__Host-ab_session=${selector}; __Host-ab_session=${selector}`, "__Host-ab_session=bad"])("rejects absent, duplicate or invalid session cookies before DB/API work", async (cookie) => {
    const { controller, sessions, fetcher } = setup();
    await failure(await controller.handle("profileGet", request(undefined, "GET", undefined, { cookie })), 401, "AUTH_SESSION_EXPIRED");
    expect(sessions.resolve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["limit=1&limit=2", "limit=01", "limit=101", "userId=x", "from=2040-01-02&to=2040-01-01"])("rejects transaction query before delegation: %s", async query => {
    const { controller, fetcher } = setup();
    await failure(await controller.handle("transactionsList", request(`/api/transactions?${query}`)), 400, "LEDGER_VALIDATION_FAILED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ origin: "https://attacker.test" }, { "x-csrf-token": "bad" }])("requires origin and CSRF for transaction creation", async headers => {
    const { controller, fetcher } = setup();
    await failure(await controller.handle("transactionsCreate", request("/api/transactions", "POST", transactionInput, headers)), 403, "AUTH_CSRF_REJECTED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["expired", "unavailable", "rate_limited"] as const)("maps session %s without leaking details or calling the API", async (reason) => {
    const { controller, sessions, fetcher } = setup(); sessions.resolve.mockRejectedValueOnce(new SessionOperationError(reason));
    await failure(await controller.handle("profileGet", request()), reason === "expired" ? 401 : reason === "rate_limited" ? 429 : 503, reason === "expired" ? "AUTH_SESSION_EXPIRED" : reason === "rate_limited" ? "AUTH_RATE_LIMITED" : "AUTH_PROVIDER_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks for explicit refresh without silently refreshing while reading", async () => {
    const { controller, sessions, fetcher } = setup();
    const session = await sessions.resolve(); sessions.resolve.mockResolvedValueOnce({ ...session, accessTokenExpiresAt: new Date(now.getTime() + 60_000) });
    await failure(await controller.handle("profileGet", request()), 401, "AUTH_SESSION_REFRESH_REQUIRED"); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ origin: "https://attacker.test" }, { "x-csrf-token": "bad" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("rejects forged PATCH before API mutation: %j", async (headers) => {
    const { controller, fetcher } = setup();
    await failure(await controller.handle("profileUpdate", request("/api/profile", "PATCH", { nickname: null, expectedVersion: 1 }, headers)), 403, "AUTH_CSRF_REJECTED"); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["profileGet", "/api/profile?userId=attacker", "GET", undefined, {}],
    ["accountsList", "/api/accounts?includeArchived=true&includeArchived=false", "GET", undefined, {}],
    ["categoriesList", "/api/categories?includeArchived=1", "GET", undefined, {}],
    ["accountsList", "/api/accounts?limit=100", "GET", undefined, {}],
    ["accountsUpdate", "/api/accounts/bad", "PATCH", { name: "x", expectedVersion: 1 }, { id: "../profile" }],
    ["profileUpdate", "/api/profile", "PATCH", { nickname: "x", expectedVersion: 1, role: "admin" }, {}],
    ["profileUpdate", "/api/profile", "PATCH", { nickname: "x", expectedVersion: 0 }, {}],
    ["accountsCreate", "/api/accounts", "POST", { name: "x", kind: "cash" }, {}],
    ["accountsArchive", `/api/accounts/${id}/archive`, "POST", { expectedVersion: 1, ownerId: id }, { id }],
    ["categoriesUpdate", `/api/categories/${id}`, "PATCH", { expectedVersion: 1 }, { id }],
    ["categoriesList", "/api/categories", "GET", undefined, { id }],
  ] as const)("rejects invalid route input for %s before transport", async (operation, path, method, body, params) => {
    const { controller, fetcher } = setup();
    await failure(await controller.handle(operation, request(path, method, body), params), 400, operation.startsWith("profile") ? "PROFILE_VALIDATION_FAILED" : "LEDGER_VALIDATION_FAILED"); expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unsupported methods before resolving a session", async () => {
    const { controller, sessions } = setup(); await failure(await controller.handle("profileGet", request("/api/profile", "DELETE")), 405, "LEDGER_VALIDATION_FAILED"); expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it("normalizes uppercase UUIDs before delegation and compares normalized resource IDs", async () => {
    const { controller, fetcher } = setup(Response.json(account));
    const response = await controller.handle("accountsUpdate", request(`/api/accounts/${id.toUpperCase()}`, "PATCH", { name: "현금", expectedVersion: 1 }), { id: id.toUpperCase() });
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0]![0]).toEqual(new URL(`https://api.example.test/v1/accounts/${id}`));
  });

  it("rejects a valid-shaped response for the wrong resource", async () => {
    const { controller } = setup(Response.json({ ...account, id: sessionId }));
    await failure(await controller.handle("accountsUpdate", request(`/api/accounts/${id}`, "PATCH", { name: "x", expectedVersion: 1 }), { id }), 502, "LEDGER_SERVICE_UNAVAILABLE");
  });

  it("enforces the API list cap even on small valid-shaped upstream rows", async () => {
    const { controller } = setup(Response.json({ items: Array.from({ length: 1_001 }, () => account) }));
    await failure(await controller.handle("accountsList", request("/api/accounts")), 502, "LEDGER_SERVICE_UNAVAILABLE");
  });

  it("rejects cross-origin reads before session or API access", async () => {
    const { controller, sessions } = setup();
    await failure(await controller.handle("profileGet", request(undefined, "GET", undefined, { origin: "https://attacker.test" })), 403, "AUTH_CSRF_REJECTED");
    expect(sessions.resolve).not.toHaveBeenCalled();
  });

  it.each(["GET", "PATCH"])("accepts a Next internal listener URL for %s only with the canonical public origin", async (method) => {
    const { controller, fetcher } = setup();
    const browserRequest = request("/api/profile", method, method === "PATCH" ? { nickname: "테스트", expectedVersion: 1 } : undefined);
    // Next 16 attachRequestMeta는 공개 Host와 별개로 내부 listener를 initURL에 사용할 수 있다.
    const internalRequest = new Request("http://localhost:3000/api/profile", browserRequest);
    const response = await controller.handle(method === "GET" ? "profileGet" : "profileUpdate", internalRequest);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0]![0]).toEqual(new URL("https://api.example.test/v1/profile"));
  });

  it.each(["constructor", "__proto__", "https://attacker.test"])("does not turn an unknown operation into arbitrary routing: %s", async (operation) => {
    const { controller, fetcher } = setup(); await failure(await controller.handle(operation, request()), 400, "LEDGER_VALIDATION_FAILED"); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    () => Response.json({ ...profile, accessToken: "private-secret" }),
    () => new Response("private-secret", { status: 200 }),
    () => Response.json(profile, { status: 201 }),
    () => new Response(null, { status: 302, headers: { location: "https://attacker.test" } }),
    () => Response.json({ code: "AUTH_SESSION_EXPIRED", message: "private-secret" }, { status: 401 }),
    () => Response.json(buildApiError({ code: "PROFILE_VERSION_CONFLICT", retryable: false }), { status: 500 }),
    () => Response.json({ ...profile, id: sessionId }),
  ])("rejects malformed, mismatched, redirect, leaking or other-user upstream results", async (reply) => {
    const { controller, fetcher } = setup(reply()); await failure(await controller.handle("profileGet", request()), 502, "LEDGER_SERVICE_UNAVAILABLE"); expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([[401, "AUTH_SESSION_EXPIRED"], [409, "PROFILE_VERSION_CONFLICT"], [503, "LEDGER_SERVICE_UNAVAILABLE"]] as const)("preserves safe upstream %s/%s errors without retry", async (status, code) => {
    const { controller, fetcher } = setup(Response.json(buildApiError({ code, retryable: false }), { status })); await failure(await controller.handle("profileUpdate", request("/api/profile", "PATCH", { nickname: null, expectedVersion: 1 })), status, code); expect(fetcher).toHaveBeenCalledOnce();
  });

  it("collapses transport errors without leaking credentials or retrying", async () => {
    const { controller, fetcher } = setup(); fetcher.mockRejectedValueOnce(new Error("postgres private-secret")); await failure(await controller.handle("profileGet", request()), 502, "LEDGER_SERVICE_UNAVAILABLE"); expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a large request body before API transport", async () => {
    const { controller, fetcher } = setup(); await failure(await controller.handle("profileUpdate", request("/api/profile", "PATCH", { nickname: "x".repeat(17_000), expectedVersion: 1 })), 400, "PROFILE_VALIDATION_FAILED"); expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized upstream data and cancels its stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1_048_577)); }, cancel });
    const { controller } = setup(new Response(stream, { headers: { "content-type": "application/json" } }));
    await failure(await controller.handle("profileGet", request()), 502, "LEDGER_SERVICE_UNAVAILABLE"); expect(cancel).toHaveBeenCalledOnce();
  });

  it("times out an upstream body that never finishes and cancels it", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const { controller } = setup(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
    const pending = controller.handle("profileGet", request()); await vi.advanceTimersByTimeAsync(3_001);
    await failure(await pending, 502, "LEDGER_SERVICE_UNAVAILABLE"); expect(cancel).toHaveBeenCalledOnce();
  });
});
