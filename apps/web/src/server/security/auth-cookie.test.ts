import { describe, expect, it } from "vitest";

const cookieModule = await import("./auth-cookie.js").catch(() => ({} as Record<string, unknown>));
const sessionCookie = cookieModule.sessionCookie as ((value: string, secure: boolean) => unknown) | undefined;
const interactionCookie = cookieModule.interactionCookie as ((value: string, secure: boolean) => unknown) | undefined;
const clearAuthCookie = cookieModule.clearAuthCookie as ((name: string, secure: boolean) => unknown) | undefined;
const SESSION_COOKIE_NAME = cookieModule.SESSION_COOKIE_NAME as string | undefined;
const INTERACTION_COOKIE_NAME = cookieModule.INTERACTION_COOKIE_NAME as string | undefined;

const selector = Buffer.alloc(32, 7).toString("base64url");

describe("auth cookies", () => {
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
    expect(interactionCookie?.(selector, false)).toEqual({
      name: "__Host-ab_interaction",
      value: selector,
      httpOnly: true,
      secure: false,
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
    expect(clearAuthCookie?.("__Host-ab_interaction", false)).toEqual({
      name: "__Host-ab_interaction",
      value: "",
      httpOnly: true,
      secure: false,
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
    for (const buildCookie of [sessionCookie, interactionCookie]) {
      expect(() => buildCookie?.(invalid, true)).toThrow("AUTH_COOKIE_INVALID");
      if (invalid !== "") {
        expect(() => buildCookie?.(invalid, true)).toThrowError(
          expect.not.objectContaining({ message: expect.stringContaining(invalid) }),
        );
      }
    }
  });

  it.each(["ab_session", "__Host-ab_session\n", "__Host-other", "", "__Host-ab_session", 1])(
    "rejects an arbitrary cookie clearer name without echoing it",
    (invalid) => {
      if (invalid === "__Host-ab_session") {
        return;
      }
      expect(() => clearAuthCookie?.(invalid as string, true)).toThrow("AUTH_COOKIE_INVALID");
      expect(() => clearAuthCookie?.(invalid as string, true)).toThrowError(
        expect.not.objectContaining({ message: expect.not.stringContaining("AUTH_COOKIE_INVALID") }),
      );
    },
  );

  it.each(["true", 1, null, undefined])("rejects a non-boolean secure flag", (secure) => {
    expect(() => sessionCookie?.(selector, secure as unknown as boolean)).toThrow("AUTH_COOKIE_INVALID");
  });
});
