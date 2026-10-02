import { expect, test } from "@playwright/test";

// 고정 합성 계정만 사용한다. provider는 로컬 대역, 계정 존재 조회는 실제 폐기용 PostgreSQL이다.
test("expired recovery callback remains public and removes provider query values", async ({ page }) => {
  await page.goto("/api/auth/password/callback?error=access_denied&error_code=otp_expired");
  await expect(page).toHaveURL(/\/forgot-password\/invalid-link$/u);
  await expect(page.getByRole("heading", { name: "재설정 링크를 확인해 주세요" })).toBeVisible();
  await page.getByRole("link", { name: "재설정 링크 다시 받기" }).click();
  await expect(page.getByRole("button", { name: "재설정 링크 받기" })).toBeVisible();
});

test("missing account receives a red error without a mail success claim", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("이메일", { exact: true }).fill("absent@example.test");
  const response = page.waitForResponse((value) => value.url().endsWith("/api/auth/password/reset-request") && value.request().method() === "POST");
  await page.getByRole("button", { name: "재설정 링크 받기" }).click();
  expect((await response).status()).toBe(404);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("존재하지 않는 계정이에요");
  await expect(page.getByText("재설정 메일 발송을 요청했어요.", { exact: false })).toHaveCount(0);
});

test("duplicate email signup offers login and creates no session", async ({ page, context }) => {
  await page.goto("/sign-up");
  await page.getByLabel("이메일", { exact: true }).fill("verified@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse battery staple");
  const response = page.waitForResponse((value) => value.url().endsWith("/api/auth/sign-up") && value.request().method() === "POST");
  await page.getByRole("button", { name: "가입하기", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("이미 가입된 이메일이에요");
  expect((await context.cookies()).some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);
  await page.getByRole("link", { name: "기존 계정으로 로그인" }).click();
  await expect(page).toHaveURL(/\/login$/u);
});

test("social signup return shows the fixed login notice without a session", async ({ page, context }) => {
  await page.goto("/login?notice=social-signup");
  await expect(page.getByRole("status").filter({ hasText: "소셜 계정을 확인했어요" })).toContainText("로그인");
  expect((await context.cookies()).some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);
});
