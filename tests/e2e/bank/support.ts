import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
export { inspectBankE2eDatabase as inspectDatabase } from "../../database/support/bank-e2e-database.js";

/** @param page 별도 브라우저 세션. 실제 BFF 로그인과 DB 세션 생성을 통과한다. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill("verified@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 계좌", exact: true })).toBeVisible();
}

/**
 * @param page 실제 앱 브라우저. @param outcome 외부 공급자만 합성할 응답 종류.
 * @returns 실제 BFF가 생성한 요청 ID와 합성 은행 Callback URL.
 */
export async function startBank(page: Page, outcome: "ok" | "fail" | "deny" = "ok") {
  let callback = "";
  const previousCookies = new Set((await page.context().cookies()).map(cookie => cookie.name));
  await page.unroute("https://bank.invalid/authorize?*");
  await page.route("https://bank.invalid/authorize?*", async route => {
    const state = new URL(route.request().url()).searchParams.get("state")!;
    const params = new URLSearchParams({ state, [outcome === "deny" ? "error" : "code"]: outcome === "deny" ? "access_denied" : `${outcome}-${randomUUID()}` });
    callback = `http://127.0.0.1:4511/v1/bank-connections/kftc/callback?${params}`;
    // 실제 금융결제원 페이지로 오인하지 않도록 테스트 대역임을 표시한다.
    await route.fulfill({ contentType: "text/html; charset=utf-8", headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      body: `<html lang="ko"><title>합성 은행 테스트</title><h1>가짜 은행 동의 화면</h1><a href="${callback.replaceAll("&", "&amp;")}">테스트 응답 보내기</a></html>` });
  });
  await page.goto("/app/bank-connections");
  const response = page.waitForResponse(r => r.url().endsWith("/api/bank-connections/kftc/start"));
  await page.getByRole("button", { name: "은행 연결 시작", exact: true }).click();
  const started = await response;
  expect(started.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "가짜 은행 동의 화면" })).toBeVisible();
  // 외부 origin으로 즉시 이동하면 Chromium이 이전 응답 본문을 폐기한다. 서버가 설정한 새 쿠키의 ID를 관찰한다.
  const proof = (await page.context().cookies()).find(cookie => cookie.name.startsWith("__Host-ab_bank_proof_") && !previousCookies.has(cookie.name));
  expect(proof).toBeDefined();
  const requestId = proof!.name.slice("__Host-ab_bank_proof_".length);
  return { requestId, callback };
}

/** @param page 앱 origin에 있는 브라우저. @param requestId 완료할 실제 요청 ID. CSRF를 새로 얻어 전송한다. */
export async function complete(page: Page, requestId: string): Promise<number> {
  return page.evaluate(async id => {
    const { csrfToken } = await (await fetch("/api/auth/csrf", { cache: "no-store" })).json();
    return (await fetch("/api/bank-connections/kftc/complete", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ requestId: id }) })).status;
  }, requestId);
}
