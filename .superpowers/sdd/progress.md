# Security Auth Foundation SDD Progress

Plan: `docs/superpowers/plans/2026-07-20-security-auth-foundation.md`
Mode: Subagent-Driven Development + Ponytail full
Start HEAD: `164eddb`

- Task 1: complete — already satisfied at `164eddb`; independent review CLEAN.
- Task 2: complete (commits `164eddb..9137ea5`, independent review CLEAN).
- Task 3: complete (commits `9137ea5..e31c9da`, independent review CLEAN).
- Task 4: complete (commits `e31c9da..3cc6607`, independent review CLEAN;
  user-approved package-local third-party declaration exception; live DB test
  remains explicitly environment-blocked without a disposable PostgreSQL URL).
- Task 5: complete (commits `3cc6607..043bc23`, independent review CLEAN;
  36 focused tests and 100% branch coverage). The user approved a web-package
  `skipLibCheck` exception for the pinned TypeScript 6.0.3 / Node declaration
  conflict; root source strictness remains enabled and a policy test limits
  local exceptions to the three explicitly approved configs.
- Task 6: complete (commits `043bc23..129de0a`, independent review CLEAN;
  149 web security tests and 100% statements/branches/functions/lines). Cookie,
  CSRF, exact-origin/Referer and Fetch Metadata checks fail closed, including
  control-character and coalesced-header regressions.
- Task 7: complete (commits `129de0a..97853f2`, independent review CLEAN;
  179 web tests and 100% statements/branches/functions/lines). Opaque sessions
  persist only digests/envelopes, enforce 7-day idle and at-most-30-day absolute
  lifetime, reject cross-user refresh results, and rotate with an atomic SQL CAS.
- Task 8: complete (commits `97853f2..5c08880`, independent review CLEAN;
  231 web tests and 100% branch coverage). Supabase is request-scoped and
  server-only; verified-email/JWT consistency, opaque-session creation,
  account-enumeration resistance and fixed non-secret errors are enforced.
- Task 9: complete (commits `5c08880..c37d579`, independent review
  APPROVED). Server-owned PKCE now covers OAuth, email confirmation, and
  recovery; per-user JWT issuance gates serialize password recovery with
  session creation; raw Supabase responses and malformed-token boundaries are
  fail-closed. Live Supabase/disposable PostgreSQL integration remains
  environment-blocked without credentials. Task 10 must build callback URLs
  only from configured canonical origin, mint a fresh hardened interaction
  cookie per start, and keep all provider/transaction material server-only.
- Task 10: complete (same-origin Next.js BFF, request-scoped auth container,
  ky/TanStack Query browser boundary; 22 files and 359 web tests pass). TDD
  captured missing controller/container, callback, route, client, provider and
  `/api/me` error-mapping behavior as RED before the smallest GREEN changes.
  The pinned `ky@2.0.2` rejects the brief's removed `prefixUrl` option at
  runtime, so the user-approved exact v2 equivalent `prefix: "/api"` is used;
  credentials, retry, timeout and Accept options remain exact. The optional
  coverage command runs all 359 tests successfully but exits 1 because the
  existing Task 5-9 instrumentation set reports 91.78% branches against its
  100% threshold; Task 10 controller/client files are not yet in that coverage
  include set. Live Supabase/disposable PostgreSQL integration was not run
  because credentials and a disposable database were unavailable, so staging
  validation remains a release requirement.
