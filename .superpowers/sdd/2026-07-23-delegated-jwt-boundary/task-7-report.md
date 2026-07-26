# Task 7 — Node runtime, E2E, security evidence

## Evidence identity

- Base commit: `b84ae721bedfe97b37240229a37b2cfa9bca785a`
- Evidence scope: Task 7 working-tree changes on that base; final commit SHA is returned with the implementation handoff.
- Local runtime: Node 24.14.0; repository pin is Node 22.15.1. This is a warning, not pinned-runtime evidence.

## RED

Command:

```powershell
pnpm --filter @account-book/web test -- route-wiring.test.ts
```

Result: exit 1. The new route-policy assertions failed for all 14 BFF routes because each lacked `runtime = "nodejs"`; the focused suite reported 14 failed tests while unrelated web tests remained green. This is the intended missing-policy failure.

## GREEN and verification

| Command | Observed result |
| --- | --- |
| `pnpm --filter @account-book/web test -- route-wiring.test.ts` | exit 0; 25 test files, 479 tests passed |
| `pnpm --filter @account-book/e2e typecheck` | exit 0 |
| legacy API-JWT setting absence check | exit 0; no legacy remote-JWKS/IDP JWT setting remains in Playwright config |
| `pnpm run verify` | exit 0 in 145.8 seconds; legacy 52, contracts 22, database 12, API 113, web 479 tests passed; production build completed |
| `pnpm audit --prod --audit-level high` | exit 1; npm advisory service access failed in the restricted environment, so no audit pass is claimed |

`git diff --check` is run after the report and documentation are complete.

## Files changed

- All 14 `apps/web/src/app/api/**/route.ts` BFF adapters
- `apps/web/src/app/api/route-wiring.test.ts`
- `tests/e2e/playwright.config.ts`
- `docs/guides/security-auth-testing.md`
- `docs/architecture/backend-authentication.ko.md`
- `docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md`
- This report

The unrelated legacy `.superpowers/sdd/progress.md` was not modified or staged by this task.

## Security decisions

- Every BFF route explicitly selects Node.js, `iad1`, dynamic rendering, and a 10-second maximum duration while remaining a thin request adapter.
- One ephemeral P-256 pair is created in the Playwright config process. The BFF process receives only private signing material; the API process receives only public verification material, an accepted-key allowlist, and an independent enabled kill-switch setting.
- Legacy API remote-JWKS/IDP JWT environment settings are absent from the E2E API process.
- Browser E2E keeps the opaque-cookie `/api/me` contract and does not extract an internal delegated JWT.
- No key material, JWT, selector, request-binding hash, or database connection value is included in this report.

## Unexecuted and release-blocking evidence

Prerequisite detection found Chromium installed but no PostgreSQL listener on the guarded local disposable endpoint. The destructive disposable database commands, `pnpm test:db`, database preparation, and browser E2E were therefore not run; guards were not weakened. Required remaining evidence is live disposable PostgreSQL migration/catalog/privilege/replay behavior, Supabase `cron.job` cleanup presence, key rotation overlap/removal, kill-switch drill, same-SHA GitHub security gate, and pinned Node 22 runtime verification. The production dependency audit must also be rerun where npm advisory access is permitted.
