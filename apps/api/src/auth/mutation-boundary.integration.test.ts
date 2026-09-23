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
  UseGuards,
  type LoggerService,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
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

/**
 * 고정 스칼라에서 테스트용 P-256 키 쌍을 재현한다. 운영 자격 증명이 아니다.
 * @returns BFF 서명기와 API 검증기에 나눠 줄 개인키·공개키.
 */
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

  /**
   * 해시 길이와 45초 보존 시각을 확인하고 메모리에서 한 번만 사용하게 한다.
   * @param digest - 검증기가 전달한 32바이트 해시.
   * @param expiresAt - 고정 테스트 시각 기준의 예상 만료 시각.
   * @returns 최초 사용이면 true, 중복이면 false. 입력 불일치나 failure 설정은 오류를 던진다.
   */
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

  /**
   * 다음 테스트에 영향을 주지 않도록 사용 해시와 주입한 장애를 지운다.
   * @returns 반환값 없음. 이 메모리 대역의 상태만 초기화한다.
   */
  public reset(): void {
    this.entries.clear();
    this.failure = undefined;
  }
}

class CapturingLogger implements LoggerService {
  private readonly records: unknown[][] = [];

  /**
   * log 호출을 출력하지 않고 배열에 수집하는 로거 대역이다.
   * @param message - 주 로그 값.
   * @param optionalParams - 함께 기록할 추가 값들.
   * @returns 반환값 없음. 테스트가 나중에 유출 여부를 검사한다.
   */
  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  /**
   * error 호출을 출력하지 않고 배열에 수집하는 로거 대역이다.
   * @param message - 주 로그 값.
   * @param optionalParams - 함께 기록할 추가 값들.
   * @returns 반환값 없음. 테스트가 나중에 유출 여부를 검사한다.
   */
  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  /**
   * warn 호출을 출력하지 않고 배열에 수집하는 로거 대역이다.
   * @param message - 주 로그 값.
   * @param optionalParams - 함께 기록할 추가 값들.
   * @returns 반환값 없음. 테스트가 나중에 유출 여부를 검사한다.
   */
  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  /**
   * debug 호출을 출력하지 않고 배열에 수집하는 로거 대역이다.
   * @param message - 주 로그 값.
   * @param optionalParams - 함께 기록할 추가 값들.
   * @returns 반환값 없음. 테스트가 나중에 유출 여부를 검사한다.
   */
  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  /**
   * verbose 호출을 출력하지 않고 배열에 수집하는 로거 대역이다.
   * @param message - 주 로그 값.
   * @param optionalParams - 함께 기록할 추가 값들.
   * @returns 반환값 없음. 테스트가 나중에 유출 여부를 검사한다.
   */
  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }
  /**
   * fatal 호출을 출력하지 않고 배열에 수집하는 로거 대역이다.
   * @param message - 주 로그 값.
   * @param optionalParams - 함께 기록할 추가 값들.
   * @returns 반환값 없음. 테스트가 나중에 유출 여부를 검사한다.
   */
  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.records.push([message, ...optionalParams]);
  }

  /** 다음 테스트를 위해 수집한 로그만 비운다. @returns 반환값 없음. 외부 로그 파일은 변경하지 않는다. */
  public reset(): void {
    this.records.length = 0;
  }

  /**
   * 수집된 로그를 한 문자열로 합쳐 비밀값 유출 여부를 단언할 수 있게 한다.
   * @returns 오류는 이름·메시지, 객체는 JSON 또는 문자열로 바꾼 여러 줄 로그.
   */
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
  /**
   * 인증을 통과한 사용자와 파싱 본문을 그대로 돌려주는 테스트 전용 경로다.
   * @param request - 실제 가드와 본문 파서를 통과한 요청.
   * @returns 사용자 ID와 본문. 금융 거래를 DB에 저장하지 않는다.
   */
  public create(request: FastifyRequest): unknown {
    return { userId: request.principal!.userId, body: request.body };
  }
}

Controller()(TestMutationController);
UseGuards(AuthGuard)(TestMutationController);
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
/**
 * 서명기와 검증기가 시간 경계에서 흔들리지 않도록 같은 시각을 제공한다.
 * @returns 고정 테스트 시각의 새 Date.
 */
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
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})(TestMutationModule);

const exactBodyText = '{"amount":1200,"memo":"lunch"}';
const exactBody = new TextEncoder().encode(exactBodyText);

/**
 * 정상 POST 변경 요청에 일부 변경값을 적용해 실제 BFF 서명기로 서명한다.
 * @param overrides - 본문·경로·권한 등의 테스트 변경값.
 * @returns 서명 토큰과 요청 ID가 담긴 비동기 결과.
 */
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

/**
 * 서명 결과를 HTTP 테스트에 필요한 세 헤더로 바꾼다.
 * @param signed - 토큰과 요청 ID를 담은 서명 결과.
 * @returns Authorization, Content-Type, X-Request-Id 헤더 객체.
 */
function requestHeaders(signed: Awaited<ReturnType<typeof signMutation>>) {
  return {
    authorization: `Bearer ${signed.token}`,
    "content-type": "application/json",
    "x-request-id": signed.requestId,
  };
}

/**
 * 응답이 고정된 401 인증 실패 계약과 일치하는지 단언한다.
 * @param response - 상태 코드와 JSON 본문 접근기를 가진 HTTP 테스트 응답.
 * @returns 반환값 없음. 상태·스키마·필드가 다르면 테스트 실패.
 */
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

/**
 * 기존 토큰의 발급자·수신자만 바꿔 다시 서명하므로 서명 오류와 클레임 정책 오류를 구분할 수 있다.
 * @param token - 페이로드를 가져올 테스트 토큰.
 * @param claim - 덮어쓸 iss 또는 aud.
 * @returns 테스트 개인키로 다시 서명한 토큰.
 */
async function tokenWithClaim(
  token: string,
  claim: Readonly<{ iss?: string; aud?: string }>,
): Promise<string> {
  return new SignJWT({ ...decodeJwt(token), ...claim })
    .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: KEY_ID })
    .sign(keys.privateKey);
}

type RawResponse = Readonly<{ statusCode: number; body: string }>;

/**
 * 중복 헤더가 합쳐지지 않도록 이름·값 배열로 실제 HTTP POST를 보낸다.
 * @param baseUrl - 로컬 테스트 서버 주소.
 * @param headers - 중복을 보존할 원시 헤더 쌍.
 * @param payload - 전송할 정확한 본문 바이트.
 * @returns 응답 상태와 UTF-8 본문. 요청 전송 오류는 Promise를 거부한다.
 */
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
