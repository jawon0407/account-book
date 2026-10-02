import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { issueCsrfToken } from "../security/csrf.js";
import { SessionOperationError } from "../session/session-service.js";
import { BankController } from "./bank-controller.js";

const origin = "https://app.example.test", endpoint = "https://bank.invalid/authorize";
const id = "123e4567-e89b-42d3-a456-426614174001", sid = "123e4567-e89b-42d3-a456-426614174002";
const now = new Date("2040-01-01T00:00:00Z"), key = Buffer.alloc(32, 71);
const selector = Buffer.alloc(32, 72).toString("base64url"), proof = Buffer.alloc(32, 73).toString("base64url");
const url = `${endpoint}?state=${Buffer.alloc(32, 74).toString("base64url")}`;
const proofCookie = `__Host-ab_bank_proof_${id}=${id}.${proof}`;

/** @param reply 내부 API 결과. DB/네트워크만 대체하고 BFF 검증은 실제 실행한다. */
function setup(reply = Response.json({ requestId: id, authorizationUrl: url }), enabled = true) {
  const sessions = { resolve: vi.fn(async () => ({ userId: id, sessionId: sid, accessToken: "private-access", refreshToken: "private-refresh", supabaseSessionId: id, rotationVersion: 0, accessTokenExpiresAt: new Date(now.getTime() + 120_000) })) };
  const delegatedApiClient = { request: vi.fn(async () => reply) };
  const controller = new BankController({ configuredOrigin: new URL(origin), csrfKey: key, now: () => now, sessions, delegatedApiClient, authorizationEndpoint: enabled ? endpoint : null });
  return { controller, sessions, delegatedApiClient };
}
/** @param operation 고정 BFF 작업. @param body JSON. @param headers 변조할 헤더. */
function request(operation: "start"|"complete"|"status" = "start", body: unknown = {}, headers: Record<string, string> = {}) {
  const path = operation === "status" ? `requests/${id}` : `kftc/${operation}`;
  return new Request(`${origin}/api/bank-connections/${path}`, { method: operation === "status" ? "GET" : "POST", headers: { cookie: `__Host-ab_session=${selector}; ${proofCookie}`, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-csrf-token": issueCsrfToken({ selector }, now, key), ...headers }, ...(operation === "status" ? {} : { body: JSON.stringify(body) }) });
}
/** @param response 공개 응답. @param status 예상 상태. @param code 예상 고정 코드. */
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const raw = await response.text();
  expect(JSON.parse(raw).code).toBe(code);
  expect(raw).not.toMatch(/private-|upstream-secret|proofDigest/);
}

describe("bank BFF", () => {
  it("creates a separate browser proof cookie and delegates only its digest with trusted identity", async () => {
    const { controller, delegatedApiClient } = setup();
    const response = await controller.handle("start", request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requestId: id, authorizationUrl: url });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300$/);
    expect(cookie).not.toMatch(/Domain=/);
    const value = cookie.split(";")[0]!.split("=")[1]!.split(".")[1]!;
    expect(Buffer.from(value, "base64url")).toHaveLength(32);
    const call = delegatedApiClient.request.mock.calls[0] as unknown as [{ body: Uint8Array }];
    expect(call[0]).toMatchObject({ userId: id, sessionId: sid, scope: "bank-connection:write", target: "/v1/bank-connections/kftc/start", method: "POST" });
    expect(JSON.parse(new TextDecoder().decode(call[0].body))).toEqual({ channel: "web", proofDigest: createHash("sha256").update(Buffer.from(value, "base64url")).digest("hex") });
    expect(value).not.toBe(proof);
    expect(delegatedApiClient.request).toHaveBeenCalledOnce();
  });
  it.each([{}, { userId: id }, { proofDigest: proof }, { returnUrl: "https://evil.invalid" }].slice(1))("rejects browser-owned start fields", async body => {
    const f = setup(); await failure(await f.controller.handle("start", request("start", body)), 400, "BANK_INVALID_REQUEST"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each(["", `__Host-ab_session=${selector}; __Host-ab_session=${selector}`, "__Host-ab_session=bad"])("rejects missing/duplicate/malformed session before delegation", async cookie => {
    const f = setup(); await failure(await f.controller.handle("start", request("start", {}, { cookie })), 401, "AUTH_SESSION_EXPIRED"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each([{ origin: "https://evil.invalid" }, { "x-csrf-token": "bad" }, { "sec-fetch-site": "cross-site" }])("rejects unsafe mutations", async headers => {
    const f = setup(); await failure(await f.controller.handle("start", request("start", {}, headers)), 403, "AUTH_CSRF_REJECTED"); expect(f.sessions.resolve).not.toHaveBeenCalled();
  });
  it("rechecks revoked sessions", async () => {
    const f = setup(); f.sessions.resolve.mockRejectedValue(new SessionOperationError("expired"));
    await failure(await f.controller.handle("start", request()), 401, "AUTH_SESSION_EXPIRED"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("rejects a stale account tab", async () => {
    const f = setup(); await failure(await f.controller.handle("start", request("start", {}, { "x-account-book-user": sid })), 401, "AUTH_SESSION_EXPIRED"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("fails closed when runtime integration is disabled", async () => {
    const f = setup(undefined, false); await failure(await f.controller.handle("start", request()), 503, "BANK_UNAVAILABLE"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it.each(["https://evil.invalid/authorize", "http://bank.invalid/authorize", `${url}&state=x`, "https://bank.invalid/other", `${url}#private-fragment`])("rejects unsafe authorization URLs without setting proof", async authorizationUrl => {
    const f = setup(Response.json({ requestId: id, authorizationUrl })); const response = await f.controller.handle("start", request());
    await failure(response, 502, "BANK_UNAVAILABLE"); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("completes once using the matching HttpOnly proof and clears it", async () => {
    const f = setup(Response.json({ requestId: id, status: "connected" })); const response = await f.controller.handle("complete", request("complete", { requestId: id }));
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const call = f.delegatedApiClient.request.mock.calls[0] as unknown as [{ body: Uint8Array }];
    expect(JSON.parse(new TextDecoder().decode(call[0].body))).toEqual({ requestId: id, proofDigest: createHash("sha256").update(Buffer.from(proof, "base64url")).digest("hex") });
    expect(f.delegatedApiClient.request).toHaveBeenCalledOnce();
  });
  it.each(["", `${proofCookie}; ${proofCookie}`, `__Host-ab_bank_proof_${id}=${sid}.${proof}`, `__Host-ab_bank_proof_${id}=${id}.bad`])("rejects missing/duplicate/mismatched proof before API call", async cookie => {
    const f = setup(); await failure(await f.controller.handle("complete", request("complete", { requestId: id }, { cookie: `__Host-ab_session=${selector}; ${cookie}` })), 409, "BANK_REQUEST_CONFLICT"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
  it("never retries an uncertain completion and clears the consumed proof", async () => {
    const f = setup(); f.delegatedApiClient.request.mockRejectedValue(new Error("upstream-secret"));
    const response = await f.controller.handle("complete", request("complete", { requestId: id }));
    await failure(response, 502, "BANK_UNAVAILABLE"); expect(response.headers.get("set-cookie")).toContain("Max-Age=0"); expect(f.delegatedApiClient.request).toHaveBeenCalledOnce();
  });
  it("preserves a newer tab's proof when an older completion response arrives late", async () => {
    const jar = new Map<string, string>();
    /** @param response 브라우저가 응답 도착 순서대로 반영하는 Set-Cookie만 모사한다. */
    function receive(response: Response) {
      const cookie = response.headers.get("set-cookie")!;
      const [name, value] = cookie.split(";")[0]!.split("=");
      if (cookie.includes("Max-Age=0")) jar.delete(name!); else jar.set(name!, value!);
    }
    const cookies = () => `__Host-ab_session=${selector}; ${[...jar].map(([name, value]) => `${name}=${value}`).join("; ")}`;
    const first = setup(); receive(await first.controller.handle("start", request()));
    let finish!: (response: Response) => void;
    first.delegatedApiClient.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const late = first.controller.handle("complete", request("complete", { requestId: id }, { cookie: cookies() }));
    await vi.waitFor(() => expect(first.delegatedApiClient.request).toHaveBeenCalledTimes(2));
    const second = setup(Response.json({ requestId: sid, authorizationUrl: url }));
    receive(await second.controller.handle("start", request()));
    finish(Response.json({ requestId: id, status: "connected" })); receive(await late);
    expect(jar.size).toBe(1);
    second.delegatedApiClient.request.mockResolvedValue(Response.json({ requestId: sid, status: "connected" }));
    const result = await second.controller.handle("complete", request("complete", { requestId: sid }, { cookie: cookies() }));
    expect(result.status).toBe(200);
  });
  it.each(["awaiting_callback", "awaiting_completion", "exchanging", "connected", "cancelled", "expired", "failed"])("returns only authenticated request state: %s", async status => {
    const f = setup(Response.json({ requestId: id, status }, { headers: { "set-cookie": "upstream-secret" } })); const response = await f.controller.handle("status", request("status"), id);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ requestId: id, status }); expect(response.headers.get("set-cookie")).toBeNull();
    expect(f.delegatedApiClient.request).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", scope: "bank-connection:read", target: `/v1/bank-connections/requests/${id}` }));
  });
  it.each([{ requestId: sid, status: "connected" }, { requestId: id, status: "connected", token: "upstream-secret" }])("rejects wrong resource or extra secret field", async output => {
    const f = setup(Response.json(output)); await failure(await f.controller.handle("status", request("status"), id), 502, "BANK_UNAVAILABLE");
  });
  it.each([[400,"BANK_INVALID_REQUEST"],[404,"BANK_REQUEST_NOT_FOUND"],[409,"BANK_REQUEST_CONFLICT"],[429,"BANK_RATE_LIMITED"],[503,"BANK_UNAVAILABLE"]] as const)("maps only allowed upstream error %i", async (status, code) => {
    const f = setup(Response.json(buildApiError({ code, retryable: false }), { status })); await failure(await f.controller.handle("status", request("status"), id), status, code);
  });
  it("rejects a malformed status ID as input, not a provider outage", async () => {
    const f = setup(); await failure(await f.controller.handle("status", request("status"), "bad"), 400, "BANK_INVALID_REQUEST"); expect(f.delegatedApiClient.request).not.toHaveBeenCalled();
  });
});
