import { describe, expect, it, vi } from "vitest";

const module = await import("./auth.js").catch(() => ({} as Record<string, unknown>));
const getCurrentUser = module.getCurrentUser as ((client: unknown) => Promise<unknown>) | undefined;
const currentUserQueryOptions = module.currentUserQueryOptions as ((client: unknown) => Record<string, unknown>) | undefined;
const signInMutationOptions = module.signInMutationOptions as ((client: unknown) => Record<string, unknown>) | undefined;

const user = { id: "123e4567-e89b-12d3-a456-426614174001", email: "person@example.test", emailVerified: true };

function result(value: unknown, failure = false) {
  return { json: vi.fn(async () => failure ? Promise.reject(value) : value) };
}

function apiFailure(code: string, status: number) {
  return Object.assign(new Error("untrusted"), { response: new Response(JSON.stringify({ code, message: "Safe message", requestId: "request-123", retryable: false, fieldErrors: [] }), { status, headers: { "Content-Type": "application/json" } }) });
}

describe("authentication queries", () => {
  it("refreshes exactly once only for refresh-required and retries the original safe query once", async () => {
    expect(getCurrentUser).toBeTypeOf("function");
    const client = {
      get: vi.fn()
        .mockReturnValueOnce(result(apiFailure("AUTH_SESSION_REFRESH_REQUIRED", 401), true))
        .mockReturnValueOnce(result({ csrfToken: "csrf-token" }))
        .mockReturnValueOnce(result(user)),
      post: vi.fn(() => result({ refreshed: true })),
    };
    await expect(getCurrentUser!(client)).resolves.toEqual(user);
    expect(client.get.mock.calls.map(([path]) => path)).toEqual(["me", "auth/csrf", "me"]);
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith("auth/session/refresh", { json: {}, headers: { "X-CSRF-Token": "csrf-token" } });
  });

  it.each([
    ["AUTH_SESSION_EXPIRED", 401],
    ["AUTH_CSRF_REJECTED", 403],
    ["AUTH_INVALID_CREDENTIALS", 422],
  ])("does not auto retry %s", async (code, status) => {
    expect(getCurrentUser).toBeTypeOf("function");
    const client = { get: vi.fn(() => result(apiFailure(code, status), true)), post: vi.fn() };
    await expect(getCurrentUser!(client)).rejects.toMatchObject({ code });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("stops after one failed refresh cycle without recursion", async () => {
    expect(getCurrentUser).toBeTypeOf("function");
    const required = apiFailure("AUTH_SESSION_REFRESH_REQUIRED", 401);
    const client = {
      get: vi.fn()
        .mockReturnValueOnce(result(required, true))
        .mockReturnValueOnce(result({ csrfToken: "csrf-token" }))
        .mockReturnValueOnce(result(required, true)),
      post: vi.fn(() => result({ refreshed: true })),
    };
    await expect(getCurrentUser!(client)).rejects.toMatchObject({ code: "AUTH_SESSION_REFRESH_REQUIRED" });
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("exports typed TanStack options with automatic retries disabled", () => {
    expect(currentUserQueryOptions).toBeTypeOf("function");
    expect(signInMutationOptions).toBeTypeOf("function");
    const client = { get: vi.fn(), post: vi.fn() };
    expect(currentUserQueryOptions!(client)).toMatchObject({ queryKey: ["auth", "current-user"], retry: false });
    expect(currentUserQueryOptions!(client).queryFn).toBeTypeOf("function");
    expect(signInMutationOptions!(client)).toMatchObject({ retry: false });
    expect(signInMutationOptions!(client).mutationFn).toBeTypeOf("function");
    expect(JSON.stringify(currentUserQueryOptions!(client))).not.toMatch(/token|selector/iu);
  });
});
