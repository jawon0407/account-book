import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { buildApiError } from "../../../packages/contracts/src/index.js";

/** @param page 격리된 브라우저. 합성 IdP 사용자로 실제 로그인 경로를 통과한다. */
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill("verified@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 계좌", exact: true })).toBeVisible();
}

test("PC user can manage accounts, categories and profile through the real BFF/API/database", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "로그인하기" })).toBeVisible();
  await page.getByRole("link", { name: "로그인하기" }).click();
  await page.getByLabel("이메일", { exact: true }).fill("verified@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 계좌", exact: true })).toBeVisible();
  await expect(page.getByText("등록한 계좌가 없어요")).toBeVisible();
  await page.getByRole("button", { name: "계좌 추가", exact: true }).first().click();
  await page.getByLabel("계좌 이름").fill("E2E 생활비 계좌");
  await page.getByRole("button", { name: "추가하기" }).click();
  const accountRow = page.getByRole("row").filter({ hasText: "E2E 생활비 계좌" });
  await expect(accountRow).toBeVisible();
  await expect(accountRow.getByText("0원", { exact: true })).toBeVisible();
  await accountRow.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("계좌 이름").fill("E2E 수정한 계좌");
  // 실제 다른 요청이 먼저 저장한 상황을 만든다. 열린 폼의 오래된 version은 409가 되어야 한다.
  const concurrentStatus = await page.evaluate(async () => {
    const { items } = await (await fetch("/api/accounts")).json();
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    const account = items.find((item: { name: string }) => item.name === "E2E 생활비 계좌");
    return (await fetch(`/api/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ name: "E2E 다른 화면 수정", expectedVersion: account.version }) })).status;
  });
  expect(concurrentStatus).toBe(200);
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("다른 화면");
  await expect(page.getByLabel("계좌 이름")).toHaveValue("E2E 수정한 계좌");
  await expect(page.getByRole("button", { name: "저장하기" })).toBeDisabled();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "E2E 다른 화면 수정" }).getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("계좌 이름").fill("E2E 수정한 계좌");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 수정한 계좌" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "E2E 수정한 계좌" })).toBeVisible();
  for (const width of [1920, 1080, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: "output/playwright/core-accounts-desktop.png", fullPage: true });
  await page.getByRole("row").filter({ hasText: "E2E 수정한 계좌" }).getByRole("button", { name: "보관", exact: true }).click();
  await page.getByRole("button", { name: "보관하기", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 수정한 계좌" })).toHaveCount(0);
  await page.getByLabel("보관 항목 포함").check();
  await expect(page.getByRole("row").filter({ hasText: "E2E 수정한 계좌" }).getByText("보관됨")).toBeVisible();

  await page.getByRole("link", { name: "카테고리", exact: true }).click();
  await page.getByRole("button", { name: "카테고리 추가", exact: true }).first().click();
  await page.getByLabel("카테고리 이름").fill("E2E 식비");
  await page.getByLabel("정렬 순서").fill("2");
  await page.getByRole("button", { name: "추가하기" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 식비" })).toBeVisible();
  await page.getByRole("row").filter({ hasText: "E2E 식비" }).getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("카테고리 이름").fill("E2E 외식");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 외식" })).toBeVisible();
  await page.getByRole("row").filter({ hasText: "E2E 외식" }).getByRole("button", { name: "보관", exact: true }).click();
  await page.getByRole("button", { name: "보관하기", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 외식" })).toHaveCount(0);

  await page.getByRole("link", { name: "내 정보", exact: true }).click();
  await page.getByLabel("닉네임").fill("테스트 사용자");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("status").filter({ hasText: "닉네임을 저장했어요" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("닉네임")).toHaveValue("테스트 사용자");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("heading", { name: "로그아웃했어요", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인하기" })).toBeVisible();
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "로그인하기" })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("browser boundary handles malformed data, long names, negative balances and keyboard focus", async ({ page }) => {
  // 이 사례만 브라우저 HTTP 응답을 대체한다. 실제 저장 검증은 위 full-stack 사례에서 수행한다.
  let valid = false;
  const name = "아주 긴 계좌 이름 ".repeat(4).trim();
  const record = { id: "33333333-3333-4333-8333-333333333333", name, kind: "bank", currentBalanceKrw: -123456789, archivedAt: null, version: 1, createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z" };
  await page.route("**/api/accounts?*", (route) => route.fulfill({ json: valid ? { items: [record] } : { items: [{ privateError: "must-not-show" }] } }));
  await login(page);
  await expect(page.getByRole("region", { name: "계좌 목록" }).getByRole("alert")).toContainText("목록을 불러오지 못했어요");
  await expect(page.getByText("must-not-show")).toHaveCount(0);
  valid = true;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await expect(page.getByText("-123,456,789원", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1080, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "계좌 추가", exact: true }).click();
  await expect(page.getByLabel("계좌 이름")).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations.map((item) => item.id)).toEqual([]);
  await page.route("**/api/accounts", (route) => route.fulfill({ status: 201, json: { privateError: "must-not-show" } }));
  await page.getByLabel("계좌 이름").fill("응답 오류 입력 보존");
  await page.getByRole("button", { name: "추가하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("계좌 이름")).toHaveValue("응답 오류 입력 보존");
  await expect(page.getByText("must-not-show")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "계좌 추가", exact: true })).toBeFocused();
});

test("identity revalidation hides old forms and rejects a mismatched account assertion", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "계좌 추가", exact: true }).first().click();
  await page.getByLabel("계좌 이름").fill("이전 사용자 미저장 입력");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/me", async (route) => {
    await held;
    // UI에는 B를 반환하지만 실제 쿠키는 A다. BFF가 불일치를 거부하는지 함께 확인한다.
    await route.fulfill({ json: { id: "22222222-2222-4222-8222-222222222222", email: "second@example.test", emailVerified: true } });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  try {
    await expect(page.getByRole("status")).toContainText("로그인 상태");
    await expect(page.getByLabel("계좌 이름")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "내 계좌", exact: true })).toHaveCount(0);
    expect(await page.getByRole("status").locator('[aria-hidden="true"]').first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "세션을 다시 확인해 주세요", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "추가하기" })).toHaveCount(0);
});

test("PC transactions survive response loss, filter/paginate, update balance and reject archived parents", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "계좌 추가", exact: true }).first().click();
  await page.getByLabel("계좌 이름").fill("거래 테스트 통장");
  await page.getByRole("button", { name: "추가하기" }).click();
  await expect(page.getByRole("row").filter({ hasText: "거래 테스트 통장" })).toBeVisible();
  await page.getByRole("link", { name: "카테고리", exact: true }).click();
  for (const [name, kind] of [["거래 식비", "expense"], ["거래 급여", "income"]]) {
    await page.getByRole("button", { name: "카테고리 추가", exact: true }).first().click();
    await page.getByLabel("카테고리 이름").fill(name!);
    await page.getByLabel("종류", { exact: true }).selectOption(kind!);
    await page.getByRole("button", { name: "추가하기" }).click();
    await expect(page.getByRole("row").filter({ hasText: name! })).toBeVisible();
  }
  await page.goto("/app/transactions");
  await expect(page.getByRole("heading", { name: "거래 내역", exact: true })).toBeVisible();
  // 최초 요청은 실제 저장 후 응답만 유실. 두 번째 전송은 429 대역, 세 번째는 같은 키로 실제 서버 재시도다.
  const attempts: unknown[] = [];
  await page.route("**/api/transactions", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) {
      // 대역 전송의 Fetch Metadata를 복원하고 실제 저장 성공을 확인한 후 응답만 유실시킨다.
      expect(new URL(route.request().url()).origin).toBe(new URL(page.url()).origin);
      const response = await route.fetch({ headers: { ...await route.request().allHeaders(), "sec-fetch-site": "same-origin" } });
      expect(response.status()).toBe(201);
      return route.abort("failed");
    }
    if (attempts.length === 2) return route.fulfill({ status: 429, json: buildApiError({ code: "AUTH_RATE_LIMITED", retryable: true }) });
    return route.continue();
  });
  await page.getByRole("button", { name: "거래 추가", exact: true }).click();
  await page.getByLabel("금액 (원)").fill("1200");
  await page.getByLabel("메모 (선택)").fill("응답 유실 재시도");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("button", { name: "같은 내용으로 재시도" })).toBeVisible();
  await expect(page.getByLabel("금액 (원)")).toBeDisabled();
  await page.getByRole("button", { name: "같은 내용으로 재시도" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("요청이 많아요");
  await expect(page.getByLabel("금액 (원)")).toBeDisabled();
  await page.getByRole("button", { name: "같은 내용으로 재시도" }).click();
  await expect(page.getByRole("row").filter({ hasText: "응답 유실 재시도" })).toHaveCount(1);
  expect(attempts).toHaveLength(3); expect(attempts[1]).toEqual(attempts[0]); expect(attempts[2]).toEqual(attempts[0]);
  for (const [type, amount, memo] of [["income", "10000", "월급 기록"], ["expense", "800", "간식 기록"]]) {
    await page.getByRole("button", { name: "거래 추가", exact: true }).click();
    await page.getByLabel("거래 종류", { exact: true }).selectOption(type!);
    await page.getByLabel("금액 (원)").fill(amount!); await page.getByLabel("메모 (선택)").fill(memo!);
    await page.getByRole("button", { name: "저장하기" }).click();
    await expect(page.getByRole("row").filter({ hasText: memo! })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "월급 기록" })).toBeVisible();
  await page.getByLabel("종류 필터").selectOption("income");
  await page.getByRole("button", { name: "조회하기" }).click();
  await expect(page.getByRole("row").filter({ hasText: "월급 기록" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "간식 기록" })).toHaveCount(0);
  // 작은 페이지로 같은 실제 DB의 keyset 페이지 이동을 브라우저까지 확인한다.
  await page.route("**/api/transactions**", route => { if (route.request().method() !== "GET") return route.continue(); const url = new URL(route.request().url()); url.searchParams.set("limit", "2"); return route.continue({ url: url.href }); });
  await page.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page.getByRole("button", { name: "더 보기" })).toBeVisible();
  await page.getByRole("button", { name: "더 보기" }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(4);
  expect((await new AxeBuilder({ page }).analyze()).violations.map(v => v.id)).toEqual([]);
  for (const width of [1920, 1080, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "output/playwright/transactions-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "계좌", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "거래 테스트 통장" }).getByText("8,000원", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "거래 내역", exact: true }).click();
  await page.getByRole("button", { name: "거래 추가", exact: true }).click();
  await page.getByLabel("금액 (원)").fill("500");
  const archived = await page.evaluate(async () => {
    const { items } = await (await fetch("/api/categories")).json();
    const item = items.find((row: { name: string }) => row.name === "거래 식비");
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    return (await fetch(`/api/categories/${item.id}/archive`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ expectedVersion: item.version }) })).status;
  });
  expect(archived).toBe(200);
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("사용할 수 없어요");
  await expect(page.getByLabel("금액 (원)")).toHaveValue("500");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("heading", { name: "로그아웃했어요" })).toBeVisible();
  await expect(page.getByText("월급 기록")).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("transaction data and draft disappear while identity is revalidated", async ({ page }) => {
  await login(page); await page.goto("/app/transactions");
  await expect(page.getByRole("row").filter({ hasText: "월급 기록" })).toBeVisible();
  await page.getByRole("button", { name: "거래 추가", exact: true }).click();
  await page.getByLabel("메모 (선택)").fill("이전 계정의 미저장 거래");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/me", async route => { await held; await route.fulfill({ json: { id: "22222222-2222-4222-8222-222222222222", email: "second@example.test", emailVerified: true } }); });
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  try {
    await expect(page.getByRole("status")).toContainText("로그인 상태");
    await expect(page.getByLabel("메모 (선택)")).toHaveCount(0);
    await expect(page.getByText("월급 기록")).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "세션을 다시 확인해 주세요" })).toBeVisible();
});
