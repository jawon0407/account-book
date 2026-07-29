import { AxeBuilder } from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import {
  SafeAuthUiError,
  type SafeAuthUiErrorCode,
} from "./safe-ui-error.js";

export type TestCredentials = Readonly<{
  email: string;
  password: string;
}>;

export interface AuthUi {
  openLogin(): Promise<void>;
  assertLoginUsable(): Promise<void>;
  submit(credentials: TestCredentials): Promise<void>;
  assertRejected(): Promise<void>;
  assertAuthenticated(): Promise<void>;
  assertNoBrowserCredentials(): Promise<void>;
  assertNoAuthorizationHeaders(): Promise<void>;
}

async function runStep(
  code: SafeAuthUiErrorCode,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch {
    throw new SafeAuthUiError(code);
  }
}

export function createAuthUi(input: Readonly<{
  page: Page;
  context: BrowserContext;
}>): AuthUi {
  const { page, context } = input;
  const authorizationPresence: Array<Promise<boolean>> = [];
  try {
    page.on("request", function authorizationRecorder(request) {
      authorizationPresence.push(
        request.headerValue("authorization").then((value) => value !== null),
      );
    });
  } catch {
    throw new SafeAuthUiError("AUTH_UI_UNEXPECTED_FAILURE");
  }

  const authUi = Object.assign(Object.create(null) as AuthUi, {
    async openLogin(): Promise<void> {
      await runStep("AUTH_UI_LOGIN_NOT_READY", async () => {
        await page.goto("/login");
      });
    },

    async assertLoginUsable(): Promise<void> {
      await runStep("AUTH_UI_LAYOUT_FAILED", async () => {
        const emailInput = page.locator("#sign-in-email");
        const passwordInput = page.locator("#sign-in-password");
        const emailLabel = page.locator('label[for="sign-in-email"]');
        const passwordLabel = page.locator('label[for="sign-in-password"]');
        const [
          emailVisible,
          passwordVisible,
          emailLabelText,
          passwordLabelText,
        ] = await Promise.all([
          emailInput.isVisible(),
          passwordInput.isVisible(),
          emailLabel.textContent(),
          passwordLabel.textContent(),
        ]);
        if (!emailVisible
          || !passwordVisible
          || (emailLabelText?.trim().length ?? 0) === 0
          || (passwordLabelText?.trim().length ?? 0) === 0) {
          throw new Error();
        }

        await page.keyboard.press("Tab");
        const emailFocused = await emailInput.evaluate(
          (element) => element === document.activeElement,
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (!emailFocused || overflow > 0) throw new Error();
      });

      await runStep("AUTH_UI_ACCESSIBILITY_FAILED", async () => {
        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        if (accessibility.violations.length !== 0) throw new Error();
      });
    },

    async submit(credentials: TestCredentials): Promise<void> {
      await runStep("AUTH_UI_LOGIN_NOT_READY", async () => {
        await page.locator("#sign-in-email").fill(credentials.email);
        await page.locator("#sign-in-password").fill(credentials.password);
        await page.locator('button[type="submit"]').first().click();
      });
    },

    async assertRejected(): Promise<void> {
      await runStep("AUTH_UI_REJECTION_FAILED", async () => {
        const [alertVisible, cookies] = await Promise.all([
          page.locator('.auth-status[role="alert"]').isVisible(),
          context.cookies(),
        ]);
        if (!alertVisible
          || !/\/login$/u.test(page.url())
          || cookies.some((cookie) => cookie.name === "__Host-ab_session")) {
          throw new Error();
        }
      });
    },

    async assertAuthenticated(): Promise<void> {
      await runStep("AUTH_UI_SESSION_POLICY_FAILED", async () => {
        await page.waitForURL("**/app");
        if (!/\/app$/u.test(page.url())) throw new Error();

        const cookies = await context.cookies();
        if (cookies.length !== 1) throw new Error();
        const [cookie] = cookies;
        if (cookie === undefined
          || cookie.httpOnly !== true
          || cookie.name !== "__Host-ab_session"
          || cookie.path !== "/"
          || cookie.sameSite !== "Lax"
          || cookie.secure !== true
          || !/^[A-Za-z0-9_-]{43}$/u.test(cookie.value)) {
          throw new Error();
        }
      });
    },

    async assertNoBrowserCredentials(): Promise<void> {
      await runStep("AUTH_UI_BROWSER_CREDENTIAL_DETECTED", async () => {
        const storageIsSafe = await page.evaluate(() => {
          const containsCredentialMaterial = (value: string): boolean =>
            value.includes(
              "e2e-provider-refresh-token-must-never-reach-browser",
            )
            || /access.?token|refresh.?token/iu.test(value)
            || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(
              value,
            );

          if (localStorage.length !== 0) return false;
          for (let index = 0; index < sessionStorage.length; index += 1) {
            const key = sessionStorage.key(index);
            if (key === null
              || !/^__next_debug_channel:[A-Za-z0-9_-]+$/u.test(key)) {
              return false;
            }
            const value = sessionStorage.getItem(key) ?? "";
            if (containsCredentialMaterial(key)
              || containsCredentialMaterial(value)) {
              return false;
            }
          }
          return true;
        });
        if (!storageIsSafe) throw new Error();
      });
    },

    async assertNoAuthorizationHeaders(): Promise<void> {
      await runStep("AUTH_UI_AUTHORIZATION_HEADER_DETECTED", async () => {
        const authorizationDetected = (
          await Promise.all(authorizationPresence)
        ).some((present) => present);
        if (authorizationDetected) throw new Error();
      });
    },
  });

  return Object.freeze(authUi);
}
