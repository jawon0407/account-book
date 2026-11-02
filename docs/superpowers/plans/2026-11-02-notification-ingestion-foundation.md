# Notification ingestion API / DB foundation

> **For agentic workers:** Use superpowers:executing-plans task by task, with test-driven-development and one final independent review.

**Goal:** Accept a minimal normalized notification transaction atomically behind the existing Android session/consent/collector boundary, without enabling real-device uploads yet.

**Spec:** `docs/superpowers/specs/2026-10-13-notification-ledger-data-flow-design.md`, user request 2026-11-02. Approved product decisions are retained. This is the first server foundation, not the complete multi-source ingestion feature.

**Prerequisite:** Exact SHA `a3816268f00a9662e380ea4306bf5576e7cb7bca` push and PR security-gate workflows must succeed before product changes.

## Scope and interfaces

- POST `/v1/notification-transactions`, Android-only signed `notification:write` scope. Body has UUIDv4 eventId, collectorVersion, consentVersion, sourceApp/parserVersion, income/expense, positive integer KRW, nullable counterpartyName, receivedAt UTC and optional fully resolved transaction time. No user/session/device identity, raw notification, account number, category, memo or arbitrary metadata in the body.
- GET `/v1/notification-transactions/:eventId`, Android-only `notification:read`, returns minimal receipt or 404. It does not activate collection. Historical accepted receipt lookup remains possible after collection is stopped, subject to authenticated owner access.
- `finance.notification_receipts`: `(user_id,event_id)` key, owner-bound transaction FK, SHA256 semantic request fingerprint, source/parser revision, device received time, time-review flag and created time. No financial response snapshot or raw text copy. Same request returns the same transaction ID; changed payload returns 409. Collector/consent generation is authorization, not part of the event fingerprint.
- Transaction + receipt commit together in `UserDatabase.runCollector`. Check current authority again after other locks before insertion. Retry never overwrites a user-edited or soft-deleted transaction.
- Clear income/expense is saved with account/category NULL; existing ledger read/edit APIs see it. Matching account/category rules and cross-app duplicate candidates remain later units.
- Actual notification UTC time takes priority. Missing full time uses device received time marked for review, never server arrival time. Residence history supplies ledger date. Ambiguous residence history requires confirmation instead of silently choosing a timezone.
- Initial validated parser family is KB-v1; this is an API input allowlist, not a fixed bank-selection UI or a promise to support every bank.
- Runtime activation provider defaults to **false**. Tests explicitly override it. No environment switch, mobile/BFF upload call or production migration in this unit. Activation requires updated recording notice/consent, stable native event IDs, cross-source duplicate handling and mobile result reconciliation.
- Receipt retention and physical purge are an activation gate: this foundation deliberately restricts physical deletion while a receipt references a transaction. Before activation, define the 30-day trash purge and account deletion flow with a minimal anti-replay tombstone; never retain a financial snapshot or resurrect a purged transaction on retry.

## Files / size

Expected 16–20 files, approximately 700–1,100 lines including tests and docs; adjust based on actual diff, not a completion estimate.

- New `packages/contracts/src/notification-ingestion.ts` and `.test.ts`; modify contracts `index.ts` and `internal-api.ts`.
- New `packages/database/src/schema/notification-receipts.ts`; modify database `index.ts`; new CLI-named migration under `supabase/migrations/`.
- New `apps/api/src/notification-transactions/notification-transactions.controller.ts`, `.repository.ts`, `notification-time.ts`, repository tests; modify `core/core.module.ts`, `core/core-http.test.ts`.
- New `tests/database/notification-ingestion.test.ts`; extend the isolated consent fixture to optionally apply this migration for these tests only.
- New status record and this plan. No PC UI, Android UI, package upgrade, CI threshold or real Supabase changes.

## Review Focus

- Revoked/expired/wrong-session/wrong-generation collection cannot write, including racing withdrawal.
- One owner/event key creates one row under concurrency; changed content cannot reuse it; deleted/edited rows are not recreated.
- Foreign-user reads/FKs fail under RLS; public/browser/BFF roles cannot access receipts directly; no raw payload logging/storage.
- UTC precision, received-time estimation and residence transitions cannot silently shift dates.
- Default-disabled endpoint, Android channel, narrow scopes, no identity injection, bounded bodies and fail-closed errors.

### Task 1: Contract and storage

**Interfaces:** Produces strict normalized input and receipt schema, minimal private-to-API storage and migration for repository task.

- [x] Write contract tests first; observe missing implementation failure.
- [x] Implement strict input/result contracts; verify malformed/extra fields, time precision, amount, IDs and nullable counterparty.
- [x] Generate migration filename with Supabase CLI after help discovery; add owner-bound FK, checks, indexes, RLS and least-privilege grants. Mirror Drizzle schema.
- [x] Add isolated DB tests proving owner access, foreign owner/FK rejection and no public grants; run on a newly created disposable local cluster, never hosted DB.

### Task 2: Atomic repository and HTTP boundary

**Interfaces:** Consumes Task1 contracts/storage and existing `runCollector`, produces dormant-by-default signed Android API.

- [x] Write failing repository/HTTP tests; implement a small notification-specific time resolver and repository without nested transactions.
- [x] Verify concurrent same ID, conflicting payload, rollback, reconsent/collector replacement, no-consent rejection and original transaction preservation after edit/delete.
- [x] Register controller/provider with activation false. Test Android/wrong-channel/wrong-scope/invalid-body/query and disabled-runtime rejection.
- [x] Run contracts/API/database tests, typecheck and lint; build API. Unchanged PC UI is not claimed as manually/browser-tested in this unit.

### Task 3: Review and handoff

**Interfaces:** Consumes verified code and returns evidence-backed status / next mobile integration requirements.

- [x] Independent review: Critical0/Important0, Minor2 coverage recommendations deferred and documented; no production defect found requiring a fix pass.
- [x] Record actual files/test counts, migration-not-applied status, remaining activation gates and CI evidence in MD/Notion. Local tests2427 + DB447, builds pass after preserving OneDrive .next output.
- [x] Keep this feature unit separate from the already-pushed security patch. Prepare a local feature commit; do not imply remote verification of this unpushed unit. Remote integration remains a separate handoff choice.
