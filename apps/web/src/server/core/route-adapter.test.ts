import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const adapter = await import("./route-adapter.js").catch(() => ({} as Record<string, unknown>));
const handle = adapter.handleCoreRoute as (operation: string, request: Request, context: unknown, factory: () => unknown) => Promise<Response>;

describe("Core route adapter safety", () => {
  it.each(["constructor", "__proto__", "unknown"])("rejects unknown operation %s before creating the container", async (operation) => {
    expect(handle).toBeTypeOf("function"); const factory = vi.fn();
    const response = await handle(operation, new Request("https://app.example.test/api/profile"), {}, factory);
    expect(response.status).toBe(400); expect(factory).not.toHaveBeenCalled();
  });
  it.each(["factory", "params", "controller"])("masks %s failures without exposing secrets", async (stage) => {
    expect(handle).toBeTypeOf("function");
    const factory = () => { if (stage === "factory") throw new Error("private-secret"); return { coreController: { handle: async () => { throw new Error("private-secret"); } } }; };
    const context = stage === "params" ? { params: Promise.reject(new Error("private-secret")) } : {};
    const response = await handle("profileGet", new Request("https://app.example.test/api/profile"), context, factory);
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(await response.text()).not.toContain("private-secret");
  });
});
