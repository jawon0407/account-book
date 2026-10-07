import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { buildApiError } from "../../../packages/contracts/src/index.js";

/** @param page 폐기용 브라우저. @param name 합성 fixture 이름. 실제 로그인/BFF/API 경로로 본인 수입·지출을 준비한다. */
async function setup(page: Page, name: string) {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill("verified@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 계좌", exact: true })).toBeVisible();
  const fixture = await page.evaluate(async name => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    const post = async (path: string, input: object) => {
      const response = await fetch(`/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }) });
      if (response.status !== 201) throw new Error(`fixture failed ${response.status}`);
      return response.json();
    };
    const account = await post("accounts", { name, kind: "bank" });
    const category = await post("categories", { name, kind: "expense", sortOrder: 0 });
    const row = await post("transactions", { accountId: account.id, categoryId: category.id, type: "expense", amountKrw: 100, occurredOn: "2026-10-01", memo: name });
    return { id: row.id as string, accountId: account.id as string };
  }, name);
  await page.goto("/app/transactions");
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
  return fixture;
}

test("PC edits, detects concurrent changes, confirms soft delete and recalculates balances", async ({ page }) => {
  const name = "수정 삭제 PC 검증", { id } = await setup(page, name);
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByLabel("거래 종류", { exact: true })).toBeFocused();
  await page.getByLabel("금액 (원)").fill("500");
  await page.getByLabel("메모 (선택)").fill("");
  expect((await new AxeBuilder({ page }).analyze()).violations.map(v => v.id)).toEqual([]);
  await page.screenshot({ path: "output/playwright/transaction-edit-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(row).toContainText("500원");
  await row.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("메모 (선택)").fill("오래된 폼 내용");
  const status = await page.evaluate(async id => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    return (await fetch(`/api/transactions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ memo: "다른 기기 변경", expectedVersion: 2 }) })).status;
  }, id);
  expect(status).toBe(200);
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("다른 화면");
  await expect(page.getByLabel("메모 (선택)")).toHaveValue("오래된 폼 내용");
  await expect(page.getByRole("button", { name: "저장하기" })).toBeDisabled();
  await page.getByRole("button", { name: "닫고 목록 확인" }).click();
  await expect(row).toContainText("다른 기기 변경");
  for (const width of [1920, 1080, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("500원");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations.map(v => v.id)).toEqual([]);
  await page.screenshot({ path: "output/playwright/transaction-delete-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "삭제하기" }).click();
  await expect(row).toHaveCount(0);
  await page.reload(); await expect(row).toHaveCount(0);
  await page.getByRole("link", { name: "계좌", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: name }).getByText("0원", { exact: true })).toBeVisible();
});

test("a committed edit or delete with lost response is not resubmitted and refresh shows truth", async ({ page }) => {
  const name = "응답 유실 변경 PC", { id } = await setup(page, name);
  const row = page.getByRole("row").filter({ hasText: name });
  const methods: string[] = [];
  await page.route(`**/api/transactions/${id}`, async route => {
    methods.push(route.request().method());
    const headers = await route.request().allHeaders();
    // Playwright의 중간 전송에는 브라우저가 나중에 붙이는 Fetch Metadata가 없다.
    // 같은 출처인 이 합성 전송에서만 복원한다. 앱의 실제 CSRF 검사는 그대로 실행한다.
    expect(new URL(route.request().url()).origin).toBe(new URL(page.url()).origin);
    const response = await route.fetch({ headers: { ...headers, "sec-fetch-site": "same-origin" } });
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await row.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("금액 (원)").fill("900");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("변경 결과를 확인하지 못했어요");
  await expect(page.getByRole("button", { name: "저장하기" })).toBeDisabled();
  await page.getByRole("button", { name: "닫고 목록 확인" }).click();
  await expect(row).toContainText("900원");
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제하기" }).click();
  await expect(page.getByRole("button", { name: "삭제하기" })).toBeDisabled();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("변경 결과를 확인하지 못했어요");
  await page.getByRole("button", { name: "닫고 목록 확인" }).click();
  await expect(row).toHaveCount(0); expect(methods).toEqual(["PATCH", "DELETE"]);
});

for (const method of ["PATCH", "DELETE"] as const) {
  test(`a ${method} session expiry hides the transaction and draft`, async ({ page }) => {
    const name = `세션 만료 ${method}`, { id } = await setup(page, name);
    await page.route(`**/api/transactions/${id}`, route => route.fulfill({ status: 401, json: buildApiError({ code: "AUTH_SESSION_EXPIRED", retryable: false }) }));
    await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: method === "PATCH" ? "수정" : "삭제", exact: true }).click();
    await page.getByRole("button", { name: method === "PATCH" ? "저장하기" : "삭제하기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "세션을 다시 확인해 주세요" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByText(name)).toHaveCount(0);
  });
}
