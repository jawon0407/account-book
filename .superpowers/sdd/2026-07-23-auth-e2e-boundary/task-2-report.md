# Task 2 report: HTTP response contract and Playwright project split

## Implementation

- Moved the existing browser-only login journey to `auth-ui.spec.ts` without changing its assertions, then removed the original file.
- Added one isolated `APIRequestContext` contract suite. It verifies failed and successful sign-in public contracts, session-cookie attributes, authenticated `/api/me`, sign-out, and selector replay rejection. Response and credential-bearing values stay in process memory; assertions use status, shape, booleans, and fixed public fields only.
- Replaced the global Playwright match with exactly three projects: two UI viewports and one HTTP-contract project. Serial policy remains `fullyParallel: false`, one worker, and zero retries; web-server reuse remains disabled.
- Added the executable config-policy test and updated the workspace policy expectation for the new E2E test command.

## Changed files

- `tests/e2e/auth-ui.spec.ts` (moved from `auth.spec.ts`)
- `tests/e2e/auth-response.spec.ts`
- `tests/e2e/playwright-config.test.ts`
- `tests/e2e/playwright.config.ts`
- `tests/e2e/package.json`
- `scripts/workspace-policy.test.mjs`
- Removed `tests/e2e/auth.spec.ts`

## TDD evidence

1. RED: added the config-policy test, then ran the locally available `tsx` launcher because `pnpm --filter @account-book/e2e exec tsx` could not resolve `tsx` in this worktree. The test failed as intended: existing projects were `mobile-390x844` and `desktop-1440x900`, not the three required routes.
2. GREEN: applied project routing and test-script changes, then ran the same config test: `1` test passed. `pnpm --filter @account-book/e2e typecheck` completed with exit `0`.
3. The first complete `pnpm test` exposed the workspace policy's old E2E-script expectation; updating that policy assertion made the expectation follow the requested command. A second full run passed.

## Verification

- `pnpm test`: PASS. Legacy policy/security tests: `53/53`; contracts: `22`; database: `12`; API: `113`; web: `479`; E2E preflight: `2/2`.
- `pnpm --filter @account-book/e2e typecheck`: PASS.
- `git diff --check`: PASS.
- Disposable-database preparation: BLOCKED locally with `[E2E_DATABASE_PREPARATION_FAILED]`; no local PostgreSQL service was available. HTTP-contract and UI Playwright projects were therefore not run, avoiding failure artifacts that could retain transport data.

## Self-review

- Confirmed browser tests run only for the two named viewport projects and response tests only for `http-contract`.
- Confirmed no production code was changed, test-only cleanup stays in the spec, and helper JSDoc documents behavior, security rationale, parameters, and return values where applicable.
- Confirmed response/cookie/selector/credential material is not emitted through assertions or this report.

## Concerns

- The environment uses Node 24 while the workspace pins Node 22. The completed checks emitted the package-manager engine warning but passed. Run the two Playwright projects in a Node 22 environment with disposable PostgreSQL before release.

## Fix round 1: stricter security separation

### Changes

- Set Playwright trace collection to `off` for every authentication E2E project. This prevents failed authentication traces from retaining request headers, response bodies, or cookie values.
- Restricted `auth-ui.spec.ts` to browser journeys: accessibility, browser storage and cookie metadata, no browser Authorization header, and status-only checks for `/api/me`, sign-out, and post-logout access. It no longer parses those response bodies or replays a session selector.
- Kept response-body assertions and selector replay solely in `auth-response.spec.ts`.

### TDD and covering verification

1. RED: appended `config.use.trace === "off"` to `playwright-config.test.ts` and ran the local `tsx` launcher. It failed as expected with actual `retain-on-failure` and expected `off`.
2. GREEN: set `trace: "off"`; the config-policy test then passed (`1/1`) and `pnpm --filter @account-book/e2e typecheck` exited `0`.
3. Covering suite: `pnpm test` passed: legacy policy/security `53/53`, contracts `22`, database `12`, API `113`, web `479`, and E2E preflight `2/2`.

### Remaining verification boundary

- There is no local PostgreSQL service, so database-backed HTTP/UI Playwright projects remain unrun locally and are not reported as successful. The same-SHA CI controller must run those disposable-database projects; the local covering tests above protect the static route, type, and workspace-policy boundaries.

## Fix round 2: UI response-body ownership

### Changes

- Removed the UI spec's CSRF fetch, logout request, post-logout request, and related response parsing. The authenticated browser journey now ends after cookie public metadata and opaque-format checks, token-free storage, `/api/me` status, and absent browser Authorization headers.
- Added an executable source-topology boundary in `playwright-config.test.ts`. UI and HTTP specs execute in separate projects, so a runtime response alone cannot identify its owning spec; this is the closest executable enforcement that prevents UI ownership of CSRF, logout, and response-body parsing. Boolean assertions intentionally avoid echoing source text when the policy fails.

### TDD and covering verification

1. RED: the new ownership test failed with `UI spec must not fetch CSRF response bodies` and boolean result `true !== false` while the UI spec still read CSRF JSON.
2. GREEN: after removing the logout path from the UI spec, the config-and-ownership test passed (`2/2`), and `pnpm --filter @account-book/e2e typecheck` exited `0`.
3. Covering suite: `pnpm test` passed: legacy policy/security `53/53`, contracts `22`, database `12`, API `113`, web `479`, and E2E preflight `2/2`.

### Remaining verification boundary

- No local PostgreSQL service is available. Database-backed Playwright projects were not run and are not represented as a local success; the same-SHA CI controller must supply that disposable-database coverage.

## Fix round 3: semantic UI Response ownership policy

### Changes

- Replaced the weak route/string topology check with a TypeScript AST and type-checker policy. It recognizes only DOM `Response` receivers and reports safe category/method names for body consumption; it never returns source text or transport values.
- The policy rejects `json`, `text`, `arrayBuffer`, `blob`, `formData`, and direct body-stream property or bracket access. It permits status-only access.
- The policy runs against the real UI spec. Existing Playwright project routing and the HTTP contract suite remain the separation and runtime ownership boundaries; this policy does not infer ownership from route text.

### TDD and covering verification

1. RED: added synthetic fixtures before the analyzer module existed; focused execution failed with a missing analyzer module. After implementing the core analyzer, a second RED fixture proved bracket-form body access was not yet detected (expected stream finding, actual empty list).
2. GREEN: added semantic bracket-access handling. The focused policy/config test passed (`2/2`), covering all five body APIs, dot and bracket stream access, a status-only fixture, and the real UI spec. `pnpm --filter @account-book/e2e typecheck` exited `0`.
3. Covering suite: `pnpm test` passed: legacy policy/security `53/53`, contracts `22`, database `12`, API `113`, web `479`, and E2E preflight `2/2`.

### Remaining verification boundary

- No local PostgreSQL service is available. Database-backed Playwright projects, including the HTTP response contract runtime suite, remain CI-owned same-SHA coverage and are not claimed as local success.

## Fix round 4: computed members and DOM declaration provenance

### Changes

- Extended the semantic policy to cover all five forbidden methods through dot access, literal bracket access, statically resolvable computed keys, and fail-closed unbounded computed keys. Direct `body` access is covered in property, bracket, computed, and call-target forms.
- Replaced the symbol-name-only `Response` check with declaration provenance against the exact `lib.dom.d.ts` shipped by the active TypeScript installation. Union, intersection, alias-symbol, and generic-constraint resolution preserve the DOM boundary without rejecting a module-scoped custom `Response`.
- Kept findings limited to fixed categories and method labels, including the fixed `computed` label. The analyzer never returns source snippets or response values, and the real `auth-ui.spec.ts` assertion remains executable.

### TDD evidence

1. RED: `.\node_modules\.bin\tsx.cmd --test tests\e2e\playwright-config.test.ts` reported `3/6` passing. Safe assertion output showed the literal `json` bracket call and DOM alias/intersection produced no finding, while the custom non-DOM `Response` produced fixed method/category findings instead of the expected empty list.
2. Self-review RED: after the first GREEN, the same command reported `5/6` passing for a literal `body` call-target fixture; expected fixed `stream/body`, actual empty list.
3. GREEN: the same focused command passed `6/6`, covering dot and bracket calls for `json`, `text`, `arrayBuffer`, `blob`, and `formData`; literal and dynamic body access; a status-only allow case; custom non-DOM `Response`; DOM alias/intersection; and the real UI spec.

### Verification

- `pnpm --filter @account-book/e2e typecheck`: PASS.
- `pnpm test`: PASS on the final code state: legacy policy/security `53/53`, contracts `22`, database `12`, API `113`, web `479`, and E2E preflight `2/2`.
- `git diff --check`: PASS before report staging.
- The focused command used the root workspace launcher because filtered `pnpm exec tsx` does not resolve `tsx` from this worktree package.

### Files and self-review

- Changed `tests/e2e/response-body-ownership.ts`, `tests/e2e/playwright-config.test.ts`, and this report.
- Confirmed only exact TypeScript standard-library provenance activates DOM `Response` enforcement; a same-named user type remains allowed, while aliases, intersections, unions, and constraints cannot hide the DOM type.
- Confirmed bounded computed keys use their literal type set, broad computed string keys fail closed, fixed diagnostics cannot echo credentials or transport content, and no runtime authentication behavior changed.

### Remaining verification boundary

- Local PostgreSQL absence is not represented as success. Database-backed Playwright E2E remains the same-SHA controller CI responsibility.
