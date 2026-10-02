import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthAdapter } from "../supabase-auth-adapter.js";
import { accepted, rawTokenPair, tokenPair } from "./session-parser.js";
import {
  accessToken,
  adapter,
  challenge,
  client,
  emailFlow,
  expectSafeError,
  issuedAtSeconds,
  jwt,
  jwtPayload,
  jsonResponse,
  nowSeconds,
  ok,
  rawSession,
  session,
  userId,
  verifier,
} from "./test-fixtures.js";

vi.mock("server-only", () => ({}));
afterEach(() => vi.restoreAllMocks());

it("validates errors even when no result data is expected", () => {
  expect(() => accepted({ error: { status: 429 } })).toThrow("AUTH_RATE_LIMITED");
  expect(accepted({})).toBeUndefined();
});

it.each(["A", "Zh"])("rejects an empty or noncanonical decoded JWT segment %s", (segment) => {
  const parts = session.access_token.split(".");
  expect(() => tokenPair({ ...session, access_token: `${segment}.${parts[1]}.${parts[2]}` }))
    .toThrow("AUTH_PROVIDER_UNAVAILABLE");
});

const tokenSegments = session.access_token.split(".");
const wrongSegmentCountJwt = tokenSegments.slice(0, 2).join(".");
const nonCanonicalSegmentJwt = `${tokenSegments[0]}.${tokenSegments[1]}=.${tokenSegments[2]}`;
const malformedPayloadJwt = `${tokenSegments[0]}.${Buffer.from("{").toString("base64url")}.${tokenSegments[2]}`;
const nonObjectPayloadJwt = jwtPayload(null);
const nonCanonicalHeaderJwt = `${tokenSegments[0]}=.${tokenSegments[1]}.${tokenSegments[2]}`;
const nonCanonicalSignatureJwt = `${tokenSegments[0]}.${tokenSegments[1]}.${tokenSegments[2]}=`;
const overflowExpiresAtSeconds = 8_640_000_000_001;
const overflowAccessToken = jwt({ exp: overflowExpiresAtSeconds });
const overflowRawSession = { ...rawSession, access_token: overflowAccessToken, expires_in: overflowExpiresAtSeconds - issuedAtSeconds, expires_at: undefined };
const overflowSdkSession = { ...session, access_token: overflowAccessToken, expires_at: overflowExpiresAtSeconds };

describe("Supabase session parsing through public flows", () => {
  it.each([1, 60])("accepts provider issuance %i seconds ahead without changing the JWT expiry", (skewSeconds) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    const response = { ...rawSession, access_token: jwt({ iat: issuedAtSeconds + skewSeconds, exp: nowSeconds + skewSeconds }), expires_at: nowSeconds + skewSeconds };
    for (const parse of [tokenPair, rawTokenPair]) {
      expect(parse(response)).toMatchObject({ issuedAtSeconds: issuedAtSeconds + skewSeconds, accessTokenExpiresAt: new Date((nowSeconds + skewSeconds) * 1000) });
    }
  });

  it.each([61, 3600])("rejects provider issuance %i seconds ahead on both token paths", (skewSeconds) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    const response = { ...rawSession, access_token: jwt({ iat: issuedAtSeconds + skewSeconds, exp: nowSeconds + skewSeconds }), expires_at: nowSeconds + skewSeconds };
    for (const parse of [tokenPair, rawTokenPair]) expect(() => parse(response)).toThrow("AUTH_PROVIDER_UNAVAILABLE");
  });

  it.each([-60, -1, 1, 60])("uses JWT expiry when SDK absolute expiry differs by %i seconds", (difference) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    expect(tokenPair({ ...session, expires_at: nowSeconds + difference }).accessTokenExpiresAt).toEqual(new Date(nowSeconds * 1000));
    expect(() => rawTokenPair({ ...rawSession, expires_at: nowSeconds + difference })).toThrow("AUTH_PROVIDER_UNAVAILABLE");
  });

  it.each([-61, 61])("rejects SDK expiry drift of %i seconds", (difference) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    expect(() => tokenPair({ ...session, expires_at: nowSeconds + difference })).toThrow("AUTH_PROVIDER_UNAVAILABLE");
  });

  it.each([0, -1])("does not extend an actually expired JWT by the skew allowance (%i seconds)", (difference) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    const response = { ...rawSession, access_token: jwt({ iat: issuedAtSeconds - 3600, exp: issuedAtSeconds + difference }), expires_at: issuedAtSeconds + 60, expires_in: 3600 + difference };
    for (const parse of [tokenPair, rawTokenPair]) expect(() => parse(response)).toThrow("AUTH_PROVIDER_UNAVAILABLE");
  });

  it.each(["signInWithPassword", "refresh"] as const)("accepts the real SDK's synthesized expiry after %s", async (operation) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000 + 750);
    const response = { ...rawSession, expires_at: undefined };
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(response));
    const subject = new SupabaseAuthAdapter({ url: "https://project.supabase.co", anonKey: "anon-key" }, undefined, fetcher);
    const result = operation === "signInWithPassword"
      ? await subject.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) })
      : await subject.refresh("refresh-token");
    expect(result.accessTokenExpiresAt).toEqual(new Date(nowSeconds * 1000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([1, 60])("accepts a newly confirmed email %i seconds ahead on both token paths", (skewSeconds) => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    const response = { ...rawSession, user: { ...session.user, email_confirmed_at: new Date((issuedAtSeconds + skewSeconds) * 1000).toISOString() } };
    for (const parse of [tokenPair, rawTokenPair]) expect(parse(response).user.emailVerified).toBe(true);
  });

  it("rejects email confirmation beyond the clock skew bound", () => {
    vi.spyOn(Date, "now").mockReturnValue(issuedAtSeconds * 1000);
    const response = { ...rawSession, user: { ...session.user, email_confirmed_at: new Date((issuedAtSeconds + 61) * 1000).toISOString() } };
    for (const parse of [tokenPair, rawTokenPair]) expect(() => parse(response)).toThrow("AUTH_EMAIL_VERIFICATION_REQUIRED");
  });

  it.each([
    ["missing JWT issuance", { access_token: jwt({ iat: undefined }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["mismatched JWT subject", { access_token: jwt({ sub: "123e4567-e89b-12d3-a456-426614174099" }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["missing JWT session", { access_token: jwt({ session_id: undefined }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["mismatched absolute expiry", { expires_at: nowSeconds + 61 }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["unconfirmed email", { user: { ...session.user, email_confirmed_at: null } }, "AUTH_EMAIL_VERIFICATION_REQUIRED"],
  ] as const)("rejects an SDK-normalized session with %s", async (_label, override, expected) => {
    const malformed = { ...session, ...override };
    const setup = adapter([], client({ signInWithPassword: vi.fn(async () => ok({ session: malformed })) }));
    await expectSafeError(() => setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), expected);
  });

  it.each([
    ["wrong JWT segment count", { access_token: wrongSegmentCountJwt }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["noncanonical base64url JWT segment", { access_token: nonCanonicalSegmentJwt }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["malformed JWT payload JSON", { access_token: malformedPayloadJwt }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["non-object JWT payload JSON", { access_token: nonObjectPayloadJwt }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["missing JWT expiry", { access_token: jwt({ exp: undefined }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["fractional JWT expiry", { access_token: jwt({ exp: nowSeconds + 0.5 }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["malformed JWT subject", { access_token: jwt({ sub: "not-a-uuid" }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["malformed JWT session identifier", { access_token: jwt({ session_id: "not-a-uuid" }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["noncanonical JWT header segment", { access_token: nonCanonicalHeaderJwt }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["noncanonical JWT signature segment", { access_token: nonCanonicalSignatureJwt }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["invalid email confirmation timestamp", { user: { ...session.user, email_confirmed_at: "not-a-date" } }, "AUTH_EMAIL_VERIFICATION_REQUIRED"],
    ["future email confirmation timestamp", { user: { ...session.user, email_confirmed_at: "9999-12-31T23:59:59.000Z" } }, "AUTH_EMAIL_VERIFICATION_REQUIRED"],
    ["phone-only confirmation", { user: { id: userId, phone: "+821012345678", phone_confirmed_at: "2026-07-20T00:00:00.000Z" } }, "AUTH_EMAIL_VERIFICATION_REQUIRED"],
  ] as const)("rejects %s on both normalized and raw token paths", async (_label, override, expected) => {
    const normalizedSession = { ...session, ...override };
    const normalized = adapter([], client({ signInWithPassword: vi.fn(async () => ok({ session: normalizedSession })) }));
    await expectSafeError(() => normalized.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), expected);

    const raw = adapter([jsonResponse({ ...rawSession, ...override })]);
    await expectSafeError(() => raw.adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), expected);
    expect(raw.factory).not.toHaveBeenCalled();

    const normalizedFlow = emailFlow(adapter([], client({ signInWithPassword: vi.fn(async () => ok({ session: normalizedSession })) })).adapter);
    await expect(normalizedFlow.service.signIn({ email: "person@example.test", password: "a".repeat(12) }, normalizedFlow.context)).rejects.toMatchObject({ code: expected });
    expect(normalizedFlow.sessions.create).not.toHaveBeenCalled();

    const rawFlow = emailFlow(adapter([jsonResponse({}), jsonResponse({ ...rawSession, ...override })]).adapter);
    await rawFlow.service.signUp({ email: "person@example.test", password: "a".repeat(12) }, rawFlow.context);
    await expect(rawFlow.service.confirmEmail({ code: "code" }, rawFlow.context)).rejects.toMatchObject({ code: expected });
    expect(rawFlow.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects an unrepresentable expiry from the SDK-normalized parser", async () => {
    const setup = adapter([], client({ signInWithPassword: vi.fn(async () => ok({ session: overflowSdkSession })) }));
    await expectSafeError(() => setup.adapter.signInWithPassword({ email: "person@example.test", password: "a".repeat(12) }), "AUTH_PROVIDER_UNAVAILABLE");
  });

  it("rejects an unrepresentable expiry from a raw PKCE token exchange", async () => {
    const setup = adapter([jsonResponse(overflowRawSession)]);
    await expectSafeError(() => setup.adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_PROVIDER_UNAVAILABLE");
  });

  it("rejects an unrepresentable expiry from a recovery code exchange", async () => {
    const setup = adapter([jsonResponse(overflowRawSession)]);
    await expectSafeError(() => setup.adapter.exchangeRecoveryCode({ code: "code", codeVerifier: verifier }), "AUTH_PROVIDER_UNAVAILABLE");
  });

  it.each([
    ["non-canonical token type", { token_type: "Bearer" }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["missing token type", { token_type: undefined }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["non-positive lifetime", { expires_in: 0 }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["fractional lifetime", { expires_in: 3600.5 }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["lifetime inconsistent with JWT", { expires_in: 3599 }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["missing issued-at", { access_token: jwt({ iat: undefined }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["fractional issued-at", { access_token: jwt({ iat: issuedAtSeconds + 0.5 }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["expiry before issued-at", { access_token: jwt({ exp: issuedAtSeconds }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["inconsistent optional absolute expiry", { expires_at: nowSeconds + 1 }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["mismatched subject", { access_token: jwt({ sub: "123e4567-e89b-12d3-a456-426614174099" }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["missing provider session", { access_token: jwt({ session_id: undefined }) }, "AUTH_PROVIDER_UNAVAILABLE"],
    ["unconfirmed email", { user: { ...session.user, email_confirmed_at: null } }, "AUTH_EMAIL_VERIFICATION_REQUIRED"],
  ] as const)("rejects a raw PKCE token response with %s", async (_label, override, expected) => {
    const setup = adapter([jsonResponse({ ...rawSession, ...override })]);
    await expectSafeError(() => setup.adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), expected);
  });

  it("rejects malformed HTTP JSON and incomplete token material", async () => {
    const malformedJson = new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
    await expectSafeError(() => adapter([malformedJson]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_PROVIDER_UNAVAILABLE");
    await expectSafeError(() => adapter([jsonResponse({ ...rawSession, refresh_token: "" })]).adapter.exchangeOAuthCode({ code: "code", codeVerifier: verifier }), "AUTH_PROVIDER_UNAVAILABLE", accessToken);
    await expectSafeError(() => adapter([jsonResponse([])]).adapter.requestPasswordReset("person@example.test", new URL("https://app.example.test/recovery"), challenge), "AUTH_PROVIDER_UNAVAILABLE");
  });
});
