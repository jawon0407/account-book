import { test, expect } from "@playwright/test";
import { login, startBank, complete, inspectDatabase } from "./support.js";

test.beforeEach(async () => {
  // 테스트 사례 간 quota만 초기화한다. 생성한 폐기용 DB에서만 실행되며 제품에는 노출하지 않는다.
  await inspectDatabase(db => db.query("delete from app_bank.bank_request_limits"));
});

test("PC 연결 전체 경로·HttpOnly proof·암호화 저장·재전송 거부·토큰 비노출", async ({ page, context }) => {
  const bodies: Promise<string>[] = [];
  page.on("response", response => { if (response.url().includes("/api/")) bodies.push(response.text().catch(() => "")); });
  await login(page);
  const { requestId, callback } = await startBank(page);
  const proof = (await context.cookies()).find(cookie => cookie.name === `__Host-ab_bank_proof_${requestId}`);
  expect(proof).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  await page.getByRole("link", { name: "테스트 응답 보내기" }).click();
  await expect(page.getByRole("heading", { name: "마지막 확인이 필요해요" })).toBeVisible();
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(["requestId"]);
  const repeatCallback = await context.request.get(callback, { maxRedirects: 0 });
  expect(repeatCallback.status()).toBe(400);
  const done = page.waitForResponse(r => r.url().endsWith("/api/bank-connections/kftc/complete"));
  await page.getByRole("button", { name: "연결 확인", exact: true }).click();
  expect((await done).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "연결 인증을 완료했어요" })).toBeVisible();
  expect((await context.cookies()).some(c => c.name === proof!.name)).toBe(false);
  // 제거된 쿠키를 테스트 도구로 복원해도 서버 상태 전이가 재교환을 막아야 한다.
  await context.addCookies([proof!]);
  expect(await complete(page, requestId)).toBe(409);
  const saved = await inspectDatabase(async db => (await db.query(`select r.status,
    r.encrypted_code is null as code_removed, c.environment,
    app_bank.valid_token_envelope(c.encrypted_access_token) as access_encrypted,
    app_bank.valid_token_envelope(c.encrypted_refresh_token) as refresh_encrypted,
    c.encrypted_access_token::text like '%synthetic-bank-access-never-public%' as plaintext
    from app_bank.bank_connection_requests r join app_bank.bank_connection_credentials c on c.connection_id=r.connection_id where r.id=$1`, [requestId])).rows);
  expect(saved).toEqual([{ status: "connected", code_removed: true, environment: "fake", access_encrypted: true, refresh_encrypted: true, plaintext: false }]);
  expect((await Promise.all(bodies)).join("\n")).not.toMatch(/synthetic-bank-(?:access|refresh|subject)|e2e-provider-refresh-token/u);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "연결 인증을 완료했어요" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/bank-a5-connected.png", fullPage: true });
});

test("동의 거절은 종료 상태가 되고 연결 자격정보를 만들지 않는다", async ({ page }) => {
  await login(page);
  const { requestId } = await startBank(page, "deny");
  await page.getByRole("link", { name: "테스트 응답 보내기" }).click();
  await expect(page.getByRole("heading", { name: "은행 연결을 완료하지 못했어요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 확인", exact: true })).toHaveCount(0);
  const row = await inspectDatabase(async db => (await db.query("select status, connection_id, encrypted_code from app_bank.bank_connection_requests where id=$1", [requestId])).rows[0]);
  expect(row).toEqual({ status: "failed", connection_id: null, encrypted_code: null });
});

test("다른 로그인 세션은 요청 상태를 읽거나 완료할 수 없다", async ({ page, browser }) => {
  await login(page);
  const { requestId } = await startBank(page);
  await page.getByRole("link", { name: "테스트 응답 보내기" }).click();
  await expect(page.getByRole("heading", { name: "마지막 확인이 필요해요" })).toBeVisible();
  const other = await browser.newContext({ baseURL: "https://127.0.0.1:4512", ignoreHTTPSErrors: true });
  try {
    const second = await other.newPage(); await login(second);
    const status = await second.evaluate(async id => (await fetch(`/api/bank-connections/requests/${id}`)).status, requestId);
    expect(status).toBe(404);
    // proof를 복제해도 DB의 session_id 결속은 우회할 수 없다.
    const proof = (await page.context().cookies()).filter(c => c.name.startsWith("__Host-ab_bank_proof_"));
    await other.addCookies(proof);
    expect(await complete(second, requestId)).toBe(404);
  } finally { await other.close(); }
  await page.getByRole("button", { name: "연결 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "연결 인증을 완료했어요" })).toBeVisible();
});

test("공급자 교환 실패 뒤에는 상태 조회만 하고 연결을 저장하지 않는다", async ({ page }) => {
  await login(page);
  const { requestId } = await startBank(page, "fail");
  await page.getByRole("link", { name: "테스트 응답 보내기" }).click();
  await expect(page.getByRole("heading", { name: "마지막 확인이 필요해요" })).toBeVisible();
  await page.getByRole("button", { name: "연결 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 확인", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "상태 새로고침" }).click();
  await expect(page.getByRole("heading", { name: "은행 연결을 완료하지 못했어요" })).toBeVisible();
  const row = await inspectDatabase(async db => (await db.query("select status, connection_id, encrypted_code from app_bank.bank_connection_requests where id=$1", [requestId])).rows[0]);
  expect(row).toEqual({ status: "failed", connection_id: null, encrypted_code: null });
});

test("동시 완료 두 요청은 하나만 저장하고 만료 코드는 교환하지 않는다", async ({ page }) => {
  await login(page);
  const { requestId } = await startBank(page);
  await page.getByRole("link", { name: "테스트 응답 보내기" }).click();
  await expect(page.getByRole("heading", { name: "마지막 확인이 필요해요" })).toBeVisible();
  expect((await Promise.all([complete(page, requestId), complete(page, requestId)])).sort()).toEqual([200, 409]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "연결 인증을 완료했어요" })).toBeVisible();
  const expired = await startBank(page);
  await page.getByRole("link", { name: "테스트 응답 보내기" }).click();
  await expect(page.getByRole("heading", { name: "마지막 확인이 필요해요" })).toBeVisible();
  await inspectDatabase(db => db.query(`update app_bank.bank_connection_requests set
    created_at=created_at-interval '10 minutes', expires_at=expires_at-interval '10 minutes',
    callback_received_at=callback_received_at-interval '10 minutes', code_expires_at=code_expires_at-interval '10 minutes' where id=$1`, [expired.requestId]));
  expect(await complete(page, expired.requestId)).toBe(409);
  await page.reload();
  await expect(page.getByRole("heading", { name: "연결 시간이 지났어요" })).toBeVisible();
});
