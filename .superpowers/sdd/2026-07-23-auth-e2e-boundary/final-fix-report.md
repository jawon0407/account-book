# M1 Task 14 final-review fix report

## Scope and files

This single fix wave addresses every final-review Critical/Important finding and
the documentation Minor without changing production application code or adding
dependencies.

- `tests/e2e/response-body-ownership.ts`: builds a TypeScript Program from the
  real UI root, visits its reachable local non-declaration import graph, and
  recognizes exact TypeScript DOM `Body`/`Response` and Playwright
  `Response`/`APIResponse` declaration provenance.
- `tests/e2e/playwright-config.test.ts` and
  `tests/e2e/fixtures/response-body-ownership/*.ts`: named mutation coverage for
  dot, bracket, optional, bounded/unbounded computed, alias, destructuring,
  intersection, generic/base, TypeScript 6 `bytes()`, Playwright page/API
  responses, imported helpers, status-only access, and same-named custom types.
- `tests/e2e/auth-response-policy.ts` and
  `tests/e2e/auth-response-policy.test.ts`: boolean-safe parsing, raw/decoded
  leak scans, and exact CSRF/error/sign-in/me/sign-out public-contract
  validators, with malformed/extra/nested-leak mutations.
- `tests/e2e/auth-response.spec.ts`: reads each exercised response as text once,
  checks every secret known at that point before structural validation,
  re-checks retained sign-in data after learning the selector, and never sends a
  received body/object/string into an assertion diff.
- `tests/e2e/package.json` and `scripts/workspace-policy.test.mjs`: include
  response/config policies in DB-free preflight and pin the full E2E script to
  run that preflight before Playwright.
- `docs/guides/security-auth-testing.md`: marks the pre-Task-14 response-copy
  flow as historical, records the current UI/status/browser-state versus
  HTTP/body/logout/replay split, links the current evidence, and includes the
  executable config/type policy while preserving prior evidence and D2.
- This standalone report.

## TDD evidence

### Response ownership

RED command:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\e2e\playwright-config.test.ts
```

RED exited `1`: `5/9` passed and four mutations failed with only fixed
category/method output (`bytes`, `json`, `text`, `body`). The failures proved
the old analyzer missed TypeScript 6 bytes, Playwright provenance, the real
Program entry point, and the imported helper.

GREEN used the same focused command after the minimal Program/provenance
implementation. The final combined policy command passes `14/14`, including
`10/10` config/ownership mutations and `4/4` HTTP policy mutations.

### HTTP leak and shape policy

RED command:

```powershell
$redOutput = & .\node_modules\.bin\tsx.cmd --test tests\e2e\auth-response-policy.test.ts 2>&1
```

The harness additionally searched the captured output for its synthetic secret
sentinel and would fail if present. RED exited `1`, passed `1/4`, failed three
tests as boolean-only `false !== true` / `true !== false`, and the output guard
remained clean. The mutations covered nested credentials/sensitive keys,
malformed JSON, and malformed/extra nested contracts.

GREEN used the same output guard and passed `4/4`. The implementation catches
raw and decoded nested values, permits the expected public email only at
`user.email`, permits a CSRF endpoint's own key only at the root, and validates
exact public shapes without exposing received data.

### Script-policy wiring

```powershell
node --test scripts/workspace-policy.test.mjs
```

RED exited `1` with `2/3` passing because the package had not yet included the
new policies in preflight. GREEN passed `3/3` after updating the package script.

## Verification

- Focused config/HTTP policy:
  `.\node_modules\.bin\tsx.cmd --test tests\e2e\playwright-config.test.ts tests\e2e\auth-response-policy.test.ts`
  — PASS, `14/14`.
- E2E TypeScript:
  `pnpm --filter @account-book/e2e typecheck` — PASS, exit `0`.
- Lint: `pnpm lint` — PASS, exit `0`, zero warnings.
- Covering suite: `pnpm test` — PASS: legacy/security `53/53`, contracts
  `22/22`, database package `12/12`, API `113/113`, web `479/479`, E2E
  preflight `16/16` (`695` tests across the reported groups).
- Pre-report `git diff --check` — PASS.
- Disposable database preparation was attempted with the required local flags
  and failed closed with the fixed `[E2E_DATABASE_PREPARATION_FAILED]`
  diagnostic. No PostgreSQL-backed Playwright result is claimed.

The machine runs Node `24.14.0`, while the workspace pins Node `22.15.1`; pnpm
printed the expected engine warning during otherwise successful local checks.

## Self-review

- Assertion audit: response status and cookie metadata use fixed
  primitives/booleans; every response body is retained only in process memory;
  parser/leak/shape failures expose only fixed messages and booleans. There are
  no `response.json()`, body `toEqual`, received-object diffs, or body-derived
  assertion messages in `auth-response.spec.ts`. Trace remains off.
- Secret chronology: initial CSRF is checked against synthetic
  email/password/provider token; sign-in includes that CSRF; the sign-in text
  and decoded value are re-checked after the exact selector is learned; me,
  logout CSRF, logout, and replay include every previously learned token and
  selector.
- Analyzer audit: exact declaration paths prevent custom-name false positives;
  unions/intersections/aliases/bases/generic constraints preserve provenance;
  method aliases and object destructuring are inspected; optional, bracket, and
  computed forms fail closed; local imports are visited; declaration files,
  TypeScript libs, and node_modules implementations are not visited.
- Mutation audit: each added test names the policy change it kills. The
  committed fixtures cover the original `page.waitForResponse()` surface,
  `APIRequestContext`/`APIResponse`, DOM `bytes()`, and an imported body reader.
- Documentation audit: historical SHA/run/count evidence and the hosted
  OAuth/TLS D2 release blocker remain intact.

## Concerns and remaining boundary

Local PostgreSQL is unavailable, so HTTP/UI runtime Playwright projects remain
unverified locally. The controller must run the disposable PostgreSQL and
Playwright gates in pinned Node 22 CI on this exact final commit SHA. Hosted
Google, Kakao, Naver, and real TLS D2 evidence remains an independent production
release blocker.
