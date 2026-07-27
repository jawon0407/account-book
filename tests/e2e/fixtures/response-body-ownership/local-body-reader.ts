import type { Response } from "@playwright/test";

/**
 * Consumes a Playwright response body to test local import-graph enforcement.
 * @param response - Page-owned response passed from the root mutation fixture.
 * @returns Resolves after the forbidden text read.
 */
export async function readBody(response: Response): Promise<void> {
  await response.text();
}
