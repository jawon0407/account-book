import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: { get: vi.fn(), post: vi.fn() }, create: vi.fn() }));
mocks.create.mockReturnValue(mocks.client);
vi.mock("ky", () => ({ default: { create: mocks.create } }));

const module = await import("./api-client.js").catch(() => ({} as Record<string, unknown>));

describe("browser API client", () => {
  it("creates exactly one relative same-origin ky boundary with retries disabled", () => {
    expect(module.apiClient).toBe(mocks.client);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      prefix: "/api",
      credentials: "same-origin",
      retry: { limit: 0 },
      timeout: 10_000,
      headers: { accept: "application/json" },
    });
  });
});
