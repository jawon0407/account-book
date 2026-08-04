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
 * Reads one response body exactly once, then checks raw and decoded credential
 * material before returning parsed data for any structural assertion.
 * @param response - Playwright response whose body belongs to the HTTP project.
 * @param forbidden - Exact synthetic and live secrets known at response time.
 * @param options - Narrow public-email or CSRF-key allowance for this endpoint.
 * @returns Retained text and parsed value, neither of which enters assertion diffs.
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
 * Re-checks retained parsed/text data when a newly learned selector becomes secret.
 * @param body - Previously read sign-in body retained only inside the test process.
 * @param forbidden - Expanded exact-secret set including the live selector.
 * @param options - Sign-in public-email allowance constrained by decoded JSON path.
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
 * Fetches a selector-bound CSRF token into process memory for one immediate mutation.
 * @param api - Isolated Playwright request context that owns its cookie jar.
 * @param forbidden - Exact secrets known before the CSRF response is received.
 * @param context - Optional server-side selector context required by logout.
 * @returns The short-lived CSRF token without logging or persisting it.
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
 * Builds the exact same-origin Fetch Metadata boundary accepted for JSON mutations.
 * @param token - Fresh CSRF token bound to the request context's current selector.
 * @returns Immutable headers for one authenticated or pre-auth mutation.
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
 * Attempts local session revocation during cleanup without replacing the primary test failure.
 * @param api - Request context whose cookie jar may contain an authenticated session.
 * @param forbidden - Exact secrets already known to the interrupted test flow.
 * @returns Resolves after attempting the best-effort revocation without logging session material.
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
