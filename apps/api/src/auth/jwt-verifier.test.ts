import { createHash, randomUUID } from "node:crypto";
import { SignJWT, generateKeyPair } from "jose";
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

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

function request(overrides: Partial<RequestDescriptor> = {}): RequestDescriptor {
  return { method: "POST", target: "/v1/me?a=1&b=2", contentType: "application/json; charset=utf-8", body: Buffer.from('{"x":1}'), requestId, ...overrides };
}

function binding(value: RequestDescriptor): string {
  return createHash("sha256").update(canonicalDelegatedRequest({
    method: value.method,
    target: value.target,
    contentType: value.contentType,
    bodySha256: createHash("sha256").update(value.body).digest("base64url"),
    requestId: value.requestId,
  })).digest("base64url");
}

async function token(value = request(), overrides: Readonly<Record<string, unknown>> = {}, header: Record<string, unknown> = { alg: "ES256", typ: "at+jwt", kid: "key-1" }): Promise<string> {
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
  }).setProtectedHeader(header).sign(privateKey);
}

class MemoryReplayStore implements ReplayStore {
  public readonly consumed = new Set<string>();
  public calls = 0;
  public failure: Error | undefined;

  public async consume(digest: Uint8Array, _expiresAt: Date): Promise<boolean> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    const value = Buffer.from(digest).toString("hex");
    if (this.consumed.has(value)) return false;
    this.consumed.add(value);
    return true;
  }
}

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
    ["future not-before", { nbf: now + 6, exp: now + 36 }],
    ["inconsistent lifetime", { exp: now + 31 }],
    ["wrong issuer", { iss: "urn:wrong" }],
    ["array audience", { aud: ["urn:account-book:api"] }],
    ["array scope", { scp: ["me:read"] }],
    ["noncanonical subject", { sub: userId.toUpperCase() }],
    ["noncanonical jti", { jti: "AAAAAAAAAAAAAAAAAAAAAA=" }],
    ["missing request binding", { rbh: undefined }],
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
  ])("rejects a %s binding mismatch before replay consumption", async (_name, actualRequest) => {
    const { verifier: subject, store } = verifier();
    await expect(subject.verify({ token: await token(), request: actualRequest, requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(store.calls).toBe(0);
  });

  it("rejects an unknown key and an unsupported critical header before replay consumption", async () => {
    const unknown = verifier();
    await expect(unknown.verifier.verify({ token: await token(request(), {}, { alg: "ES256", typ: "at+jwt", kid: "other" }), request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(unknown.store.calls).toBe(0);

    const critical = verifier();
    const signed = await token();
    const [, payload, signature] = signed.split(".");
    const unsupportedCriticalHeader = Buffer.from(JSON.stringify({ alg: "ES256", typ: "at+jwt", kid: "key-1", crit: ["x"], x: true })).toString("base64url");
    await expect(critical.verifier.verify({ token: `${unsupportedCriticalHeader}.${payload}.${signature}`, request: request(), requiredScope: "me:read" })).rejects.toMatchObject({ message: "AUTH_ACCESS_TOKEN_INVALID" });
    expect(critical.store.calls).toBe(0);
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
