import { afterEach, describe, expect, it, vi } from "vitest";
import { BankConnectionService } from "./bank-service.js";
import { bankFixture } from "./testing/bank-fixture.js";
import { decryptBankToken } from "./security/token-envelope.js";

afterEach(() => { vi.useRealTimers(); });
/** @returns 실제 암호화 서비스에 합성 저장소/공급자를 붙인 미완료 연결. */
async function started() {
  const h = bankFixture(), service = new BankConnectionService(h.repo, h.options);
  const result = await service.start(h.who, { channel: "web", proofDigest: h.proofDigest });
  const state = new URL(result.authorizationUrl).searchParams.get("state")!;
  return { ...h, service, result, state, input: { requestId: result.requestId, proofDigest: h.proofDigest } };
}
/** @returns 합성 은행 Callback까지 처리하여 완료 요청을 받을 수 있는 연결. */
async function ready() { const h = await started(); await h.service.callback(`state=${h.state}&code=fake-code`, "127.0.0.1"); return h; }
describe("bank connection orchestration", () => {
  it("commits quota and claim before exchange, returns no tokens and saves real bound ciphertext", async () => {
    const h = await ready();
    expect(await h.service.complete(h.who, h.input)).toEqual({ requestId: h.result.requestId, status: "connected" });
    expect(h.events).toEqual(["quota-committed", "start-committed", "claim-committed", "exchange", "finish-committed"]);
    const saved = h.stored()!;
    expect(JSON.stringify(saved)).not.toContain("fake-access");
    expect(decryptBankToken(saved.access, { userId: h.who.userId, resourceId: saved.connectionId, provider: "kftc", environment: "fake", purpose: "access_token" }, h.options.keys)).toBe("fake-access");
    expect(h.provider.exchange).toHaveBeenCalledWith("fake-code", expect.any(AbortSignal));
  });
  it("allows only one concurrent completion to exchange a code", async () => {
    const h = await ready(); const results = await Promise.allSettled([h.service.complete(h.who, h.input), h.service.complete(h.who, h.input)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(h.provider.exchange).toHaveBeenCalledTimes(1);
  });
  it("never exchanges after an ambiguous claim commit", async () => {
    const h = await ready(); vi.mocked(h.repo.claim).mockRejectedValueOnce(new Error("secret-db"));
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    expect(h.provider.exchange).not.toHaveBeenCalled();
  });
  it("rejects other sessions and mismatched environments before claim", async () => {
    const h = await ready();
    await expect(h.service.complete({ ...h.who, sessionId: "33333333-3333-4333-8333-333333333333" }, h.input)).rejects.toMatchObject({ code: "BANK_REQUEST_NOT_FOUND" });
    vi.mocked(h.repo.context).mockResolvedValueOnce({ requestId: h.input.requestId, environment: "test", status: "awaiting_completion" });
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_REQUEST_NOT_FOUND" });
    expect(h.repo.claim).not.toHaveBeenCalled();
  });
  it("fails closed and never saves a late exchange after timeout", async () => {
    vi.useFakeTimers(); const h = await ready(); let resolve!: (value: unknown) => void;
    h.provider.exchange.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const result = h.service.complete(h.who, h.input); const assertion = expect(result).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(8000); await assertion;
    expect(h.provider.exchange.mock.calls[0]?.[1].aborted).toBe(true);
    resolve(h.response()); await Promise.resolve();
    expect(h.stored()).toBeNull(); expect(await h.service.status(h.who, h.input.requestId)).toMatchObject({ status: "failed" });
  });
  it.each([{}, { accessExpiresAt: new Date(0) }, { permissions: ["payments:write"] }, { refreshToken: "refresh" }, { accessToken: "" }, { extra: "secret" }])("rejects malformed provider result %j", async override => {
    const h = await ready(); h.provider.exchange.mockResolvedValueOnce(Object.keys(override).length ? { ...h.response(), ...override } : {});
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" }); expect(h.stored()).toBeNull();
  });
  it("does not retry the code when persistence fails", async () => {
    const h = await ready(); vi.mocked(h.repo.finish).mockRejectedValueOnce(new Error("private-db"));
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_REQUEST_CONFLICT" });
    expect(h.provider.exchange).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["oversized token", { accessToken: "a".repeat(65_537) }],
    ["invalid UTF16", { accessToken: "\ud800" }],
    ["invalid Date", { accessExpiresAt: new Date(NaN) }],
  ])("rejects provider %s without storing", async (_label, override) => {
    const h = await ready(); h.provider.exchange.mockResolvedValueOnce({ ...h.response(), ...override as object });
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    expect(h.stored()).toBeNull();
  });
  it("preserves connected status when finish commits but acknowledgement fails", async () => {
    const h = await ready(), persist = vi.mocked(h.repo.finish).getMockImplementation()!;
    vi.mocked(h.repo.finish).mockImplementationOnce(async (...args) => { await persist(...args); throw new Error("lost acknowledgement"); });
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    expect(await h.service.status(h.who, h.input.requestId)).toMatchObject({ status: "connected" });
    await expect(h.service.complete(h.who, h.input)).rejects.toMatchObject({ code: "BANK_REQUEST_CONFLICT" });
    expect(h.stored()).not.toBeNull(); expect(h.provider.exchange).toHaveBeenCalledTimes(1);
  });
  it("stores denial without code and redirects only to the fixed result with id", async () => {
    const h = await started(); const url = await h.service.callback(`state=${h.state}&error=access_denied`, "127.0.0.1");
    expect(url).toBe(`https://web.invalid/app/bank-connections/result?requestId=${h.input.requestId}`);
    expect(await h.service.status(h.who, h.input.requestId)).toEqual({ requestId: h.input.requestId, status: "failed" });
    expect(h.provider.exchange).not.toHaveBeenCalled();
    await expect(h.service.callback(`state=${h.state}&code=late`, "127.0.0.1")).rejects.toMatchObject({ code: "BANK_INVALID_REQUEST" });
  });
  it("refuses unsafe authorization destinations and client-injected owner", async () => {
    const h = bankFixture(); const service = new BankConnectionService(h.repo, h.options);
    await expect(service.start(h.who, { channel: "web", proofDigest: h.proofDigest, userId: h.who.userId })).rejects.toMatchObject({ code: "BANK_INVALID_REQUEST" });
    h.provider.authorizationUrl = () => "https://evil.invalid/authorize";
    await expect(service.start(h.who, { channel: "web", proofDigest: h.proofDigest })).rejects.toMatchObject({ code: "BANK_UNAVAILABLE" });
    expect(h.repo.start).not.toHaveBeenCalled();
  });
});
