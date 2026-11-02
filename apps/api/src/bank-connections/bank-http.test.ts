import { ApiErrorSchema } from "@account-book/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bankHttpFixture } from "./testing/bank-http-fixture.js";
import { callbackAddressDigest } from "./bank-runtime-safety.js";

const root = "/v1/bank-connections", start = `${root}/kftc/start`, complete = `${root}/kftc/complete`, callback = `${root}/kftc/callback`;
const write = "bank-connection:write", read = "bank-connection:read";
describe("bank signed HTTP boundary", () => {
  let h: Awaited<ReturnType<typeof bankHttpFixture>>;
  beforeEach(async () => { h = await bankHttpFixture(); });
  afterEach(async () => { await h?.app.close(); });
  /** @returns 시작 응답의 요청 UUID·은행 이동 URL과 Callback state. */
  async function begin() {
    const response = await h.send("POST", start, write, { channel: "web", proofDigest: h.proofDigest });
    expect(response.statusCode).toBe(200);
    const result = response.json(); return { ...result, state: new URL(result.authorizationUrl).searchParams.get("state")! };
  }
  it("connects through four real routes with only safe public fields", async () => {
    const request = await begin();
    const redirected = await h.app.inject({ method: "GET", url: `${callback}?state=${request.state}&code=private-code` });
    expect(redirected.statusCode).toBe(303);
    expect(redirected.headers.location).toBe(`https://web.invalid/app/bank-connections/result?requestId=${request.requestId}`);
    expect(redirected.headers["referrer-policy"]).toBe("no-referrer"); expect(redirected.headers["cache-control"]).toBe("private, no-store");
    const done = await h.send("POST", complete, write, { requestId: request.requestId, proofDigest: h.proofDigest });
    expect(done.statusCode).toBe(200); expect(done.json()).toEqual({ requestId: request.requestId, status: "connected" });
    const status = await h.send("GET", `${root}/requests/${request.requestId}`, read);
    expect(status.statusCode).toBe(200); expect(status.json()).toEqual(done.json());
    expect(status.headers["access-control-allow-origin"]).toBeUndefined();
    expect(status.headers["cache-control"]).toBe("private, no-store"); expect(status.headers["referrer-policy"]).toBe("no-referrer");
    expect(JSON.stringify([redirected.headers, done.json(), status.json()])).not.toMatch(/private-code|fake-access|fake-subject/);
  });
  it("rejects missing/wrong scope, body changes and replay before repository", async () => {
    const body = JSON.stringify({ channel: "web", proofDigest: h.proofDigest });
    const absent = await h.app.inject({ method: "POST", url: start, payload: body, headers: { "content-type": "application/json" } });
    expect(absent.statusCode).toBe(401); expect(absent.headers["referrer-policy"]).toBe("no-referrer");
    expect((await h.send("POST", start, read, JSON.parse(body))).statusCode).toBe(401);
    const signed = await h.headers("POST", start, write, body);
    expect((await h.app.inject({ method: "POST", url: start, headers: signed, payload: body.replace("web", "app") })).statusCode).toBe(401);
    expect(h.repo.consumeStart).not.toHaveBeenCalled();
    const fresh = await h.headers("POST", start, write, body);
    expect((await h.app.inject({ method: "POST", url: start, headers: fresh, payload: body })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "POST", url: start, headers: fresh, payload: body })).statusCode).toBe(401);
  });
  it.each(["state=x&state=y&code=z", "state=x&code=z&redirect_uri=https://evil.invalid", "state=x&code=z&error=denied", "state=x&code=%00", "state=x&code=%E0%A4", "code=x", ""])("rejects ambiguous or invalid callback %s after quota", async query => {
    const response = await h.app.inject({ method: "GET", url: `${callback}?${query}` });
    expect(response.statusCode).toBe(400); expect(response.json().code).toBe("BANK_INVALID_REQUEST");
    expect(h.repo.consumeCallback).toHaveBeenCalledTimes(1); expect(h.repo.callbackContext).not.toHaveBeenCalled();
    expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
  it("ignores spoofed forwarding headers and stores only canonical IP HMAC", async () => {
    await h.app.inject({ method: "GET", url: `${callback}?state=x`, remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "8.8.8.8" } });
    await h.app.inject({ method: "GET", url: `${callback}?state=x`, remoteAddress: "::ffff:127.0.0.1", headers: { forwarded: "for=1.1.1.1" } });
    const calls = vi.mocked(h.repo.consumeCallback).mock.calls;
    expect(calls[0]?.[0]).toEqual(callbackAddressDigest("127.0.0.1", h.options.callbackHmacKey)); expect(calls[1]?.[0]).toEqual(calls[0]?.[0]);
  });
  it.each([
    ["control", "code", "secret\u0000"], ["code overflow", "code", "a".repeat(4097)],
    ["multibyte overflow", "code", "한".repeat(1366)], ["error overflow", "error", "e".repeat(129)],
    ["empty code", "code", ""], ["empty error", "error", ""],
  ])("rejects %s after a VALID state", async (_label, field, value) => {
    const request = await begin();
    const result = await h.app.inject({ method: "GET", url: `${callback}?state=${request.state}&${field}=${encodeURIComponent(value!)}` });
    expect(result.statusCode).toBe(400); expect(h.repo.callbackContext).not.toHaveBeenCalled();
    expect(h.repo.receiveCallback).not.toHaveBeenCalled();
  });
  it.each([["code", 4096], ["error", 128]] as const)("accepts exact %s byte boundary", async (field, length) => {
    const request = await begin();
    expect((await h.app.inject({ method: "GET", url: `${callback}?state=${request.state}&${field}=${"a".repeat(length)}` })).statusCode).toBe(303);
    expect(h.repo.receiveCallback).toHaveBeenCalledTimes(1);
  });
  it("returns fixed 429 and Retry-After without calling providers", async () => {
    vi.mocked(h.repo.consumeStart).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 29 });
    const response = await h.send("POST", start, write, { channel: "web", proofDigest: h.proofDigest });
    expect(response.statusCode).toBe(429); expect(response.headers["retry-after"]).toBe("29");
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({ code: "BANK_RATE_LIMITED", retryable: true, fieldErrors: [] });
    expect(h.repo.start).not.toHaveBeenCalled();
    vi.mocked(h.repo.consumeCallback).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });
    expect((await h.app.inject({ method: "GET", url: callback })).headers["retry-after"]).toBe("17");
  });
  it("rejects extra query, forged owner and unknown request without secrets", async () => {
    const body = { channel: "web", proofDigest: h.proofDigest };
    expect((await h.send("POST", `${start}?owner=x`, write, body)).statusCode).toBe(400);
    expect((await h.send("POST", start, write, { ...body, userId: h.who.userId })).statusCode).toBe(400);
    expect((await h.send("GET", `${root}/requests/${h.who.userId}`, read)).statusCode).toBe(404);
    expect(h.repo.consumeStart).not.toHaveBeenCalled();
  });
  it("keeps default runtime disabled even with a valid delegated JWT", async () => {
    const disabled = await bankHttpFixture(true);
    try {
      const response = await disabled.send("POST", start, write, { channel: "web", proofDigest: h.proofDigest });
      expect(response.statusCode).toBe(503); expect(response.json().code).toBe("BANK_UNAVAILABLE");
      expect((await disabled.app.inject({ method: "GET", url: callback })).json().code).toBe("BANK_UNAVAILABLE");
    } finally { await disabled.app.close(); }
  });
});
