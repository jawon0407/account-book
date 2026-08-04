import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: { get: vi.fn(), post: vi.fn() }, create: vi.fn() }));
mocks.create.mockReturnValue(mocks.client);
vi.mock("ky", () => ({ default: { create: mocks.create } }));

const module = await import("./api-client.js").catch(() => ({} as Record<string, unknown>));
const apiError = module.apiError as ((error: unknown) => Promise<Readonly<{ code: string; retryable: boolean }>>) | undefined;

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

  it("parses ky 2 error data after the response body has already been consumed", async () => {
    expect(apiError).toBeTypeOf("function");
    const envelope = {
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Untrusted display message",
      requestId: "request-123",
      retryable: false,
      fieldErrors: [],
    };
    const response = new Response(JSON.stringify(envelope), { status: 422, headers: { "Content-Type": "application/json" } });
    await response.json();

    await expect(apiError!({ data: envelope, response })).resolves.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      retryable: false,
    });
  });
});
