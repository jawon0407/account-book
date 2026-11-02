import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthProviderError } from "../auth/auth-provider-port.js";
import { SessionOperationError } from "../session/session-service.js";
import type { NativeAuthDependencies, NativeOperation } from "./native-controller.js";
const module = await import("./native-controller.js").catch(() => ({} as Record<string, unknown>));
const Controller = module.NativeAuthController as new (deps: NativeAuthDependencies) => { handle(operation: NativeOperation, request: Request): Promise<Response> };
const origin = new URL("https://app.example.test");
const now = new Date("2026-10-16T00:00:00Z");
const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const token = "A".repeat(43), nextToken = "B".repeat(42) + "A";
const credentials = { email: "person@example.test", password: "synthetic-password", deviceId };
const paths = { signIn: "sign-in", session: "session", refresh: "session/refresh", signOut: "sign-out" };

/** 합성 입력만 쓰며 provider token과 앱 자격 증명을 구분한다. */
function setup() {
  const pair = { accessToken: "provider-access-secret", refreshToken: "provider-refresh-secret", userId,
    supabaseSessionId: "33333333-3333-4333-8333-333333333333", issuedAtSeconds: now.getTime() / 1000,
    accessTokenExpiresAt: new Date(now.getTime() + 3600_000), user: { id: userId, email: credentials.email, emailVerified: true } };
  const resolved = { ...pair, sessionId: "44444444-4444-4444-8444-444444444444", clientChannel: "android" as const, deviceId, rotationVersion: 0 };
  const deps = {
    origin, now: () => now,
    provider: { signInWithPassword: vi.fn(async () => pair), signOut: vi.fn(async () => undefined) },
    sessions: { create: vi.fn(async () => ({ selector: token, sessionId: resolved.sessionId, userId, accessTokenExpiresAt: pair.accessTokenExpiresAt, absoluteExpiresAt: new Date(now.getTime() + 86400_000) })),
      resolve: vi.fn(async () => resolved), refresh: vi.fn(async () => ({ status: "refreshed" as const, selector: nextToken })),
      revokeCurrent: vi.fn(async () => true), markRevocationPending: vi.fn(async () => undefined) },
    limiter: { consume: vi.fn<NativeAuthDependencies["limiter"]["consume"]>(async () => true) },
  };
  expect(Controller).toBeTypeOf("function");
  return { deps, pair, subject: new Controller(deps) };
}

function request(operation: NativeOperation, options: { headers?: HeadersInit; body?: string; url?: string; method?: string } = {}): Request {
  const method = options.method ?? (operation === "session" ? "GET" : "POST");
  const headers = new Headers(options.headers);
  if (operation !== "signIn" && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  if (method === "POST" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Request(options.url ?? new URL(`/api/native/auth/${paths[operation]}`, origin), { method, headers,
    ...(method === "POST" ? { body: options.body ?? JSON.stringify(operation === "signIn" ? credentials : {}) } : {}) });
}

describe("native authentication HTTP controller", () => {
  it("signs in with verified email and returns no cookies or provider credentials", async () => {
    const { subject, deps } = setup();
    const response = await subject.handle("signIn", request("signIn"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionToken: token, session: { authenticated: true, userId, deviceId, refreshAt: "2026-10-16T00:59:00.000Z" } });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(deps.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ userId }), now, deviceId);
    expect(deps.provider.signInWithPassword).toHaveBeenCalledWith({ email: credentials.email, password: credentials.password });
    expect(deps.limiter.consume.mock.calls.map(call => call[1])).toEqual(["global", "email", "device"]);
  });
  it.each(["cookie", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"])("rejects browser header %s before storage or provider calls", async header => {
    const { subject, deps } = setup();
    const response = await subject.handle("signIn", request("signIn", { headers: { [header]: "blocked" } }));
    expect(response.status).toBe(403);
    expect(deps.provider.signInWithPassword).not.toHaveBeenCalled();
    expect(deps.limiter.consume).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["http://app.example.test/api/native/auth/sign-in", "https://evil.test/api/native/auth/sign-in", "https://app.example.test/api/native/auth/sign-in?token=secret", "https://app.example.test/api/auth/sign-in"])("rejects wrong URL %s", async url => {
    const { subject, deps } = setup();
    expect((await subject.handle("signIn", request("signIn", { url }))).status).toBe(403);
    expect(deps.limiter.consume).not.toHaveBeenCalled();
  });
  it.each(["{}", "null", "[1]", "{", JSON.stringify({ ...credentials, userId }), JSON.stringify({ ...credentials, deviceId: "bad" }), "x".repeat(16385)])("rejects invalid login body %#", async body => {
    const { subject, deps } = setup();
    expect((await subject.handle("signIn", request("signIn", { body }))).status).toBe(400);
    expect(deps.provider.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each(["Basic secret", "Bearer short", `Bearer ${token}, Bearer ${token}`, "Bearer " + "A".repeat(42) + "B"])("rejects malformed bearer %#", async authorization => {
    const { subject, deps } = setup();
    expect((await subject.handle("session", request("session", { headers: { authorization } }))).status).toBe(401);
    expect(deps.sessions.resolve).not.toHaveBeenCalled();
  });
  it("rejects authorization on sign-in and unsupported methods", async () => {
    const { subject, deps } = setup();
    expect((await subject.handle("signIn", request("signIn", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(403);
    expect((await subject.handle("signIn", request("signIn", { method: "GET" }))).status).toBe(405);
    expect(deps.provider.signInWithPassword).not.toHaveBeenCalled();
  });
  it("resolves and refreshes without returning internal session data", async () => {
    const { subject, deps } = setup();
    const current = await subject.handle("session", request("session"));
    expect(await current.json()).toEqual({ authenticated: true, userId, deviceId, refreshAt: "2026-10-16T00:59:00.000Z" });
    const refreshed = await subject.handle("refresh", request("refresh"));
    expect(await refreshed.json()).toMatchObject({ sessionToken: nextToken, session: { userId, deviceId } });
    expect(deps.sessions.refresh).toHaveBeenCalledWith(token, now);
    expect(deps.sessions.resolve).toHaveBeenLastCalledWith(nextToken, now);
  });
  it("requires empty mutation JSON and rejects unverified provider identities", async () => {
    const { subject, deps, pair } = setup();
    for (const operation of ["refresh", "signOut"] as const) expect((await subject.handle(operation, request(operation, { body: '{"extra":true}' }))).status).toBe(400);
    deps.provider.signInWithPassword.mockResolvedValue({ ...pair, user: { ...pair.user, emailVerified: false } });
    expect((await subject.handle("signIn", request("signIn"))).status).toBe(403);
    expect(deps.sessions.create).not.toHaveBeenCalled();
  });
  it("fails closed on rate limits and DB failure without leaking credentials", async () => {
    const { subject, deps } = setup();
    deps.limiter.consume.mockResolvedValueOnce(false);
    expect((await subject.handle("signIn", request("signIn"))).status).toBe(429);
    deps.limiter.consume.mockRejectedValueOnce(new Error("database-secret"));
    const unavailable = await subject.handle("signIn", request("signIn"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toMatch(/database-secret|provider-access-secret|synthetic-password/u);
    expect(deps.provider.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each([["AUTH_INVALID_CREDENTIALS",401],["AUTH_EMAIL_VERIFICATION_REQUIRED",403],["AUTH_RATE_LIMITED",429],["AUTH_PROVIDER_UNAVAILABLE",503]] as const)("maps provider failure %s safely", async (code,status) => {
    const { subject, deps } = setup();
    deps.provider.signInWithPassword.mockRejectedValueOnce(new AuthProviderError(code));
    const response = await subject.handle("signIn", request("signIn"));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, retryable: false });
  });
  it("does not claim logout success if local revocation lost a race", async () => {
    const { subject, deps } = setup();
    deps.sessions.revokeCurrent.mockResolvedValue(false);
    expect((await subject.handle("signOut", request("signOut"))).status).toBe(401);
    expect(deps.provider.signOut).not.toHaveBeenCalled();
  });
  it("revokes locally before the provider and records a failed provider revocation", async () => {
    const { subject, deps } = setup();
    deps.provider.signOut.mockRejectedValue(new Error("provider-secret"));
    expect(await (await subject.handle("signOut", request("signOut"))).json()).toEqual({ signedOut: true });
    expect(deps.sessions.revokeCurrent.mock.invocationCallOrder[0]).toBeLessThan(deps.provider.signOut.mock.invocationCallOrder[0]!);
    expect(deps.sessions.markRevocationPending).toHaveBeenCalled();
  });
  it("maps expired native sessions to 401", async () => {
    const { subject, deps } = setup();
    deps.sessions.resolve.mockRejectedValue(new SessionOperationError("expired"));
    expect((await subject.handle("session", request("session"))).status).toBe(401);
  });
  it.each(["email", "device"])("does not call the provider after a rejected %s budget", async scope => {
    const { subject, deps } = setup();
    deps.limiter.consume.mockImplementation(async (_operation, current) => current !== scope);
    expect((await subject.handle("signIn", request("signIn"))).status).toBe(429);
    expect(deps.provider.signInWithPassword).not.toHaveBeenCalled();
  });
  it("normalizes only the rate-limit email and retains the provider input", async () => {
    const { subject, deps } = setup();
    await subject.handle("signIn", request("signIn", { body: JSON.stringify({ ...credentials, email: "Person@Example.test" }) }));
    expect(deps.limiter.consume).toHaveBeenCalledWith("signIn", "email", "person@example.test");
    expect(deps.provider.signInWithPassword).toHaveBeenCalledWith({ email: "Person@Example.test", password: credentials.password });
  });
  it("rejects missing bearer, GET body metadata and any fetch-metadata header", async () => {
    const { subject, deps } = setup();
    expect((await subject.handle("session", new Request(new URL("/api/native/auth/session", origin)))).status).toBe(401);
    expect((await subject.handle("session", request("session", { headers: { "Content-Length": "1" } }))).status).toBe(400);
    expect((await subject.handle("session", request("session", { headers: { "sec-fetch-future": "" } }))).status).toBe(403);
    expect(deps.sessions.resolve).not.toHaveBeenCalled();
  });
  it.each(["text/plain", "application/json; charset=iso-8859-1"])("rejects unsupported content-type %s", async contentType => {
    const { subject, deps } = setup();
    expect((await subject.handle("signIn", request("signIn", { headers: { "Content-Type": contentType } }))).status).toBe(400);
    expect(deps.provider.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each(["null", "[]", '"text"'])("rejects non-object mutation body %s", async body => {
    const { subject, deps } = setup();
    expect((await subject.handle("refresh", request("refresh", { body }))).status).toBe(400);
    expect(deps.sessions.resolve).not.toHaveBeenCalled();
  });
  it("fails closed if a misconfigured service returns a web session or missing device", async () => {
    const { subject, deps } = setup();
    const base = await deps.sessions.resolve();
    for (const extra of [{ clientChannel: "web" }, { deviceId: null }]) {
      deps.sessions.resolve.mockResolvedValueOnce({ ...base, ...extra } as unknown as typeof base);
      expect((await subject.handle("session", request("session"))).status).toBe(401);
    }
  });
  it("rejects refresh results without a new selector and mismatched replacements", async () => {
    const { subject, deps } = setup();
    for (const result of [{ status: "superseded" }, { status: "refreshed" }]) {
      deps.sessions.refresh.mockResolvedValueOnce(result as Awaited<ReturnType<typeof deps.sessions.refresh>>);
      expect((await subject.handle("refresh", request("refresh"))).status).toBe(401);
    }
    const base = await deps.sessions.resolve();
    for (const extra of [{ clientChannel: "web" }, { userId: deviceId }, { deviceId: userId }]) {
      deps.sessions.resolve.mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, ...extra } as typeof base);
      expect((await subject.handle("refresh", request("refresh"))).status).toBe(401);
    }
  });
  it.each([["rate_limited",429],["unavailable",503]] as const)("maps session %s without instructing unsafe retries", async (reason,status) => {
    const { subject, deps } = setup();
    deps.sessions.resolve.mockRejectedValueOnce(new SessionOperationError(reason));
    const response = await subject.handle("session", request("session"));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ retryable: false });
  });
  it("handles success, pending-revocation failure and invalid clocks safely", async () => {
    const { subject, deps } = setup();
    expect((await subject.handle("signOut", request("signOut"))).status).toBe(200);
    expect(deps.sessions.markRevocationPending).not.toHaveBeenCalled();
    deps.provider.signOut.mockRejectedValue(new Error("secret"));
    deps.sessions.markRevocationPending.mockRejectedValue(new Error("db"));
    expect((await subject.handle("signOut", request("signOut"))).status).toBe(503);
    deps.now = () => new Date(Number.NaN);
    expect((await subject.handle("signIn", request("signIn"))).status).toBe(503);
  });
  it("maps a malformed provider pair and an unexpected provider code to unavailable", async () => {
    const { subject, deps, pair } = setup();
    deps.provider.signInWithPassword.mockResolvedValueOnce({ ...pair, accessToken: "" });
    expect((await subject.handle("signIn", request("signIn"))).status).toBe(503);
    deps.provider.signInWithPassword.mockRejectedValueOnce(new AuthProviderError("AUTH_OAUTH_TRANSACTION_INVALID"));
    expect((await subject.handle("signIn", request("signIn"))).status).toBe(503);
  });
  it("accepts Next.js loopback hostname normalization only with the exact canonical Host", async () => {
    const { deps } = setup();
    const subject = new Controller({ ...deps, origin: new URL("https://127.0.0.1:4512") });
    const url = "https://localhost:4512/api/native/auth/sign-in";
    expect((await subject.handle("signIn", request("signIn", { url, headers: { host: "127.0.0.1:4512" } }))).status).toBe(200);
    for (const host of ["evil.test", "localhost:4512", "127.0.0.1:4513"]) {
      expect((await subject.handle("signIn", request("signIn", { url, headers: { host } }))).status).toBe(403);
    }
    expect((await subject.handle("signIn", request("signIn", { url }))).status).toBe(403);
  });
});
