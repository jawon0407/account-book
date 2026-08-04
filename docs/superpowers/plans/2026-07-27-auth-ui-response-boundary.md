# Auth UI Response Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI 인증 E2E가 응답 객체·HTTP status·본문을 관찰하지 못하게 하고, HTTP 계약 프로젝트가 상태·본문·CSRF·로그아웃·selector replay 검증을 독점하도록 M1의 마지막 보안 경계를 닫는다.

**Architecture:** 기존 TypeScript `Response` declaration provenance 분석기를 제거하고 `tests/e2e/ui/`에 적용되는 폐쇄형 네트워크 capability 정책으로 교체한다. 정책은 canonical realpath로 import graph를 제한하고, 승인된 import·navigation·request recorder·함수형 `page.evaluate`만 허용한다. UI와 HTTP 계약은 별도 Playwright project와 별도 spec으로 유지한다.

**Tech Stack:** TypeScript 6.0.3, Node.js 22.15.1, Playwright 1.61.1, Node test runner, pnpm 11.9.0, GitHub Actions PostgreSQL 17/Chromium

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md`이며 구현이 설계를 완화해서는 안 된다.
- UI 소유 코드는 `tests/e2e/ui/` 안의 `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`만 허용한다.
- 로컬 import는 canonical realpath 기준 UI root 안에 있어야 하며 symlink·Windows reparse-point 탈출은 즉시 실패한다.
- UI 외부 import는 `@playwright/test`의 named `test`, `expect`, type `Page`와 `@axe-core/playwright`의 named `AxeBuilder`만 허용한다. namespace/default/dynamic import와 `require()`는 금지한다.
- UI는 화면·접근성·키보드·URL 이동·cookie 공개 metadata/형식·token-free browser storage·browser Authorization 부재만 검증한다.
- HTTP 계약은 status·body·CSRF·로그아웃·폐기 selector replay·원문/중첩 credential 비노출을 독점한다.
- `page.goto`, `reload`, `goBack`, `goForward` 반환값은 직접 `await`한 expression statement에서 즉시 폐기해야 한다.
- 이벤트는 named function expression `authorizationRecorder`를 사용하는 정확한 `page.on("request", function authorizationRecorder(...) {})`만 허용한다. header value는 즉시 boolean promise로 축약하고 원문을 assertion·로그·artifact에 전달하지 않는다.
- `page.evaluate`는 함수 또는 arrow-function AST만 허용하고 그 AST도 동일한 금지 기능 검사를 통과해야 한다. 다른 browser execution과 script/HTML injection은 금지한다.
- 정책 진단은 고정 `category`와 `capability`만 포함한다. path, URL, source expression, header, cookie, body와 secret을 포함하지 않는다.
- Playwright trace는 `off`, `workers`는 `1`, `fullyParallel`은 `false`, `retries`는 `0`을 유지한다.
- production application code, dependency와 `/app` 화면은 이번 보안 패치에서 추가·변경하지 않는다. 성공 UI 증거는 browser-visible `/app` URL 이동과 hardened cookie/browser state다.
- 모든 새 함수와 타입에는 행동 원리와 매개변수를 설명하는 간결한 JSDoc을 작성한다.
- 로컬 Node는 24.14.0이고 PostgreSQL이 없으므로 Node 22/PostgreSQL/Chromium 권위 증거는 최종 커밋과 동일 SHA의 GitHub `security-gate`에서 얻는다.
- hosted Google·Kakao·Naver와 실제 TLS를 검증하는 D2는 독립적인 production release blocker로 유지한다.

---

### Task 1: Response 타입 분석기를 폐쇄형 UI 네트워크 경계로 교체

**Files:**
- Create: `tests/e2e/ui-network-boundary.ts`
- Create: `tests/e2e/ui-network-boundary.test.ts`
- Modify: `tests/e2e/package.json`
- Modify: `scripts/workspace-policy.test.mjs`
- Modify: `tests/e2e/playwright-config.test.ts`
- Delete: `tests/e2e/response-body-ownership.ts`
- Delete: `tests/e2e/fixtures/response-body-ownership/dom-bytes-body-read.ts`
- Delete: `tests/e2e/fixtures/response-body-ownership/imported-helper-root.ts`
- Delete: `tests/e2e/fixtures/response-body-ownership/local-body-reader.ts`
- Delete: `tests/e2e/fixtures/response-body-ownership/playwright-api-response-body-read.ts`
- Delete: `tests/e2e/fixtures/response-body-ownership/playwright-response-body-read.ts`

**Interfaces:**
- Consumes: filesystem root, one UI spec root, TypeScript parser, exact import and capability allowlists.
- Produces:

```ts
export type UiNetworkCapability =
  | "boundary-escape"
  | "unsupported-extension"
  | "dynamic-import"
  | "unapproved-external-import"
  | "unapproved-playwright-import"
  | "direct-http-client"
  | "response-type"
  | "response-consumption"
  | "http-status"
  | "response-event"
  | "request-response"
  | "request-context"
  | "dynamic-code"
  | "script-injection"
  | "navigation-response"
  | "unapproved-request-observer";

export type UiNetworkBoundaryViolation = Readonly<{
  category: "boundary" | "import" | "network" | "response" | "event" | "execution" | "navigation";
  capability: UiNetworkCapability;
}>;

export type UiNetworkBoundaryOptions = Readonly<{
  rootDirectory: string;
  rootFile: string;
}>;

export function findUiNetworkBoundaryViolations(
  options: UiNetworkBoundaryOptions,
): readonly UiNetworkBoundaryViolation[];
```

- The returned array is deduplicated by `category/capability`, sorted by those fixed labels, and never contains source-derived text.

- [ ] **Step 1: RED mutation fixture helper와 정책 테스트 작성**

`tests/e2e/ui-network-boundary.test.ts`에 임시 UI root를 만들고 종료 시 제거하는 helper를 작성한다. 테스트 데이터는 synthetic token이나 URL을 넣지 않고 고정된 코드 조각만 사용한다.

```ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findUiNetworkBoundaryViolations,
  type UiNetworkBoundaryViolation,
} from "./ui-network-boundary.js";

type FixtureFiles = Readonly<Record<string, string>>;

/**
 * Creates one disposable UI import graph and removes it after the assertion.
 * @param files - Root-relative source files that form the mutation graph.
 * @param run - Assertion that receives canonical root and entry paths.
 */
function withUiFixture(
  files: FixtureFiles,
  run: (fixture: Readonly<{ rootDirectory: string; rootFile: string }>) => void,
): void {
  const parent = mkdtempSync(path.join(tmpdir(), "account-book-ui-boundary-"));
  const rootDirectory = path.join(parent, "ui");
  mkdirSync(rootDirectory, { recursive: true });
  try {
    for (const [relative, source] of Object.entries(files)) {
      const target = path.join(rootDirectory, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, "utf8");
    }
    run({ rootDirectory, rootFile: path.join(rootDirectory, "auth-ui.spec.ts") });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

function violation(
  category: UiNetworkBoundaryViolation["category"],
  capability: UiNetworkBoundaryViolation["capability"],
): readonly UiNetworkBoundaryViolation[] {
  return [{ category, capability }];
}
```

다음 mutation을 각각 이름 있는 `node:test`로 고정한다.

- external import: `ky`, `node:http`, Playwright `request`, `APIRequestContext`, `APIResponse`, `Response`, namespace/default import.
- graph: root 밖 helper, junction/symlink escape, `.json`/미지원 확장자, `import()`, `require`, non-static specifier.
- direct network: `fetch`, `XMLHttpRequest`, `page.request`, `context.request`, `Request.response()`.
- body/status: dot/bracket/computed/optional `json`, `text`, `body`, `arrayBuffer`, `blob`, `bytes`, `formData`, `status`.
- type hiding: `Pick<Response, "text">`, alias, parameter destructuring, assignment destructuring, imported helper.
- events: `waitForResponse`, `waitForEvent("response")`, `on`, `once`, `addListener`, `prependListener`, `prependOnceListener`, dynamic event name.
- execution: string `page.evaluate`, function형 `page.evaluate` 내부 `fetch`, `evaluateHandle`, `waitForFunction`, `addInitScript`, `addScriptTag`, `setContent`, `eval`, `Function`.
- navigation: `goto/reload/goBack/goForward` result assignment, return, argument passing, chaining and method alias.
- guards: direct awaited navigation discard, exact named `authorizationRecorder`, function/arrow `page.evaluate`로 DOM width/storage만 읽는 코드는 `[]`.

junction/reparse mutation은 UI root 안의 `escape` directory link가 root 밖의 helper directory를 가리키게 만든 뒤 `./escape/helper.js`를 import한다. Windows에서는 `symlinkSync(outside, link, "junction")`, 그 외 플랫폼에서는 directory symlink를 사용한다.

- [ ] **Step 2: 정책 테스트가 RED인지 확인**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-network-boundary.test.ts
```

Expected: exit `1`. `ui-network-boundary.js`가 아직 없거나 mutation이 빈 배열로 판정되어 실패한다. 출력에는 synthetic credential, path 원문이나 source expression이 없어야 한다.

- [ ] **Step 3: 고정 진단과 canonical import graph 구현**

`tests/e2e/ui-network-boundary.ts`는 다음 순서로 구현한다.

1. `realpathSync.native`로 `rootDirectory`와 `rootFile`을 canonicalize한다.
2. `path.relative(canonicalRoot, canonicalTarget)`가 `..`로 시작하거나 absolute면 `boundary/boundary-escape`를 추가한다.
3. 지원 확장자만 `ts.createSourceFile`의 올바른 `ScriptKind`로 파싱한다.
4. static import/export는 `ts.resolveModuleName`으로 해석하고 local target을 canonicalize한 뒤 재귀 방문한다.
5. 외부 module은 module name과 named import symbol을 exact allowlist로 검사한다.
6. AST visitor는 금지 identifier, type reference, property/member access, computed property, destructuring과 실행 API를 출처에 상관없이 fail-closed로 판정한다.
7. `page.goto/reload/goBack/goForward`는 `AwaitExpression -> ExpressionStatement` 형태이고 반환값을 다른 식이 사용하지 않을 때만 허용한다.
8. 이벤트 구독은 `page.on("request", function authorizationRecorder(request) { ... })`와 그 함수 안의 `request.headerValue("authorization").then(...)` boolean 축약만 허용한다.
9. `page.evaluate`는 string이 아닌 function/arrow AST만 허용하고 해당 함수 body도 같은 visitor로 검사한다.
10. findings는 고정 enum만 deduplicate/sort하여 반환한다.

금지 computed property가 compile-time string literal union으로 확정되지 않으면 fixed `response-consumption`, `response-event` 또는 해당 capability로 실패한다. 진단 생성 helper는 다음처럼 source node를 보관하지 않는다.

```ts
function addViolation(
  findings: UiNetworkBoundaryViolation[],
  category: UiNetworkBoundaryViolation["category"],
  capability: UiNetworkCapability,
): void {
  if (!findings.some((item) => item.category === category && item.capability === capability)) {
    findings.push({ category, capability });
  }
}
```

- [ ] **Step 4: 새 정책을 GREEN으로 만들고 실제 현재 UI의 RED를 고정**

새 mutation suite는 모두 GREEN이어야 한다. 실제 현재 `tests/e2e/auth-ui.spec.ts`를 임시 legacy root로 검사하는 테스트는 다음 두 fixed finding을 기대해 현재 구현이 왜 Task 2에서 바뀌어야 하는지 고정한다.

```ts
assert.deepEqual(
  findUiNetworkBoundaryViolations({
    rootDirectory: fileURLToPath(new URL(".", import.meta.url)),
    rootFile: fileURLToPath(new URL("./auth-ui.spec.ts", import.meta.url)),
  }),
  [
    { category: "network", capability: "direct-http-client" },
    { category: "response", capability: "response-event" },
    { category: "event", capability: "unapproved-request-observer" },
  ],
);
```

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-network-boundary.test.ts
```

Expected: all mutation tests PASS and the current legacy UI produces only the two fixed capability findings.

- [ ] **Step 5: 구형 analyzer를 제거하고 preflight를 새 정책으로 연결**

`tests/e2e/playwright-config.test.ts`에서 `response-body-ownership.js` import와 기존 provenance mutation tests를 제거한다. project routing/trace test는 유지한다.

`tests/e2e/package.json`:

```json
"test:preflight": "tsx --test production-fake-startup.test.ts playwright-environment.test.ts playwright-config.test.ts auth-response-policy.test.ts ui-network-boundary.test.ts"
```

`scripts/workspace-policy.test.mjs`의 exact expected string도 동일하게 바꾼다. 구형 analyzer와 fixture 다섯 개는 새 mutation suite가 GREEN인 뒤 삭제한다.

- [ ] **Step 6: Task 1 focused 검증**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-network-boundary.test.ts playwright-config.test.ts auth-response-policy.test.ts
pnpm --filter @account-book/e2e test:preflight
pnpm --filter @account-book/e2e typecheck
node --test scripts/workspace-policy.test.mjs
git diff --check
```

Expected: 모두 exit `0`. 정책 failure output에는 고정 category/capability만 나타난다.

- [ ] **Step 7: Task 1 커밋**

```powershell
git add -- tests/e2e/ui-network-boundary.ts tests/e2e/ui-network-boundary.test.ts tests/e2e/package.json tests/e2e/playwright-config.test.ts scripts/workspace-policy.test.mjs tests/e2e/response-body-ownership.ts tests/e2e/fixtures/response-body-ownership
git diff --cached --check
git commit -m "test: replace response provenance with UI network boundary"
```

---

### Task 2: 실제 인증 UI를 전용 root와 response 비관찰 규칙에 연결

**Files:**
- Create: `tests/e2e/ui/auth-ui.spec.ts`
- Modify: `tests/e2e/ui-network-boundary.test.ts`
- Modify: `tests/e2e/playwright.config.ts`
- Modify: `tests/e2e/playwright-config.test.ts`
- Modify: `tests/e2e/tsconfig.json`
- Delete: `tests/e2e/auth-ui.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `findUiNetworkBoundaryViolations()`와 exact named request recorder rule.
- Produces: policy-clean `tests/e2e/ui/auth-ui.spec.ts`, UI project `testMatch: "ui/auth-ui.spec.ts"`, response/status를 사용하지 않는 실패·성공 browser journey.

- [ ] **Step 1: config와 실제 UI root acceptance를 RED로 변경**

`tests/e2e/playwright-config.test.ts`의 두 UI project 기대값을 다음으로 먼저 바꾼다.

```ts
assert.equal(projects.get("ui-mobile-390x844")?.testMatch, "ui/auth-ui.spec.ts");
assert.equal(projects.get("ui-desktop-1440x900")?.testMatch, "ui/auth-ui.spec.ts");
```

`tests/e2e/ui-network-boundary.test.ts`의 legacy two-finding assertion을 제거하고 새 root가 위반 없이 존재해야 한다고 요구한다.

```ts
const uiRoot = fileURLToPath(new URL("./ui", import.meta.url));
const uiSpec = fileURLToPath(new URL("./ui/auth-ui.spec.ts", import.meta.url));
assert.deepEqual(
  findUiNetworkBoundaryViolations({ rootDirectory: uiRoot, rootFile: uiSpec }),
  [],
);
```

- [ ] **Step 2: Task 2 RED 확인**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-network-boundary.test.ts playwright-config.test.ts
```

Expected: exit `1`; 새 UI file이 없고 config가 아직 `auth-ui.spec.ts`를 가리켜 실패한다.

- [ ] **Step 3: UI spec을 이동하고 response/status 관찰 제거**

`tests/e2e/ui/auth-ui.spec.ts`는 기존 접근성·cookie·storage 검사를 유지하면서 다음처럼 바꾼다.

실패 로그인:

```ts
await page.goto("/login");
await page.locator("#sign-in-email").fill(email);
await page.locator("#sign-in-password").fill(`${password}!wrong`);
await page.locator('button[type="submit"]').first().click();
await expect(page.locator('.auth-status[role="alert"]')).toBeVisible();
await expect(page).toHaveURL(/\/login$/u);
expect((await context.cookies()).some((cookie) => cookie.name === "__Host-ab_session")).toBe(false);
await expectTokenFreeStorage(page);
```

성공 로그인에서는 raw header string array와 `/api/me` fetch를 제거한다.

```ts
const authorizationPresence: Array<Promise<boolean>> = [];
page.on("request", function authorizationRecorder(request) {
  authorizationPresence.push(
    request.headerValue("authorization").then((value) => value !== null),
  );
});

await page.goto("/login");
await page.locator("#sign-in-email").fill(email);
await page.locator("#sign-in-password").fill(password);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL("**/app");
await expect(page).toHaveURL(/\/app$/u);

// 기존 cookie metadata mapping과 opaque selector boolean assertion 유지
await expectTokenFreeStorage(page);
expect(
  (await Promise.all(authorizationPresence)).every((present) => !present),
  "browser requests must not carry an Authorization header",
).toBe(true);
```

`page.waitForResponse`, response listener, status assertion, `fetch`, raw authorization value 저장은 없어야 한다. URL은 사용자에게 보이는 성공 navigation 상태이고 cookie metadata/opaque 형식은 browser 인증 상태다. `/app` route의 실제 가계부 UI는 이 보안 패치 범위 밖이다.

- [ ] **Step 4: config와 TypeScript include를 실제 UI root에 연결**

`tests/e2e/playwright.config.ts`:

```ts
testMatch: "ui/auth-ui.spec.ts"
```

두 UI project만 위 값으로 바꾸고 HTTP project는 `auth-response.spec.ts`를 유지한다.

`tests/e2e/tsconfig.json`의 `include`에 다음 glob을 추가한다.

```json
"ui/**/*.ts",
"ui/**/*.tsx"
```

- [ ] **Step 5: Task 2 GREEN과 회귀 검증**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-network-boundary.test.ts playwright-config.test.ts auth-response-policy.test.ts
pnpm --filter @account-book/e2e typecheck
pnpm --filter @account-book/e2e test:preflight
pnpm lint
git diff --check
```

Expected: 모두 exit `0`. 실제 UI root finding은 `[]`, config는 세 project/trace-off/single-worker를 유지한다.

- [ ] **Step 6: Task 2 커밋**

```powershell
git add -- tests/e2e/auth-ui.spec.ts tests/e2e/ui/auth-ui.spec.ts tests/e2e/ui-network-boundary.test.ts tests/e2e/playwright.config.ts tests/e2e/playwright-config.test.ts tests/e2e/tsconfig.json
git diff --cached --check
git commit -m "test: enforce response-free authentication UI"
```

---

### Task 3: 보안 증거 문서화와 동일 SHA CI 게이트

**Files:**
- Modify: `docs/guides/security-auth-testing.md`
- Modify: `docs/architecture/backend-authentication.ko.md`
- Modify: `docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md`
- Modify: `docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md`
- Runtime ledger: `.superpowers/sdd/2026-07-27-auth-ui-response-boundary/progress.md`

**Interfaces:**
- Consumes: Task 1·2 commit SHA, 실제 local verification output, GitHub push/PR `security-gate` run IDs와 URLs.
- Produces: 코드 SHA의 재현 가능한 RED/GREEN 근거, 최종 documentation SHA의 same-SHA CI 증거, M1 종료 또는 정확한 blocker.

- [ ] **Step 1: 전체 로컬 검증**

Run:

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
Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:TEST_DATABASE_DISPOSABLE -ErrorAction SilentlyContinue
git diff --check
git status --short --branch
```

`TEST_DATABASE_URL`, `DATABASE_URL`, `TEST_DATABASE_DISPOSABLE=true`는 DB/E2E 세 명령에만 process-local로 설정한다. 로컬 PostgreSQL이 없으면 DB/Playwright 실패를 성공으로 바꾸지 않고 `로컬 미실행/실패 폐쇄`로 기록한다. Node 24 결과는 보조 증거이며 Node 22 권위 증거로 표현하지 않는다.

- [ ] **Step 2: 코드 SHA push와 두 security-gate 확인**

```powershell
$codeSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$gh = 'C:\Users\PC\.codex\visualizations\2026\07\16\019f696e-e609-7f70-8d59-b46fae218ddc\gh-portable\bin\gh.exe'
$deadline = (Get-Date).AddMinutes(2)
do {
  $runs = & $gh run list --branch feature/security-auth-foundation --workflow security-gate.yml --limit 20 --json databaseId,event,headSha,status,conclusion,url | ConvertFrom-Json
  $codeRuns = @($runs | Where-Object headSha -eq $codeSha)
  if ($codeRuns.Count -lt 2) { Start-Sleep -Seconds 5 }
} while ($codeRuns.Count -lt 2 -and (Get-Date) -lt $deadline)
if ($codeRuns.Count -lt 2) { throw 'Push and PR security-gate runs for the code SHA are required.' }
foreach ($run in $codeRuns) { & $gh run watch $run.databaseId --exit-status }
```

Expected: 동일 `$codeSha`에 대한 push와 pull_request run이 각각 success다. 둘 중 하나라도 실패하거나 없으면 Task 3 문서를 성공으로 작성하지 않는다.

- [ ] **Step 3: 실제 RED/GREEN과 책임 경계를 문서화**

`docs/guides/security-auth-testing.md`에 다음 내용을 실제 값으로 기록한다.

- RED: 기존 `1586ee5` analyzer가 `Pick<Response, "text">`와 구조 분해를 놓친 최종 review 근거.
- 설계: `3047b08`에서 승인된 response 비관찰 경계.
- GREEN code SHA: Step 2의 `$codeSha`.
- GitHub push/PR run URL과 실제 suite count.
- UI는 화면/URL/cookie metadata/storage/Authorization boolean만 소유.
- HTTP는 status/body/CSRF/logout/replay를 독점.
- policy는 canonical UI root와 고정 capability 진단을 사용하고 trace는 off.
- D2와 별도 침투 테스트는 실제 금융정보 beta의 독립 blocker.

`docs/architecture/backend-authentication.ko.md`의 TASK 14 문구에서 “UI가 status를 소유”와 “DOM Response body AST 제한”을 역사적 내용으로 표시하고 현재 폐쇄형 UI capability 경계로 바꾼다.

`docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md`의 과거 완료 기록에는 M1.1이 status 소유와 provenance analyzer를 대체했다는 superseded note를 추가한다. 당시 RED/GREEN SHA와 실행 기록은 역사 증거이므로 삭제하거나 재작성하지 않는다.

새 설계 문서에는 `구현 완료—코드 SHA 및 동일 SHA CI 검증 완료` 상태와 code SHA/run URLs를 추가한다. 아직 검증되지 않은 최종 문서 commit SHA를 자기 참조로 넣지 않는다.

- [ ] **Step 4: 문서 self-check와 커밋**

Run:

```powershell
rg -n 'TBD|TODO|FIXME|추후 결정|나중에 결정' docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md
git diff --check
git add -- docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md
git diff --cached --check
git commit -m "docs: record UI response boundary evidence"
```

Expected: placeholder scan은 no-match exit `1`, 두 diff check는 exit `0`, 문서 commit이 생성된다.

- [ ] **Step 5: 최종 documentation SHA push와 두 동일 SHA CI 확인**

```powershell
$finalSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$gh = 'C:\Users\PC\.codex\visualizations\2026\07\16\019f696e-e609-7f70-8d59-b46fae218ddc\gh-portable\bin\gh.exe'
$deadline = (Get-Date).AddMinutes(2)
do {
  $finalRuns = & $gh run list --branch feature/security-auth-foundation --workflow security-gate.yml --limit 20 --json databaseId,event,headSha,status,conclusion,url | ConvertFrom-Json
  $sameShaRuns = @($finalRuns | Where-Object headSha -eq $finalSha)
  if ($sameShaRuns.Count -lt 2) { Start-Sleep -Seconds 5 }
} while ($sameShaRuns.Count -lt 2 -and (Get-Date) -lt $deadline)
if ($sameShaRuns.Count -lt 2) { throw 'Push and PR security-gate runs for the final documentation SHA are required.' }
foreach ($run in $sameShaRuns) { & $gh run watch $run.databaseId --exit-status }
git status --short --branch
```

Expected: 최종 `$finalSha`의 push와 PR run이 success이고 branch는 origin과 동기화되어 clean하다. run IDs/URLs는 SDD ledger에 기록해 self-referential 문서 commit을 만들지 않는다.

- [ ] **Step 6: M1 종료 판정**

다음 조건을 모두 대조한다.

- UI network policy mutation과 실제 root가 GREEN.
- UI가 response/status를 관찰하지 않음.
- HTTP contract의 fixed status/body/CSRF/logout/replay와 secret-safe assertion 유지.
- 최종 commit과 동일 SHA의 Node 22/PostgreSQL/Chromium push+PR CI 성공.
- D2와 beta 전 침투 테스트가 release blocker로 문서에 남음.

모두 충족되면 ledger에 `M1: complete`와 final SHA/run URLs를 기록하고 M2 진입 가능으로 보고한다. 하나라도 미충족이면 M1을 완료로 표시하지 않고 정확한 blocker를 보고한다.

---

## Plan Self-Review Record

- Spec coverage: UI root confinement, import allowlist, response/status/body 금지, navigation discard, request recorder, function AST evaluation, fixed diagnostics, trace-off, HTTP ownership, same-SHA CI와 D2를 Task 1~3에 각각 매핑했다.
- Scope: production app/API/database/dependency와 `/app` UI는 변경하지 않는다. 현재 존재하지 않는 `/app` 화면은 M2 제품 구현 범위이며 M1.1은 URL navigation과 browser auth state만 검증한다.
- TDD: Task 1은 capability mutation RED→GREEN, Task 2는 새 root/config acceptance RED→GREEN, Task 3은 실제 local/CI 결과를 증거로 사용한다.
- Type consistency: `UiNetworkCapability`, `UiNetworkBoundaryViolation`, `UiNetworkBoundaryOptions`, `findUiNetworkBoundaryViolations()` 이름과 경로가 모든 task에서 일치한다.
- Secret safety: policy finding, assertion, documentation에 source/path/header/cookie/body 값을 넣지 않는다. Authorization은 promise의 boolean만 유지한다.
- No placeholders: runtime SHA와 URL은 PowerShell 변수와 실제 GitHub output으로 수집하며 미래 값을 문서에 미리 적지 않는다.
