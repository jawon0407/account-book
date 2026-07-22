import { ApiErrorSchema, CurrentUserSchema } from "@account-book/contracts";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import {
  ACCESS_TOKEN_VERIFIER,
  JwtAccessTokenVerifier,
  type AccessTokenVerifier,
} from "../auth/jwt-verifier.js";
import { configureApiApplication } from "../main.js";
import { createApiFastifyAdapter } from "../common/request-context.js";

const issuer = "https://id.example.test/auth/v1";
const audience = "authenticated";
const userId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "123e4567-e89b-12d3-a456-426614174001";
const operationalToken = "b3BlcmF0aW9uYWw.c2VjcmV0.dG9rZW4";
const unsupportedCritToken = `${Buffer.from(JSON.stringify({ alg: "ES256", crit: ["x"], x: true })).toString("base64url")}.e30.AA`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("API authentication boundary", () => {
  let app: NestFastifyApplication;
  let validToken: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const local = new JwtAccessTokenVerifier(
      { issuer, audience, algorithm: "ES256" },
      async () => publicKey,
    );
    const verifier: AccessTokenVerifier = {
      async verify(token) {
        if (token === operationalToken) throw new Error(`JWKS failure with ${token}`);
        return local.verify(token);
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(createApiFastifyAdapter(), { logger: false });
    await configureApiApplication(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const now = Math.floor(Date.now() / 1000);
    validToken = await new SignJWT({ session_id: sessionId, ignored_email: "private@example.test" })
      .setProtectedHeader({ alg: "ES256", kid: "local-test" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves minimal health with Helmet, no CORS, and a server-owned UUID request ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "attacker-owned" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toMatch(uuid);
    expect(response.headers["x-request-id"]).not.toBe("attacker-owned");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBeTypeOf("string");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns a fixed no-store 401 without credentials", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    const error = ApiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(error).toMatchObject({ code: "AUTH_SESSION_EXPIRED", retryable: false, fieldErrors: [] });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-request-id"]).toBe(error.requestId);
  });

  it("returns only the shared current-user shape from the verified principal", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(CurrentUserSchema.parse(response.json())).toEqual({ id: userId, email: null, emailVerified: true });
    expect(response.body).not.toContain("private@example.test");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("rejects duplicate, coalesced, and oversized Bearer inputs at the HTTP boundary", async () => {
    const duplicate = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: ["Bearer aaa.bbb.ccc", "Bearer ddd.eee.fff"] },
    });
    const coalesced = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer aaa.bbb.ccc, Bearer ddd.eee.fff" },
    });
    const oversized = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${"a".repeat(8186)}` },
    });

    for (const response of [duplicate, coalesced, oversized]) {
      expect(response.statusCode).toBe(401);
      expect(ApiErrorSchema.parse(response.json()).code).toBe("AUTH_SESSION_EXPIRED");
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("maps unsupported protected critical headers to the fixed authentication failure", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${unsupportedCritToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
      retryable: false,
      fieldErrors: [],
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("fails closed on operational verifier errors without leaking tokens or messages", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${operationalToken}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true, fieldErrors: [] });
    expect(response.body).not.toContain(operationalToken);
    expect(response.body).not.toContain("JWKS failure");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});
