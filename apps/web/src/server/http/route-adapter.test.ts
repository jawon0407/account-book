import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const module = await import("./route-adapter.js").catch(() => ({} as Record<string, unknown>));
const handleAuthRoute = module.handleAuthRoute as ((operation: string, request: Request, context: unknown, factory: () => unknown) => Promise<Response>) | undefined;
const unsupportedAuthRoute = module.unsupportedAuthRoute as ((request: Request) => Promise<Response> | Response) | undefined;

function expectNoStore(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Expires")).toBe("0");
}

describe("route adapter", () => {
  it("builds a fresh container for every request and forwards only request parameters", async () => {
    expect(handleAuthRoute).toBeTypeOf("function");
    const handled = vi.fn(async () => new Response(null, { status: 204 }));
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
