import { describe, expect, it } from "vitest";

const cookieModule = await import("./auth-cookie.js").catch(() => ({} as Record<string, unknown>));
const sessionCookie = cookieModule.sessionCookie as ((value: string, secure: boolean) => unknown) | undefined;
const interactionCookie = cookieModule.interactionCookie as ((value: string, secure: boolean) => unknown) | undefined;
const authBudgetCookie = cookieModule.authBudgetCookie as ((value: string, secure: boolean) => unknown) | undefined;
const clearAuthCookie = cookieModule.clearAuthCookie as ((name: string, secure: boolean) => unknown) | undefined;
const SESSION_COOKIE_NAME = cookieModule.SESSION_COOKIE_NAME as string | undefined;
const INTERACTION_COOKIE_NAME = cookieModule.INTERACTION_COOKIE_NAME as string | undefined;

const selector = Buffer.alloc(32, 7).toString("base64url");

/**
 * 작업이 고정 쿠키 오류를 던지고 제출 값을 메시지에 노출하지 않는지 확인합니다. 검증 때문에 작업을 두 번 호출합니다.
 * @param action 실패해야 하는 동기 작업.
 * @param supplied 메시지에 없어야 할 선택적 입력값.
 * @returns 검증 후 값 없이 종료합니다.
 * @throws 기대한 오류나 비노출 조건이 맞지 않으면 테스트 실패.
 */
function expectInvalid(action: () => unknown, supplied?: string): void {
  expect(action).toThrow("AUTH_COOKIE_INVALID");
  try {
    action();
  } catch (error) {
    expect((error as Error).message).toBe("AUTH_COOKIE_INVALID");
    if (supplied !== undefined && supplied !== "") expect((error as Error).message).not.toContain(supplied);
  }
}

describe("auth cookies", () => {
  it("creates a ten-minute host-only browser budget cookie independent of interaction cookies", () => {
    expect(authBudgetCookie).toBeTypeOf("function");
    expect(authBudgetCookie?.(selector, true)).toEqual({
      name: "__Host-ab_auth_budget", value: selector, httpOnly: true, secure: true,
      sameSite: "lax", path: "/", priority: "high", maxAge: 600,
    });
  });

  it("creates exact host-only HttpOnly cookies for canonical selectors", () => {
    expect(sessionCookie).toBeTypeOf("function");
    expect(interactionCookie).toBeTypeOf("function");
    expect(SESSION_COOKIE_NAME).toBe("__Host-ab_session");
    expect(INTERACTION_COOKIE_NAME).toBe("__Host-ab_interaction");

    expect(sessionCookie?.(selector, true)).toEqual({
      name: "__Host-ab_session",
      value: selector,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      priority: "high",
    });
    expect(interactionCookie?.(selector, true)).toEqual({
      name: "__Host-ab_interaction",
      value: selector,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      priority: "high",
    });
  });

  it("clears only the two scoped auth cookies deterministically", () => {
    expect(clearAuthCookie).toBeTypeOf("function");
    expect(clearAuthCookie?.("__Host-ab_session", true)).toEqual({
      name: "__Host-ab_session",
      value: "",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      priority: "high",
      maxAge: 0,
    });
    expect(clearAuthCookie?.("__Host-ab_interaction", true)).toEqual({
      name: "__Host-ab_interaction",
      value: "",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      priority: "high",
      maxAge: 0,
    });
  });

  it.each([
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}+`,
    ` ${selector}`,
    `${selector} `,
    `${selector}\r`,
    `${selector}\n`,
    "_".repeat(43),
  ])("rejects an invalid cookie selector without echoing it", (invalid) => {
    for (const buildCookie of [sessionCookie, interactionCookie, authBudgetCookie]) {
      expectInvalid(() => buildCookie?.(invalid, true), invalid);
    }
  });

  it.each(["ab_session", "__Host-ab_session\n", "__Host-other", "", "__Host-ab_session", 1])(
    "rejects an arbitrary cookie clearer name without echoing it",
    (invalid) => {
      if (invalid === "__Host-ab_session") {
        return;
      }
      expectInvalid(() => clearAuthCookie?.(invalid as string, true), String(invalid));
    },
  );

  it.each([false, "true", 1, null, undefined])("rejects any secure flag other than literal true", (secure) => {
    expectInvalid(() => sessionCookie?.(selector, secure as unknown as boolean), String(secure));
    expectInvalid(() => authBudgetCookie?.(selector, secure as unknown as boolean), String(secure));
  });
});
