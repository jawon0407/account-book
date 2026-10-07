import { createECDH, createHash, createPublicKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ApiErrorSchema, CurrentUserSchema } from "@account-book/contracts";
import { canonicalDelegatedRequest } from "@account-book/contracts/internal-api";
import { Test, type TestingModule } from "@nestjs/testing";
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
vi.mock("pg", async (importActual) => {
  const actual = await importActual<typeof import("pg")>();
  poolConstructor.mockImplementation(function PoolMock(options) {
    return new actual.Pool(options);
  });
  return { ...actual, Pool: poolConstructor };
});

const userId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "123e4567-e89b-12d3-a456-426614174001";
const requestId = "123e4567-e89b-12d3-a456-426614174002";
const now = 1_800_000_000;

class MemoryReplayStore implements ReplayStore {
  private readonly entries = new Set<string>();
  /**
   * 같은 토큰의 두 번째 사용을 막는 최소 메모리 저장소 대역이다.
   * @param digest - 검증기가 계산한 토큰 ID 해시.
   * @returns 처음 저장하면 true, 이미 저장했으면 false.
   */
  public async consume(digest: Uint8Array): Promise<boolean> {
    const value = Buffer.from(digest).toString("hex");
    if (this.entries.has(value)) return false;
    this.entries.add(value);
    return true;
  }
}

/**
 * 본문 없는 GET 요청과 고정 요청 ID를 묶는 해시를 만든다.
 * @param target - 테스트할 경로와 쿼리.
 * @returns JWT rbh 클레임에 넣을 SHA-256 base64url 값.
 */
function binding(target: string): string {
  return createHash("sha256").update(canonicalDelegatedRequest({
    method: "GET",
    target,
    contentType: null,
    bodySha256: createHash("sha256").update(new Uint8Array()).digest("base64url"),
    requestId,
  })).digest("base64url");
}

/** 실제 풀 factory 검사용 API 환경을 만든다. 고정 테스트 키 외의 운영 비밀은 사용하지 않는다. */
function apiEnvironmentFixture(): Record<string, string> {
  const scalar = Buffer.from("0000000000000000000000000000000000000000000000000000000000000001", "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const point = ecdh.getPublicKey();
  const publicKey = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33, 65).toString("base64url") },
    format: "jwk",
  });
  return {
    API_DATABASE_URL: "postgresql://app_api:test-password@127.0.0.1:5432/account_book?sslmode=disable",
    BFF_AUTH_DISABLED: "false",
    BFF_JWT_ACCEPTED_KIDS: '["test-key"]',
    BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "test-key": Buffer.from(publicKey.export({ format: "der", type: "spki" })).toString("base64url") }),
  };
}

/**
 * 테스트 환경 값을 잠시 설치하고 원래 값을 복원하는 함수를 돌려준다.
 * @param values - 이번 fixture에서만 사용할 환경 값.
 * @returns 성공·실패와 무관하게 호출할 환경 복원 함수.
 */
function installEnvironment(values: Record<string, string>): () => void {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
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

  /**
   * 현재 사용자 조회 테스트에 사용할 새 토큰 ID의 ES256 JWT를 발급한다.
   * @param target - 요청 결합 해시에 넣을 경로.
   * @param rid - 토큰의 rid 클레임. 결합 해시는 별도 고정 requestId를 사용한다.
   * @returns 테스트 키로 서명한 위임 토큰.
   */
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
    expect(CurrentUserSchema.parse(first.json())).toEqual({ id: userId, email: null, emailVerified: false });
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
    poolConstructor.mockClear();
    const restoreEnvironment = installEnvironment(apiEnvironmentFixture());

    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let moduleRef: TestingModule | undefined;
    let end: ReturnType<typeof vi.spyOn> | undefined;
    try {
      moduleRef = await Test.createTestingModule({ imports: [MeModule] }).compile();
      const pool = moduleRef.get(API_DATABASE_POOL);
      end = vi.spyOn(pool, "end");
      diagnostic.mockImplementation(() => {
        pool.emit("error", new Error("nested-secret"));
      });
      expect(poolConstructor).toHaveBeenCalledOnce();
      expect(poolConstructor).toHaveBeenCalledWith({
        connectionString: process.env.API_DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 10_000,
        allowExitOnIdle: true,
      });
      expect(pool).toBeDefined();
      expect(moduleRef.get(ACCESS_TOKEN_VERIFIER)).toBeInstanceOf(DelegatedJwtVerifier);
      expect(() => pool.emit("error", new Error("test-password SQL detail"), { password: "test-password" })).not.toThrow();
      expect(() => pool.emit("error", new Error("second-secret"))).not.toThrow();
      expect(diagnostic.mock.calls).toEqual([["DB_POOL_IDLE_ERROR source=api"]]);
    } finally {
      await moduleRef?.close();
      diagnostic.mockRestore();
      restoreEnvironment();
    }
    expect(end).toHaveBeenCalledOnce();
  });

  it("isolates diagnostics per API pool and swallows synchronous output failures", async () => {
    const restoreEnvironment = installEnvironment(apiEnvironmentFixture());
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let firstModule: TestingModule | undefined;
    let secondModule: TestingModule | undefined;
    let thirdModule: TestingModule | undefined;
    try {
      firstModule = await Test.createTestingModule({ imports: [MeModule] }).compile();
      secondModule = await Test.createTestingModule({ imports: [MeModule] }).compile();
      const firstPool = firstModule.get(API_DATABASE_POOL);
      const secondPool = secondModule.get(API_DATABASE_POOL);
      expect(() => firstPool.emit("error", new Error("first-secret"))).not.toThrow();
      expect(() => secondPool.emit("error", new Error("second-secret"))).not.toThrow();
      expect(diagnostic.mock.calls).toEqual([
        ["DB_POOL_IDLE_ERROR source=api"],
        ["DB_POOL_IDLE_ERROR source=api"],
      ]);

      diagnostic.mockImplementation(() => {
        throw new Error("diagnostic unavailable");
      });
      thirdModule = await Test.createTestingModule({ imports: [MeModule] }).compile();
      const thirdPool = thirdModule.get(API_DATABASE_POOL);
      expect(() => thirdPool.emit("error", new Error("third-secret"))).not.toThrow();
      expect(() => thirdPool.emit("error", new Error("fourth-secret"))).not.toThrow();
      expect(diagnostic).toHaveBeenCalledTimes(3);
    } finally {
      await Promise.all([firstModule?.close(), secondModule?.close(), thirdModule?.close()]);
      diagnostic.mockRestore();
      restoreEnvironment();
    }
  });
});
