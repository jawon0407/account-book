import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const email = "verified@example.test";
const password = "correct horse battery staple";
const providerRefreshToken = "e2e-provider-refresh-token-must-never-reach-browser";

/**
 * Detects credential-like material without returning or logging the matched value.
 * @param serialized - Browser state serialized only inside the current test process.
 * @returns True when a provider sentinel, token label, or compact JWT shape is present.
 */
function containsCredentialMaterial(serialized: string): boolean {
  return serialized.includes(providerRefreshToken)
    || /access.?token|refresh.?token/iu.test(serialized)
    || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(serialized);
}

/**
 * Verifies that the browser persists no application credential state.
 * @param page - Active authenticated or unauthenticated browser page.
 */
async function expectTokenFreeStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(storage.local.map(([key]) => key)).toEqual([]);
  for (const [key] of storage.session) {
    expect(key).toMatch(/^__next_debug_channel:[A-Za-z0-9_-]+$/u);
  }
  expect(containsCredentialMaterial(JSON.stringify(storage)), "browser storage must not contain credential material").toBe(false);
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
  expect((await responsePromise).status()).toBe(401);
  await expect(page.locator(".auth-status[role=\"alert\"]")).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);
  await expectTokenFreeStorage(page);
});

test("successful login creates only an opaque cookie and reaches the real API", async ({ page, context }) => {
  const browserAuthorizationHeaders: Array<string | undefined> = [];
  page.on("request", (request) => browserAuthorizationHeaders.push(request.headers().authorization));
  await page.goto("/login");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL("**/app");

  const cookies = await context.cookies();
  expect(cookies.map(({ httpOnly, name, path, sameSite, secure }) => ({ httpOnly, name, path, sameSite, secure }))).toEqual([
    {
      httpOnly: true,
      name: "__Host-ab_session",
      path: "/",
      sameSite: "Lax",
      secure: true,
    },
  ]);
  expect(/^[A-Za-z0-9_-]{43}$/u.test(cookies[0]?.value ?? ""), "session selector must use the opaque fixed-length format").toBe(true);
  await expectTokenFreeStorage(page);

  const meStatus = await page.evaluate(async () => (await fetch("/api/me", { headers: { accept: "application/json" } })).status);
  expect(meStatus).toBe(200);
  expect(browserAuthorizationHeaders.every((header) => header === undefined)).toBe(true);
});
