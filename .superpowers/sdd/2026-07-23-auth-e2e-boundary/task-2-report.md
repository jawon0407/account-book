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
