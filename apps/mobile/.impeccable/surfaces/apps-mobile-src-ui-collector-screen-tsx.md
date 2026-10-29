---
version: 1
slug: "apps-mobile-src-ui-collector-screen-tsx"
primary_target: "apps/mobile/src/ui/collector-screen.tsx"
related_targets:
  [
    "apps/mobile/src/ui/notification-access-guide.tsx",
    "apps/mobile/src/ui/notification-access-panel.tsx",
  ]
---

# Collector settings — Android / Operate

Scope: existing Bookify mobile UI extension; user already requested implementation without routine approval loops. No new brand, assets or package dependencies. Explicit local consent and Android notification-access settings are now connected; actual capture is not implemented.

## Direction contract

THESIS: Separate designated device from automatic capture readiness. No nonfunctional permission switch.

OWN-WORLD: Inherit mobile theme's Bookify blue, gray canvas, white sections, Android system font, 48dp controls. No global token changes.

STORY: Return, read readiness, see verified designation, confirm impact, save, read result. Uncertain changes only trigger a read.

FIRST VIEWPORT: Back above 24sp title, short readiness statement, verified status and primary action. Confirmation replaces status actions; cancel is visible. Refresh and one-device explanation follow. Scroll preserves large text.

FORM: User-pinned existing world, narrow local extension; no seed. Code-led native screen. Signature interaction: explicit impact confirmation before designation changes, never an optimistic switch. No decorative motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 2026-10-21 permission guidance extension

- Keep the existing first viewport and device controls. Inline disclosure follows refresh and the designation explanation; no new route/modal or nested cards.
- Always show that this is guidance only and manual use needs no notification access. Expanded content describes planned behavior, never an already-granted consent or running capture service.
- One 48dp minimum disclosure control, expanded accessibility state, headings, inherited text scales and scroll. No storage/network/OS permission side effect.
- Separate other-app notification access from own-app notification display. Explain selected sources, unsupported/hidden notifications, no history retrieval, future stop/withdrawal and separate ledger deletion.
- User deferred native screenshots/font scale/TalkBack/Back verification. Code and bundle checks cannot grant visual approval; no new raster or global design-system change.

## 2026-10-21 consent/permission connection

- Add a separate panel below designation; keep local consent, OS access, listener connection, and device designation as distinct statuses. No optimistic grant or start-collection switch.
- Disclosure expand remains side-effect free. Explicit accept confirmation explains purpose/minimum fields/local record, optional manual use, withdrawal, and unimplemented processing. Revoke is a separate confirmed action, not OS revoke or ledger deletion.
- Use existing blue/gray/white tokens, headings, 48dp buttons and scroll. Background hides/unmounts; return revalidates session and rereads OS state.
- Android16 device capture confirms readable statuses and visible disabled/active actions. Full large-font/TalkBack/OEM review remains open. No generated assets or shared token changes.

## 2026-10-28 source preference extension (superseded)

Historical design only: the user subsequently rejected this fixed-list approach. The six implementation/test files are removed; see the current direction below.

- Keep the first viewport/device and consent controls unchanged. Add a separate flat section after consent, with five checkbox rows of 56dp minimum height (above the 48dp target), 8dp gaps and the existing colors/type. No nested cards or decorative assets.
- Headline is “알림 출처 선택 (준비)”; copy distinguishes selection from OS permission/consent/actual collection. Chat/SMS describe future financial-only analysis, not reading conversation history.
- Selection is a draft until explicit save. Show count, unsaved status, clear-all draft action, save state and generic retry errors. Leaving the screen discards unsaved changes.
- Store only source IDs in per-origin/account/install SecureStore; a new device needs selection again. No backend or native capture changes in this unit.
- Verify on the connected Android device at its current settings. Large-font, TalkBack and other OEM coverage remain separate, not implied by one screenshot.

## 2026-10-28 current permission entry

- One primary “알림 허용” control; no fixed financial-app selection list. Keep existing theme and 48dp controls. Put the primary action before expanded help.
- Native Alert explains Account Book Dev notification access, financial-only intended processing, explicit server consent, and the current no-capture state. Cancel is inert; confirm opens Android settings only after verified consent. This is not the OS grant dialog itself.
- Keep withdrawal, refresh, and OS-management when access is already enabled (including server-error recovery). Never pretend settings navigation grants permission.
- React checklist: effect cleanup invalidates late operations; derived readiness is not duplicated in state; no new subscriptions/dependencies; sequential save→settings is a required dependency, not an avoidable network waterfall.
- Device reconnected after initial implementation: both new-consent and existing-consent Alert text/buttons inspected on the connected portrait phone at its current font setting. Cancel/back dismissal, settings navigation, permission reflection and withdrawal/restart state verified. Large-font/TalkBack/landscape/other OEM coverage remains unverified.

## 2026-10-28 latest simplification (supersedes layout above)

- Keep multiple logins and the account's shared ledger. One collector is a separate permission, not a single-login policy. Permission-entry enrollment is approved for a subsequent unit; keep current designation controls until it is implemented.
- Main status is now one line: “알림 여부”. Only verified current server consent AND available/granted Android access yields “허용됨”. Known rejection is “허용되지 않음”; busy/unknown are “확인 중”/“확인 필요”. Internal consent and OS conditions remain separate.
- One compact header “새로고침” button replaces both large refresh controls. It reads both models, blocks during either model's loading/save, and preserves screen cleanup/revalidation. No new icon dependency or developer-launcher coupling.
- Rounded 14sp “자세히 알아보기” next to the intro (wrap below on narrow screens) opens a read-only native Modal. Touch targets stay 48dp. Fixed header close and Android back dismiss it; long content scrolls. It neither grants nor withdraws consent.
- Preserve explicit permission Alert, withdrawal and OS-management paths. Actual capture remains unimplemented. No new tests for layout only; combined allowance adds 12 cases to the existing presentation test.
- Current verification: USB has zero devices, so the latest Modal/layout has NOT been visually approved. Earlier device results above belong to the prior permission Alert, not this new UI. Type checks, existing tests and bundle/PC smoke are tracked in the latest status document.

## 2026-10-28 permission-driven enrollment (superseded on 10/29)

- Independent review corrected known-denial priority: a verified rejection remains not allowed even if the other source is unavailable. Both must be verified to show allowed.
- Actual device verified compact refresh, guide scroll to the final paragraph, fixed close and Android Back returning to settings without consent mutation. Large fonts/TalkBack/other OEMs remain outside evidence.
- Remove separate activate/replace buttons. The primary permission Alert explains consent + OS check + designation. Keep designation status/deactivation. Replacement retains an explicit second confirmation; multiple logins remain allowed.
- Hold only an expiring in-memory intent across OS settings. Background hides content, return revalidates login and permissions. No successful OS-launch acknowledgement means no resumed enrollment. Old native Alert callbacks cannot act on a restarted screen/account.
- Retain no-capture warning. Neither permission nor designation is labeled as running capture. No new palette, font or raster assets.

## 2026-10-28 compact actions (latest visual refinement)

- Rename the permission subsection (not the page heading) to “알림 설정”. Intro names Account Book notification access for financial-app/KakaoTalk/SMS notifications; preparation/help still disclose no actual capture.
- Reading order: purpose, verified allowance/notices, equal-width guide-left/allow-right actions. 12dp column gap, shrinkable columns and centered wrapping text; no fixed text height or font-scaling cap.
- Reduce vertical internal padding from 12 to 9dp for permission/guide and current designation controls. Outer Pressable remains at least 48dp; inner filled/outlined faces shrink to 42/44dp at standard 24dp line height and grow with text.
- Preserve the prior enrollment flow; do not restore obsolete standalone activation. No global theme, state/subscription, permission, API or DB changes. React checks: no new effects, fetches or dependencies; disabled/accessibility and late-callback guards remain intact.
- Verification is recorded in docs/status/2026-10-28-notification-settings-compact.ko.md. No new raster assets.

## 2026-10-29 compact-actions device verification

- Verified the latest layout on the connected Android portrait device, at its original font scale 0.8 and temporary scale 1.3. Purpose text and both equal-width actions remained readable without clipping; action hit areas stayed 48dp and the column gap stayed 12dp. Restored scale 0.8 afterward.
- Verified guide scrolling to its final paragraph, fixed close, Android Back, and existing-consent Alert cancellation with unchanged server consent/designation versions. OS access was not toggled by automation; the final enabled/designated state was preserved.
- Existing APK loaded the latest Metro bundle. No new native build, permission/data-flow change, or product-source change during this follow-up. TalkBack, landscape, other OEMs/tablets and all confirmation layouts remain outside this visual evidence.
- Full repository tests (2,350), mobile type checks/UI lint and PC Playwright regression passed; see the status document for scope and exclusions. Device screenshots remain ignored local evidence, not committed design assets.

## 2026-10-29 independent permission and designation (current)

- Supersedes permission-driven enrollment above: allow/OS-return never designates. Separate activate/replace/deactivate controls use explicit confirmation and revalidate consent/OS before designation. Multiple logins and one collector remain unchanged.
- Retain the equal-width guide/action row, 9dp face padding and at least 48dp hit targets. Verified allowed state changes the action to red `colors.error` / white “알림 거부”. Remove the two standalone withdrawal/OS-management buttons.
- Native Alert preserves withdrawal and settings-only recovery, including withdrawn/not-granted consent with OS access still on. No re-consent is required to reach OS settings; OS changes remain manual.
- Replace persistent designation success copy with a noninteractive three-second bottom toast, exact “기기 지정을 완료했습니다.”. Model cleanup cancels stale timers. Existing readiness/help still disclose no real capture.
- Verdict: scoped implementation verified on the connected portrait Android device at its current font setting. Red deny/cancel, server withdrawal, OS settings round trips, permission grant without designation, standalone designation and visible/dismissed toast confirmed. No new visual assets/global theme changes. Latest large-font flow, TalkBack, landscape and other devices remain unverified.
- Independent review found one recovery-path gap, fixed with RED→GREEN and actual-device navigation. Full tests 2,367; changed tests 84 included, mobile types/lint/export and PC smoke passed. See the 10/29 status document; no whole-app security or actual capture completion claim.

## 2026-10-29 toast motion refinement (current)

- Supersedes the three-second full-width toast only. Success is now visible for 2,500ms including a 220ms, 24dp upward entry; a linear shrinking bar communicates remaining display time, never server progress.
- Content width plus 20dp horizontal padding, centered, viewport-constrained and wrapping. Radius derives from the button's 24dp minus 4 = 20dp. Black/white theme colors retained; no assets, dependencies or global palette changes.
- Native-driven transforms avoid per-frame layout work. Reduced-motion removes entry movement and updates the decorative bar in steps. Unmount/new-action cleanup cancels animations and timers; the existing model remains responsible for dismissal.
- Verdict: both success messages inspected on the connected portrait Android device. Video frames confirm upward entry, captures confirm compact centered box, changing bar and dismissal. Final collector/consent states restored. Two bounded inspection rounds; no speculative visual polish.
- Fresh full repository tests 2,367, timer cases 22 (included), mobile type checks, changed-file lint, Android export and existing PC Playwright flow passed. TalkBack, reduced-motion-on, large-font/landscape/other-device runs were not repeated. See docs/status/2026-10-29-collector-toast-motion.ko.md.

## 2026-10-29 central confirmation / no progress bar (current)

- User follow-up removes only the toast countdown bar and its measuring/animation/interval code. Keep compact centered text, 20dp radius, upward entry and the existing 2,500ms model-owned dismissal.
- Replace expanding in-card designation/replace/deactivate confirmation with the same native Alert used for permission decisions. Keep existing impact text. No custom dialog styling, new dependency or global theme change.
- Cancel, Android Back and outside dismissal abandon only that pending request. Confirm callbacks bind the exact request and account/screen epoch; stale callbacks cannot submit or cancel a newer request. Access is still revalidated before activation.
- Verdict: designation/deactivation native dialogs were inspected on the connected portrait device; cancel and Android Back preserved the existing designation. The user stopped further device testing. Outside dismissal and the updated success/toast path remain device-unverified; do not substitute older countdown-toast evidence. Last observed device state was allowed/designated after the user enabled OS access; no further state mutation was performed after the stop request.
- Full tests 2,377 (including 10 new dialog-boundary cases), mobile types/lint, Android export and existing PC Playwright smoke passed. Keep the inherited animation/dismissal but do not claim new real-device animation evidence. No new global styling/assets/dependencies; see docs/status/2026-10-29-collector-confirmation-dialog.ko.md.
