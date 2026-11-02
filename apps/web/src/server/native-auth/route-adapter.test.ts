import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const module = await import("./route-adapter.js").catch(() => ({} as Record<string, unknown>));
const handle = module.handleNativeAuthRoute as (operation: "session", request: Request, factory: () => unknown) => Promise<Response>;
describe("native route adapter", () => {
  it("creates a request-owned container and hides configuration errors", async () => {
    expect(handle).toBeTypeOf("function");
    const request = new Request("https://app.example.test/api/native/auth/session");
    const callback = vi.fn(async () => new Response(null, { status: 204 }));
    const factory = vi.fn(() => ({ nativeAuthController: { handle: callback } }));
    expect((await handle("session", request, factory)).status).toBe(204);
    await handle("session", request, factory);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledWith("session", request);
    const failed = await handle("session", request, () => { throw new Error("private-configuration"); });
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toContain("no-store");
    expect(await failed.text()).not.toContain("private-configuration");
    const unsupported = (module.unsupportedNativeRoute as () => Response)();
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("access-control-allow-origin")).toBeNull();
  });
});
