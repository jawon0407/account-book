import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiErrorSchema } from "@account-book/contracts";
import { canonicalDelegatedRequest, type DelegatedScope } from "@account-book/contracts/internal-api";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ACCESS_TOKEN_VERIFIER, DelegatedJwtVerifier } from "../auth/jwt-verifier.js";
import { createApiFastifyAdapter } from "../common/request-context.js";
import { configureApiApplication, registerRequestBodyParsers } from "../main.js";
import { API_DATABASE_POOL } from "../me/me.module.js";
import { REPLAY_STORE } from "../persistence/replay-store.js";
import { ProfilesRepository } from "../profiles/profiles.repository.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { CategoriesRepository } from "../categories/categories.repository.js";
import { TransactionsRepository } from "../transactions/transactions.repository.js";
import { CoreError } from "./core-error.js";
import { CollectorRepository } from "../collector/collector.repository.js";
import { NotificationConsentRepository } from "../collector/notification-consent.repository.js";

const userId = "11111111-1111-4111-8111-111111111111", resource = "22222222-2222-4222-8222-222222222222";
const profile = { id: userId, nickname: null, avatarObjectKey: null, role: "member", signupProvider: "email", version: 1, createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z" };
const account = { id: resource, name: "통장", kind: "bank", currentBalanceKrw: 0, version: 1, archivedAt: null, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
const category = { id: resource, name: "식비", kind: "expense", sortOrder: 0, version: 1, archivedAt: null, createdAt: profile.createdAt, updatedAt: profile.updatedAt };

describe("core API signed HTTP boundary", () => {
  let app: NestFastifyApplication, privateKey: CryptoKey;
  const consentRepo = { get: vi.fn(async () => ({ version: 0, state: "not_granted", noticeVersion: "notification-access-v1" })),
    change: vi.fn(async () => ({ version: 2,state: "withdrawn",noticeVersion: "notification-access-v1" })) };
  const collectorRepo = { get: vi.fn(async () => ({ version: 0, state: "inactive" })), change: vi.fn(async () => ({ version: 1, state: "active_here" })) };
  const profileRepo = { get: vi.fn(async () => profile), update: vi.fn(async () => ({ ...profile, nickname: "닉네임", version: 2 })) };
  const accountRepo = { list: vi.fn(async () => ({ items: [account] })), create: vi.fn(async () => account), update: vi.fn(async () => account), archive: vi.fn(async () => account) };
  const categoryRepo = { list: vi.fn(async () => ({ items: [category] })), create: vi.fn(async () => category), update: vi.fn(async () => category), archive: vi.fn(async () => category) };
  const transactionRepo = { list: vi.fn(async () => ({ items: [], nextCursor: null })), create: vi.fn(async () => ({ id: resource })), update: vi.fn(async () => ({ id: resource, version: 2 })), remove: vi.fn(async () => ({ id: resource, version: 2, deletedAt: profile.createdAt })) };
  beforeAll(async () => {
    const keys = await generateKeyPair("ES256"); privateKey = keys.privateKey;
    const used = new Set<string>();
    const replay = { consume: async (digest: Uint8Array) => { const key = Buffer.from(digest).toString("hex"); if (used.has(key)) return false; used.add(key); return true; } };
    const verifier = new DelegatedJwtVerifier({ authDisabled: false, acceptedKids: ["test"], keyring: { test: keys.publicKey }, replayStore: replay });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_DATABASE_POOL).useValue({ end: async () => undefined })
      .overrideProvider(REPLAY_STORE).useValue(replay).overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(verifier)
      .overrideProvider(ProfilesRepository).useValue(profileRepo).overrideProvider(AccountsRepository).useValue(accountRepo)
      .overrideProvider(CategoriesRepository).useValue(categoryRepo)
      .overrideProvider(TransactionsRepository).useValue(transactionRepo)
      .overrideProvider(NotificationConsentRepository).useValue(consentRepo)
      .overrideProvider(CollectorRepository).useValue(collectorRepo).compile();
    app = module.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
    registerRequestBodyParsers(app); await configureApiApplication(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app?.close(); });

  it("exposes Android-only consent with strict inputs and method scopes", async () => {
    const path = "/v1/collector/consent";
    expect((await send("GET",path,"collector:read",undefined,"android")).statusCode).toBe(200);
    expect((await send("GET",path,"collector:read")).statusCode).toBe(403);
    expect((await send("GET",path,"transaction:read",undefined,"android")).statusCode).toBe(401);
    expect((await send("PATCH",path,"collector:read",{ action: "withdraw",expectedVersion: 1 },"android")).statusCode).toBe(401);
    for (const input of [{},{ action: "accept",expectedVersion: 0,noticeVersion: "old" },{ action: "withdraw",expectedVersion: 1,deviceId: resource }]) {
      const result = await send("PATCH",path,"collector:write",input,"android");
      expect(result.statusCode).toBe(400); expect(result.json()).toMatchObject({ code: "COLLECTOR_VALIDATION_FAILED" });
    }
    expect((await send("GET",path+"?userId=x","collector:read",undefined,"android")).statusCode).toBe(400);
    const result = await send("PATCH",path,"collector:write",{ action: "withdraw",expectedVersion: 1 },"android");
    expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toContain("no-store");
  });

  /** @param method HTTP 메서드. @param target 실제 요청 URL. @param scope 요청 전용 권한. @param body 서명할 JSON. @returns 새 one-use JWT 헤더. */
  async function headers(method: "GET" | "POST" | "PATCH" | "DELETE", target: string, scope: DelegatedScope, body = "", channel = "web") {
    const requestId = randomUUID(), now = Math.floor(Date.now() / 1000);
    const contentType = method === "GET" ? null : "application/json";
    const rbh = createHash("sha256").update(canonicalDelegatedRequest({ method, target, contentType, bodySha256: createHash("sha256").update(body).digest("base64url"), requestId })).digest("base64url");
    const token = await new SignJWT({ chn: channel, aud: "urn:account-book:api", iss: "urn:account-book:bff", iat: now, nbf: now, exp: now + 30, jti: randomBytes(16).toString("base64url"), rid: requestId, rbh, scp: scope, sub: userId, sid: randomUUID() })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "test" }).sign(privateKey);
    return { authorization: `Bearer ${token}`, "x-request-id": requestId, ...(contentType ? { "content-type": contentType } : {}) };
  }
  /** @param method 메서드. @param url 경로. @param scope 권한. @param input JSON 입력. @returns 실제 Nest/Fastify 응답. */
  async function send(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, scope: DelegatedScope, input?: unknown, channel = "web") {
    const body = input === undefined ? "" : JSON.stringify(input);
    return app.inject({ method, url, headers: await headers(method, url, scope, body, channel), ...(input !== undefined ? { payload: body } : {}) });
  }
  it("binds collector requests to signed Android principal and dedicated scopes", async () => {
    expect((await send("GET", "/v1/collector", "collector:read", undefined, "android")).json()).toEqual({ version: 0, state: "inactive" });
    expect(collectorRepo.get).toHaveBeenCalledWith(userId, expect.stringMatching(/^[0-9a-f-]{36}$/u));
    const input = { action: "activate", expectedVersion: 0, replaceExisting: false };
    const response = await send("PATCH", "/v1/collector", "collector:write", input, "android");
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(collectorRepo.change).toHaveBeenCalledWith(userId, expect.any(String), input);
    expect((await send("GET", "/v1/collector", "collector:write", undefined, "android")).statusCode).toBe(401);
    expect((await send("PATCH", "/v1/collector", "collector:read", input, "android")).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/collector" })).statusCode).toBe(401);
  });
  it("rejects web collector controls and protected/ambiguous inputs before repository access", async () => {
    collectorRepo.get.mockClear(); collectorRepo.change.mockClear();
    for (const method of ["GET", "PATCH"] as const) {
      const input = method === "PATCH" ? { action: "deactivate", expectedVersion: 1 } : undefined;
      const response = await send(method, "/v1/collector", method === "GET" ? "collector:read" : "collector:write", input);
      expect(response.statusCode).toBe(403); expect(response.json().code).toBe("LEDGER_CHANNEL_FORBIDDEN");
    }
    for (const input of [{}, { action: "activate", expectedVersion: 0 }, { action: "deactivate", expectedVersion: 0, sessionId: resource }]) {
      const response = await send("PATCH", "/v1/collector", "collector:write", input, "android");
      expect(response.statusCode).toBe(400); expect(response.json().code).toBe("COLLECTOR_VALIDATION_FAILED");
    }
    expect((await send("GET", "/v1/collector?userId=x", "collector:read", undefined, "android")).statusCode).toBe(400);
    expect(collectorRepo.get).not.toHaveBeenCalled(); expect(collectorRepo.change).not.toHaveBeenCalled();
  });
  it.each([
    ["GET", "/v1/profile", "profile:read", undefined, 200],
    ["PATCH", "/v1/profile", "profile:write", { nickname: "닉네임", expectedVersion: 1 }, 200],
    ["GET", "/v1/accounts?includeArchived=false", "account:read", undefined, 200],
    ["POST", "/v1/accounts", "account:write", { kind: "bank", name: "통장", idempotencyKey: randomUUID() }, 201],
    ["PATCH", `/v1/accounts/${resource}`, "account:write", { name: "새 이름", expectedVersion: 1 }, 200],
    ["POST", `/v1/accounts/${resource}/archive`, "account:write", { expectedVersion: 1 }, 200],
    ["GET", "/v1/categories", "category:read", undefined, 200],
    ["POST", "/v1/categories", "category:write", { kind: "expense", name: "식비", sortOrder: 0, idempotencyKey: randomUUID() }, 201],
    ["PATCH", `/v1/categories/${resource}`, "category:write", { sortOrder: 0, expectedVersion: 1 }, 200],
    ["POST", `/v1/categories/${resource}/archive`, "category:write", { expectedVersion: 1 }, 200],
  ] as const)("wires %s %s with exact scope and no-store", async (method, url, scope, input, expected) => {
    const response = await send(method, url, scope, input);
    expect(response.statusCode).toBe(expected);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.json()).toEqual(url.includes("accounts") ? method === "GET" ? { items: [account] } : account : url.includes("categories") ? method === "GET" ? { items: [category] } : category : method === "GET" ? profile : { ...profile, nickname: "닉네임", version: 2 });
  });
  it("uses the signed principal and exact false query, never a client owner", async () => {
    await send("GET", "/v1/accounts?includeArchived=false", "account:read");
    expect(accountRepo.list).toHaveBeenCalledWith(userId, false);
    const response = await send("POST", "/v1/accounts", "account:write", { kind: "cash", name: "x", idempotencyKey: randomUUID(), userId: resource });
    expect(response.statusCode).toBe(400);
  });
  it("accepts a versioned residence setting but never a client-owned clock", async () => {
    const value = { ledgerTimeZone: "Asia/Seoul", expectedVersion: 1 };
    expect((await send("PATCH", "/v1/profile", "profile:write", value, "android")).statusCode).toBe(200);
    expect(profileRepo.update).toHaveBeenCalledWith(userId, value);
    for (const extra of [{ effectiveFrom: "2026-10-01T00:00:00.000Z" }, { revision: 99 }, { ledgerTimeZone: null }])
      expect((await send("PATCH", "/v1/profile", "profile:write", { ...value, ...extra })).statusCode).toBe(400);
  });
  it("allows manual UTC evidence on Android without accepting automated provenance", async () => {
    const time = { occurredAt: "2026-10-01T06:00:00.000Z", precision: "minute", sourceTimeZone: "Asia/Seoul" };
    const value = { type: "expense", amountKrw: 100, occurredOn: "2026-10-01", idempotencyKey: randomUUID(), time };
    expect((await send("POST", "/v1/transactions", "transaction:write", value, "android")).statusCode).toBe(201);
    expect(transactionRepo.create).toHaveBeenCalledWith(userId, { ...value, accountId: null, categoryId: null });
    for (const extra of [{ source: "notification" }, { ledgerTimeZone: "UTC" }])
      expect((await send("POST", "/v1/transactions", "transaction:write", { ...value, time: { ...time, ...extra } }, "android")).statusCode).toBe(400);
    expect((await send("POST", "/v1/transactions", "transaction:write", value)).statusCode).toBe(403);
  });
  it("wires transaction list with exact scope and normalized query", async () => {
    const response = await send("GET", "/v1/transactions?limit=2&type=expense", "transaction:read");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(transactionRepo.list).toHaveBeenCalledWith(userId, { limit: 2, type: "expense" });
    expect((await send("GET", "/v1/transactions", "account:read")).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/transactions" })).statusCode).toBe(401);
  });
  it.each(["limit=0", "limit=101", "limit=1.5", "limit=1&limit=2", "from=2026-10-02&to=2026-10-01", "owner=x"])("rejects transaction query %s", async query => {
    expect((await send("GET", `/v1/transactions?${query}`, "transaction:read")).statusCode).toBe(400);
  });
  it("accepts only ordinary income/expense creation under transaction:write", async () => {
    const value = { accountId: resource, categoryId: resource, type: "expense", amountKrw: 100, occurredOn: "2026-10-01", idempotencyKey: randomUUID() };
    expect((await send("POST", "/v1/transactions", "transaction:write", value, "android")).statusCode).toBe(201);
    expect(transactionRepo.create).toHaveBeenCalledWith(userId, value);
    expect((await send("POST", "/v1/transactions", "transaction:read", value)).statusCode).toBe(401);
    for (const change of [{ amountKrw: 0 }, { amountKrw: 1.5 }, { amountKrw: "100" }, { memo: " " }, { memo: "x".repeat(501) }, { occurredOn: "2026-02-30" }, { userId }, { type: "transfer_in" }])
      expect((await send("POST", "/v1/transactions", "transaction:write", { ...value, ...change }, "android")).statusCode).toBe(400);
  });
  it("denies web transaction creation even with a spoofed Android header without touching the repository", async () => {
    transactionRepo.create.mockClear();
    const body = JSON.stringify({ accountId: resource, categoryId: resource, type: "expense", amountKrw: 100, occurredOn: "2026-10-01", idempotencyKey: randomUUID() });
    const response = await app.inject({ method: "POST", url: "/v1/transactions", payload: body,
      headers: { ...await headers("POST", "/v1/transactions", "transaction:write", body), "x-client-channel": "android" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("LEDGER_CHANNEL_FORBIDDEN");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(transactionRepo.create).not.toHaveBeenCalled();
  });
  it.each(["PATCH", "DELETE"] as const)("guards %s transaction mutation scope, identity and input", async method => {
    const value = { expectedVersion: 1, ...(method === "PATCH" ? { memo: null } : {}) };
    const response = await send(method, `/v1/transactions/${resource}`, "transaction:write", value);
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(transactionRepo[method === "PATCH" ? "update" : "remove"]).toHaveBeenCalledWith(userId, resource, value);
    expect((await send(method, `/v1/transactions/${resource}`, "transaction:read", value)).statusCode).toBe(401);
    for (const invalid of [{}, { ...value, userId }, { ...value, expectedVersion: 0 }])
      expect((await send(method, `/v1/transactions/${resource}`, "transaction:write", invalid)).statusCode).toBe(400);
    expect((await send(method, "/v1/transactions/invalid", "transaction:write", value)).statusCode).toBe(400);
    expect((await send(method, `/v1/transactions/${resource}?owner=x`, "transaction:write", value)).statusCode).toBe(400);
  });
  it.each(["true&includeArchived=false", "1", "TRUE", "false&owner=x", "false&includeArchived[]=true"])("rejects ambiguous query %s", async value => {
    expect((await send("GET", `/v1/accounts?includeArchived=${value}`, "account:read")).statusCode).toBe(400);
  });
  it.each(["role", "signupProvider", "deletedAt", "avatarObjectKey"])("rejects protected profile %s", async field => {
    const response = await send("PATCH", "/v1/profile", "profile:write", { nickname: "n", expectedVersion: 1, [field]: "private" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("PROFILE_VALIDATION_FAILED");
    expect(response.body).not.toContain("private");
  });
  it("rejects absent/wrong scopes, replay and signed-body mutation", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/profile" })).statusCode).toBe(401);
    expect((await send("GET", "/v1/profile", "me:read")).statusCode).toBe(401);
    const signed = await headers("GET", "/v1/accounts", "account:read");
    expect((await app.inject({ method: "GET", url: "/v1/accounts", headers: signed })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/accounts", headers: signed })).statusCode).toBe(401);
    const before = JSON.stringify({ nickname: "before", expectedVersion: 1 });
    expect((await app.inject({ method: "PATCH", url: "/v1/profile", headers: await headers("PATCH", "/v1/profile", "profile:write", before), payload: JSON.stringify({ nickname: "after", expectedVersion: 1 }) })).statusCode).toBe(401);
  });
  it.each([
    ["LEDGER_NOT_FOUND", 404, false], ["LEDGER_VERSION_CONFLICT", 409, false], ["LEDGER_SERVICE_UNAVAILABLE", 503, true],
  ] as const)("returns only fixed %s error data", async (code, status, retryable) => {
    accountRepo.list.mockRejectedValueOnce(new CoreError(code, status, retryable));
    const response = await send("GET", "/v1/accounts", "account:read");
    expect(response.statusCode).toBe(status);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({ code, retryable, fieldErrors: [] });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});
