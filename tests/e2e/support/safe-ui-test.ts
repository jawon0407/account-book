import { test as baseTest } from "@playwright/test";
import { createAuthUi } from "./auth-ui-driver.js";
import type { AuthUi } from "./auth-ui-driver.js";
import { normalizeSafeAuthUiError } from "./safe-ui-error.js";
import { withTransportTripwire } from "./transport-tripwire.js";

export type AuthTestFixtures = Readonly<{ authUi: AuthUi }>;

/**
 * UI 테스트에 넘길 기능 객체를 동결된 fixture로 감싼다.
 * @param authUi - 허용된 UI 동작만 제공하는 기능 객체다.
 * @returns {authUi} 형태의 동결 객체. page/context를 직접 노출하지 않는다.
 */
export function createAuthTestFixtures(authUi: AuthUi): AuthTestFixtures {
  return Object.freeze({ authUi });
}

/**
 * fixture로 테스트 callback을 실행하고 실패를 안전한 오류로 정규화한다.
 * @param callback - AuthTestFixtures를 받는 비동기 테스트 함수다.
 * @param fixtures - callback에 공개할 기능 객체 모음이다.
 * @returns 완료 Promise. 실패 시 원본 대신 normalizeSafeAuthUiError 결과를 던진다.
 */
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

/**
 * Playwright 테스트를 등록하고 실행 시 UI 기능과 전송 차단 경계를 연결한다.
 * @param title - 테스트 리포트에 표시할 고정 이름이다.
 * @param callback - page/context 대신 authUi만 받는 비동기 테스트다.
 * @returns 반환값 없음. 등록된 테스트는 실행 시 tripwire 안에서 callback을 수행한다.
 */
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
