/**
 * Mutates TypeScript 6 DOM Body ownership through the new bytes API.
 * @param response - Standard-library DOM Response under policy analysis.
 * @returns Resolves after the policy-only body-read mutation.
 */
export async function mutation(response: Response): Promise<void> {
  await response.bytes();
}
