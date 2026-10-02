import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canonicalDelegatedRequest } from "@account-book/contracts/internal-api";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { generateKeyPair, SignJWT } from "jose";
import { AppModule } from "../../app.module.js";
import { ACCESS_TOKEN_VERIFIER, DelegatedJwtVerifier } from "../../auth/jwt-verifier.js";
import { createApiFastifyAdapter } from "../../common/request-context.js";
import { configureApiApplication, registerRequestBodyParsers } from "../../main.js";
import { API_DATABASE_POOL } from "../../me/me.module.js";
import { REPLAY_STORE } from "../../persistence/replay-store.js";
import { BANK_SERVICE } from "../bank.tokens.js";
import { BankConnectionService } from "../bank-service.js";
import { bankFixture } from "./bank-fixture.js";

/** @param disabled 런타임 기본 null을 검사할지 여부. @returns 실제 Nest/Fastify와 ES256 JWT를 쓰는 외부 통신 없는 fixture. */
export async function bankHttpFixture(disabled = false) {
  const h = bankFixture(), keys = await generateKeyPair("ES256"), used = new Set<string>();
  const replay = { consume: async (digest: Uint8Array) => { const key = Buffer.from(digest).toString("hex"); if (used.has(key)) return false; used.add(key); return true; } };
  const verifier = new DelegatedJwtVerifier({ authDisabled: false, acceptedKids: ["test"], keyring: { test: keys.publicKey }, replayStore: replay });
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_DATABASE_POOL).useValue({ end: async () => undefined })
    .overrideProvider(REPLAY_STORE).useValue(replay).overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(verifier);
  if (!disabled) builder.overrideProvider(BANK_SERVICE).useValue(new BankConnectionService(h.repo, h.options));
  const module = await builder.compile();
  const app = module.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
  registerRequestBodyParsers(app); await configureApiApplication(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
  /** @param method HTTP 동작. @param target 실제 경로. @param scope 권한. @param body 서명할 원문. @returns 30초 일회용 JWT 헤더. */
  async function headers(method: "GET" | "POST", target: string, scope: string, body = "") {
    const requestId = randomUUID(), now = Math.floor(Date.now() / 1000), contentType = method === "GET" ? null : "application/json";
    const rbh = createHash("sha256").update(canonicalDelegatedRequest({ method, target, contentType, bodySha256: createHash("sha256").update(body).digest("base64url"), requestId })).digest("base64url");
    const token = await new SignJWT({ aud: "urn:account-book:api", iss: "urn:account-book:bff", iat: now, nbf: now, exp: now + 30, jti: randomBytes(16).toString("base64url"), rid: requestId, rbh, scp: scope, sub: h.who.userId, sid: h.who.sessionId })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "test" }).sign(keys.privateKey);
    return { authorization: `Bearer ${token}`, "x-request-id": requestId, ...(contentType ? { "content-type": contentType } : {}) };
  }
  /** @param method 동작. @param url 경로. @param scope 권한. @param input JSON. @returns 가드·필터를 거친 실제 응답. */
  async function send(method: "GET" | "POST", url: string, scope: string, input?: unknown) {
    const body = input === undefined ? "" : JSON.stringify(input);
    return app.inject({ method, url, headers: await headers(method, url, scope, body), ...(input !== undefined ? { payload: body } : {}) });
  }
  return { ...h, app, headers, send };
}
