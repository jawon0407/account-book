# Independent Notification Controls Implementation Plan

> Historical implementation plan. Same-day follow-ups changed the toast to 2,500ms without a progress bar and replaced inline collector confirmation with a central Alert. See `docs/status/2026-10-29-collector-confirmation-dialog.ko.md`. The user subsequently authorized committing/pushing the completed changes; see `docs/status/2026-10-29-notification-capture-next-steps.ko.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Separate notification consent from collector designation and show a three-second success toast.
**Architecture:** Retain existing NotificationAccess/CollectorSettings APIs. Remove permission-driven enrollment intent; keep lifecycle/scope guards and explicit confirmation. Derive one permission action from verified state; show model-owned timed feedback outside the scrolling screen.
**Tech Stack:** React Native/Expo, TypeScript, Vitest; no new dependencies.
**Spec:** `docs/status/2026-10-29-independent-notification-controls.ko.md`

## Global Constraints

- Multiple logins, one collector. No automatic designation on permission grant or resume.
- OS permission changes remain manual. Server withdrawal must not falsely claim OS removal.
- Existing 48dp hit targets, 9dp internal padding, two-column actions, Bookify tokens retained.
- Three-second noninteractive toast; no actual capture, backend/schema/native/dependency changes.
- Preserve stale callback/session/late result guards, version conflict behavior and explicit replacement confirmation.
- User has opted out of repeated approvals; implement inline. Do not commit/push automatically in this request.

## Review Focus

- Server unavailable while OS access remains enabled: preserve a settings escape through the single action.
- Granted/outdated consent with OS denied/unavailable: retain an explicit withdrawal choice.
- Old native Alert after navigation/account change: no writes or settings launch.
- Grant, reload and OS return: never call collector mutation.
- Timer from an old toast must not clear a newer message or survive screen stop.

### Task 1: Independent controls and transient feedback

**Files:**
- Modify: `apps/mobile/src/collector/collector-enrollment.ts`, `collector-settings.ts`, `collector-copy.ts`, `notification-consent-copy.ts`.
- Modify: `apps/mobile/src/ui/collector-screen.tsx`, `notification-access-panel.tsx`, `notification-access-guide.tsx`.
- Test: `apps/mobile/src/collector/collector-enrollment.test.ts`, `collector-settings.test.ts`, `notification-consent-copy.test.ts`.
- Document: status/spec above and mobile collector surface brief.

**Interfaces:**
- Keep `prepareAccessRequest(): () => Promise<void>` guarded but remove all automatic collector writes.
- Add `prepareWithdrawal(): () => Promise<void>` for stale-safe native confirmation; `withdraw()` performs server withdrawal and optional OS settings navigation, never a collector write.
- Keep `settings.choose('activate'|'deactivate')` and guarded `confirm()` for standalone designation.
- Add `toast: string | null` to `CollectorSettingsState`, cleared at 3,000ms and on state-changing navigation/stop/read.
- Add `primaryAction: 'allow'|'deny'|'settings'|'none'` to consent presentation; derive from verified capability, never from stale successful text.
- Review follow-up: derive `alternateAction` for an in-popup settings-only escape after withdrawal; never require re-consent to reach OS removal settings.

- [x] Write regression assertions before product edits: permission request+resume leaves collector inactive; separate activate+confirm calls collector once; revoked OS blocks confirm; replacement cancel leaves prior collector.
- [x] Add stale withdrawal callback, withdrawal failure/settings fallback and duplicate-tap cases; assert real model state and exact external mutation counts.
- [x] Add fake-timer assertions: successful activate displays exact requested text, 2,999ms remains, 3,000ms disappears; stop/newer operation cancels old timer; failure/lost response never yields toast.
- [x] Add presentation table assertions for allowed, denied, outdated, unavailable, error and busy combinations.
- [x] Run targeted Vitest and observe expected failures (not import/syntax errors).
- [x] Implement minimal coordinator simplification, toast lifecycle, action derivation and UI. Red deny confirmation replaces separate panels; partial-state withdrawal remains available inside native Alert.
- [x] Update help copy to explain separate designation; retain current no-capture warning outside success message.
- [x] Run mobile tests/type checks, ESLint and full `pnpm test`; exit 0, 2,367 tests. Android export and PC Playwright smoke passed.
- [x] Inspect connected Android screen, separate actions, toast timing and consent changes without real credentials. Record unsupported/unverified conditions.
- [x] Obtain independent review, fix important findings with RED→GREEN, update Notion/status. Notion append confirmed succeeded; leave changes uncommitted for this request.
