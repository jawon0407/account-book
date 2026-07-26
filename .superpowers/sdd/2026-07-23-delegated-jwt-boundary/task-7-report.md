# Task 7 — Node runtime, E2E, security evidence

## Evidence identity

- Code evidence commit: `357f8412dcb19b004a0a0e45f08449682fc23f75` (`test: cover vulnerable lockfile entries`)
- Evidence scope: Task 7 runtime and E2E boundary implementation at that exact code commit.
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
| `tsx --test tests/e2e/playwright-environment.test.ts` | exit 0; 1 test passed |
| obsolete API-IDP setting absence check | exit 0; no obsolete API-IDP JWT setting remains in Playwright config |
| `pnpm run verify` | exit 0 in 103.3 seconds; legacy 53, contracts 22, database 12, API 113, web 479 tests passed; production build completed |
| `pnpm audit --prod --audit-level high` | exit 0; no known production dependency vulnerabilities found |

`git diff --check` after the report and documentation changes exited 0.

## Files changed

- All 14 `apps/web/src/app/api/**/route.ts` BFF adapters
- `apps/web/src/app/api/route-wiring.test.ts`
- `tests/e2e/playwright.config.ts`
- `tests/e2e/playwright-environment.ts`
- `tests/e2e/playwright-environment.test.ts`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `scripts/workspace-policy.test.mjs`
- `docs/guides/security-auth-testing.md`
- `docs/guides/backend-auth-operations.ko.md`
- `docs/architecture/backend-authentication.ko.md`
- `docs/security/security-architecture.md`
- `docs/security/verification-checklist.md`
- `docs/superpowers/specs/2026-07-23-managed-deployment-platform-design.md`
- This report

The unrelated legacy `.superpowers/sdd/progress.md` was not modified or staged by this task.

## Security decisions

- Every BFF route explicitly selects Node.js, `iad1`, dynamic rendering, and a 10-second maximum duration while remaining a thin request adapter.
- One ephemeral P-256 pair is created in the Playwright config process. The BFF process receives only private signing material; the API process receives only public verification material, an accepted-key allowlist, and an independent enabled kill-switch setting.
- The actual IDP/API/BFF environment builder retains non-security OS/toolchain variables but case-insensitively deletes inherited `API_`, `AUTH_`, `BFF_`, `SUPABASE_`, database, test-database, migration-database, and app-origin boundary variables before each child receives its explicit allowlist.
- Obsolete API-IDP JWT environment settings are absent from the E2E API process.
- Browser E2E keeps the opaque-cookie `/api/me` contract and does not extract an internal delegated JWT.
- The failed GitHub `security-gate` run 30211236719 exposed three high production advisories. Next.js PostCSS is overridden to `8.5.19` and Fastify's `find-my-way@9.6.0` resolution to `9.7.0`; the policy test pins both remediations and the regenerated lockfile contains neither vulnerable resolution.
- No key material, JWT, selector, request-binding hash, or database connection value is included in this report.

## Unexecuted and release-blocking evidence

Prerequisite detection found Chromium installed but no PostgreSQL listener on the guarded local disposable endpoint. The destructive disposable database commands, `pnpm test:db`, database preparation, and browser E2E were therefore not run; guards were not weakened. Required remaining evidence is live disposable PostgreSQL migration/catalog/privilege/replay behavior, Supabase `cron.job` cleanup presence, key rotation overlap/removal, kill-switch drill, a successful same-SHA GitHub security gate after the advisory remediation, and pinned Node 22 runtime verification.
