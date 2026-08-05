import { createECDH, createPrivateKey, createPublicKey } from "node:crypto";
import { request as httpRequest } from "node:http";
import { ApiErrorSchema } from "@account-book/contracts";
import { DELEGATED_JSON_BODY_MAX_BYTES } from "@account-book/contracts/internal-api";
import {
  Controller,
  HttpCode,
  Module,
  Post,
  Req,
  UseFilters,
  UseGuards,
  type LoggerService,
} from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { decodeJwt, SignJWT } from "jose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DelegatedJwtSigner } from "../../../web/src/server/security/delegated-jwt-signer.js";
import { ApiErrorFilter } from "../common/api-error.filter.js";
import { createApiFastifyAdapter } from "../common/request-context.js";
import {
  configureApiApplication,
  registerRequestBodyParsers,
} from "../main.js";
import type { ReplayStore } from "../persistence/replay-store.js";
import { AuthGuard } from "./auth.guard.js";
import { RequireDelegatedScope } from "./delegated-scope.js";
import { ACCESS_TOKEN_VERIFIER, DelegatedJwtVerifier } from "./jwt-verifier.js";

const USER_ID = "123e4567-e89b-12d3-a456-426614174000";
const SESSION_ID = "123e4567-e89b-12d3-a456-426614174001";
const REQUEST_ID = "123e4567-e89b-12d3-a456-426614174002";
const NOW_SECONDS = 1_800_000_000;
const KEY_ID = "boundary-test-key";
const PRIVATE_SCALAR = Buffer.from(
  "0000000000000000000000000000000000000000000000000000000000000001",
  "hex",
);

function deterministicKeyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(PRIVATE_SCALAR);
  const point = ecdh.getPublicKey();
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33, 65).toString("base64url"),
    d: PRIVATE_SCALAR.toString("base64url"),
  };
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

class MemoryReplayStore implements ReplayStore {
  private readonly entries = new Set<string>();
  public failure: Error | undefined;

  public async consume(digest: Uint8Array, expiresAt: Date): Promise<boolean> {
    if (
      digest.byteLength !== 32 ||
      expiresAt.getTime() !== (NOW_SECONDS + 45) * 1_000
    ) {
      throw new Error("invalid replay fixture input");
    }
    if (this.failure !== undefined) throw this.failure;
    const value = Buffer.from(digest).toString("hex");
    if (this.entries.has(value)) return false;
    this.entries.add(value);
    return true;
  }

  public reset(): void {
    this.entries.clear();
    this.failure = undefined;
  }
}

class CapturingLogger implements LoggerService {
  private readonly records: unknown[][] = [];

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }

  public reset(): void {
    this.records.length = 0;
  }

  public serialized(): string {
    return this.records
      .map((record) =>
        record
          .map((value) => {
            if (value instanceof Error) return `${value.name}:${value.message}`;
            if (typeof value === "string") return value;
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          })
          .join(" "),
      )
      .join("\n");
  }
}

class TestMutationController {
  public create(request: FastifyRequest): unknown {
    return { userId: request.principal!.userId, body: request.body };
  }
}

Controller()(TestMutationController);
UseGuards(AuthGuard)(TestMutationController);
UseFilters(ApiErrorFilter)(TestMutationController);
const createDescriptor = Object.getOwnPropertyDescriptor(
  TestMutationController.prototype,
  "create",
)!;
Post("/v1/test-mutation")(
  TestMutationController.prototype,
  "create",
  createDescriptor,
);
HttpCode(200)(TestMutationController.prototype, "create", createDescriptor);
RequireDelegatedScope("transaction:write")(
  TestMutationController.prototype,
  "create",
  createDescriptor,
);
Req()(TestMutationController.prototype, "create", 0);

const keys = deterministicKeyPair();
const replayStore = new MemoryReplayStore();
const logger = new CapturingLogger();
const now = () => new Date(NOW_SECONDS * 1_000);
const signer = new DelegatedJwtSigner({
  keyId: KEY_ID,
  privateKey: keys.privateKey,
  now,
  randomBytes: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
  randomUUID: () => REQUEST_ID,
});
const verifier = new DelegatedJwtVerifier({
  authDisabled: false,
  acceptedKids: [KEY_ID],
  keyring: { [KEY_ID]: keys.publicKey },
  replayStore,
  now,
});
const verifySpy = vi.spyOn(verifier, "verify");

class TestMutationModule {}
Module({
  controllers: [TestMutationController],
  providers: [
    AuthGuard,
    { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
    ApiErrorFilter,
  ],
})(TestMutationModule);

const exactBodyText = '{"amount":1200,"memo":"lunch"}';
const exactBody = new TextEncoder().encode(exactBodyText);

function signMutation(
  overrides: Partial<Parameters<DelegatedJwtSigner["sign"]>[0]> = {},
) {
  return signer.sign({
    method: "POST",
    target: "/v1/test-mutation",
    contentType: "application/json",
    body: exactBody,
    scope: "transaction:write",
    userId: USER_ID,
    sessionId: SESSION_ID,
    ...overrides,
  });
}

function requestHeaders(signed: Awaited<ReturnType<typeof signMutation>>) {
  return {
    authorization: `Bearer ${signed.token}`,
    "content-type": "application/json",
    "x-request-id": signed.requestId,
  };
}

function expectAuthenticationFailure(response: {
  statusCode: number;
  json(): unknown;
}): void {
  expect(response.statusCode).toBe(401);
  expect(ApiErrorSchema.parse(response.json())).toMatchObject({
    code: "AUTH_SESSION_EXPIRED",
    retryable: false,
    fieldErrors: [],
  });
}

async function tokenWithClaim(
  token: string,
  claim: Readonly<{ iss?: string; aud?: string }>,
): Promise<string> {
  return new SignJWT({ ...decodeJwt(token), ...claim })
    .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: KEY_ID })
    .sign(keys.privateKey);
}

type RawResponse = Readonly<{ statusCode: number; body: string }>;

function rawPost(
  baseUrl: string,
  headers: string[],
  payload: Uint8Array,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL("/v1/test-mutation", baseUrl);
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: ["Host", url.host, ...headers],
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

describe("delegated financial mutation HTTP boundary", () => {
  let app: NestFastifyApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestMutationModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createApiFastifyAdapter(),
      { logger },
    );
    registerRequestBodyParsers(app);
    await configureApiApplication(app);
    await app.init();
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    replayStore.reset();
    logger.reset();
    verifySpy.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts only the exact signed POST body and returns the verified user", async () => {
    const signed = await signMutation();
    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      userId: USER_ID,
      body: { amount: 1200, memo: "lunch" },
    });
  });

  it("rejects a one-byte body mutation without consuming the correctly bound token", async () => {
    const signed = await signMutation();
    const mutated = Buffer.from(exactBody);
    mutated[11] = mutated[11] === 0x30 ? 0x31 : 0x30;

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: mutated,
    });
    expectAuthenticationFailure(rejected);

    const exact = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });
    expect(exact.statusCode).toBe(200);
  });

  it("rejects a changed request target without consuming the correctly bound token", async () => {
    const signed = await signMutation();
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/test-mutation?view=changed",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });
    expectAuthenticationFailure(rejected);

    const exact = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });
    expect(exact.statusCode).toBe(200);
  });

  it("maps a read-scoped token on the write route to the fixed 401 ApiError policy", async () => {
    const signed = await signMutation({ scope: "transaction:read" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });

    expectAuthenticationFailure(response);
  });

  it("rejects the second use of the same JWT and request ID", async () => {
    const signed = await signMutation();
    const request = {
      method: "POST" as const,
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expectAuthenticationFailure(replay);
  });

  it("rejects an expired JWT", async () => {
    const expiredSigner = new DelegatedJwtSigner({
      keyId: KEY_ID,
      privateKey: keys.privateKey,
      now: () => new Date((NOW_SECONDS - 36) * 1_000),
      randomBytes: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
      randomUUID: () => REQUEST_ID,
    });
    const signed = await expiredSigner.sign({
      method: "POST",
      target: "/v1/test-mutation",
      contentType: "application/json",
      body: exactBody,
      scope: "transaction:write",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });

    expectAuthenticationFailure(response);
  });

  it.each([
    ["issuer", { iss: "urn:wrong-issuer" }],
    ["audience", { aud: "urn:wrong-audience" }],
  ])("rejects a token with the wrong %s", async (_name, claim) => {
    const signed = await signMutation();
    const invalidToken = await tokenWithClaim(signed.token, claim);
    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: {
        ...requestHeaders(signed),
        authorization: `Bearer ${invalidToken}`,
      },
      payload: Buffer.from(exactBody),
    });

    expectAuthenticationFailure(response);
  });

  it("rejects a token with an unaccepted key ID", async () => {
    const unknownKeySigner = new DelegatedJwtSigner({
      keyId: "unknown-test-key",
      privateKey: keys.privateKey,
      now,
      randomBytes: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
      randomUUID: () => REQUEST_ID,
    });
    const signed = await unknownKeySigner.sign({
      method: "POST",
      target: "/v1/test-mutation",
      contentType: "application/json",
      body: exactBody,
      scope: "transaction:write",
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(exactBody),
    });

    expectAuthenticationFailure(response);
  });

  it.each(["authorization", "content-type", "x-request-id"])(
    "rejects duplicate %s headers at the real HTTP boundary",
    async (duplicatedHeader) => {
      const signed = await signMutation();
      const bearer = `Bearer ${signed.token}`;
      const contentLength = String(exactBody.byteLength);
      const headerPairs: Record<string, string[]> = {
        authorization: [
          "Authorization",
          bearer,
          "Content-Type",
          "application/json",
          "Content-Length",
          contentLength,
          "X-Request-Id",
          signed.requestId,
        ],
        "content-type": [
          "Authorization",
          bearer,
          "Content-Type",
          "application/json",
          "Content-Type",
          "application/json",
          "Content-Length",
          contentLength,
          "X-Request-Id",
          signed.requestId,
        ],
        "x-request-id": [
          "Authorization",
          bearer,
          "Content-Type",
          "application/json",
          "Content-Length",
          contentLength,
          "X-Request-Id",
          signed.requestId,
        ],
      };
      if (duplicatedHeader === "authorization") {
        headerPairs.authorization.splice(2, 0, "Authorization", bearer);
      } else if (duplicatedHeader === "x-request-id") {
        headerPairs["x-request-id"].push("X-Request-Id", signed.requestId);
      }

      const response = await rawPost(
        baseUrl,
        headerPairs[duplicatedHeader]!,
        exactBody,
      );
      expect(response.statusCode).toBe(401);
      expect(ApiErrorSchema.parse(JSON.parse(response.body))).toMatchObject({
        code: "AUTH_SESSION_EXPIRED",
        retryable: false,
        fieldErrors: [],
      });
    },
  );

  it("rejects an oversized body with 413 before verifier invocation", async () => {
    const framingBytes = Buffer.byteLength('{"memo":""}');
    const oversizedText = `{"memo":"${"x".repeat(DELEGATED_JSON_BODY_MAX_BYTES + 1 - framingBytes)}"}`;
    const oversizedBody = new TextEncoder().encode(oversizedText);
    expect(oversizedBody.byteLength).toBe(DELEGATED_JSON_BODY_MAX_BYTES + 1);
    const signed = await signMutation({ body: oversizedBody });

    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(oversizedBody),
    });

    expect(response.statusCode).toBe(413);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it("does not expose the JWT, raw body, or internal verifier detail in responses or logs", async () => {
    const bodySecret = "RAW_FINANCIAL_BODY_SECRET_7c2f";
    const rawBody = `{"memo":"${bodySecret}"}`;
    const body = new TextEncoder().encode(rawBody);
    const signed = await signMutation({ body });
    const internalDetail = "INTERNAL_REPLAY_DRIVER_DETAIL_41ad";
    replayStore.failure = new Error(internalDetail);

    const response = await app.inject({
      method: "POST",
      url: "/v1/test-mutation",
      headers: requestHeaders(signed),
      payload: Buffer.from(body),
    });
    const parsed = ApiErrorSchema.parse(response.json());
    const publicEvidence = `${response.body}\n${logger.serialized()}`;

    expect(response.statusCode).toBe(503);
    expect(parsed).toMatchObject({
      code: "AUTH_PROVIDER_UNAVAILABLE",
      retryable: true,
      fieldErrors: [],
    });
    expect(publicEvidence).not.toContain(signed.token);
    expect(publicEvidence).not.toContain(rawBody);
    expect(publicEvidence).not.toContain(bodySecret);
    expect(publicEvidence).not.toContain(internalDetail);
  });
});
