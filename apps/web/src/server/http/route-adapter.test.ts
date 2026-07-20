import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const module = await import("./route-adapter.js").catch(() => ({} as Record<string, unknown>));
const handleAuthRoute = module.handleAuthRoute as ((operation: string, request: Request, context: unknown, factory: () => unknown) => Promise<Response>) | undefined;

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

  it("fails closed for a missing controller operation", async () => {
    expect(handleAuthRoute).toBeTypeOf("function");
    await expect(handleAuthRoute!("unknown", new Request("https://app.example.test/api"), {}, () => ({ authController: {} }))).rejects.toThrow("AUTH_ROUTE_INVALID");
  });
});
