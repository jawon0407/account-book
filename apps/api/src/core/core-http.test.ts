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

const userId = "11111111-1111-4111-8111-111111111111", resource = "22222222-2222-4222-8222-222222222222";
const profile = { id: userId, nickname: null, avatarObjectKey: null, role: "member", signupProvider: "email", version: 1, createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z" };
const account = { id: resource, name: "통장", kind: "bank", currentBalanceKrw: 0, version: 1, archivedAt: null, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
const category = { id: resource, name: "식비", kind: "expense", sortOrder: 0, version: 1, archivedAt: null, createdAt: profile.createdAt, updatedAt: profile.updatedAt };

describe("core API signed HTTP boundary", () => {
  let app: NestFastifyApplication, privateKey: CryptoKey;
  const profileRepo = { get: vi.fn(async () => profile), update: vi.fn(async () => ({ ...profile, nickname: "닉네임", version: 2 })) };
  const accountRepo = { list: vi.fn(async () => ({ items: [account] })), create: vi.fn(async () => account), update: vi.fn(async () => account), archive: vi.fn(async () => account) };
  const categoryRepo = { list: vi.fn(async () => ({ items: [category] })), create: vi.fn(async () => category), update: vi.fn(async () => category), archive: vi.fn(async () => category) };
  const transactionRepo = { list: vi.fn(async () => ({ items: [], nextCursor: null })), create: vi.fn(async () => ({ id: resource })) };
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
      .overrideProvider(TransactionsRepository).useValue(transactionRepo).compile();
    app = module.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
    registerRequestBodyParsers(app); await configureApiApplication(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app?.close(); });

  /** @param method HTTP 메서드. @param target 실제 요청 URL. @param scope 요청 전용 권한. @param body 서명할 JSON. @returns 새 one-use JWT 헤더. */
  async function headers(method: "GET" | "POST" | "PATCH", target: string, scope: DelegatedScope, body = "") {
    const requestId = randomUUID(), now = Math.floor(Date.now() / 1000);
    const contentType = method === "GET" ? null : "application/json";
    const rbh = createHash("sha256").update(canonicalDelegatedRequest({ method, target, contentType, bodySha256: createHash("sha256").update(body).digest("base64url"), requestId })).digest("base64url");
    const token = await new SignJWT({ aud: "urn:account-book:api", iss: "urn:account-book:bff", iat: now, nbf: now, exp: now + 30, jti: randomBytes(16).toString("base64url"), rid: requestId, rbh, scp: scope, sub: userId, sid: randomUUID() })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "test" }).sign(privateKey);
    return { authorization: `Bearer ${token}`, "x-request-id": requestId, ...(contentType ? { "content-type": contentType } : {}) };
  }
  /** @param method 메서드. @param url 경로. @param scope 권한. @param input JSON 입력. @returns 실제 Nest/Fastify 응답. */
  async function send(method: "GET" | "POST" | "PATCH", url: string, scope: DelegatedScope, input?: unknown) {
    const body = input === undefined ? "" : JSON.stringify(input);
    return app.inject({ method, url, headers: await headers(method, url, scope, body), ...(input !== undefined ? { payload: body } : {}) });
  }
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
    expect((await send("POST", "/v1/transactions", "transaction:write", value)).statusCode).toBe(201);
    expect(transactionRepo.create).toHaveBeenCalledWith(userId, value);
    expect((await send("POST", "/v1/transactions", "transaction:read", value)).statusCode).toBe(401);
    for (const change of [{ amountKrw: 0 }, { amountKrw: 1.5 }, { amountKrw: "100" }, { memo: " " }, { memo: "x".repeat(501) }, { occurredOn: "2026-02-30" }, { userId }, { type: "transfer_in" }])
      expect((await send("POST", "/v1/transactions", "transaction:write", { ...value, ...change })).statusCode).toBe(400);
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
