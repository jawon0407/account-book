import type { Page } from "@playwright/test";

/**
 * Mutates a page-owned Playwright Response into a forbidden body read.
 * @param page - Browser page that supplies the original waitForResponse surface.
 * @returns Resolves after the policy-only body-read mutation.
 */
export async function mutation(page: Page): Promise<void> {
  const response = await page.waitForResponse("**/api/auth/sign-in");
  await response?.["json"]?.();
}
