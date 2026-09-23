import { describe, expect, it, vi } from "vitest";

const module = await import("./auth.js").catch(() => ({} as Record<string, unknown>));
const getCurrentUser = module.getCurrentUser as ((client: unknown) => Promise<unknown>) | undefined;
const currentUserQueryOptions = module.currentUserQueryOptions as ((client: unknown) => Record<string, unknown>) | undefined;
const signInMutationOptions = module.signInMutationOptions as ((client: unknown) => Record<string, unknown>) | undefined;
const oauthStartMutationOptions = module.oauthStartMutationOptions as ((client: unknown) => { mutationFn: (input: unknown) => Promise<unknown> }) | undefined;

const user = { id: "123e4567-e89b-12d3-a456-426614174001", email: "person@example.test", emailVerified: true };

/**
 * 인증 조회의 성공 JSON 또는 실패 Promise를 재현하는 HTTP 응답 대역이다.
 * @param value 성공 응답 값 또는 reject할 오류 객체.
 * @param failure true이면 json()을 거절하고 false이면 값을 반환한다.
 * @returns 호출 기록을 보유한 mock json 메서드. 실제 HTTP는 발생하지 않는다.
 */
function result(value: unknown, failure = false) {
  return { json: vi.fn(async () => failure ? Promise.reject(value) : value) };
}

/**
 * 인증 갱신 분기를 검사할 공개 오류 응답을 Error에 붙인다.
 * @param code 테스트할 공개 인증 오류 코드. 대응하는 고정 메시지를 선택한다.
 * @param status 합성 Response의 HTTP 상태 번호.
 * @returns response 속성이 붙은 Error. 운영 오류 생성 함수가 아닌 테스트 도우미다.
 */
function apiFailure(code: string, status: number) {
  return Object.assign(new Error("untrusted"), { response: new Response(JSON.stringify({ code, message: code === "AUTH_SESSION_EXPIRED" ? "The session has expired." : code === "AUTH_SESSION_REFRESH_REQUIRED" ? "The session must be refreshed." : code === "AUTH_CSRF_REJECTED" ? "The request could not be verified." : "The authentication input was rejected.", requestId: "123e4567-e89b-12d3-a456-426614174011", retryable: false, fieldErrors: [] }), { status, headers: { "Content-Type": "application/json" } }) });
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

  it("accepts only the fixed same-origin OAuth handoff path", async () => {
    expect(oauthStartMutationOptions).toBeTypeOf("function");
    const client = {
      get: vi.fn(() => result({ csrfToken: "csrf-token" })),
      post: vi.fn()
        .mockReturnValueOnce(result({ authorizationPath: "/api/auth/oauth/google/continue?returnPath=%2Fapp" }))
        .mockReturnValueOnce(result({ authorizationUrl: "https://provider.example.test/authorize?state=secret" })),
    };
    await expect(oauthStartMutationOptions!(client).mutationFn({ provider: "google", returnPath: "/app" })).resolves.toEqual({ authorizationPath: "/api/auth/oauth/google/continue?returnPath=%2Fapp" });
    await expect(oauthStartMutationOptions!(client).mutationFn({ provider: "google", returnPath: "/app" })).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: false });
    expect(JSON.stringify(client.post.mock.calls)).not.toContain("provider.example.test");
  });
});
