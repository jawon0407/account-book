# Accessible Neumorphism Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved restrained, accessible neumorphism design to every web authentication page without changing authentication behavior or security boundaries.

**Architecture:** Keep the existing semantic React authentication components and implement the visual system through CSS custom properties in `globals.css`. Add focused Vitest source-contract tests and Playwright browser tests before each style change, then preserve the existing BFF, session, OAuth, and safe-error behavior unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, CSS custom properties, Vitest 4, Testing Library, Playwright 1.61, `@axe-core/playwright` 4.12

**Spec:** `docs/superpowers/specs/2026-08-25-accessible-neumorphism-auth-design.md`

## Global Constraints

- Use `#F7F7F5` for the page canvas, `#FAFAF8` for raised surfaces, and `#FFFFFF` only for flat high-readability data surfaces.
- Use neumorphic elevation only on authentication panels, form controls, primary actions, provider actions, and status surfaces.
- Keep financial amounts, transaction lists, tables, chart axes, labels, legends, and data marks flat.
- Shadows communicate hierarchy only; focus, error, success, pending, and disabled states require explicit non-shadow signals.
- Keep general text contrast at 4.5:1 or greater and important control/state boundaries at 3:1 or greater.
- Preserve the approved width rule: `60vw` from 1080px through 1920px and exactly `1080px` from 1921px upward.
- Preserve a single-column mobile layout, 44px minimum interactive targets, Korean word integrity, and tabular numerals.
- Preserve the exact `prefers-reduced-motion` override and never introduce infinite decorative animation.
- Do not change authentication requests, Zod schemas, BFF routes, OAuth paths, session handling, public error-code mapping, or raw-error suppression.
- Add no runtime or development dependency for this feature; Axe and Playwright are already installed.
- Keep Playwright trace, screenshot, and video artifacts disabled. Visual inspection is local and transient.
- Do not add `.pnpm-store/` or `deliverables/` to any commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/web/src/app/globals.css` | Canonical color, surface, elevation, control-state, responsive, and motion tokens and rules |
| `apps/web/src/components/auth/auth-ui.test.tsx` | Fast RED/GREEN source-contract tests for approved tokens and state rules |
| `tests/e2e/layout/auth-neumorphism.spec.ts` | Browser proof for computed colors, restrained elevation, target size, overflow, focus, reduced motion, and Axe results |
| `tests/e2e/playwright.config.ts` | Registers the new layout/a11y spec in the isolated layout project |
| `tests/e2e/playwright-config.test.ts` | Locks the expanded layout project routing and existing artifact-off policy |
| `DESIGN.md` | Product-level summary of the approved visual language and links to the detailed spec |
| `docs/status/2026-08-24-development-progress.ko.md` | Records the implemented authentication redesign and verification evidence |

No new React primitive is created. `AuthShell`, `AuthForm`, `ProviderButtons`, and `AuthStatus` retain their existing public props and semantic structure.

---

### Task 1: Neutral Surface Tokens and Restrained Elevation

**Files:**

- Modify: `apps/web/src/components/auth/auth-ui.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: Existing `:root` tokens and `.auth-shell`, `.auth-context`, `.auth-surface` selectors.
- Produces: `--paper`, `--shadow-light`, `--shadow-dark`, `--shadow-raised`, `--shadow-soft`, and `--shadow-inset` CSS custom properties for later control-state work.

- [ ] **Step 1: Write the failing token and elevation tests**

Add these tests inside `describe("provider and shell interactions", ...)` in `apps/web/src/components/auth/auth-ui.test.tsx`:

```tsx
  it("uses the approved neutral off-white surface tokens", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("--canvas: #f7f7f5");
    expect(css).toContain("--surface: #fafaf8");
    expect(css).toContain("--paper: #ffffff");
    expect(css).toContain("--shadow-raised: -4px -4px 11px var(--shadow-light), 4px 4px 11px var(--shadow-dark)");
  });

  it("keeps neumorphic elevation subtle and off the composite shell", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const shell = css.match(/\.auth-shell\s*\{([^}]*)\}/isu)?.[1] ?? "";
    const surface = css.match(/^\.auth-surface\s*\{([^}]*)\}/imu)?.[1] ?? "";
    expect(shell).not.toContain("box-shadow");
    expect(surface).toContain("box-shadow: var(--shadow-raised)");
    expect(css).not.toMatch(/(?:12|16|20|24|26|32)px\s+(?:12|16|20|24|26|32)px\s+(?:20|24|26|32|40|48)px/iu);
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @account-book/web exec vitest run src/components/auth/auth-ui.test.tsx
```

Expected: FAIL because the current canvas and surface use blue-tinted OKLCH values and the new elevation tokens do not exist.

- [ ] **Step 3: Define the approved neutral tokens**

Replace the canvas/surface portion of `:root` in `apps/web/src/app/globals.css` with these exact values while retaining the existing semantic ink, muted, accent, danger, success, and focus tokens:

```css
:root {
  --canvas: #f7f7f5;
  --surface: #fafaf8;
  --paper: #ffffff;
  --surface-subtle: #f1f1ee;
  --ink: oklch(0.22 0.02 260);
  --muted: oklch(0.43 0.025 260);
  --line: oklch(0.58 0.018 260);
  --accent: oklch(0.52 0.18 270);
  --accent-hover: oklch(0.46 0.18 270);
  --danger: oklch(0.46 0.18 28);
  --danger-surface: oklch(0.96 0.025 28);
  --success: oklch(0.38 0.11 150);
  --success-surface: oklch(0.96 0.025 150);
  --focus: oklch(0.58 0.2 270);
  --shadow-light: rgb(255 255 255 / 0.82);
  --shadow-dark: rgb(72 77 86 / 0.09);
  --shadow-raised: -4px -4px 11px var(--shadow-light), 4px 4px 11px var(--shadow-dark);
  --shadow-soft: -2px -2px 7px rgb(255 255 255 / 0.7), 2px 2px 7px rgb(72 77 86 / 0.07);
  --shadow-inset: inset 2px 2px 4px rgb(72 77 86 / 0.07), inset -2px -2px 4px rgb(255 255 255 / 0.78);
  color-scheme: light;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

Do not change `--line`; the existing unit test verifies that this boundary token has at least 3:1 contrast against white.

- [ ] **Step 4: Apply the restrained surface hierarchy**

Update the existing selectors in `globals.css` to use a visible border plus the new shallow elevation:

```css
.auth-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: min(100%, 68rem);
  margin: auto;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid color-mix(in oklch, var(--line) 45%, transparent);
  border-radius: 16px;
}

.auth-context {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  background: var(--surface-subtle);
}

.auth-surface {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: var(--surface);
  box-shadow: var(--shadow-raised);
}
```

The shell remains shadow-free so the page does not appear heavily elevated. Only the form surface receives shallow separation.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
pnpm --filter @account-book/web exec vitest run src/components/auth/auth-ui.test.tsx
```

Expected: PASS, including the existing width, contrast, touch-target, reading-order, safe-error, and reduced-motion assertions.

- [ ] **Step 6: Commit the surface foundation**

```powershell
git add -- apps/web/src/app/globals.css apps/web/src/components/auth/auth-ui.test.tsx
git commit -m "feat(web): add restrained neutral auth surfaces"
```

---

### Task 2: Explicit Control States and Functional Motion

**Files:**

- Modify: `apps/web/src/components/auth/auth-ui.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: The elevation tokens created in Task 1 and the existing `aria-invalid`, `:focus-visible`, `:disabled`, `.auth-status-*`, and `.pending-indicator` states.
- Produces: Explicit inset inputs, shallow buttons, focus/error/state boundaries, and one-shot functional motion with no React API changes.

- [ ] **Step 1: Write failing tests for controls and state redundancy**

Add these tests to `apps/web/src/components/auth/auth-ui.test.tsx`:

```tsx
  it("uses shallow control depth with explicit focus and error boundaries", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const input = css.match(/\.field-group input\s*\{([^}]*)\}/isu)?.[1] ?? "";
    const invalid = css.match(/\.field-group input\[aria-invalid="true"\]\s*\{([^}]*)\}/isu)?.[1] ?? "";
    expect(input).toContain("box-shadow: var(--shadow-inset)");
    expect(invalid).toContain("border-width: 2px");
    expect(invalid).toContain("border-color: var(--danger)");
    expect(css).toContain("outline: 3px solid var(--focus)");
  });

  it("keeps actions shallow and motion finite", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const primary = css.match(/\.primary-button\s*\{([^}]*)\}/isu)?.[1] ?? "";
    const provider = css.match(/\.provider-button\s*\{([^}]*)\}/isu)?.[1] ?? "";
    expect(primary).toContain("box-shadow: var(--shadow-soft)");
    expect(provider).toContain("box-shadow: var(--shadow-soft)");
    expect(css).toContain("transform: translateY(1px)");
    expect(css).not.toMatch(/animation:[^;]*(?:infinite|linear)/iu);
  });

  it("gives status surfaces both a border and semantic text color", async () => {
    const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const status = css.match(/\.auth-status\s*\{([^}]*)\}/isu)?.[1] ?? "";
    expect(status).toContain("border: 1px solid currentColor");
    expect(css).toMatch(/\.auth-status-error\s*\{[^}]*color:\s*var\(--danger\)/isu);
    expect(css).toMatch(/\.auth-status-success\s*\{[^}]*color:\s*var\(--success\)/isu);
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @account-book/web exec vitest run src/components/auth/auth-ui.test.tsx
```

Expected: FAIL because inputs and actions do not yet consume the new shallow shadow tokens, invalid inputs use a 1px border, and status surfaces do not have a current-color boundary.

- [ ] **Step 3: Apply shallow depth to inputs and actions**

Update the existing input and button rules in `globals.css`:

```css
.field-group input {
  width: 100%;
  min-height: 44px;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-inset);
  color: var(--ink);
}

.field-group input:hover { border-color: var(--muted); }
.field-group input:focus { border-color: var(--accent); }
.field-group input[aria-invalid="true"] {
  border-width: 2px;
  border-color: var(--danger);
  background: var(--danger-surface);
}

.primary-button {
  border: 1px solid var(--accent);
  background: var(--accent);
  box-shadow: var(--shadow-soft);
  color: white;
}

.provider-button {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  color: var(--ink);
}
```

Keep the existing hover colors, disabled opacity, 44px minimum height, and 1px active translation.

- [ ] **Step 4: Make status surfaces explicit without changing their content**

Extend the existing base status rule:

```css
.auth-status {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid currentColor;
  border-radius: 10px;
  font-size: 0.9375rem;
}
```

Do not edit `auth-form.tsx`, `provider-buttons.tsx`, or `auth-status.tsx`; their current roles, Korean messages, `aria-invalid`, `aria-describedby`, pending disabling, and safe error mapping already satisfy the approved design.

- [ ] **Step 5: Run component tests and verify GREEN**

Run:

```powershell
pnpm --filter @account-book/web exec vitest run src/components/auth/auth-ui.test.tsx src/components/auth/auth-pages.test.tsx
```

Expected: PASS with no change to authentication behavior, safe public error messages, keyboard order, or reduced-motion safeguards.

- [ ] **Step 6: Commit the explicit control states**

```powershell
git add -- apps/web/src/app/globals.css apps/web/src/components/auth/auth-ui.test.tsx
git commit -m "feat(web): clarify auth control states"
```

---

### Task 3: Browser-Level Responsive and Accessibility Proof

**Files:**

- Create: `tests/e2e/layout/auth-neumorphism.spec.ts`
- Modify: `tests/e2e/playwright.config.ts`
- Modify: `tests/e2e/playwright-config.test.ts`

**Interfaces:**

- Consumes: Browser-computed styles produced by Tasks 1 and 2; existing isolated HTTPS web/API/test-IdP environment; installed `@axe-core/playwright`.
- Produces: Browser regression coverage for approved colors, width boundaries, mobile overflow, target size, focus, reduced motion, and WCAG automated checks.

- [ ] **Step 1: Write the browser design and accessibility spec**

Create `tests/e2e/layout/auth-neumorphism.spec.ts` with this content:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const authPaths = [
  "/login",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
] as const;

test("authentication pages use the approved neutral surfaces", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 247, 245)");
  await expect(page.locator(".auth-surface")).toHaveCSS("background-color", "rgb(250, 250, 248)");

  const shadow = await page.locator(".auth-surface").evaluate((element) => getComputedStyle(element).boxShadow);
  expect(shadow).not.toBe("none");
  expect(shadow).not.toMatch(/(?:12|16|20|24|26|32)px/iu);
});

test("mobile layouts avoid horizontal overflow and keep 44px controls", async ({ page }) => {
  await page.goto("/login");

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
  ] as const) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    for (const locator of await page.locator("input, button, .auth-footer a").all()) {
      const box = await locator.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
});

test("focus, error, and reduced-motion states remain explicit", async ({ page }) => {
  await page.goto("/login");
  const email = page.getByLabel("이메일");
  await email.focus();
  await expect(email).toHaveCSS("outline-style", "solid");
  await expect(email).toHaveCSS("outline-width", "3px");

  await page.getByRole("button", { name: "로그인" }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveCSS("border-top-width", "2px");
  await expect(page.getByText("올바른 이메일 주소를 입력해 주세요.")).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "로그인" })).toHaveCSS("transition-duration", "0.001s");
});

for (const path of authPaths) {
  test(`${path} has no automated accessibility violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
```

This layout spec may use Playwright `page` because it does not inspect network responses, submit valid credentials, expose browser storage, or extend the security-sensitive `AuthUi` facade.

- [ ] **Step 2: Register the spec in the isolated layout project**

Change the existing `layout-desktop-width-boundaries` project in `tests/e2e/playwright.config.ts` to:

```ts
    {
      name: "layout-desktop-width-boundaries",
      testMatch: [
        "layout/auth-shell-width.spec.ts",
        "layout/auth-neumorphism.spec.ts",
      ],
      use: { viewport: { width: 1080, height: 900 } },
    },
```

Update the layout-project assertion in `tests/e2e/playwright-config.test.ts` so the preflight locks both approved layout specs:

```ts
  assert.deepEqual(projects.get("layout-desktop-width-boundaries")?.testMatch, [
    "layout/auth-shell-width.spec.ts",
    "layout/auth-neumorphism.spec.ts",
  ]);
```

- [ ] **Step 3: Run the browser test in fail-closed disposable mode**

Use only the repository's fixed disposable local test database identity. Set the variables in the current PowerShell process, run the target project, and remove the variables immediately afterward:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm --filter @account-book/e2e exec playwright test --config playwright.config.ts --project layout-desktop-width-boundaries
Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:TEST_DATABASE_DISPOSABLE -ErrorAction SilentlyContinue
```

Expected: PASS when disposable PostgreSQL is available. If it is unavailable, the command must fail closed; record the missing local service and do not weaken or skip the environment guard.

- [ ] **Step 4: Run the preflight boundary tests**

```powershell
pnpm --filter @account-book/e2e test:preflight
```

Expected: PASS, proving the new layout spec did not weaken production fake-adapter blocking, environment sanitization, transport tripwires, or UI response ownership.

- [ ] **Step 5: Perform transient visual inspection**

Start the web app with the existing local development environment and inspect `/login`, `/sign-up`, and `/forgot-password` at 390px and 1440px. Confirm all of the following without enabling Playwright screenshot, trace, or video artifacts:

- Canvas is neutral off-white with no blue cast.
- Form surface separation is visible but shallow.
- Inputs look slightly inset but still have explicit borders.
- Keyboard focus and invalid states are more prominent than the shadows.
- Korean labels do not break inside words.
- No panel or control appears heavily raised.

- [ ] **Step 6: Commit browser coverage**

```powershell
git add -- tests/e2e/layout/auth-neumorphism.spec.ts tests/e2e/playwright.config.ts tests/e2e/playwright-config.test.ts
git commit -m "test(web): cover auth neumorphism accessibility"
```

---

### Task 4: Documentation and Full Verification

**Files:**

- Modify: `DESIGN.md`
- Modify: `docs/status/2026-08-24-development-progress.ko.md`

**Interfaces:**

- Consumes: The final CSS token names, browser evidence, and commits produced by Tasks 1 through 3.
- Produces: A discoverable product design summary and an accurate Korean progress record.

- [ ] **Step 1: Add the canonical visual-language summary to `DESIGN.md`**

Add this section after the existing visual-direction section:

```markdown
## Accessible Instrument Neumorphism

인증 화면은 중립 오프화이트 Canvas(`#F7F7F5`)와 거의 흰색인 Surface(`#FAFAF8`)를 사용한다. 낮은 양방향 그림자는 패널의 얕은 계층만 표현하며, 포커스·오류·성공·로딩 상태는 테두리와 색상, 텍스트를 함께 사용한다.

- 적용: 인증 패널, 입력창, 핵심 버튼, 소셜 로그인 버튼, 상태 표면
- 평면 유지: 금액, 거래 목록, 표, 차트와 레이블
- PC 너비: 1080~1920px는 60vw, 1921px 이상은 1080px
- 모바일: 단일 열, 44px 이상 터치 대상
- 모션: 기능 설명용 단발성 전환만 허용하고 움직임 축소 설정을 존중

상세 결정과 검증 기준은 [`docs/superpowers/specs/2026-08-25-accessible-neumorphism-auth-design.md`](docs/superpowers/specs/2026-08-25-accessible-neumorphism-auth-design.md)를 따른다.
```

- [ ] **Step 2: Update the Korean progress document**

Append this entry to `docs/status/2026-08-24-development-progress.ko.md`:

```markdown
### 2026-08-25 — 인증 화면 Accessible Instrument Neumorphism

- 중립 오프화이트 Canvas와 낮은 뉴모피즘 표면 토큰 적용
- 기존 60vw/1080px 인증 셸 규칙과 모바일 단일 열 유지
- 입력 포커스, 오류, 성공, 대기 상태의 명시적 경계 강화
- 움직임 축소 설정과 44px 터치 대상 유지
- Vitest 디자인 계약, Playwright 반응형 검사, Axe 접근성 검사 추가
- 인증 데이터 흐름, BFF, OAuth, 세션 및 안전 오류 매핑은 변경하지 않음
```

- [ ] **Step 3: Run documentation and source checks**

```powershell
git diff --check
pnpm lint
pnpm typecheck
```

Expected: all commands PASS with no Markdown whitespace error, lint warning, or TypeScript error.

- [ ] **Step 4: Run the full non-live verification suite**

```powershell
pnpm test
pnpm build
```

Expected: PASS. `pnpm test` includes the security preflight but not live browser E2E; the disposable browser result from Task 3 remains separate evidence.

- [ ] **Step 5: Inspect the final diff and secret boundary**

```powershell
git status --short
git diff --check
git diff --name-only HEAD
git diff -- .gitignore
```

Expected:

- Only the files named by this plan appear in the feature diff.
- `.pnpm-store/` and `deliverables/` remain untracked and unstaged.
- No `.env` file or secret value appears.
- `.gitignore` is unchanged unless an independently verified missing environment-file pattern requires a separate security patch.

- [ ] **Step 6: Commit documentation**

```powershell
git add -- DESIGN.md docs/status/2026-08-24-development-progress.ko.md
git commit -m "docs(web): record accessible auth redesign"
```

- [ ] **Step 7: Run verification-before-completion**

Invoke `superpowers:verification-before-completion`, rerun the commands it requires, and report exact pass/fail output. Do not claim completion based on an earlier run.

---

## Self-Review Result

- Spec coverage: Sections 3 through 10 map to Tasks 1 and 2; responsive, motion, accessibility, and completion criteria map to Tasks 3 and 4.
- Security coverage: No auth logic, browser token state, raw responses, secret handling, or artifact policy is changed.
- Dependency coverage: The plan uses the already installed Axe and Playwright packages and adds no dependency.
- Type consistency: No React props, exported TypeScript types, or request contracts change.
- Scope control: Native mobile UI and financial dashboard components are intentionally excluded; they will consume the documented design rules in their own feature plans.

