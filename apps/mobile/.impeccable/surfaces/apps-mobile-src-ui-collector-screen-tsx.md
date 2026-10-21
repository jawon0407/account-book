---
version: 1
slug: "apps-mobile-src-ui-collector-screen-tsx"
primary_target: "apps/mobile/src/ui/collector-screen.tsx"
related_targets: []
---

# Collector settings — Android / Operate

Scope: existing Bookify mobile UI extension; user already requested implementation without routine approval loops. No new brand, assets, dependencies or OS permissions. Actual capture is not implemented.

## Direction contract

THESIS: Separate designated device from automatic capture readiness. No nonfunctional permission switch.

OWN-WORLD: Inherit mobile theme's Bookify blue, gray canvas, white sections, Android system font, 48dp controls. No global token changes.

STORY: Return, read readiness, see verified designation, confirm impact, save, read result. Uncertain changes only trigger a read.

FIRST VIEWPORT: Back above 24sp title, short readiness statement, verified status and primary action. Confirmation replaces status actions; cancel is visible. Refresh and one-device explanation follow. Scroll preserves large text.

FORM: User-pinned existing world, narrow local extension; no seed. Code-led native screen. Signature interaction: explicit impact confirmation before designation changes, never an optimistic switch. No decorative motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
