import { expect, request as requestFactory, test, type APIRequestContext } from "@playwright/test";

const origin = "https://127.0.0.1:4512";
const email = "verified@example.test";
const password = "correct horse battery staple";
const userId = "123e4567-e89b-42d3-a456-426614174001";
const providerRefreshToken = "e2e-provider-refresh-token-must-never-reach-browser";

/**
 * Detects credential material without exposing the received body in an assertion diff.
 * @param value - An HTTP response body held only for the current assertion.
 * @param forbidden - Synthetic credential values that must never cross the BFF boundary.
 * @returns True when a forbidden value, token label, or compact JWT shape is present.
 */
function containsCredentialMaterial(value: string, forbidden: readonly string[] = []): boolean {
  return forbidden.some((secret) => value.includes(secret))
    || /access.?token|refresh.?token/iu.test(value)
    || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(value);
}

/**
 * Fetches a selector-bound CSRF token into process memory for one immediate mutation.
 * @param api - Isolated Playwright request context that owns its cookie jar.
 * @param context - Optional server-side selector context required by logout.
 * @returns The short-lived CSRF token without logging or persisting it.
 */
async function csrfToken(api: APIRequestContext, context?: "session"): Promise<string> {
  const suffix = context === "session" ? "?context=session" : "";
  const response = await api.get(`/api/auth/csrf${suffix}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as unknown;
  expect(body !== null && typeof body === "object" && typeof (body as { csrfToken?: unknown }).csrfToken === "string").toBe(true);
  return (body as { csrfToken: string }).csrfToken;
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
 * @returns Resolves after attempting the best-effort revocation without logging session material.
 */
async function bestEffortSignOut(api: APIRequestContext): Promise<void> {
  try {
    const token = await csrfToken(api, "session");
    await api.post("/api/auth/sign-out", { data: {}, headers: mutationHeaders(token) });
  } catch {
    // The disposable database is the final containment boundary when cleanup cannot reach the server.
  }
}

test("failed login returns a fixed public error without creating a session", async () => {
  const api = await requestFactory.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const token = await csrfToken(api);
    const response = await api.post("/api/auth/sign-in", {
      data: { email, password: `${password}!wrong` },
      headers: mutationHeaders(token),
    });
    expect(response.status()).toBe(401);
    const text = await response.text();
    expect(containsCredentialMaterial(text, [email, password, providerRefreshToken]), "failure response must not disclose credential material").toBe(false);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "fieldErrors", "message", "requestId", "retryable"]);
    expect(body.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(body.retryable).toBe(false);
    const cookieNames = (await api.storageState()).cookies.map((cookie) => cookie.name);
    expect(cookieNames.includes("__Host-ab_session")).toBe(false);
  } finally {
    await api.dispose();
  }
});

test("successful login exposes only the public session contract and revokes the opaque selector", async () => {
  const api = await requestFactory.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  let signedOut = false;
  try {
    const token = await csrfToken(api);
    const response = await api.post("/api/auth/sign-in", {
      data: { email, password },
      headers: mutationHeaders(token),
    });
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(containsCredentialMaterial(text, [providerRefreshToken]), "success response must not disclose credential material").toBe(false);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["absoluteExpiresAt", "expiresAt", "user"]);

    const cookies = (await api.storageState()).cookies;
    expect(cookies.map(({ httpOnly, name, path, sameSite, secure }) => ({ httpOnly, name, path, sameSite, secure }))).toEqual([
      { httpOnly: true, name: "__Host-ab_session", path: "/", sameSite: "Lax", secure: true },
    ]);
    const selector = cookies[0]?.value;
    expect(/^[A-Za-z0-9_-]{43}$/u.test(selector ?? ""), "session selector must use the opaque fixed-length format").toBe(true);

    const me = await api.get("/api/me");
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ email: null, emailVerified: true, id: userId });

    const logoutToken = await csrfToken(api, "session");
    const logout = await api.post("/api/auth/sign-out", { data: {}, headers: mutationHeaders(logoutToken) });
    expect(logout.status()).toBe(200);
    expect(await logout.json()).toEqual({ signedOut: true });
    signedOut = true;
    expect((await api.storageState()).cookies.some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);

    const replay = await requestFactory.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Cookie: `__Host-ab_session=${selector ?? ""}` },
      ignoreHTTPSErrors: true,
    });
    try {
      expect((await replay.get("/api/me")).status()).toBe(401);
    } finally {
      await replay.dispose();
    }
  } finally {
    if (!signedOut) await bestEffortSignOut(api);
    await api.dispose();
  }
});
