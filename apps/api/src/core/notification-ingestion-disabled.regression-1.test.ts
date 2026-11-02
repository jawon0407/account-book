import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canonicalDelegatedRequest } from "@account-book/contracts/internal-api";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ACCESS_TOKEN_VERIFIER, DelegatedJwtVerifier } from "../auth/jwt-verifier.js";
import { createApiFastifyAdapter } from "../common/request-context.js";
import { configureApiApplication, registerRequestBodyParsers } from "../main.js";
import { API_DATABASE_POOL } from "../me/me.module.js";
import { REPLAY_STORE } from "../persistence/replay-store.js";

// Regression: healthy contract — real CoreModule must leave ingestion disabled.
// Found by /qa on 2026-11-02
// Report: .gstack/qa-reports/run-20261102-notification-hardening/qa-report-notification-hardening-2026-11-02.md
let app: NestFastifyApplication, privateKey: CryptoKey;
const blockedDatabaseAccess = () => { throw new Error("UNEXPECTED_INGESTION_DATABASE_ACCESS"); };
const pool = { connect: vi.fn(blockedDatabaseAccess), query: vi.fn(blockedDatabaseAccess), end: async () => undefined };
const eventId = "22222222-2222-4222-8222-222222222222";

beforeAll(async () => {
  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey;
  const used = new Set<string>();
  const replay = { consume: async (digest: Uint8Array) => {
    const key = Buffer.from(digest).toString("hex");
    if (used.has(key)) return false;
    used.add(key); return true;
  } };
  const verifier = new DelegatedJwtVerifier({ authDisabled: false, acceptedKids: ["test"], keyring: { test: keys.publicKey }, replayStore: replay });
  // DB transport/replay only: the real controller, repository factory and UserDatabase remain wired.
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_DATABASE_POOL).useValue(pool)
    .overrideProvider(REPLAY_STORE).useValue(replay)
    .overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(verifier).compile();
  app = module.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
  registerRequestBodyParsers(app);
  await configureApiApplication(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => { await app?.close(); });

/** @param method 검사할 HTTP 메서드. @returns 실제 검증기가 검증할 일회용 Android 서명 요청. */
async function signedRequest(method: "GET" | "POST") {
  const target = `/v1/notification-transactions${method === "GET" ? `/${eventId}` : ""}`;
  const body = method === "GET" ? "" : JSON.stringify({ eventId, collectorVersion: 1, consentVersion: 1,
    sourceApp: "com.kbstar.kbbank", parserVersion: "kb-v1", type: "expense", amountKrw: 20000,
    counterpartyName: null, receivedAt: "2026-11-02T01:00:00.000Z" });
  const requestId = randomUUID(), now = Math.floor(Date.now() / 1000);
  const contentType = method === "GET" ? null : "application/json";
  const rbh = createHash("sha256").update(canonicalDelegatedRequest({ method, target, contentType,
    bodySha256: createHash("sha256").update(body).digest("base64url"), requestId })).digest("base64url");
  const token = await new SignJWT({ chn: "android", aud: "urn:account-book:api", iss: "urn:account-book:bff",
    iat: now, nbf: now, exp: now + 30, jti: randomBytes(16).toString("base64url"), rid: requestId, rbh,
    scp: method === "GET" ? "notification:read" : "notification:write",
    sub: "11111111-1111-4111-8111-111111111111", sid: randomUUID() })
    .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "test" }).sign(privateKey);
  return { method, url: target, headers: { authorization: `Bearer ${token}`, "x-request-id": requestId,
    ...(contentType ? { "content-type": contentType } : {}) }, ...(body ? { payload: body } : {}) };
}

it.each(["POST", "GET"] as const)("keeps signed Android %s dormant before any ingestion DB access", async method => {
  const response = await app.inject(await signedRequest(method));
  expect(response.statusCode).toBe(503);
  expect(response.json()).toMatchObject({ code: "LEDGER_SERVICE_UNAVAILABLE" });
  expect(response.headers["cache-control"]).toBe("private, no-store");
  // 503 alone also matches a DB failure after accidental activation; these distinguish that regression.
  expect(pool.connect).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
});

it("still requires authentication while ingestion is disabled", async () => {
  const response = await app.inject({ method: "GET", url: `/v1/notification-transactions/${eventId}` });
  expect(response.statusCode).toBe(401);
  expect(pool.connect).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
});
