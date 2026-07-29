import { test as baseTest } from "@playwright/test";
import { createAuthUi } from "./auth-ui-driver.js";
import type { AuthUi } from "./auth-ui-driver.js";
import { normalizeSafeAuthUiError } from "./safe-ui-error.js";
import { withTransportTripwire } from "./transport-tripwire.js";

export type AuthTestFixtures = Readonly<{ authUi: AuthUi }>;

export function createAuthTestFixtures(authUi: AuthUi): AuthTestFixtures {
  return Object.freeze({ authUi });
}

export async function runAuthUiCallback(
  callback: (fixtures: AuthTestFixtures) => Promise<void>,
  fixtures: AuthTestFixtures,
): Promise<void> {
  try {
    await callback(fixtures);
  } catch (error) {
    throw normalizeSafeAuthUiError(error);
  }
}

export function authTest(
  title: string,
  callback: (fixtures: AuthTestFixtures) => Promise<void>,
): void {
  baseTest(title, async ({ page, context }) => {
    const authUi = createAuthUi({ page, context });
    await withTransportTripwire(async () => {
      await runAuthUiCallback(callback, createAuthTestFixtures(authUi));
    });
  });
}
