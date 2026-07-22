import { AxeBuilder } from "@axe-core/playwright";
import { expect, request as requestFactory, test, type Page } from "@playwright/test";

const email = "verified@example.test";
const password = "correct horse battery staple";
const userId = "123e4567-e89b-42d3-a456-426614174001";
const providerRefreshToken = "e2e-provider-refresh-token-must-never-reach-browser";

async function expectTokenFreeStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(storage).toEqual({ local: [], session: [] });
}

test("login is responsive, labelled, keyboard reachable, and axe-clean", async ({ page }) => {
  await page.goto("/login");
  const emailInput = page.locator("#sign-in-email");
  const passwordInput = page.locator("#sign-in-password");
  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await expect(page.locator('label[for="sign-in-email"]')).not.toHaveText("");
  await expect(page.locator('label[for="sign-in-password"]')).not.toHaveText("");
  await page.keyboard.press("Tab");
  await expect(emailInput).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("failed login stays fixed and never creates browser token state", async ({ page, context }) => {
  await page.goto("/login");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(`${password}!wrong`);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in"));
  await page.locator('button[type="submit"]').first().click();
  const response = await responsePromise;
  expect(response.status()).toBe(401);
  const body = await response.text();
  expect(body).not.toContain(email);
  expect(body).not.toContain(password);
  await expect(page.locator('[role="status"]')).toBeVisible();
  await expect(page.locator('[role="status"]')).not.toContainText(email);
  expect((await context.cookies()).filter((cookie) => cookie.name.includes("ab_session"))).toEqual([]);
  await expectTokenFreeStorage(page);
});

test("successful login creates only an opaque cookie, reaches the real API, and logout invalidates it", async ({ page, context }) => {
  const browserAuthorizationHeaders: Array<string | undefined> = [];
  page.on("request", (request) => browserAuthorizationHeaders.push(request.headers().authorization));
  await page.goto("/login");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in"));
  await page.locator('button[type="submit"]').first().click();
  const signIn = await responsePromise;
  expect(signIn.status()).toBe(200);
  const signInText = await signIn.text();
  expect(signInText).not.toContain(providerRefreshToken);
  const publicBody = JSON.parse(signInText) as Record<string, unknown>;
  expect(Object.keys(publicBody).sort()).toEqual(["absoluteExpiresAt", "expiresAt", "user"]);
  expect(JSON.stringify(publicBody)).not.toMatch(/access.?token|refresh.?token|eyJ/iu);
  await page.waitForURL("**/app");

  const cookies = await context.cookies();
  expect(cookies).toHaveLength(1);
  expect(JSON.stringify(cookies)).not.toContain(providerRefreshToken);
  expect(cookies[0]).toMatchObject({
    httpOnly: true,
    name: "__Host-ab_session",
    path: "/",
    sameSite: "Lax",
    secure: true,
  });
  const sessionSelector = cookies[0]?.value;
  expect(sessionSelector).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  await expectTokenFreeStorage(page);

  const me = await page.evaluate(async () => {
    const response = await fetch("/api/me", { headers: { accept: "application/json" } });
    return { body: await response.json() as unknown, status: response.status };
  });
  expect(me).toEqual({ body: { email: null, emailVerified: true, id: userId }, status: 200 });
  expect(browserAuthorizationHeaders.every((header) => header === undefined)).toBe(true);

  const signOut = await page.evaluate(async () => {
    const csrfResponse = await fetch("/api/auth/csrf?context=session", { headers: { accept: "application/json" } });
    const csrf = await csrfResponse.json() as { csrfToken: string };
    const response = await fetch("/api/auth/sign-out", {
      body: "{}",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
      method: "POST",
    });
    return { body: await response.json() as unknown, status: response.status };
  });
  expect(signOut).toEqual({ body: { signedOut: true }, status: 200 });
  expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("__Host-ab_"))).toEqual([]);
  const afterLogout = await page.evaluate(async () => (await fetch("/api/me")).status);
  expect(afterLogout).toBe(401);
  const replay = await requestFactory.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { Cookie: `__Host-ab_session=${sessionSelector}` },
    ignoreHTTPSErrors: true,
  });
  try {
    expect((await replay.get("/api/me")).status()).toBe(401);
  } finally {
    await replay.dispose();
  }
  await expectTokenFreeStorage(page);
});
