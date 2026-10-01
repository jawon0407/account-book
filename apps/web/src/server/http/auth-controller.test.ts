import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueCsrfToken, verifyCsrfToken } from "../security/csrf.js";
import type { DelegatedApiRequest } from "./delegated-api-client.js";

vi.mock("server-only", () => ({}));

const module = await import("./auth-controller.js").catch(() => ({} as Record<string, unknown>));
const AuthController = module.AuthController as (new (dependencies: Record<string, unknown>) => Record<string, (request: Request, parameters?: Record<string, string>) => Promise<Response>>) | undefined;
const sessionModule = await import("../session/session-service.js").catch(() => ({} as Record<string, unknown>));
const SessionOperationError = sessionModule.SessionOperationError as (new (reason: "expired" | "rate_limited" | "unavailable") => Error & Readonly<{ reason: "expired" | "rate_limited" | "unavailable" }>) | undefined;

const now = new Date("2026-07-20T12:00:00.000Z");
const selector = Buffer.alloc(32, 3).toString("base64url");
const freshSelector = Buffer.alloc(32, 4).toString("base64url");
const sessionSelector = Buffer.alloc(32, 5).toString("base64url");
const csrfKey = randomBytes(32);
const csrfToken = issueCsrfToken({ selector }, now, csrfKey);
const user = { id: "123e4567-e89b-12d3-a456-426614174001", email: "person@example.test", emailVerified: true };
const delegatedRequestId = "123e4567-e89b-42d3-a456-426614174004";
const delegatedToken = "delegated-fixture-token";

/**
 * POST이면 기본 CSRF·출처 헤더를 채우고 호출자가 준 헤더로 덮어씁니다. URL은 일부러 다른 출처로 만들어 컨트롤러가 설정 출처만 신뢰하는지 시험합니다.
 * @param path 요청 경로.
 * @param init 메서드·본문·덮어쓸 헤더 등 Request 설정.
 * @param selected 기본 상호작용 쿠키 식별자; 빈 문자열이면 넣지 않습니다.
 * @returns ReadableStream의 duplex 설정까지 적용한 테스트 Request.
 */
function request(path: string, init: RequestInit = {}, selected = selector): Request {
  const headers = new Headers();
  if (init.method === "POST") {
    headers.set("Content-Type", "application/json");
    headers.set("Origin", "https://app.example.test");
    headers.set("Sec-Fetch-Site", "same-origin");
    headers.set("Sec-Fetch-Mode", "cors");
    headers.set("Sec-Fetch-Dest", "");
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (selected) headers.set("Cookie", `__Host-ab_interaction=${selected}`);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const duplex = init.body instanceof ReadableStream ? { duplex: "half" as const } : {};
  return new Request(`https://spoofed.example.test${path}`, { ...init, ...duplex, headers } as RequestInit & { duplex?: "half" });
}

/**
 * 청크를 순서대로 내보내고 취소 여부를 조회할 수 있는 본문 스트림을 만듭니다.
 * @param chunks 내보낼 바이트 청크 목록.
 * @returns body 스트림과 현재 취소 상태를 반환하는 wasCanceled 함수.
 */
function trackedStream(chunks: readonly Uint8Array[]) {
  let index = 0;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    /**
     * 다음 청크를 전달하고 더 이상 청크가 없으면 스트림을 닫는 대역입니다.
     * @param controller 청크 추가·종료를 제어하는 스트림 컨트롤러.
     * @returns 청크 처리 후 값 없음.
     */
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    /**
     * 읽기 취소가 호출됐음을 기록해 본문 크기 초과 시 취소 동작을 검증합니다.
     * @returns 취소 플래그를 바꾼 뒤 값 없음.
     */
    cancel() { canceled = true; },
  });
  return { body, wasCanceled: () => canceled };
}

/**
 * 고정 시각·쿠키 생성기와 이메일·OAuth·복구·세션·제공자 대역을 실제 컨트롤러에 연결합니다.
 * @param overrides 오류·설정 경계 시험을 위해 바꿀 의존성.
 * @returns 컨트롤러·각 대역·실행 순서 기록 배열.
 */
function setup(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const email = {
    /**
     * 가입 호출 순서를 기록하고 전달된 컨텍스트를 응답에 보존하는 대역입니다.
     * @param _input 사용하지 않는 가입 입력.
     * @param context 서비스에 전달된 콜백 컨텍스트.
     * @returns 접수 표시와 컨텍스트.
     */
    signUp: vi.fn(async (_input, context) => { events.push("sign-up"); return { accepted: true, context }; }),
    /**
     * 외부 로그인 없이 정상 공개 세션 결과를 반환하는 대역입니다.
     * @returns 고정 사용자·새 식별자·2분 접근 만료·하루 절대 만료 정보.
     */
    signIn: vi.fn(async () => ({ selector: freshSelector, user, accessTokenExpiresAt: new Date(now.getTime() + 120_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) })),
    /**
     * 외부 메일 확인 없이 정상 공개 세션 결과를 반환합니다.
     * @returns 고정 사용자·새 식별자·만료 정보.
     */
    confirmEmail: vi.fn(async () => ({ selector: freshSelector, user, accessTokenExpiresAt: new Date(now.getTime() + 120_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) })),
  };
  const oauth = {
    /**
     * OAuth 시작 순서를 기록하고 테스트 인증 URL과 받은 컨텍스트를 반환합니다.
     * @param _provider 사용하지 않는 제공자 ID.
     * @param context 서버가 만든 OAuth 시작 컨텍스트.
     * @returns 테스트 인증 URL과 컨텍스트.
     */
    start: vi.fn(async (_provider, context) => { events.push("oauth-start"); return { authorizationUrl: new URL("https://provider.example.test/authorize?state=provider-secret-state"), context }; }),
    /**
     * 실제 코드 교환 없이 앱 복귀 경로가 포함된 정상 OAuth 결과를 만듭니다.
     * @returns 공개 세션 정보와 /app 복귀 경로.
     */
    complete: vi.fn(async () => ({ selector: freshSelector, user, accessTokenExpiresAt: new Date(now.getTime() + 120_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000), returnPath: "/app" })),
  };
  const recovery = {
    /**
     * 복구 시작 순서를 기록하고 요청 컨텍스트를 돌려주는 대역입니다.
     * @param _email 사용하지 않는 이메일.
     * @param context 서비스에 전달된 복구 컨텍스트.
     * @returns 접수 표시와 컨텍스트.
     */
    start: vi.fn(async (_email, context) => { events.push("reset-start"); return { accepted: true, context }; }),
    /**
     * 실제 복구 코드 교환 없이 준비 완료 결과를 반환합니다.
     * @returns ready: true.
     */
    exchange: vi.fn(async () => ({ ready: true })),
    /**
     * 실제 비밀번호 변경 없이 성공 결과를 반환합니다.
     * @returns updated: true.
     */
    update: vi.fn(async () => ({ updated: true })),
  };
  const sessions = {
    /**
     * 컨트롤러 응답에 비밀값이 섞이지 않는지 시험하도록 서버 전용 가짜 토큰을 포함한 세션을 반환합니다.
     * @returns 가짜 접근·갱신 토큰과 정상 내부 세션 메타데이터.
     */
    resolve: vi.fn(async () => ({ accessToken: "server-access-jwt", refreshToken: "server-refresh-token", sessionId: "123e4567-e89b-12d3-a456-426614174002", userId: user.id, supabaseSessionId: "123e4567-e89b-12d3-a456-426614174003", accessTokenExpiresAt: new Date(now.getTime() + 120_000), rotationVersion: 0 })),
    /**
     * 실제 제공자 갱신 없이 성공 상태를 반환합니다.
     * @returns status가 refreshed인 결과.
     */
    refresh: vi.fn(async () => ({ status: "refreshed" })),
    /**
     * 로컬 폐기 호출 순서를 기록하고 성공을 반환합니다. 실제 저장소는 변경하지 않습니다.
     * @returns true.
     */
    revokeCurrent: vi.fn(async () => { events.push("local-revoke"); return true; }),
    /**
     * 제공자 폐기 실패 후 보류 기록이 호출된 순서를 남깁니다.
     * @returns 기록 후 값 없음.
     */
    markRevocationPending: vi.fn(async () => { events.push("pending"); }),
  };
  /**
   * signOut 대역은 외부 로그아웃 대신 provider-sign-out 이벤트를 기록합니다. 로컬 폐기와 외부 폐기의 순서를 검사하기 위한 객체입니다.
   */
  const provider = { signOut: vi.fn(async () => { events.push("provider-sign-out"); }) };
  const delegatedApiClient = {
    /**
     * 내부 API 요청을 기록하고 사용자 JSON을 반환합니다. 금지된 상위 Set-Cookie를 일부러 넣어 그대로 전달되지 않는지 시험합니다.
     * @param input 컨트롤러가 만든 위임 API 요청.
     * @returns 사용자 JSON과 테스트용 Set-Cookie를 가진 Response.
     */
    request: vi.fn(async (input: DelegatedApiRequest) => {
      void input;
      return new Response(JSON.stringify(user), { status: 200, headers: { "Content-Type": "application/json", "Set-Cookie": "upstream=forbidden" } });
    }),
  };
  expect(AuthController).toBeTypeOf("function");
  const controller = new AuthController!({
    configuredOrigin: new URL("https://app.example.test"),
    secureCookies: true,
    enabledProviders: ["google", "kakao", "naver"],
    csrfKey,
    now: () => new Date(now),
    createInteractionSelector: () => freshSelector,
    email,
    oauth,
    recovery,
    sessions,
    provider,
    delegatedApiClient,
    ...overrides,
  });
  return { controller, email, oauth, recovery, sessions, provider, delegatedApiClient, events };
}

/**
 * 세션 쿠키가 필요한 세 엔드포인트를 동일 조건으로 호출합니다. refresh에만 POST와 빈 JSON을 사용합니다.
 * @param subject 컨트롤러 테스트 환경.
 * @param endpoint session·me·refresh 중 시험할 작업.
 * @returns 선택한 엔드포인트의 Response.
 */
async function callSessionEndpoint(subject: ReturnType<typeof setup>, endpoint: "session" | "me" | "refresh"): Promise<Response> {
  if (endpoint === "refresh") return subject.controller.refresh!(request("/api/auth/session/refresh", { method: "POST", body: "{}", headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
  return subject.controller[endpoint]!(request(endpoint === "me" ? "/api/me" : "/api/auth/session", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
}

/**
 * 인증 응답의 캐시 방지 헤더가 모두 정확한지 확인합니다.
 * @param response 검사할 컨트롤러 응답.
 * @returns 검증 후 값 없음.
 * @throws 헤더가 다르면 테스트 실패.
 */
function expectNoStore(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Expires")).toBe("0");
}

describe("AuthController", () => {
  it("issues only a CSRF token and replaces a malformed interaction selector", async () => {
    const subject = setup();
    const response = await subject.controller.csrf!(request("/api/auth/csrf", { headers: { Cookie: "__Host-ab_interaction=malformed" } }, ""));
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get("Set-Cookie")).toContain(`__Host-ab_interaction=${freshSelector}`);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.csrfToken).toBeTypeOf("string");
    expect(JSON.stringify(payload)).not.toContain(freshSelector);
  });

  it("issues an explicit interaction-bound CSRF token when both cookies exist", async () => {
    const subject = setup();
    const response = await subject.controller.csrf!(request("/api/auth/csrf?context=interaction", { headers: { Cookie: `__Host-ab_session=${sessionSelector}; __Host-ab_interaction=${selector}` } }, ""));
    expect(response.status).toBe(200);
    const payload = await response.json() as { csrfToken: string };
    expect(() => verifyCsrfToken(payload.csrfToken, { selector }, now, csrfKey)).not.toThrow();
    expect(() => verifyCsrfToken(payload.csrfToken, { selector: sessionSelector }, now, csrfKey)).toThrow("AUTH_CSRF_REJECTED");

    const unknown = await subject.controller.csrf!(request("/api/auth/csrf?context=unknown", { headers: { Cookie: `__Host-ab_session=${sessionSelector}; __Host-ab_interaction=${selector}` } }, ""));
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", retryable: false });
  });

  it("returns only an opaque hardened session cookie after sign-in", async () => {
    const { controller } = setup();
    const response = await controller.signIn!(request("/api/auth/sign-in", { method: "POST", body: JSON.stringify({ email: "person@example.test", password: "a".repeat(12) }) }));
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get("Set-Cookie")).toMatch(/__Host-ab_session=.*HttpOnly.*Secure.*SameSite=Lax.*Path=\/.*Priority=High/u);
    const body = await response.text();
    for (const secret of [freshSelector, "server-access-jwt", "server-refresh-token", "selector", "accessToken", "refreshToken"]) expect(body).not.toContain(secret);
  });

  it("rejects any attempt to disable Secure on __Host cookies", () => {
    expect(() => setup({ secureCookies: false })).toThrow("AUTH_CONFIGURATION_INVALID");
  });

  it("rejects invalid mutation boundaries before calling a use case", async () => {
    const variants = [
      request("/api/auth/sign-up", { method: "POST", body: JSON.stringify({ email: "person@example.test", password: "a".repeat(12) }), headers: { "X-CSRF-Token": "wrong" } }),
      request("/api/auth/sign-up", { method: "POST", body: "{}", headers: { Origin: "https://evil.example.test" } }),
      request("/api/auth/sign-up", { method: "POST", body: "{}", headers: { "Sec-Fetch-Site": "cross-site" } }),
      request("/api/auth/sign-up", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } }),
      request("/api/auth/sign-up", { method: "GET" }),
    ];
    for (const candidate of variants) {
      const { controller, email } = setup();
      const response = await controller.signUp!(candidate);
      expect(response.status).toBe(403);
      expectNoStore(response);
      expect(email.signUp).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({ code: "AUTH_CSRF_REJECTED", retryable: false });
    }
  });

  it("cancels a chunked request stream immediately after the body limit", async () => {
    const subject = setup();
    const streamed = trackedStream([new Uint8Array(16_385), new TextEncoder().encode("credential-after-limit")]);
    const response = await subject.controller.signUp!(request("/api/auth/sign-up", { method: "POST", body: streamed.body }));
    expect(response.status).toBe(422);
    expect(streamed.wasCanceled()).toBe(true);
    expect(subject.email.signUp).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("credential-after-limit");
  });

  it.each([
    ["signUp", "/api/auth/sign-up", { email: "person@example.test", password: "a".repeat(12) }],
    ["passwordResetRequest", "/api/auth/password/reset-request", { email: "person@example.test" }],
  ] as const)("uses a fresh server selector for %s after validating the existing CSRF selector", async (method, path, body) => {
    const subject = setup();
    const response = await subject.controller[method]!(request(path, { method: "POST", body: JSON.stringify({ ...body, selector: "caller-selected" }) }));
    expect(response.status).toBe(422);
    expect(subject.email.signUp).not.toHaveBeenCalled();
    expect(subject.recovery.start).not.toHaveBeenCalled();

    const accepted = await subject.controller[method]!(request(path, { method: "POST", body: JSON.stringify(body), headers: { Host: "evil.test", "X-Forwarded-Host": "evil.test", "X-Forwarded-Proto": "http" } }));
    expect(accepted.headers.get("Set-Cookie")).toContain(`__Host-ab_interaction=${freshSelector}`);
    const called = subject.email.signUp.mock.calls[0] ?? subject.recovery.start.mock.calls[0];
    expect(called?.[1]).toMatchObject({ interactionSelector: freshSelector });
    expect((called?.[1] as { emailRedirectUrl?: URL; callbackBaseUrl?: URL; passwordResetRedirectUrl?: URL })).toSatisfy((context: { emailRedirectUrl?: URL; callbackBaseUrl?: URL; passwordResetRedirectUrl?: URL }) => {
      const url = context.emailRedirectUrl ?? context.callbackBaseUrl ?? context.passwordResetRedirectUrl;
      return url?.origin === "https://app.example.test" && !url.toString().includes("evil.test");
    });
  });

  it("keeps OAuth state out of JSON and creates it only during a same-origin navigation handoff", async () => {
    const subject = setup();
    const start = await subject.controller.oauthStart!(request("/api/auth/oauth/google/start", { method: "POST", body: JSON.stringify({ returnPath: "/app" }) }), { provider: "google" });
    expect(start.status).toBe(200);
    expect(start.headers.get("Set-Cookie")).toContain(`__Host-ab_interaction=${freshSelector}`);
    expect(subject.oauth.start).not.toHaveBeenCalled();
    const startText = await start.text();
    expect(JSON.parse(startText)).toEqual({ authorizationPath: "/api/auth/oauth/google/continue?returnPath=%2Fapp" });
    expect(startText).not.toMatch(/provider\.example|provider-secret-state|authorizationUrl|state/iu);

    const continued = await subject.controller.oauthContinue!(request("/api/auth/oauth/google/continue?returnPath=%2Fapp", {
      headers: {
        Cookie: `__Host-ab_interaction=${freshSelector}`,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
    }, ""), { provider: "google" });
    expect(subject.oauth.start).toHaveBeenCalledWith("google", expect.objectContaining({ interactionSelector: freshSelector, returnPath: "/app", callbackBaseUrl: new URL("https://app.example.test/api/auth/callback") }));
    expect(continued.status).toBe(303);
    expect(continued.headers.get("Location")).toBe("https://provider.example.test/authorize?state=provider-secret-state");
    expectNoStore(continued);

    const crossSite = setup();
    const rejected = await crossSite.controller.oauthContinue!(request("/api/auth/oauth/google/continue?returnPath=%2Fapp", { headers: { Cookie: `__Host-ab_interaction=${freshSelector}`, "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }, ""), { provider: "google" });
    expect(rejected.status).toBe(400);
    expect(crossSite.oauth.start).not.toHaveBeenCalled();
    const rejectedText = await rejected.text();
    for (const secret of [freshSelector, "provider-secret-state", "server-access-jwt"]) expect(rejectedText).not.toContain(secret);
  });

  it.each([
    "http://localhost:54321/auth/v1/authorize?state=local-state",
    "http://127.0.0.1:54321/auth/v1/authorize?state=local-state",
    "http://[::1]:54321/auth/v1/authorize?state=local-state",
  ])("redirects to an exact loopback HTTP OAuth provider URL %s", async (target) => {
    const subject = setup();
    subject.oauth.start.mockResolvedValueOnce({ authorizationUrl: new URL(target), context: {} });
    const response = await subject.controller.oauthContinue!(request("/api/auth/oauth/google/continue?returnPath=%2Fapp", { headers: { Cookie: `__Host-ab_interaction=${selector}`, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }, ""), { provider: "google" });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(target);
  });

  it.each([
    "http://provider.example.test/authorize?state=secret",
    "https://user:password@provider.example.test/authorize",
    "https://provider.example.test/authorize#secret",
  ])("rejects an unsafe OAuth provider redirect %s", async (target) => {
    const subject = setup();
    subject.oauth.start.mockResolvedValueOnce({ authorizationUrl: new URL(target), context: {} });
    const response = await subject.controller.oauthContinue!(request("/api/auth/oauth/google/continue?returnPath=%2Fapp", { headers: { Cookie: `__Host-ab_interaction=${selector}`, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }, ""), { provider: "google" });
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).not.toContain(target);
  });

  it("uses the 60-second refresh threshold without returning a token", async () => {
    const refresh = setup({ sessions: { ...setup().sessions, resolve: vi.fn(async () => ({ accessToken: "hidden", refreshToken: "hidden-refresh", sessionId: "123e4567-e89b-12d3-a456-426614174002", userId: user.id, supabaseSessionId: "123e4567-e89b-12d3-a456-426614174003", accessTokenExpiresAt: new Date(now.getTime() + 60_000), rotationVersion: 0 })) } });
    const response = await refresh.controller.session!(request("/api/auth/session", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "AUTH_SESSION_REFRESH_REQUIRED", retryable: false });
    expect(text).not.toContain("hidden");

    const healthy = setup();
    const ok = await healthy.controller.session!(request("/api/auth/session", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toMatch(/access|refresh|selector/iu);
  });

  it("revokes locally before provider logout and keeps the cookie deleted on provider failure", async () => {
    const subject = setup();
    subject.provider.signOut.mockImplementationOnce(async () => { subject.events.push("provider-sign-out"); throw new Error("provider detail"); });
    const response = await subject.controller.signOut!(request("/api/auth/sign-out", { method: "POST", body: "{}", headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(subject.events).toEqual(["local-revoke", "provider-sign-out", "pending"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toMatch(/__Host-ab_session=;.*Max-Age=0/u);
    expect(await response.text()).not.toContain("provider detail");
  });

  it("passes only fixed current-user metadata to the delegated API client", async () => {
    const subject = setup();
    const response = await subject.controller.me!(request("/api/me?url=https://evil.test&provider=credential", {
      headers: {
        Authorization: "Bearer browser-access-credential",
        Cookie: `__Host-ab_session=${selector}; provider_refresh=provider-refresh-credential`,
        Forwarded: "host=evil.test",
        Host: "evil.test",
        "Proxy-Authorization": "Bearer proxy-credential",
        "X-Forwarded-Host": "evil.test",
        "X-Forwarded-Proto": "http",
        "X-Original-URL": "https://evil.test/provider-credential",
      },
    }));

    expect(response.status).toBe(200);
    expect(subject.delegatedApiClient.request).toHaveBeenCalledOnce();
    const input = subject.delegatedApiClient.request.mock.calls[0]![0];
    expect(input).toMatchObject({
      contentType: null,
      method: "GET",
      scope: "me:read",
      sessionId: "123e4567-e89b-12d3-a456-426614174002",
      target: "/v1/me",
      userId: user.id,
    });
    expect(Object.keys(input).sort()).toEqual([
      "body",
      "contentType",
      "method",
      "scope",
      "sessionId",
      "target",
      "userId",
    ]);
    expect(input.body).toBeInstanceOf(Uint8Array);
    expect(input.body.byteLength).toBe(0);
    const serialized = JSON.stringify(input).toLowerCase();
    expect([
      "browser-access-credential",
      "server-access-jwt",
      "server-refresh-token",
      "provider-refresh-credential",
      "proxy-credential",
      selector.toLowerCase(),
      "cookie",
      "forwarded",
      "evil.test",
      "provider=credential",
    ].some((secret) => serialized.includes(secret))).toBe(false);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expectNoStore(response);
  });

  it("preserves safe current-user response mapping and status behavior", async () => {
    const subject = setup();

    subject.delegatedApiClient.request.mockResolvedValueOnce(new Response(JSON.stringify({ ...user, token: "forbidden" }), { status: 200 }));
    const malformed = await subject.controller.me!(request("/api/me", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: false });

    subject.delegatedApiClient.request.mockResolvedValueOnce(new Response(JSON.stringify({ code: "AUTH_SESSION_EXPIRED", message: "The session has expired.", requestId: "123e4567-e89b-12d3-a456-426614174010", retryable: false, fieldErrors: [] }), { status: 418 }));
    const unexpectedStatus = await subject.controller.me!(request("/api/me", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(unexpectedStatus.status).toBe(401);
    expect(await unexpectedStatus.json()).toMatchObject({ code: "AUTH_SESSION_EXPIRED", retryable: false });

    subject.delegatedApiClient.request.mockResolvedValueOnce(new Response(JSON.stringify({ code: "LEDGER_NOT_FOUND", message: "The requested ledger resource was not found.", requestId: "123e4567-e89b-12d3-a456-426614174010", retryable: false, fieldErrors: [] }), { status: 404 }));
    const ledgerError = await subject.controller.me!(request("/api/me", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(ledgerError.status).toBe(502);
    expect(await ledgerError.json()).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: false });

    subject.delegatedApiClient.request.mockRejectedValueOnce(new Error("internal network detail"));
    const unavailable = await subject.controller.me!(request("/api/me", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: false });
  });

  it("does not invoke the delegated API client when the provider access token requires refresh", async () => {
    const subject = setup({
      sessions: {
        ...setup().sessions,
        resolve: vi.fn(async () => ({
          accessToken: "expired-provider-access-credential",
          refreshToken: "provider-refresh-credential",
          sessionId: "123e4567-e89b-12d3-a456-426614174002",
          userId: user.id,
          supabaseSessionId: "123e4567-e89b-12d3-a456-426614174003",
          accessTokenExpiresAt: new Date(now.getTime() + 60_000),
          rotationVersion: 0,
        })),
      },
    });

    const response = await subject.controller.me!(request("/api/me", {
      headers: { Cookie: `__Host-ab_session=${selector}` },
    }, ""));

    expect(response.status).toBe(401);
    expect(subject.delegatedApiClient.request).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      code: "AUTH_SESSION_REFRESH_REQUIRED",
      retryable: false,
    });
    expectNoStore(response);
  });

  it("maps delegated client failure to the fixed upstream error without reflecting secrets", async () => {
    const subject = setup();
    subject.delegatedApiClient.request.mockRejectedValueOnce(
      new Error("provider-refresh-credential delegated client detail"),
    );

    const response = await subject.controller.me!(request("/api/me", {
      headers: { Cookie: `__Host-ab_session=${selector}` },
    }, ""));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(subject.delegatedApiClient.request).toHaveBeenCalledOnce();
    expect(JSON.parse(text)).toMatchObject({
      code: "AUTH_PROVIDER_UNAVAILABLE",
      retryable: false,
    });
    expect(text.includes("provider-refresh-credential")).toBe(false);
    expectNoStore(response);
  });

  it("does not reflect a delegated credential or request ID when the bounded fetch fails", async () => {
    const subject = setup();
    subject.delegatedApiClient.request.mockRejectedValueOnce(
      new DOMException(`${delegatedToken} ${delegatedRequestId}`, "TimeoutError"),
    );

    const response = await subject.controller.me!(request("/api/me", {
      headers: { Cookie: `__Host-ab_session=${selector}` },
    }, ""));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({
      code: "AUTH_PROVIDER_UNAVAILABLE",
      retryable: false,
    });
    expect(text.includes(delegatedToken)).toBe(false);
    expect(text.includes(delegatedRequestId)).toBe(false);
    expectNoStore(response);
  });

  it("cancels a chunked upstream stream immediately after the response limit", async () => {
    const subject = setup();
    const streamed = trackedStream([new Uint8Array(65_537), new TextEncoder().encode("upstream-token-after-limit")]);
    subject.delegatedApiClient.request.mockResolvedValueOnce(new Response(streamed.body));
    const response = await subject.controller.me!(request("/api/me", { headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(response.status).toBe(502);
    expect(streamed.wasCanceled()).toBe(true);
    expect(await response.text()).not.toContain("upstream-token-after-limit");
  });

  it("refreshes only through a CSRF-protected POST and returns no credential material", async () => {
    const subject = setup();
    const response = await subject.controller.refresh!(request("/api/auth/session/refresh", { method: "POST", body: "{}", headers: { Cookie: `__Host-ab_session=${selector}` } }, ""));
    expect(response.status).toBe(200);
    expect(subject.sessions.refresh).toHaveBeenCalledTimes(1);
    const text = await response.text();
    expect(text).toBe(JSON.stringify({ refreshed: true }));
    expect(text).not.toMatch(/access|refreshToken|selector/iu);
    expectNoStore(response);
  });

  it.each([
    ["session", "expired", 401, "AUTH_SESSION_EXPIRED", false],
    ["me", "expired", 401, "AUTH_SESSION_EXPIRED", false],
    ["refresh", "expired", 401, "AUTH_SESSION_EXPIRED", false],
    ["session", "unavailable", 503, "AUTH_PROVIDER_UNAVAILABLE", true],
    ["me", "unavailable", 503, "AUTH_PROVIDER_UNAVAILABLE", true],
    ["refresh", "unavailable", 503, "AUTH_PROVIDER_UNAVAILABLE", true],
    ["session", "rate_limited", 429, "AUTH_RATE_LIMITED", false],
    ["me", "rate_limited", 429, "AUTH_RATE_LIMITED", false],
    ["refresh", "rate_limited", 429, "AUTH_RATE_LIMITED", false],
  ] as const)("maps %s session failures with reason %s", async (endpoint, reason, status, code, retryable) => {
    expect(SessionOperationError).toBeTypeOf("function");
    const subject = setup();
    const operation = endpoint === "refresh" ? subject.sessions.refresh : subject.sessions.resolve;
    operation.mockRejectedValueOnce(new SessionOperationError!(reason));

    const response = await callSessionEndpoint(subject, endpoint);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, retryable });
    if (endpoint === "me") expect(subject.delegatedApiClient.request).not.toHaveBeenCalled();
  });

  it.each(["session", "me", "refresh"] as const)("does not duck-type raw fixed-message errors from %s", async (endpoint) => {
    const subject = setup();
    const operation = endpoint === "refresh" ? subject.sessions.refresh : subject.sessions.resolve;
    operation.mockRejectedValueOnce(new Error("AUTH_SESSION_OPERATION_FAILED"));

    const response = await callSessionEndpoint(subject, endpoint);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true });
  });

  it.each([[], undefined])("blocks disabled OAuth at start, continue and callback without creating a session (%s)", async (enabledProviders) => {
    const subject = setup({ enabledProviders });
    const start = await subject.controller.oauthStart!(request("/api/auth/oauth/google/start", { method: "POST", body: JSON.stringify({ returnPath: "/app" }) }), { provider: "google" });
    expect(start.status).toBe(503);
    expect(start.headers.get("Set-Cookie")).toBeNull();
    const continued = await subject.controller.oauthContinue!(request("/api/auth/oauth/google/continue?returnPath=%2Fapp", { headers: { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }), { provider: "google" });
    expect(continued.status).toBe(503);
    const callback = await subject.controller.oauthCallback!(request(`/api/auth/callback?provider=google&state=${selector}&code=secret-code`));
    expect(callback.headers.get("Set-Cookie")).not.toContain("__Host-ab_session=");
    expect(subject.oauth.start).not.toHaveBeenCalled();
    expect(subject.oauth.complete).not.toHaveBeenCalled();
  });

  it("fails OAuth callback closed and removes code/state from the next redirect", async () => {
    const missing = setup();
    const missingResponse = await missing.controller.oauthCallback!(request("/api/auth/callback?provider=google&state=bad&code=secret-code", {}, ""));
    expect(missing.oauth.complete).not.toHaveBeenCalled();
    expect(missingResponse.status).toBe(303);
    expect(missingResponse.headers.get("Location")).toBe("https://app.example.test/app");
    expect(missingResponse.headers.get("Location")).not.toMatch(/secret-code|state|code/iu);
    expectNoStore(missingResponse);

    const replay = setup();
    replay.oauth.complete.mockRejectedValueOnce(Object.assign(new Error("hidden-code"), { code: "AUTH_OAUTH_TRANSACTION_INVALID" }));
    const replayResponse = await replay.controller.oauthCallback!(request("/api/auth/callback?provider=google&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code=secret-code"));
    expect(replayResponse.status).toBe(303);
    expect(replayResponse.headers.get("Location")).toBe("https://app.example.test/app");
    expect(await replayResponse.text()).not.toContain("hidden-code");
  });

  it("creates a session only for a completed email callback and clears the interaction", async () => {
    const subject = setup();
    const response = await subject.controller.emailCallback!(request("/api/auth/email/callback?code=confirmation-code"));
    expect(subject.email.confirmEmail).toHaveBeenCalledWith({ code: "confirmation-code" }, expect.objectContaining({ interactionSelector: selector }));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example.test/app");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-ab_session=");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-ab_interaction=;");
    expect(response.headers.get("Location")).not.toContain("confirmation-code");
  });

  it("opens the reset form after a limited recovery callback and clears interaction only after password update", async () => {
    const subject = setup();
    const callback = await subject.controller.passwordCallback!(request("/api/auth/password/callback?code=recovery-code"));
    expect(subject.recovery.exchange).toHaveBeenCalledWith({ code: "recovery-code" }, expect.objectContaining({ interactionSelector: selector }));
    expect(callback.status).toBe(303);
    expect(callback.headers.get("Location")).toBe("https://app.example.test/reset-password");
    expect(callback.headers.get("Set-Cookie")).toBeNull();
    expect(callback.headers.get("Location")).not.toContain("recovery-code");

    const update = await subject.controller.passwordUpdate!(request("/api/auth/password/update", { method: "POST", body: JSON.stringify({ password: "b".repeat(12) }) }));
    expect(update.status).toBe(200);
    expect(update.headers.get("Set-Cookie")).toContain("__Host-ab_interaction=;");
    expect(update.headers.get("Set-Cookie")).not.toContain("__Host-ab_session=");
    expectNoStore(update);

    const both = setup();
    const bothCookies = await both.controller.passwordUpdate!(request("/api/auth/password/update", { method: "POST", body: JSON.stringify({ password: "c".repeat(12) }), headers: { Cookie: `__Host-ab_session=${sessionSelector}; __Host-ab_interaction=${selector}` } }));
    expect(bothCookies.status).toBe(200);
    expect(both.recovery.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ interactionSelector: selector }));
  });
});
