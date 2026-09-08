import { createECDH, createHash, randomUUID } from "node:crypto";
import { SignJWT, importJWK, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalDelegatedRequest, type DelegatedScope } from "@account-book/contracts/internal-api";
import type { ReplayStore } from "../persistence/replay-store.js";
import * as jwtVerifier from "./jwt-verifier.js";

const DelegatedJwtVerifier = (jwtVerifier as unknown as {
  DelegatedJwtVerifier: new (options: Readonly<{
    authDisabled: boolean;
    acceptedKids: readonly string[];
    keyring: Readonly<Record<string, CryptoKey>>;
    replayStore: ReplayStore;
    now: () => Date;
  }>) => { verify(input: Readonly<{ token: string; request: RequestDescriptor; requiredScope: DelegatedScope }>): Promise<unknown> };
}).DelegatedJwtVerifier;

type RequestDescriptor = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  target: string;
  contentType: string | null;
  body: Uint8Array;
  requestId: string;
}>;

const now = 1_800_000_000;
const userId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "123e4567-e89b-12d3-a456-426614174001";
const requestId = "123e4567-e89b-12d3-a456-426614174002";
const jti = "AAAAAAAAAAAAAAAAAAAAAA";

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let otherPublicKey: CryptoKey;
let wrongAlgorithmPrivateKey: CryptoKey;
let wrongAlgorithmPublicKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await deterministicEcPair("prime256v1", "P-256", "ES256", "0000000000000000000000000000000000000000000000000000000000000001", 32));
  ({ privateKey: otherPrivateKey, publicKey: otherPublicKey } = await deterministicEcPair("prime256v1", "P-256", "ES256", "0000000000000000000000000000000000000000000000000000000000000002", 32));
  ({ privateKey: wrongAlgorithmPrivateKey, publicKey: wrongAlgorithmPublicKey } = await deterministicEcPair("secp384r1", "P-384", "ES384", "0000000000000000000000000000000000000000000000000000000000000001", 48));
});

/**
 * 고정 비밀 스칼라로 항상 같은 테스트용 EC 키 쌍을 만든다. 운영 키로 사용하면 안 된다.
 * @param curve - Node ECDH 곡선 이름.
 * @param crv - JWK 곡선 이름.
 * @param algorithm - JOSE 서명 알고리즘.
 * @param privateScalarHex - 테스트 전용 고정 비밀 스칼라의 16진수 표기.
 * @param coordinateBytes - 공개키 x/y 좌표의 바이트 길이.
 * @returns 가져온 개인키와 공개키. 잘못된 암호 설정은 키 생성 오류로 전파된다.
 */
async function deterministicEcPair(curve: "prime256v1" | "secp384r1", crv: "P-256" | "P-384", algorithm: "ES256" | "ES384", privateScalarHex: string, coordinateBytes: number): Promise<Readonly<{ privateKey: CryptoKey; publicKey: CryptoKey }>> {
  const scalar = Buffer.from(privateScalarHex, "hex");
  const ecdh = createECDH(curve);
  ecdh.setPrivateKey(scalar);
  const point = ecdh.getPublicKey();
  const x = point.subarray(1, 1 + coordinateBytes).toString("base64url");
  const y = point.subarray(1 + coordinateBytes, 1 + (coordinateBytes * 2)).toString("base64url");
  return {
    privateKey: await importJWK({ kty: "EC", crv, d: scalar.toString("base64url"), x, y }, algorithm) as CryptoKey,
    publicKey: await importJWK({ kty: "EC", crv, x, y }, algorithm) as CryptoKey,
  };
}

/**
 * 서명 대상과 실제 요청을 비교하기 위한 기본 요청 정보를 만든다.
 * @param overrides - 메서드·URL·본문·ID 중 바꿀 값.
 * @returns 덮어쓰기가 적용된 새 요청 정보.
 */
function request(overrides: Partial<RequestDescriptor> = {}): RequestDescriptor {
  return { method: "POST", target: "/v1/me?a=1&b=2", contentType: "application/json; charset=utf-8", body: Buffer.from('{"x":1}'), requestId, ...overrides };
}

/**
 * 실제 본문 해시를 포함한 정규 요청 문자열의 해시를 계산한다.
 * @param value - JWT에 묶을 테스트 요청 정보.
 * @returns rbh 클레임에 넣을 SHA-256 base64url 문자열.
 */
function binding(value: RequestDescriptor): string {
  return createHash("sha256").update(canonicalDelegatedRequest({
    method: value.method,
    target: value.target,
    contentType: value.contentType,
    bodySha256: createHash("sha256").update(value.body).digest("base64url"),
    requestId: value.requestId,
  })).digest("base64url");
}

/**
 * 정상 기본 클레임에 변경값을 적용해 경계 조건용 JWT를 실제 서명한다.
 * @param value - 요청 결합 해시를 계산할 정보.
 * @param overrides - 누락·불일치 상황을 만들 클레임 변경값.
 * @param header - 보호 헤더.
 * @param signingKey - 서명에 사용할 테스트 개인키.
 * @param signingOptions - crit 등 JOSE 서명 옵션.
 * @returns 서명된 JWT 문자열. 서명 불가 입력은 JOSE 오류로 전파된다.
 */
async function token(value = request(), overrides: Readonly<Record<string, unknown>> = {}, header: Record<string, unknown> = { alg: "ES256", typ: "at+jwt", kid: "key-1" }, signingKey = privateKey, signingOptions: Readonly<{ crit?: Record<string, boolean> }> = {}): Promise<string> {
  return new SignJWT({
    aud: "urn:account-book:api",
    exp: now + 30,
    iat: now,
    iss: "urn:account-book:bff",
    jti,
    nbf: now,
    rbh: binding(value),
    rid: requestId,
    scp: "me:read",
    sid: sessionId,
    sub: userId,
    ...overrides,
  }).setProtectedHeader(header).sign(signingKey, signingOptions);
}

/**
 * alg 헤더가 없지만 ECDSA 서명 바이트는 유효한 특수 토큰을 만든다.
 * @param value - 서명에 묶을 요청 정보.
 * @param overrides - 기본 페이로드에 덮어쓸 클레임.
 * @returns 정책상 거부되어야 하는 alg 누락 JWT.
 */
async function tokenWithoutAlgorithm(value = request(), overrides: Readonly<Record<string, unknown>> = {}): Promise<string> {
  const signed = await token(value, overrides);
  const [, payload] = signed.split(".");
  const header = Buffer.from(JSON.stringify({ typ: "at+jwt", kid: "key-1" })).toString("base64url");
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data)).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * 음성 테스트 토큰도 암호학적 서명 자체는 유효함을 먼저 단언한다.
 * @param signed - 확인할 서명 토큰.
 * @param key - 대응하는 공개키.
 * @param algorithm - 이 확인에서 허용할 알고리즘.
 * @returns 검증 단언이 끝나면 완료되는 Promise. 유효하지 않으면 테스트가 실패한다.
 */
async function expectSignedToken(signed: string, key: CryptoKey, algorithm: "ES256" | "ES384"): Promise<void> {
  await expect(jwtVerify(signed, key, {
    algorithms: [algorithm],
    audience: "urn:account-book:api",
    issuer: "urn:account-book:bff",
    currentDate: new Date(now * 1000),
  })).resolves.toBeDefined();
}

class MemoryReplayStore implements ReplayStore {
  public readonly consumed = new Set<string>();
  public calls = 0;
  public failure: Error | undefined;

  /**
   * 메모리에서 토큰 사용과 호출 횟수를 기록하고 설정된 저장소 장애를 흉내 낸다.
   * @param digest - 재사용 여부를 구분할 해시 바이트.
   * @returns 처음이면 true, 이미 기록되었으면 false. failure가 설정되면 해당 오류를 던진다.
   */
  public async consume(digest: Uint8Array): Promise<boolean> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    const value = Buffer.from(digest).toString("hex");
    if (this.consumed.has(value)) return false;
    this.consumed.add(value);
    return true;
  }
}

/**
 * 고정 시계와 공개키를 넣은 검증기와 관찰용 저장소를 함께 만든다.
 * @param store - 호출 횟수와 중복을 관찰할 메모리 저장소.
 * @param options - 중지 스위치·허용 키·키 맵의 테스트 변경값.
 * @returns 저장소와 검증기를 묶은 객체.
 */
function verifier(store = new MemoryReplayStore(), options: Partial<{ authDisabled: boolean; acceptedKids: readonly string[]; keyring: Record<string, CryptoKey> }> = {}) {
  return {
    store,
    verifier: new DelegatedJwtVerifier({
      authDisabled: false,
      acceptedKids: ["key-1"],
      keyring: { "key-1": publicKey },
      replayStore: store,
      now: () => new Date(now * 1000),
      ...options,
    }),
  };
}

describe("DelegatedJwtVerifier", () => {
  it("returns a frozen request-correlated principal only after a valid replay consumption", async () => {
    const { verifier: subject } = verifier();
    const result = await subject.verify({ token: await token(), request: request(), requiredScope: "me:read" });

    expect(result).toEqual({ userId, sessionId, scope: "me:read", requestId });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("permits exactly one concurrent use of the same valid token", async () => {
    const { verifier: subject } = verifier();
    const signed = await token();
    const attempts = await Promise.allSettled([1, 2].map(() => subject.verify({ token: signed, request: request(), requiredScope: "me:read" })));

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });

  it.each([
    ["expired", { exp: now - 31 }],
    ["missing issued-at", { iat: undefined }],
    ["missing not-before", { nbf: undefined }],
    ["missing expiration", { exp: undefined }],
    ["missing audience", { aud: undefined }],
    ["missing issuer", { iss: undefined }],
    ["missing token identifier", { jti: undefined }],
    ["missing request identifier", { rid: undefined }],
    ["missing scope", { scp: undefined }],
    ["missing session ID", { sid: undefined }],
    ["missing subject", { sub: undefined }],
    ["future not-before", { nbf: now + 6, exp: now + 36 }],
    ["inconsistent lifetime", { exp: now + 31 }],
    ["wrong issuer", { iss: "urn:wrong" }],
    ["array audience", { aud: ["urn:account-book:api"] }],
    ["array scope", { scp: ["me:read"] }],
    ["wrong scalar scope", { scp: "admin:read" }],
    ["noncanonical subject", { sub: userId.toUpperCase() }],
    ["malformed session ID", { sid: "not-a-uuid" }],
    ["malformed request ID", { rid: "not-a-uuid" }],
    ["noncanonical jti", { jti: "AAAAAAAAAAAAAAAAAAAAAA=" }],
    ["missing request binding", { rbh: undefined }],
    ["malformed request binding", { rbh: "not-base64url" }],
  ])("rejects %s before replay consumption", async (_name, claims) => {
    const { verifier: subject, store } = verifier();
    await expect(subject.verify({ token: await token(request(), claims), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });

  it.each([
    ["wrong method", request({ method: "GET" })],
    ["wrong target", request({ target: "/v1/me?a=1&b=3" })],
    ["wrong body", request({ body: Buffer.from('{"x":2}') })],
    ["wrong request ID", request({ requestId: randomUUID() })],
    ["wrong content type", request({ contentType: null })],
  ])("rejects a %s binding mismatch before replay consumption", async (_name, actualRequest) => {
    const { verifier: subject, store } = verifier();
    await expect(subject.verify({ token: await token(), request: actualRequest, requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });

  it("accepts canonical equivalent query ordering", async () => {
    const { verifier: subject, store } = verifier();
    const signed = await token(request({ target: "/v1/me?b=2&a=1" }));

    await expect(subject.verify({ token: signed, request: request(), requiredScope: "me:read" })).resolves.toMatchObject({ userId, sessionId });
    expect(store.calls).toBe(1);
  });

  it("rejects an unknown key and an unsupported critical header before replay consumption", async () => {
    const unknown = verifier();
    await expect(unknown.verifier.verify({ token: await token(request(), {}, { alg: "ES256", typ: "at+jwt", kid: "other" }), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(unknown.store.calls).toBe(0);

    const critical = verifier();
    await expect(critical.verifier.verify({ token: await token(request(), {}, { alg: "ES256", typ: "at+jwt", kid: "key-1", crit: ["x"], x: true }, privateKey, { crit: { x: true } }), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(critical.store.calls).toBe(0);
  });

  it.each([
    ["missing protected kid", { alg: "ES256", typ: "at+jwt" }],
    ["missing token type", { alg: "ES256", kid: "key-1" }],
    ["wrong token type", { alg: "ES256", typ: "JWT", kid: "key-1" }],
  ])("rejects %s before replay consumption", async (_name, header) => {
    const { verifier: subject, store } = verifier();
    const signed = await token(request(), {}, header);
    await expectSignedToken(signed, publicKey, "ES256");
    await expect(subject.verify({ token: signed, request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });

  it("rejects a validly signed wrong algorithm header before replay consumption", async () => {
    const { verifier: subject, store } = verifier(undefined, { keyring: { "key-1": wrongAlgorithmPublicKey } });
    const signed = await token(request(), {}, { alg: "ES384", typ: "at+jwt", kid: "key-1" }, wrongAlgorithmPrivateKey);
    await expectSignedToken(signed, wrongAlgorithmPublicKey, "ES384");

    await expect(subject.verify({ token: signed, request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });

  it("rejects a validly signed missing algorithm header before replay consumption", async () => {
    const { verifier: subject, store } = verifier();
    const signed = await tokenWithoutAlgorithm();
    const [encodedHeader, payload, signature] = signed.split(".");
    const validSignature = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature!, "base64url"),
      new TextEncoder().encode(`${encodedHeader}.${payload}`),
    );
    expect(validSignature).toBe(true);

    await expect(subject.verify({ token: signed, request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });

  it("rejects an invalid signature and an unaccepted present kid before replay consumption", async () => {
    const signature = verifier();
    await expect(signature.verifier.verify({ token: await token(request(), {}, undefined, otherPrivateKey), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(signature.store.calls).toBe(0);

    const unaccepted = verifier(undefined, { keyring: { "key-1": publicKey, "key-2": otherPublicKey } });
    await expect(unaccepted.verifier.verify({ token: await token(request(), {}, { alg: "ES256", typ: "at+jwt", kid: "key-2" }, otherPrivateKey), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(unaccepted.store.calls).toBe(0);
  });

  it("uses a keyring and accepted-kid snapshot captured at construction", async () => {
    const mutableKeyring: Record<string, CryptoKey> = { "key-1": publicKey };
    const mutableAcceptedKids = ["key-1"];
    const store = new MemoryReplayStore();
    const subject = new DelegatedJwtVerifier({
      authDisabled: false,
      acceptedKids: mutableAcceptedKids,
      keyring: mutableKeyring,
      replayStore: store,
      now: () => new Date(now * 1000),
    });
    mutableKeyring["key-1"] = otherPublicKey;
    mutableAcceptedKids[0] = "key-2";

    await expect(subject.verify({ token: await token(), request: request(), requiredScope: "me:read" })).resolves.toMatchObject({ userId, sessionId });
    expect(store.calls).toBe(1);
  });

  it("fails the kill switch before resolving or consuming token material", async () => {
    const { verifier: subject, store } = verifier(undefined, { authDisabled: true });
    await expect(subject.verify({ token: "not-a-token", request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_VERIFICATION_UNAVAILABLE" });
    expect(store.calls).toBe(0);
  });

  it("maps replay duplicate and operational failures to distinct fixed failures", async () => {
    const duplicate = verifier();
    duplicate.store.consumed.add(createHash("sha256").update(jti).digest("hex"));
    await expect(duplicate.verifier.verify({ token: await token(), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });

    const unavailable = verifier();
    unavailable.store.failure = new Error("driver detail must not escape");
    await expect(unavailable.verifier.verify({ token: await token(), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_VERIFICATION_UNAVAILABLE" });
  });

  it("rejects tokens over 4,096 UTF-8 bytes before replay consumption", async () => {
    const { verifier: subject, store } = verifier();
    await expect(subject.verify({ token: `${await token()}.${"x".repeat(4_096)}`, request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });
});
