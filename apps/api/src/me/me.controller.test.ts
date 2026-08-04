import { createECDH, createHash, createPublicKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ApiErrorSchema, CurrentUserSchema } from "@account-book/contracts";
import { canonicalDelegatedRequest } from "@account-book/contracts/internal-api";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ACCESS_TOKEN_VERIFIER, DelegatedJwtVerifier } from "../auth/jwt-verifier.js";
import { createApiFastifyAdapter } from "../common/request-context.js";
import { configureApiApplication } from "../main.js";
import { API_DATABASE_POOL } from "./me.module.js";
import { MeModule } from "./me.module.js";
import { REPLAY_STORE, type ReplayStore } from "../persistence/replay-store.js";

const poolConstructor = vi.hoisted(() => vi.fn());
vi.mock("pg", () => ({ Pool: poolConstructor }));

const userId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "123e4567-e89b-12d3-a456-426614174001";
const requestId = "123e4567-e89b-12d3-a456-426614174002";
const now = 1_800_000_000;

class MemoryReplayStore implements ReplayStore {
  private readonly entries = new Set<string>();
  public async consume(digest: Uint8Array): Promise<boolean> {
    const value = Buffer.from(digest).toString("hex");
    if (this.entries.has(value)) return false;
    this.entries.add(value);
    return true;
  }
}

function binding(target: string): string {
  return createHash("sha256").update(canonicalDelegatedRequest({
    method: "GET",
    target,
    contentType: null,
    bodySha256: createHash("sha256").update(new Uint8Array()).digest("base64url"),
    requestId,
  })).digest("base64url");
}

describe("delegated API authentication boundary", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let verifier: DelegatedJwtVerifier;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    verifier = new DelegatedJwtVerifier({
      authDisabled: false,
      acceptedKids: ["test-key"],
      keyring: { "test-key": pair.publicKey },
      replayStore: new MemoryReplayStore(),
      now: () => new Date(now * 1_000),
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_DATABASE_POOL).useValue({ end: async () => undefined, query: async () => ({ rowCount: 1 }) })
      .overrideProvider(REPLAY_STORE).useValue(new MemoryReplayStore())
      .overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(verifier)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
    await configureApiApplication(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => { await app.close(); });

  async function token(target = "/v1/me", rid = requestId): Promise<string> {
    return new SignJWT({
      aud: "urn:account-book:api", exp: now + 30, iat: now, iss: "urn:account-book:bff",
      jti: randomBytes(16).toString("base64url"), nbf: now,
      rbh: binding(target), rid, scp: "me:read", sid: sessionId, sub: userId,
    }).setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "test-key" }).sign(privateKey);
  }

  it("accepts the signed token against the exact descriptor before HTTP wiring", async () => {
    const signed = await token();
    await expect(verifier.verify({
      token: signed,
      request: { method: "GET", target: "/v1/me", contentType: null, body: new Uint8Array(), requestId },
      requiredScope: "me:read",
    })).resolves.toMatchObject({ userId, requestId });
  });

  it("accepts one valid signed delegated token and rejects its replay", async () => {
    const signed = await token();
    const headers = { authorization: `Bearer ${signed}`, "x-request-id": requestId };
    const first = await app.inject({ method: "GET", url: "/v1/me", headers });
    const replay = await app.inject({ method: "GET", url: "/v1/me", headers });

    expect(first.statusCode).toBe(200);
    expect(CurrentUserSchema.parse(first.json())).toEqual({ id: userId, email: null, emailVerified: true });
    expect(first.headers["x-request-id"]).toBe(requestId);
    expect(replay.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(replay.json()).code).toBe("AUTH_SESSION_EXPIRED");
  });

  it.each([
    ["query mutation", "GET", "/v1/me?mutated=1", requestId],
    ["request ID mutation", "GET", "/v1/me", "123e4567-e89b-12d3-a456-426614174003"],
    ["method mutation", "POST", "/v1/me", requestId],
  ])("rejects %s without consuming the correctly bound token", async (_name, method, url, inboundId) => {
    const signed = await token();
    const mutated = await app.inject({ method, url, headers: { authorization: `Bearer ${signed}`, "x-request-id": inboundId } });
    const correct = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${signed}`, "x-request-id": requestId } });

    expect(mutated.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(mutated.json()).code).toBe("AUTH_SESSION_EXPIRED");
    expect(correct.statusCode).toBe(200);
  });

  it("fails closed for absent Supabase-format browser and preflight credentials", async () => {
    // Pre-generated, non-production browser JWT fixture is loaded only to prove rejection.
    const browserToken = (await readFile(
      new URL("../../test-fixtures/supabase-access-token.jwt", import.meta.url),
      "utf8",
    )).trim();
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/v1/me" }),
      app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${browserToken}`, "x-request-id": requestId } }),
      app.inject({ method: "OPTIONS", url: "/v1/me", headers: { authorization: `Bearer ${await token()}`, "x-request-id": requestId } }),
    ]);
    for (const response of responses) expect(response.statusCode).toBe(401);
  });

  it("returns the fixed detail-free 503 when delegated verification is disabled", async () => {
    const disabledVerifier = new DelegatedJwtVerifier({
      authDisabled: true,
      acceptedKids: ["test-key"],
      keyring: {},
      replayStore: new MemoryReplayStore(),
      now: () => new Date(now * 1_000),
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_DATABASE_POOL).useValue({ end: async () => undefined, query: async () => ({ rowCount: 1 }) })
      .overrideProvider(REPLAY_STORE).useValue(new MemoryReplayStore())
      .overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(disabledVerifier)
      .compile();
    const disabledApp = moduleRef.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
    await configureApiApplication(disabledApp);
    await disabledApp.init();
    const response = await disabledApp.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer aaa.bbb.ccc", "x-request-id": requestId },
    });
    await disabledApp.close();

    expect(response.statusCode).toBe(503);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true });
    expect(response.body).not.toMatch(/aaa\.bbb\.ccc|key|disabled|postgres/iu);
  });

  it("creates one bounded pool and closes its replay-store owner exactly once", async () => {
    const scalar = Buffer.from("0000000000000000000000000000000000000000000000000000000000000001", "hex");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(scalar);
    const point = ecdh.getPublicKey();
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33, 65).toString("base64url") },
      format: "jwk",
    });
    const end = vi.fn(async () => undefined);
    poolConstructor.mockReset();
    poolConstructor.mockImplementation(function PoolMock() { return { end, query: vi.fn() }; });
    Object.assign(process.env, {
      API_DATABASE_URL: "postgresql://app_api:test-password@127.0.0.1:5432/account_book?sslmode=disable",
      BFF_AUTH_DISABLED: "false",
      BFF_JWT_ACCEPTED_KIDS: '["test-key"]',
      BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "test-key": Buffer.from(publicKey.export({ format: "der", type: "spki" })).toString("base64url") }),
    });

    const moduleRef = await Test.createTestingModule({ imports: [MeModule] }).compile();
    expect(poolConstructor).toHaveBeenCalledOnce();
    expect(poolConstructor).toHaveBeenCalledWith({
      connectionString: process.env.API_DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    expect(moduleRef.get(API_DATABASE_POOL)).toBeDefined();
    expect(moduleRef.get(ACCESS_TOKEN_VERIFIER)).toBeInstanceOf(DelegatedJwtVerifier);

    await moduleRef.close();
    expect(end).toHaveBeenCalledOnce();
  });
});
