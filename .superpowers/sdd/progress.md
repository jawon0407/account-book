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
- Task 10 final provider-refresh review: complete. The session boundary now
  preserves allowlisted refresh failure semantics without importing the
  provider adapter type or inspecting messages: invalid credentials and
  malformed/cross-user replacement pairs expire the session, rate limiting
  returns non-retryable 429, and provider/clock/repository operational failures
  return retryable 503. CAS-loser behavior remains `superseded`. The final RED
  evidence and design are recorded in the Task 10 report; fresh verification is
  68/68 focused tests, 22 files / 401 full web tests, typecheck, production
  build, 44/44 security gate, zero-warning lint, and whitespace validation all
  passing under Node 22 / pnpm 11 with `CI=true`.
- Task 10 controller verification: complete. Root `pnpm test` initially found
  the approved `sharp` build entry missing from the exact workspace policy
  assertion; that policy test was updated RED→GREEN. Fresh root test,
  typecheck, production build, lint, 44/44 security gate, and diff checks all
  pass under Node 22.15.1 / pnpm 11.9.0. Korean architecture, database, and
  operations docs now describe the implemented 14-route BFF and retain live
  Supabase/PostgreSQL and 91.78% coverage caveats. Final stage/commit is pending
  once because Git mutation approval was rejected at the Codex usage limit.
  After the limit was restored on 2026-07-22, a fresh root `pnpm verify` passed
  lint, typecheck, legacy 49 tests, contracts 15 tests, database 8 tests, web
  401 tests, and the 14-route production build before staging resumed. No push
  is part of this task.
- Task 11: complete (commits `f3ca9a1..50f3694`, independent spec/code review
  APPROVED; isolated Impeccable qualitative assessment and layout/type detector
  clean). Five responsive auth routes, email/password and Google/Kakao/Naver
  entry flows, safe fixed Korean error mapping, exact 768/769px behavior,
  WCAG control contrast, 44px targets, 180ms state motion and reduced-motion
  overrides are implemented without browser token state. TDD records the
  callback, component, ky 2 envelope, accessibility and review-fix RED/GREEN
  cycles. Browser QA covered five routes at 390x844 and 1440x900 plus the
  768/769 boundary with zero horizontal overflow and console errors. Fresh
  `pnpm verify` at `50f3694` passed lint, typecheck, security 49, contracts 15,
  database 8, web 426, and the 20-route production build. The available Node
  runtime is 24.14.0 rather than the pinned 22.15.1, so the engine warning
  remains; live Supabase/PostgreSQL and optional 91.78% branch coverage remain
  unchanged release follow-ups. No push was performed.
- Task 12: complete (commits `80c1310`, `9087ac5`; independent security/code
  review CLEAN after one Important finding was fixed). The NestJS/Fastify API
  now exposes public `/health` and protected `/v1/me`; production uses remote
  JWKS with an exact asymmetric algorithm, issuer, scalar audience, time claims,
  and canonical user/session UUIDs before attaching an immutable principal.
  Raw Authorization cardinality and syntax, server-owned request IDs, Helmet,
  no-CORS, no-store responses, and fixed non-secret `ApiError` mapping are
  enforced. Review hardening rejects unsupported protected `crit` extensions
  before key resolution, preserves invalid-token 401 classification for unknown
  keys/signatures, and keeps timeout/fetch/malformed-JWKS failures operational.
  TDD records the initial missing-boundary RED and the review regression RED;
  fresh root `pnpm verify` passed lint, all package typechecks/builds, security
  49, contracts 15, database 8, API 54, web 426, and the 20-route Next build.
  The user-approved `apps/api/tsconfig.json`-only `skipLibCheck` exception works
  around the TypeScript 6.0.3 / pinned Node declaration conflict while inherited
  `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` remain
  active and workspace policy constrains the exact path. Verification used Node
  24.14.0 rather than pinned 22.15.1; live remote JWKS/Supabase/PostgreSQL stays
  a Task 13 release follow-up. No push was performed.
