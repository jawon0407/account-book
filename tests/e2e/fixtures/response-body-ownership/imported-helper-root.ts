import type { Page } from "@playwright/test";
import { readBody } from "./local-body-reader.js";

/**
 * Moves a Playwright body read behind a reachable local helper import.
 * @param page - Browser page that supplies the protected Response.
 * @returns Resolves after invoking the imported policy mutation.
 */
export async function mutation(page: Page): Promise<void> {
  const response = await page.waitForResponse("**/api/auth/sign-in");
  await readBody(response);
}
