// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../../app/providers.js";

/**
 * 인증 페이지 모듈을 읽어 기본 컴포넌트를 테스트에 제공한다.
 * @param path 테스트 파일 기준 모듈 경로. 실제 import 실패는 빈 모듈로 처리한다.
 * @returns 기본 export 또는 undefined. 페이지 존재 여부는 호출한 테스트가 단정한다.
 */
async function optionalPage(path: string): Promise<ComponentType | undefined> {
  const module = await vi.importActual<Record<string, unknown>>(path).catch(() => ({}));
  return (module as Record<string, unknown>).default as ComponentType | undefined;
}

const pages = {
  login: await optionalPage("../../app/(auth)/login/page.js"),
  signUp: await optionalPage("../../app/(auth)/sign-up/page.js"),
  verifyEmail: await optionalPage("../../app/(auth)/verify-email/page.js"),
  forgotPassword: await optionalPage("../../app/(auth)/forgot-password/page.js"),
  resetPassword: await optionalPage("../../app/(auth)/reset-password/page.js"),
};

afterEach(cleanup);

describe("authentication pages", () => {
  it("provides a local application icon without a missing favicon request", async () => {
    const icon = await readFile(resolve(process.cwd(), "src/app/icon.svg"), "utf8").catch(() => "");
    expect(icon).toContain("<svg");
  });

  it.each([
    ["login", "로그인", "새 계정 만들기", "/sign-up"],
    ["signUp", "계정 만들기", "로그인으로 돌아가기", "/login"],
    ["verifyEmail", "이메일을 확인해 주세요", "로그인으로 이동", "/login"],
    ["forgotPassword", "비밀번호 재설정", "로그인으로 돌아가기", "/login"],
    ["resetPassword", "새 비밀번호 설정", "로그인으로 돌아가기", "/login"],
  ] as const)("renders the %s flow heading and adjacent route", (key, heading, linkName, href) => {
    const Page = pages[key];
    expect(Page).toBeTypeOf("function");
    if (Page === undefined) return;
    render(<Providers><Page /></Providers>);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(screen.getByRole("link", { name: linkName }).getAttribute("href")).toBe(href);
  });
});
