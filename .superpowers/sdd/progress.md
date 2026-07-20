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
- Task 10 independent-review hardening: complete (follow-up hardening change).
  Chunked request/upstream bodies now use bounded incremental readers and are
  canceled immediately over 16/64 KiB. One lazy infrastructure-only database
  client is reused for an unchanged connection fingerprint while repository,
  service, controller, provider, and session state remain request scoped.
  OAuth POST responses contain only an exact same-origin `authorizationPath`;
  provider URL/state is created only by the new verified document-navigation
  GET `/api/auth/oauth/:provider/continue` and returned as a 303 Location.
  Every route explicitly exports safe no-store 405 handlers for unsupported
  GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS methods, and adapter construction,
  params, and controller throws become fixed 503 envelopes. Interaction-bound
  CSRF now remains selected when session and recovery cookies coexist, refresh
  operation failure maps to non-retryable session expiry, and every `__Host-`
  cookie is Secure even on loopback. Review RED matrices and corrected-test
  mutation checks are recorded in the Task 10 report; final web verification is
  22 files / 373 tests. Optional coverage still exits 1 at the unchanged Task
  5-9 include set's 91.78% branches, and live provider/database integration
  remains unexecuted and release-blocking.
- Task 10 second independent-review hardening: complete. OAuth provider
  redirects now accept HTTPS plus exact loopback HTTP while rejecting public
  HTTP, credentials, and fragments. Session failures carry a typed public-safe
  `expired | unavailable` reason: missing/corrupt state maps to non-retryable
  401, provider/repository operational failures map to retryable 503, and raw
  fixed-message lookalikes receive no privileged mapping. The process-scoped
  database-client/request-scoped service lifecycle is now documented exactly.
  The review RED evidence and final design are recorded in the Task 10 report;
  fresh verification is 56/56 focused tests, 22 files / 389 full web tests,
  typecheck, production build, 44/44 security gate, zero-warning lint, and
  whitespace validation all passing under Node 22 / pnpm 11 with `CI=true`.
