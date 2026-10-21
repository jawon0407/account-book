---
version: 1
slug: "apps-mobile-src-ui-collector-screen-tsx"
primary_target: "apps/mobile/src/ui/collector-screen.tsx"
related_targets: ["apps/mobile/src/ui/notification-access-guide.tsx"]
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
