# TASK 14 Authentication E2E Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 UI 여정과 HTTP 응답 계약을 독립된 Playwright 프로젝트로 분리해 보안 증거를 유지하면서 CI의 navigation-response 경합을 제거한다.

**Architecture:** 두 viewport의 Chromium 프로젝트는 사용자 여정, 브라우저 cookie·storage, `/api/me`, logout과 selector replay만 검증한다. 별도 `APIRequestContext` 프로젝트는 화면 이동 없이 공개 로그인 응답, hardened cookie와 동일 세션 폐기를 검증한다. 배포 단계 D2는 별도 호스팅 staging의 필수 출시 게이트로 문서화하되 이번 작업에서는 인프라나 secret을 만들지 않는다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, TypeScript 6.0.3 strict mode, Playwright 1.61.1, Chromium, Next.js 16.2.10 BFF, NestJS 11.1.28/Fastify 5.10.0 API, PostgreSQL 17 disposable CI service, Vitest 4.1.10.

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md`다.
- 프런트엔드와 E2E 코드는 `.ts` 또는 `.tsx`만 사용하고 TypeScript strictness를 낮추지 않는다.
- production에서 `AUTH_ADAPTER_MODE=fake`는 계속 startup 실패해야 한다.
- 운영 코드에 test-only 분기, navigation 억제 flag, response capture hook을 추가하지 않는다.
- `ky` same-origin BFF와 TanStack Query의 기존 애플리케이션 경계는 변경하지 않는다.
- `fullyParallel: false`, `workers: 1`, `retries: 0`, CI server reuse 금지를 유지한다.
- UI는 390x844와 1440x900 두 viewport를 검증하고 HTTP 계약은 한 번만 실행한다.
- secret, password, CSRF token, OAuth code, provider token, cookie 값과 DB URL을 assertion 출력·trace attachment·문서에 남기지 않는다.
- synthetic test credentials만 사용하며 실제 사용자나 운영 데이터를 사용하지 않는다.
- 각 helper에는 행동 원리, 보안 이유, 매개변수와 반환값을 설명하는 짧은 JSDoc을 작성한다.
- PostgreSQL 또는 Chromium 부재를 skip으로 바꾸지 않는다. 로컬 대체 증거는 같은 commit SHA의 GitHub `security-gate` 성공뿐이다.
- D2는 일상 PR gate가 아니지만 실제 운영 출시 전에는 필수다. 이번 계획은 staging 인프라나 OAuth application을 생성하지 않는다.

---

## File Structure

| 경로 | 작업 | 단일 책임 |
|---|---|---|
| `tests/e2e/auth.spec.ts` | Task 1에서 수정, Task 2에서 삭제 | 현재 실패의 RED 재현점이며 이후 `auth-ui.spec.ts`로 이동한다. |
| `tests/e2e/auth-ui.spec.ts` | 생성 | 실제 Chromium UI, accessibility, browser storage/cookie, `/api/me`, logout과 replay만 검증한다. |
| `tests/e2e/auth-response.spec.ts` | 생성 | 독립 `APIRequestContext`로 공개 응답과 HTTP cookie 계약을 검증한다. |
| `tests/e2e/playwright-config.test.ts` | 생성 | UI 두 프로젝트와 HTTP 계약 한 프로젝트의 분리 정책을 고정한다. |
| `tests/e2e/playwright.config.ts` | 수정 | 파일별 Playwright project routing을 소유한다. |
| `tests/e2e/package.json` | 수정 | production fake startup과 Playwright config policy를 browser 실행 전에 검증한다. |
| `docs/guides/security-auth-testing.md` | 수정 | TASK 14 RED/GREEN, 명령, test 수, commit SHA, CI URL과 D2 blocker를 한국어/영어로 기록한다. |
| `docs/architecture/backend-authentication.ko.md` | 수정 | 인증 기반 진행 상태와 E2E 경계 책임을 한국어로 갱신한다. |
| `docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md` | 수정 | 동일 SHA CI가 통과한 뒤 상태를 구현·검증 완료로 바꾼다. |

---

### Task 1: 브라우저 테스트를 사용자 여정에만 한정

**Files:**
- Modify: `tests/e2e/auth.spec.ts`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: 기존 `Page`, `BrowserContext`, 실제 BFF/API, fake IDP, 일회용 PostgreSQL과 `__Host-ab_session` cookie.
- Produces: navigation 중 response body를 읽지 않는 browser-only 인증 보안 여정. Task 2가 파일 내용을 `auth-ui.spec.ts`로 그대로 이동한다.

- [ ] **Step 1: 현재 실패를 RED로 재현하고 증거를 보존**

동일한 disposable DB 환경에서 현재 테스트를 수정하지 않고 실행한다.

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e exec playwright test --config playwright.config.ts
```

Expected: exit 1. 실패에는 `Network.getResponseBody: No resource with given identifier found`와 strict locator가 app alert 및 Next route announcer 두 요소를 찾았다는 내용이 포함된다. 원문 response, cookie, password와 connection string은 작업 기록에 복사하지 않는다. 로컬 PostgreSQL을 사용할 수 없으면 기존 GitHub run `29970158952`, commit `835dbc9`를 RED 증거로 사용하고 로컬 성공으로 기록하지 않는다.

- [ ] **Step 2: 민감값을 출력하지 않는 browser storage 검사로 축소**

`expectTokenFreeStorage`와 민감값 판별 helper를 다음 형태로 바꾼다. assertion 실패가 storage value 전체를 출력하지 않게 boolean만 비교한다.

```ts
/**
 * Detects credential-like material without returning or logging the matched value.
 * @param serialized - Browser state serialized only inside the current test process.
 * @returns True when a provider sentinel, token label, or compact JWT shape is present.
 */
function containsCredentialMaterial(serialized: string): boolean {
  return serialized.includes(providerRefreshToken)
    || /access.?token|refresh.?token/iu.test(serialized)
    || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(serialized);
}

/**
 * Verifies that the browser persists no application credential state.
 * @param page - Active authenticated or unauthenticated browser page.
 */
async function expectTokenFreeStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(storage.local.map(([key]) => key)).toEqual([]);
  for (const [key] of storage.session) {
    expect(key).toMatch(/^__next_debug_channel:[A-Za-z0-9_-]+$/u);
  }
  expect(containsCredentialMaterial(JSON.stringify(storage)), "browser storage must not contain credential material").toBe(false);
}
```

- [ ] **Step 3: response body 소유권을 browser test에서 제거**

`authResponse` helper를 삭제한다. 실패 로그인에서는 status만 기다리고 성공 로그인에서는 URL 이동을 성공 조건으로 사용한다.

```ts
test("failed login stays fixed and never creates browser token state", async ({ page, context }) => {
  await page.goto("/login");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(`${password}!wrong`);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in"));
  await page.locator('button[type="submit"]').first().click();
  expect((await responsePromise).status()).toBe(401);
  await expect(page.locator('.auth-status[role="alert"]')).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);
  await expectTokenFreeStorage(page);
});
```

성공 테스트의 시작 부분은 다음처럼 response body 대신 최종 URL을 기다린다.

```ts
await page.goto("/login");
await page.locator("#sign-in-email").fill(email);
await page.locator("#sign-in-password").fill(password);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL("**/app");
```

- [ ] **Step 4: cookie assertion을 안전한 공개 metadata로 제한**

cookie value가 assertion diff에 노출되지 않도록 metadata와 selector 형식 검사를 분리한다.

```ts
const cookies = await context.cookies();
expect(cookies.map(({ httpOnly, name, path, sameSite, secure }) => ({ httpOnly, name, path, sameSite, secure }))).toEqual([
  {
    httpOnly: true,
    name: "__Host-ab_session",
    path: "/",
    sameSite: "Lax",
    secure: true,
  },
]);
const sessionSelector = cookies[0]?.value;
expect(/^[A-Za-z0-9_-]{43}$/u.test(sessionSelector ?? ""), "session selector must use the opaque fixed-length format").toBe(true);
```

기존 `/api/me`, browser `Authorization` header 부재, logout, cookie 제거와 selector replay 401 검사는 유지한다. replay assertion 실패 시 selector를 message에 넣지 않는다.

- [ ] **Step 5: focused GREEN 검증**

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e exec playwright test --config playwright.config.ts
pnpm --filter @account-book/e2e typecheck
```

Expected: mobile과 desktop의 accessibility, failed login, successful login 테스트가 모두 PASS하고 typecheck exit 0. 로그에 response body, cookie value와 credential이 없어야 한다.

- [ ] **Step 6: Task 1 커밋**

```powershell
git add -- tests/e2e/auth.spec.ts
git diff --cached --check
git commit -m "test: isolate authentication browser journey"
```

---

### Task 2: HTTP 응답 계약과 Playwright 프로젝트 분리

**Files:**
- Create: `tests/e2e/auth-ui.spec.ts`
- Create: `tests/e2e/auth-response.spec.ts`
- Create: `tests/e2e/playwright-config.test.ts`
- Modify: `tests/e2e/playwright.config.ts`
- Modify: `tests/e2e/package.json`
- Delete: `tests/e2e/auth.spec.ts`
- Test: `tests/e2e/playwright-config.test.ts`
- Test: `tests/e2e/auth-response.spec.ts`

**Interfaces:**
- Consumes: Task 1의 browser-only spec, `APIRequestContext`, `GET /api/auth/csrf`, `POST /api/auth/sign-in`, `GET /api/me`, `POST /api/auth/sign-out`.
- Produces: `ui-mobile-390x844`, `ui-desktop-1440x900`, `http-contract` Playwright projects와 독립 cookie jar 기반 응답 계약.

- [ ] **Step 1: 프로젝트 분리 정책 테스트 작성**

`tests/e2e/playwright-config.test.ts`를 생성한다.

```ts
import assert from "node:assert/strict";
import test from "node:test";

test("routes browser journeys and HTTP contracts to separate Playwright projects", async () => {
  process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
  process.env.TEST_DATABASE_DISPOSABLE = "true";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { default: config } = await import("./playwright.config.js");
  const projects = new Map((config.projects ?? []).map((project) => [project.name, project]));

  assert.deepEqual([...projects.keys()].sort(), ["http-contract", "ui-desktop-1440x900", "ui-mobile-390x844"]);
  assert.equal(projects.get("ui-mobile-390x844")?.testMatch, "auth-ui.spec.ts");
  assert.equal(projects.get("ui-desktop-1440x900")?.testMatch, "auth-ui.spec.ts");
  assert.equal(projects.get("http-contract")?.testMatch, "auth-response.spec.ts");
  assert.equal(config.fullyParallel, false);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
});
```

`tests/e2e/package.json`의 test script가 두 Node 보안 테스트를 먼저 실행하도록 변경한다.

```json
"test": "tsx --test production-fake-startup.test.ts playwright-config.test.ts && playwright test --config playwright.config.ts"
```

- [ ] **Step 2: 설정 정책 RED 확인**

```powershell
pnpm --filter @account-book/e2e exec tsx --test playwright-config.test.ts
```

Expected: assertion FAIL. 현재 설정에는 `mobile-390x844`, `desktop-1440x900` 두 project만 있고 전역 `testMatch: "auth.spec.ts"`를 사용한다. import·syntax·환경 오류는 유효한 RED가 아니며 먼저 고친 뒤 project assertion 실패를 확인한다.

- [ ] **Step 3: UI 파일 이동과 project routing 구현**

Task 1의 `tests/e2e/auth.spec.ts` 전체 내용을 `tests/e2e/auth-ui.spec.ts`로 이동하고 원본을 삭제한다. `tests/e2e/playwright.config.ts`에서 전역 `testMatch`를 제거하고 projects를 다음처럼 바꾼다.

```ts
projects: [
  {
    name: "ui-mobile-390x844",
    testMatch: "auth-ui.spec.ts",
    use: { viewport: { width: 390, height: 844 } },
  },
  {
    name: "ui-desktop-1440x900",
    testMatch: "auth-ui.spec.ts",
    use: { viewport: { width: 1440, height: 900 } },
  },
  {
    name: "http-contract",
    testMatch: "auth-response.spec.ts",
  },
],
```

다른 `use`, webServer, timeout, runner 안전 설정은 변경하지 않는다.

- [ ] **Step 4: 안전한 HTTP contract client 구현**

`tests/e2e/auth-response.spec.ts`를 생성한다. helper는 response나 cookie 값을 출력하지 않고 상태와 boolean만 assertion한다.

```ts
import { expect, request as requestFactory, test, type APIRequestContext } from "@playwright/test";

const origin = "https://127.0.0.1:4512";
const email = "verified@example.test";
const password = "correct horse battery staple";
const userId = "123e4567-e89b-42d3-a456-426614174001";
const providerRefreshToken = "e2e-provider-refresh-token-must-never-reach-browser";

/**
 * Detects credential material without exposing the received body in an assertion diff.
 * @param value - An HTTP response body held only for the current assertion.
 * @param forbidden - Synthetic credential values that must never cross the BFF boundary.
 * @returns True when a forbidden value, token label, or compact JWT shape is present.
 */
function containsCredentialMaterial(value: string, forbidden: readonly string[] = []): boolean {
  return forbidden.some((secret) => value.includes(secret))
    || /access.?token|refresh.?token/iu.test(value)
    || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(value);
}

/**
 * Fetches a selector-bound CSRF token into process memory for one immediate mutation.
 * @param api - Isolated Playwright request context that owns its cookie jar.
 * @param context - Optional server-side selector context required by logout.
 * @returns The short-lived CSRF token without logging or persisting it.
 */
async function csrfToken(api: APIRequestContext, context?: "session"): Promise<string> {
  const suffix = context === "session" ? "?context=session" : "";
  const response = await api.get(`/api/auth/csrf${suffix}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as unknown;
  expect(body !== null && typeof body === "object" && typeof (body as { csrfToken?: unknown }).csrfToken === "string").toBe(true);
  return (body as { csrfToken: string }).csrfToken;
}

/**
 * Builds the exact same-origin Fetch Metadata boundary accepted for JSON mutations.
 * @param token - Fresh CSRF token bound to the request context's current selector.
 * @returns Immutable headers for one authenticated or pre-auth mutation.
 */
function mutationHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Accept: "application/json",
    Origin: origin,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": token,
  };
}

/**
 * Attempts local session revocation during cleanup without replacing the primary test failure.
 * @param api - Request context whose cookie jar may contain an authenticated session.
 */
async function bestEffortSignOut(api: APIRequestContext): Promise<void> {
  try {
    const token = await csrfToken(api, "session");
    await api.post("/api/auth/sign-out", { data: {}, headers: mutationHeaders(token) });
  } catch {
    // The disposable database is the final containment boundary when cleanup cannot reach the server.
  }
}

test("failed login returns a fixed public error without creating a session", async () => {
  const api = await requestFactory.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const token = await csrfToken(api);
    const response = await api.post("/api/auth/sign-in", {
      data: { email, password: `${password}!wrong` },
      headers: mutationHeaders(token),
    });
    expect(response.status()).toBe(401);
    const text = await response.text();
    expect(containsCredentialMaterial(text, [email, password, providerRefreshToken]), "failure response must not disclose credential material").toBe(false);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "fieldErrors", "message", "requestId", "retryable"]);
    expect(body.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(body.retryable).toBe(false);
    const cookieNames = (await api.storageState()).cookies.map((cookie) => cookie.name);
    expect(cookieNames.includes("__Host-ab_session")).toBe(false);
  } finally {
    await api.dispose();
  }
});

test("successful login exposes only the public session contract and revokes the opaque selector", async () => {
  const api = await requestFactory.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  let signedOut = false;
  try {
    const token = await csrfToken(api);
    const response = await api.post("/api/auth/sign-in", {
      data: { email, password },
      headers: mutationHeaders(token),
    });
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(containsCredentialMaterial(text, [providerRefreshToken]), "success response must not disclose credential material").toBe(false);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["absoluteExpiresAt", "expiresAt", "user"]);

    const cookies = (await api.storageState()).cookies;
    expect(cookies.map(({ httpOnly, name, path, sameSite, secure }) => ({ httpOnly, name, path, sameSite, secure }))).toEqual([
      { httpOnly: true, name: "__Host-ab_session", path: "/", sameSite: "Lax", secure: true },
    ]);
    const selector = cookies[0]?.value;
    expect(/^[A-Za-z0-9_-]{43}$/u.test(selector ?? ""), "session selector must use the opaque fixed-length format").toBe(true);

    const me = await api.get("/api/me");
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ email: null, emailVerified: true, id: userId });

    const logoutToken = await csrfToken(api, "session");
    const logout = await api.post("/api/auth/sign-out", { data: {}, headers: mutationHeaders(logoutToken) });
    expect(logout.status()).toBe(200);
    expect(await logout.json()).toEqual({ signedOut: true });
    signedOut = true;
    expect((await api.storageState()).cookies.some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);

    const replay = await requestFactory.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Cookie: `__Host-ab_session=${selector ?? ""}` },
      ignoreHTTPSErrors: true,
    });
    try {
      expect((await replay.get("/api/me")).status()).toBe(401);
    } finally {
      await replay.dispose();
    }
  } finally {
    if (!signedOut) await bestEffortSignOut(api);
    await api.dispose();
  }
});
```

- [ ] **Step 5: policy GREEN과 focused E2E 검증**

```powershell
pnpm --filter @account-book/e2e exec tsx --test playwright-config.test.ts
pnpm --filter @account-book/e2e typecheck
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e exec playwright test --config playwright.config.ts --project http-contract
pnpm --filter @account-book/e2e exec playwright test --config playwright.config.ts --project ui-mobile-390x844 --project ui-desktop-1440x900
```

Expected: config policy 1/1 PASS, typecheck exit 0, HTTP contract 2/2 PASS, UI 두 project PASS. 실패 trace를 외부 artifact로 업로드하지 않고 raw response/cookie를 출력하지 않는다.

- [ ] **Step 6: Task 2 커밋**

```powershell
git add -- tests/e2e/package.json tests/e2e/playwright.config.ts tests/e2e/playwright-config.test.ts tests/e2e/auth-ui.spec.ts tests/e2e/auth-response.spec.ts tests/e2e/auth.spec.ts
git diff --cached --check
git commit -m "test: separate authentication response contract"
```

---

### Task 3: 전체 보안 게이트와 한국어 증거 문서 확정

**Files:**
- Modify: `docs/guides/security-auth-testing.md`
- Modify: `docs/architecture/backend-authentication.ko.md`
- Modify: `docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md`

**Interfaces:**
- Consumes: Task 1·2 commit SHA, 로컬 검증 출력, GitHub `security-gate` run URL과 결과.
- Produces: 같은 SHA에 연결된 TASK 14 보안 증거와 D2 출시 blocker, TASK 15 진입 여부.

- [ ] **Step 1: 전체 로컬 검증 실행**

```powershell
pnpm setup:hooks
pnpm run verify
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm test:db
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e test
pnpm audit --prod --audit-level high
git diff --check
git status --short --branch
```

Expected: verify, DB, E2E, audit와 diff check exit 0. 각 suite의 실제 pass 수를 기록하고 예상 숫자로 대체하지 않는다. 로컬 PostgreSQL이 없다면 DB/E2E를 성공으로 표시하지 않고 Step 2의 같은 SHA CI로만 대체한다.

- [ ] **Step 2: 코드 SHA를 push하고 동일 SHA CI 확인**

```powershell
$codeSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$run = gh run list --branch feature/security-auth-foundation --workflow security-gate --limit 1 --json databaseId,headSha,url | ConvertFrom-Json
if ($run.headSha -ne $codeSha) { throw 'The newest security-gate run does not target the code commit.' }
gh run watch $run.databaseId --exit-status
```

Expected: GitHub run head SHA가 `$codeSha`와 일치하고 `security-gate`가 success로 종료한다. 실패하면 성공으로 문서화하지 말고 `superpowers:systematic-debugging`을 사용해 해당 실패를 새 RED로 조사한다.

- [ ] **Step 3: RED/GREEN과 D2 blocker를 문서화**

`docs/guides/security-auth-testing.md`에 다음 내용을 기록한다. SHA와 URL은 Step 2의 `$codeSha`, `$run.url` 값을 그대로 사용하고 pass 수는 Step 1과 GitHub job output에서 관찰한 실제 수를 사용한다.

```markdown
## TASK 14 — 인증 E2E 경계 안정화

- RED: commit `835dbc9`, GitHub run `29970158952`; UI alert selector collision과 navigation 중 response body 소실로 실패했다. 민감 응답 원문은 기록하지 않았다.
- 책임 분리: Chromium은 사용자 여정·browser state를, `APIRequestContext`는 공개 응답·cookie 계약을 소유한다.
- D2: 별도 hosted staging, 실제 TLS와 Google·Kakao·Naver credential이 준비되지 않아 `미실행—운영 출시 차단`이다. production fake adapter는 계속 금지한다.
```

RED 줄 다음에는 `GREEN:` 줄을 한 줄 추가해 code commit SHA, GitHub run URL, config policy, UI, HTTP contract, DB와 전체 workspace의 실제 pass 수를 기록한다. 값이 관찰되지 않은 suite는 성공 숫자를 추정하지 않고 `로컬 미실행—같은 SHA CI로 대체`처럼 증거 출처를 기록한다.

같은 절을 영어로 짧게 이어서 작성하되 숫자와 SHA는 한국어 절과 일치시킨다. 미래 값을 나타내는 꺾쇠 표식은 실제 문서에 남기지 않는다.

`docs/architecture/backend-authentication.ko.md`의 진행 상태를 다음 의미로 갱신한다.

```markdown
| 구현됨 | Task 14의 browser UI·HTTP response contract 분리, exact app alert 선택자, token-free storage, opaque cookie와 logout selector replay의 동일 SHA CI 증거 |
| 출시 전 필수 | 운영과 분리된 hosted staging D2에서 실제 Google·Kakao·Naver, TLS·redirect·cookie·로그 비노출 smoke |
```

`docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md`의 상태는 `구현 완료, 동일 SHA CI 검증 완료`로 바꾼다. Step 2 CI가 실패했으면 상태를 바꾸지 않는다.

- [ ] **Step 4: 문서 self-check와 커밋**

```powershell
rg -n 'TBD|TODO|FIXME|추후 결정|나중에 결정' docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md
git diff --check
git add -- docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md
git diff --cached --check
git commit -m "docs: record authentication E2E evidence"
```

Expected: `rg`는 unresolved placeholder를 찾지 않아 exit 1, 두 diff check는 출력 없이 exit 0, 문서 commit이 생성된다.

- [ ] **Step 5: 최종 SHA push와 최종 CI 확인**

```powershell
$finalSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$finalRun = gh run list --branch feature/security-auth-foundation --workflow security-gate --limit 1 --json databaseId,headSha,url | ConvertFrom-Json
if ($finalRun.headSha -ne $finalSha) { throw 'The newest security-gate run does not target the final documentation commit.' }
gh run watch $finalRun.databaseId --exit-status
git status --short --branch
```

Expected: 최종 run head SHA가 `$finalSha`와 일치하고 `security-gate` success. 작업 트리는 clean이고 branch는 origin과 동기화된다. D2가 아직 미실행이면 TASK 14 자동 검증은 완료할 수 있지만 운영 출시는 계속 차단한다.

- [ ] **Step 6: TASK 15 진입 전 승인 보고**

최종 보고에는 다음만 포함한다.

- 최종 commit SHA와 GitHub run URL
- 실제 검증 명령과 pass/fail 수
- A안 구현 결과
- D2 미실행 여부와 운영 출시 blocker
- TASK 15 범위에 대한 다방면 대안·장단점·추천안

TASK 15는 사용자 승인 전 시작하지 않는다.

---

## Plan Self-Review Record

- Spec coverage: A안의 browser UI, HTTP contract, exact alert, safe evidence, logout/replay, three-project routing과 D2 출시 경계를 Task 1~3에 모두 매핑했다.
- Scope: 운영 코드, 인증 기능, dependency, workflow 권한, staging 인프라와 관리자 페이지 변경을 제외했다.
- TDD: Task 1은 같은 실제 증상을 가진 existing CI failure를 RED로 사용하고, Task 2는 project topology assertion을 새 RED로 사용한다. import·환경 오류는 RED로 인정하지 않는다.
- Type consistency: `APIRequestContext`, `csrfToken`, `mutationHeaders`, `bestEffortSignOut`, project 이름과 spec 파일명이 모든 단계에서 일치한다.
- Secret safety: response와 cookie 값은 boolean·metadata assertion으로 축소하고 trace를 공개 artifact로 올리지 않는다.
- No placeholders: 미래 값을 꺾쇠 표식으로 남기지 않고 실행 중 수집한 SHA, run URL과 pass count의 출처를 명시했다.
