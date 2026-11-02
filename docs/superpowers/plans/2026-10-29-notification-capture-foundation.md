# Notification capture foundation implementation plan

> Execute inline with superpowers:executing-plans, TDD, then review → qa → cso.

## Goal and scope

Implement the first two stages of `docs/status/2026-10-29-notification-capture-next-steps.ko.md`: explicit start/stop and one deterministic Android notification parser. No ledger writes, bank API, background permanence, source-selection UI, or cloud parsing. Existing permission and collector enrollment remain independent.

This first executable slice is **foreground settings-screen parsing preview**, not production automatic bookkeeping. Native activity pause, screen exit, logout, withdrawal, designation changes, listener disconnect, process death, or validation failure stop it. Restart is explicit. Server state is rechecked 3 seconds after each completed check; native authorization expires at most 5 seconds after verification began. Remote revocation is therefore bounded, not instant. Slow validation may safely stop preview. No durable data is written during this interval. A future background/server-intake contract must enforce server-side authorization at commit time.

## Global constraints

- Worktree: `.worktrees/ledger-public-contracts`, baseline `36d8b49061f7f49add0cdba60e55add9aeb9a178`; preserve main checkout.
- No credential transferred to native code. Session-scoped existing API calls verify consent and collector ownership. Native permits are in-process guards, not cryptographic/server authorization.
- Fail closed: elapsed-time native lease, generation fence on asynchronous renewals, no automatic resume, no historical notification queries.
- Raw text only in a bounded synchronous native parser call. No raw events to JS, logs, files, server, or queue. Latest extracted preview is memory-only and cleared on stop. Unrecognized package/summary/own notification rejected before reading extras.
- Initial parser: KB masked-account cash movement template, synthetic examples. Other formats excluded without guessing. Account hint is not ownership proof. Missing year/timezone remains unresolved; never fabricate an instant.
- UI explains limited scope before explicit start. Existing consent alone cannot start reading. Tests use synthetic content, not personal notifications.
- No new dependency or database migration. No commit/push without the user's current authorization or an explicit required QA checkpoint approval.

## Changed files

Native: `NotificationAccessService.kt`, `NotificationAccessModule.kt`; add pure `CaptureEngine.kt`, `CashNotificationParser.kt` and JVM tests.
Mobile: add `collection-runtime.ts`, `android-capture.ts`, their tests, `collection-runtime-panel.tsx`; connect `collector-enrollment.ts`, `platform/notification-access.ts`, `app/index.tsx`, `collector-screen.tsx`; update `collector-copy.ts`, `notification-access-panel.tsx`, `notification-access-guide.tsx`.
Documentation: this plan and a status/result report. PC/server/DB product code unchanged.

### Task 1: Native gate and parser

Interfaces: begin → epoch; beginVerification(epoch) → one-use ticket with a native monotonic five-second deadline; renew(epoch, ticket) → boolean without extending that deadline; stop → clears memory; snapshot → counters and optional minimal preview. Receive accepts lazy text access, so denied packets never read content.

1. Write pure Kotlin behavior tests for stopped/expired/background/disconnected gates, stale renew, duplicates/capacity, strict cash parsing, summaries, unknown packages, oversized/hidden/malformed text, amount disagreement, card approval, missing time.
2. Run tests and observe missing implementation failure.
3. Implement gate/parser and Android callback integration with text length bounds and safe fixed errors.
4. Run JVM tests and Android compilation.

Expected: all relevant pure tests pass; Android module compiles. No raw text persists.

### Task 2: Session-scoped execution model and UI

Interfaces: Task 1 bridge; existing collector/consent/OS APIs; scope is origin/user/install/generation. Native snapshot never contains credentials or original text.

1. Write failing TS tests: missing permission/consent/ownership/session, delayed start after stop/account change, expired verification, malformed native response, refresh failure, native shutdown, no implicit restart.
2. Implement strict bridge and runtime. Poll while running, bounded timeout, serial start/stop native fence, clear preview on stop.
3. Integrate separate start/stop panel and explicit disclosure. Stop before settings/enrollment mutations and on UI unmount/session/background changes. Update obsolete no-reading notices.
4. Run mobile tests/typecheck and targeted lint.

Expected: no activation solely from permission/enrollment and no late callback resurrects stopped collection.

### Task 3: Verification and delivery record

1. Build APK/module and export mobile bundle using pinned tooling. Do not install or enable personal notification access automatically.
2. Run project checks proportionate to change, PC Playwright regression if local server available.
3. Invoke review, qa, cso in order. Respect their evidence/clean-tree gates; explicitly report unavailable real-device, runtime scanner, or external-review coverage.
4. Update Notion and local status with actual evidence, defects, limitations, and next step (server intake/background authorization).

## Review focus

Reject late native renew after stop, both JS and Android lifecycle transitions, stale server snapshots and latency exceeding lease; ensure permission/withdrawal paths stop before writes; malicious oversized/custom extras; malformed numeric strings and ambiguous time; unknown packages and card authorization must not become cash records. No UI may claim a transaction was saved.

## Execution status — 2026-10-30

- [x] Task 1: native foreground gate, bounded KB parser, JVM regression checks and Android module compilation.
- [x] Task 2: session-scoped runtime, explicit preview UI, lifecycle fencing and approved polling/stop-error repairs.
- [x] Task 3 partial: mobile 309 tests, tooling 14 tests, two type checks, targeted lint, Android export and independent code review. Approved local checkpoint: `c9909a3`; no push.
- [x] Separate post-commit QA: scoped automated contracts pass at `c9909a3`; previous review's setup-blocked evidence retained separately.
- [ ] CSO: not assessed; start failed after one correction, with no returned run ID. Tool failure is not evidence of either a vulnerability or safety. Runtime scanner prerequisites are also absent.
- [ ] Full APK build/install, actual Android callbacks/accessibility/lifecycle and PC browser checks. PC local server was unavailable; no real-device test was performed.

The status report records these limits. Do not mark the complete verification/delivery task or production automatic bookkeeping complete.
