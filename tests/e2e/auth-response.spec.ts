import {
  expect,
  request as requestFactory,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import {
  containsCredentialMaterial,
  containsCredentialMaterialInJson,
  isAuthErrorResponse,
  isCsrfResponse,
  isMeResponse,
  isSignInResponse,
  isSignOutResponse,
  parseJsonSafely,
  type CredentialScanOptions,
} from "./auth-response-policy.js";

const origin = "https://127.0.0.1:4512";
const email = "verified@example.test";
const password = "correct horse battery staple";
const userId = "123e4567-e89b-42d3-a456-426614174001";
const providerRefreshToken = "e2e-provider-refresh-token-must-never-reach-browser";

/**
 * 응답 본문을 한 번 읽고 원문·파싱값의 자격증명 누출을 검사한다.
 * @param response - HTTP 계약 테스트가 소유한 Playwright 응답이다.
 * @param forbidden - 이미 알고 있는 합성/현재 세션 비밀 문자열 목록이다.
 * @param options - 공개 이메일 또는 CSRF 키의 제한된 허용 범위다.
 * @returns {text,value} Promise. assertion에는 원문 대신 검사 boolean만 전달하며 검증 실패는 테스트를 중단한다.
 */
async function readSafeJson(
  response: APIResponse,
  forbidden: readonly string[],
  options: CredentialScanOptions = {},
): Promise<Readonly<{ text: string; value: unknown }>> {
  const text = await response.text();
  expect(
    containsCredentialMaterial(text, forbidden, options),
    "HTTP response must not contain raw credential material",
  ).toBe(false);
  const parsed = parseJsonSafely(text);
  expect(parsed.ok, "HTTP response must contain valid JSON").toBe(true);
  if (!parsed.ok) throw new Error("HTTP response JSON validation failed");
  expect(
    containsCredentialMaterialInJson(parsed.value, forbidden, options),
    "HTTP response must not contain nested credential material",
  ).toBe(false);
  return { text, value: parsed.value };
}

/**
 * 새 selector를 알게 된 뒤 앞서 보관한 응답에 그 값이 없었는지 다시 검사한다.
 * @param body - 현재 테스트 메모리의 text/value 응답 쌍이다.
 * @param forbidden - 새 selector까지 포함한 비밀 문자열 목록이다.
 * @param options - 로그인 공개 이메일의 경로 제한 허용값이다.
 * @returns 반환값 없음. 누출이 있으면 원문을 diff로 출력하지 않는 boolean assertion이 실패한다.
 */
function expectLeakFreeRetainedBody(
  body: Readonly<{ text: string; value: unknown }>,
  forbidden: readonly string[],
  options: CredentialScanOptions,
): void {
  expect(
    containsCredentialMaterial(body.text, forbidden, options),
    "retained response must not contain a newly learned credential",
  ).toBe(false);
  expect(
    containsCredentialMaterialInJson(body.value, forbidden, options),
    "retained response must not contain a nested newly learned credential",
  ).toBe(false);
}

/**
 * 쿠키 문맥에 결속된 CSRF 증표를 가져오고 공개 응답 계약을 검사한다.
 * @param api - 독립 쿠키 저장소를 가진 요청 context다.
 * @param forbidden - 응답을 받기 전에 알고 있는 비밀 문자열 목록이다.
 * @param context - 로그아웃 시 session을 지정한다. 생략하면 일반 증표다.
 * @returns 검사한 증표 문자열 Promise. HTTP/계약 실패는 전파하며 증표를 출력/영구 저장하지 않는다.
 */
async function csrfToken(
  api: APIRequestContext,
  forbidden: readonly string[],
  context?: "session",
): Promise<string> {
  const suffix = context === "session" ? "?context=session" : "";
  const response = await api.get(`/api/auth/csrf${suffix}`);
  expect(response.status()).toBe(200);
  const body = await readSafeJson(response, forbidden, { allowCsrfTokenKey: true });
  expect(isCsrfResponse(body.value), "CSRF response must match its exact public contract").toBe(true);
  if (!isCsrfResponse(body.value)) throw new Error("CSRF response validation failed");
  return body.value.csrfToken;
}

/**
 * 같은 출처 JSON 변경 요청의 Fetch Metadata와 CSRF 헤더를 구성한다.
 * @param token - 현재 요청 context의 selector에 결속된 새 CSRF 증표다.
 * @returns 읽기 전용 타입의 헤더 객체. 실제 전송이나 런타임 동결은 하지 않는다.
 */
function mutationHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Accept: "application/json",
    Origin: origin,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": token,
  };
}

/**
 * 테스트 정리 중 세션 폐기를 시도하되 원래 테스트 실패를 덮어쓰지 않는다.
 * @param api - 로그인 쿠키가 남아 있을 수 있는 요청 context다.
 * @param forbidden - 현재 테스트가 알고 있는 비밀 문자열 목록이다.
 * @returns 정리 시도 완료 Promise. CSRF 조회와 로그아웃 POST를 하며 실패는 삼킨다.
 */
async function bestEffortSignOut(api: APIRequestContext, forbidden: readonly string[]): Promise<void> {
  try {
    const token = await csrfToken(api, forbidden, "session");
    const response = await api.post("/api/auth/sign-out", { data: {}, headers: mutationHeaders(token) });
    await response.text();
  } catch {
    // The disposable database is the final containment boundary when cleanup cannot reach the server.
  }
}

test("failed login returns a fixed public error without creating a session", async () => {
  const api = await requestFactory.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const knownSecrets = [email, password, providerRefreshToken];
  try {
    const token = await csrfToken(api, knownSecrets);
    knownSecrets.push(token);
    const response = await api.post("/api/auth/sign-in", {
      data: { email, password: `${password}!wrong` },
      headers: mutationHeaders(token),
    });
    expect(response.status()).toBe(401);
    const body = await readSafeJson(response, knownSecrets);
    expect(
      isAuthErrorResponse(body.value, "AUTH_INVALID_CREDENTIALS"),
      "failed sign-in must match its exact fixed public error",
    ).toBe(true);
    const cookieNames = (await api.storageState()).cookies.map((cookie) => cookie.name);
    expect(cookieNames.includes("__Host-ab_session")).toBe(false);
  } finally {
    await api.dispose();
  }
});

test("successful login exposes only the public session contract and revokes the opaque selector", async () => {
  const api = await requestFactory.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const knownSecrets = [email, password, providerRefreshToken];
  let signedOut = false;
  try {
    const token = await csrfToken(api, knownSecrets);
    knownSecrets.push(token);
    const response = await api.post("/api/auth/sign-in", {
      data: { email, password },
      headers: mutationHeaders(token),
    });
    expect(response.status()).toBe(200);
    const publicSignIn = { publicEmail: email } as const;
    const signInBody = await readSafeJson(response, knownSecrets, publicSignIn);
    expect(
      isSignInResponse(signInBody.value, { email, userId }),
      "sign-in must match its exact nested public contract",
    ).toBe(true);

    const cookies = (await api.storageState()).cookies;
    expect(
      cookies.length === 1
        && cookies[0]?.httpOnly === true
        && cookies[0]?.name === "__Host-ab_session"
        && cookies[0]?.path === "/"
        && cookies[0]?.sameSite === "Lax"
        && cookies[0]?.secure === true,
      "session cookie must expose only fixed public metadata",
    ).toBe(true);
    const selector = cookies[0]?.value;
    expect(/^[A-Za-z0-9_-]{43}$/u.test(selector ?? ""), "session selector must use the opaque fixed-length format").toBe(true);
    if (selector === undefined) throw new Error("session selector validation failed");
    knownSecrets.push(selector);
    expectLeakFreeRetainedBody(signInBody, knownSecrets, publicSignIn);

    const me = await api.get("/api/me");
    expect(me.status()).toBe(200);
    const meBody = await readSafeJson(me, knownSecrets);
    expect(
      isMeResponse(meBody.value, { email: null, userId }),
      "current-user response must match its exact public contract",
    ).toBe(true);

    const logoutToken = await csrfToken(api, knownSecrets, "session");
    knownSecrets.push(logoutToken);
    const logout = await api.post("/api/auth/sign-out", { data: {}, headers: mutationHeaders(logoutToken) });
    expect(logout.status()).toBe(200);
    const logoutBody = await readSafeJson(logout, knownSecrets);
    expect(
      isSignOutResponse(logoutBody.value),
      "sign-out response must match its exact public contract",
    ).toBe(true);
    signedOut = true;
    expect((await api.storageState()).cookies.some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);

    const replay = await requestFactory.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Cookie: `__Host-ab_session=${selector}` },
      ignoreHTTPSErrors: true,
    });
    try {
      const rejected = await replay.get("/api/me");
      expect(rejected.status()).toBe(401);
      const rejectedBody = await readSafeJson(rejected, knownSecrets);
      expect(
        isAuthErrorResponse(rejectedBody.value, "AUTH_SESSION_EXPIRED"),
        "selector replay must return the exact fixed public error",
      ).toBe(true);
    } finally {
      await replay.dispose();
    }
  } finally {
    if (!signedOut) await bestEffortSignOut(api, knownSecrets);
    await api.dispose();
  }
});
