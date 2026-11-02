# Notification dependency security implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remove the High advisory blocking the notification feature's remote CI, preserve routing behavior, and only then start the separate notification ingestion API/DB unit.

**Architecture:** Upgrade the existing scoped query-string decoder override from 0.5.0 to 0.5.1, retaining the CommonJS/default-export bridge. Exercise the actual installed navigation parser with bounded malformed input. Keep CI's audit threshold unchanged.

**Tech Stack:** Node 22.15.1, pnpm 11.9.0, Expo Router, node:test, GitHub Actions.

**Spec:** User request 2026-11-02; https://github.com/advisories/GHSA-qr28-fpjm-wq7f; existing notification delivery record `docs/status/2026-10-30-notification-feature-delivery.ko.md`.

## Global Constraints

- Existing linked worktree and `feature/bank-state-transitions`; no merge/deployment/production DB writes.
- No lowering audit severity, ignore list, hook bypass, raw financial notifications, secrets or APKs in Git/Notion.
- Remote CI success is a gate before API/DB implementation, not inferred from local tests.
- Latest production baseline: High 1, Moderate 2, Low 1. Other advisories are recorded separately rather than silently treated as fixed.

## Review Focus

- Distinct malformed percent runs must not monopolize parsing: isolated child with five-second timeout.
- Korean query values and repeated filters must round-trip: existing real-router tests.
- Decoder module format must still work with query-string: installed runtime tests, not a mocked import.
- Both lockfile sections must exclude the vulnerable release: resolution tests plus mutation fixtures.
- Failure of registry access or CI must not be reported as success: check exit codes and exact remote SHA.

### Task 1: Patch and validate decoder dependency

**Files:** Modify `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `scripts/workspace-policy.test.mjs`, `apps/mobile/tooling/router-query.test.cjs`; create `docs/status/2026-11-02-notification-dependency-security.ko.md`.

**Interfaces:** Existing query-string parse and Expo path/state functions remain unchanged; override resolves decode-uri-component 0.5.1.

- [x] Add a real-router regression using 32,000 distinct percent runs followed by malformed `%zz`; require completion within an isolated five-second budget and known decoded/undecodable sentinels.
- [x] Run `node --test apps/mobile/tooling/router-query.test.cjs`; verify the new regression times out on 0.5.0.
- [x] Update expected security resolution and mutation cases; verify old lockfile fails.
- [x] Change scoped override to 0.5.1 and regenerate/install with pnpm; review lockfile diff for unrelated changes.
- [x] Run routing/policy tests, production audit at high threshold, and verify stages; exit 0, High/Critical 0. Local-only lint exclusion of ignored output/ is documented in the status record; remote verify remains unchanged.
- [x] Independent review, record results and remaining lower-severity advisories. Critical/Important/Minor all 0; only reviewed files will be committed.
- [ ] Push normal feature ref and observe the exact new SHA's push/PR workflows until terminal status. Record results in Notion.

### Task 2: Hand off to notification ingestion API/DB

**Files:** A separate design/implementation plan under `docs/superpowers/`; exact product files identified after inspecting collector transaction boundaries and the approved ledger spec.

**Interfaces:** Consumes successful Task 1 remote CI. Produces scoped API/DB plan with minimal normalized input, authenticated collector validation, nullable account/category ledger writes, idempotency and privacy tests.

- [ ] Read approved data-flow design and current API/DB code; identify remaining technical decisions without reopening approved product choices.
- [ ] Announce exact files/size and record plan before product changes.
- [ ] Continue implementation under its own verification plan; do not enable real notification capture or migrate production implicitly.
