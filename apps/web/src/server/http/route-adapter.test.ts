import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const module = await import("./route-adapter.js").catch(() => ({} as Record<string, unknown>));
const handleAuthRoute = module.handleAuthRoute as ((operation: string, request: Request, context: unknown, factory: () => unknown) => Promise<Response>) | undefined;
const unsupportedAuthRoute = module.unsupportedAuthRoute as ((request: Request) => Promise<Response> | Response) | undefined;

/**
 * 응답에 세 가지 인증 캐시 방지 헤더가 모두 정확히 있는지 검사합니다.
 * @param response 검사할 라우트 응답.
 * @returns 검증 후 값 없음.
 * @throws 헤더가 다르면 테스트 실패.
 */
function expectNoStore(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Expires")).toBe("0");
}

describe("route adapter", () => {
  it("builds a fresh container for every request and forwards only request parameters", async () => {
    expect(handleAuthRoute).toBeTypeOf("function");
    /**
     * 컨트롤러 호출을 기록하고 204 응답을 돌려주는 라우트 위임 대상 대역입니다.
     * @returns 본문 없는 204 Response.
     */
    const handled = vi.fn(async () => new Response(null, { status: 204 }));
    /**
     * 컨테이너 생성 횟수를 기록하고 OAuth 시작 메서드를 포함한 최소 컨테이너를 반환합니다.
     * @returns 기록용 oauthStart가 있는 컨트롤러 대역.
     */
    const factory = vi.fn(() => ({ authController: { oauthStart: handled } }));
    const context = { params: Promise.resolve({ provider: "google" }) };
    const first = new Request("https://app.example.test/api/auth/oauth/google/start", { method: "POST" });
    const second = new Request("https://app.example.test/api/auth/oauth/google/start", { method: "POST" });
    await handleAuthRoute!("oauthStart", first, context, factory);
    await handleAuthRoute!("oauthStart", second, context, factory);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(handled).toHaveBeenNthCalledWith(1, first, { provider: "google" });
    expect(handled).toHaveBeenNthCalledWith(2, second, { provider: "google" });
  });

  it.each([
    ["unknown operation", "unknown", () => ({}), () => ({ authController: {} })],
    ["factory throw", "oauthStart", () => ({}), () => { throw new Error("server-access-jwt"); }],
    ["params reject", "oauthStart", () => ({ params: Promise.reject(new Error("opaque-selector")) }), () => ({ authController: { oauthStart: vi.fn() } })],
    ["controller throw", "oauthStart", () => ({}), () => ({ authController: { oauthStart: vi.fn(async () => { throw new Error("refresh-token"); }) } })],
  ])("maps %s to a safe no-store boundary error", async (_label, operation, context, factory) => {
    expect(handleAuthRoute).toBeTypeOf("function");
    const response = await handleAuthRoute!(operation, new Request("https://app.example.test/api"), context(), factory);
    expect(response.status).toBe(503);
    expectNoStore(response);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: false });
    expect(text).not.toMatch(/server-access-jwt|opaque-selector|refresh-token/iu);
  });

  it("returns an explicit safe 405 for unsupported methods", async () => {
    expect(unsupportedAuthRoute).toBeTypeOf("function");
    const response = await unsupportedAuthRoute!(new Request("https://app.example.test/api/auth/csrf", { method: "HEAD" }));
    expect(response.status).toBe(405);
    expectNoStore(response);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", retryable: false });
    expect(text).not.toMatch(/token|selector|credential-value/iu);
  });
});
