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

/**
 * UI 검증 단계를 실행하고 원본 예외를 고정 코드로 교체한다.
 * @param code - 이 단계 실패를 나타낼 허용된 공개 코드다.
 * @param operation - 비동기 UI 조작/검사 함수다.
 * @returns 완료 Promise. 실패 시 SafeAuthUiError를 던져 원본 오류 노출을 막는다.
 */
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

/**
 * Playwright 객체를 감춘 동결된 인증 UI 기능 객체를 만든다.
 * @param input - page는 화면 조작, context는 쿠키 검사에 사용한다.
 * @returns AuthUi. 요청 이벤트를 등록해 Authorization 헤더 존재 여부만 수집한다.
 * @throws 이벤트 등록 실패 시 AUTH_UI_UNEXPECTED_FAILURE. 각 메서드는 고정 단계 오류로 실패한다.
 */
export function createAuthUi(input: Readonly<{
  page: Page;
  context: BrowserContext;
}>): AuthUi {
  const { page, context } = input;
  const authorizationPresence: Array<Promise<boolean>> = [];
  try {
    /**
     * 각 요청의 Authorization 헤더 존재 여부만 Promise로 기록한다.
     * @param request - Playwright 요청 객체. 헤더 원문은 저장하지 않는다.
     * @returns 반환값 없음. 읽기 실패도 존재함으로 취급하여 안전하게 실패시킨다.
     */
    page.on("request", function authorizationRecorder(request) {
      try {
        authorizationPresence.push(
          request.headerValue("authorization").then(
            (value) => value !== null,
            () => true,
          ),
        );
      } catch {
        authorizationPresence.push(Promise.resolve(true));
      }
    });
  } catch {
    throw new SafeAuthUiError("AUTH_UI_UNEXPECTED_FAILURE");
  }

  const authUi = Object.assign(Object.create(null) as AuthUi, {
    /**
     * 로그인 페이지로 이동한다.
     * @returns 이동 완료 Promise. 실패는 AUTH_UI_LOGIN_NOT_READY로 바꾼다.
     */
    async openLogin(): Promise<void> {
      await runStep("AUTH_UI_LOGIN_NOT_READY", async () => {
        await page.goto("/login");
      });
    },

    /**
     * 입력/레이블 표시, Tab 포커스, 가로 넘침과 axe 접근성을 검사한다.
     * @returns 검사 완료 Promise. 화면 조작이 발생하며 레이아웃/접근성 실패를 고정 코드로 전달한다.
     */
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

    /**
     * 합성 자격증명을 입력하고 첫 제출 버튼을 누른다.
     * @param credentials - 테스트용 email/password 문자열 객체다.
     * @returns 클릭 완료 Promise. 실제 로그인 요청이 시작될 수 있으며 실패는 고정 준비 오류다.
     */
    async submit(credentials: TestCredentials): Promise<void> {
      await runStep("AUTH_UI_LOGIN_NOT_READY", async () => {
        await page.locator("#sign-in-email").fill(credentials.email);
        await page.locator("#sign-in-password").fill(credentials.password);
        await page.locator('button[type="submit"]').first().click();
      });
    },

    /**
     * 고정 거부 문구, 로그인 URL 유지, 세션 쿠키 부재를 확인한다.
     * @returns 검사 완료 Promise. 불일치 시 AUTH_UI_REJECTION_FAILED이며 원본 내용은 출력하지 않는다.
     */
    async assertRejected(): Promise<void> {
      await runStep("AUTH_UI_REJECTION_FAILED", async () => {
        const alert = page.locator('.auth-status[role="alert"]');
        await alert.waitFor({ state: "visible" });
        const alertContent = await alert.textContent();
        if (alertContent?.trim() !== "!이메일 또는 비밀번호를 확인해 주세요.") {
          throw new Error();
        }
        if (!/\/login$/u.test(page.url())) throw new Error();
        const cookies = await context.cookies();
        if (cookies.some((cookie) => cookie.name === "__Host-ab_session")) {
          throw new Error();
        }
      });
    },

    /**
     * /app 이동과 세션 쿠키 개수·HttpOnly·Secure·SameSite·selector 형식을 확인한다.
     * @returns 검사 완료 Promise. 불일치는 AUTH_UI_SESSION_POLICY_FAILED다.
     * @remarks /app 화면 내용이나 가계부 구현 여부를 검사하는 함수는 아니다.
     */
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

    /**
     * 페이지 문맥에서 브라우저 저장소가 허용된 테스트 상태인지 검사한다.
     * @returns 완료 Promise. localStorage는 비어야 하고 sessionStorage는 안전한 Next 디버그 키만 허용한다.
     * @throws 민감 문자열·허용 밖 키 또는 실행 오류는 AUTH_UI_BROWSER_CREDENTIAL_DETECTED다.
     */
    async assertNoBrowserCredentials(): Promise<void> {
      await runStep("AUTH_UI_BROWSER_CREDENTIAL_DETECTED", async () => {
        const storageIsSafe = await page.evaluate(() => {
          /**
           * 저장소 문자열에 합성 refresh 표식·토큰 이름·JWT 모양이 있는지 검사한다.
           * @param value - 저장소 키 또는 값 문자열이다.
           * @returns 민감 문자열이 의심되면 true. 외부 전송이나 저장은 없다.
           */
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

    /**
     * 누적된 요청 헤더 존재 여부를 배치로 기다리며 추가된 요청도 확인한다.
     * @returns 완료 Promise. 존재하거나 읽기 실패한 요청이 있으면 고정 헤더 탐지 오류를 던진다.
     */
    async assertNoAuthorizationHeaders(): Promise<void> {
      await runStep("AUTH_UI_AUTHORIZATION_HEADER_DETECTED", async () => {
        let cursor = 0;
        while (cursor < authorizationPresence.length) {
          const batch = authorizationPresence.slice(cursor);
          cursor += batch.length;
          const authorizationDetected = (
            await Promise.all(batch)
          ).some((present) => present);
          if (authorizationDetected) throw new Error();
        }
      });
    },
  });

  return Object.freeze(authUi);
}
