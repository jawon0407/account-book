import type { APIRequestContext } from "@playwright/test";

/**
 * Mutates an APIRequestContext response into a forbidden buffer read.
 * @param api - Isolated HTTP context that supplies Playwright APIResponse provenance.
 * @returns Resolves after the policy-only body-read mutation.
 */
export async function mutation(api: APIRequestContext): Promise<void> {
  const response = await api.get("/api/me");
  await response.body?.();
}
