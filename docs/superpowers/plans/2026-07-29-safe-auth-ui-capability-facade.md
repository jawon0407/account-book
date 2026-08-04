# Safe Auth UI Capability Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bypass-prone UI response-provenance analyzer with an authentication-specific facade that exposes no raw Playwright/network capability to UI specs.

**Architecture:** `auth-ui.spec.ts` registers scenarios through `authTest`, whose callback receives only `AuthUi`. A small grammar Gate validates that exact DSL, while a runtime Tripwire disables Node transport globals during the callback; raw Playwright and Axe objects remain inside one audited driver.

**Tech Stack:** TypeScript 6.0.3, Node.js 22.15.1, Playwright 1.61.1, `@axe-core/playwright` 4.12.1, Node test runner through `tsx`, pnpm workspace, GitHub Actions `security-gate`.

## Global Constraints

- Security is the first priority; M1.1/M1 remains blocked and M2 must not begin until this plan has clean independent review and exact-SHA CI evidence.
- UI specs may import only the exact named `authTest` export from `../support/safe-ui-test.js`.
- UI callbacks receive only a frozen `{ authUi }` object and never `Page`, `Locator`, `BrowserContext`, `Request`, `Response`, `APIRequestContext`, or Axe objects.
- The initial facade contains only `openLogin`, `assertLoginUsable`, `submit`, `assertRejected`, `assertAuthenticated`, `assertNoBrowserCredentials`, and `assertNoAuthorizationHeaders`.
- Cookie, header, storage, DOM, URL, selector, credential, and Axe detail values never cross the driver boundary or enter errors/artifacts.
- Public errors are fixed `SafeAuthUiErrorCode` values without `cause`.
- UI projects explicitly set `screenshot: "off"`, `video: "off"`, and `trace: "off"`.
- Static diagnostics contain only fixed `category` and `capability` values.
- No production application code, dependency, lockfile, workflow, or HTTP contract behavior changes are allowed.
- Existing `auth-response.spec.ts` remains the sole owner of HTTP status/body/CSRF/logout/replay assertions.
- Do not remove the legacy analyzer until the new Gate, wrapper, Tripwire, real UI spec, and threat-parity mutations are GREEN.
- Local Node/PostgreSQL/Chromium/registry limitations are never reported as passing; exact commit SHA GitHub gates are authoritative.
- D2 hosted Google/Kakao/Naver TLS/redirect/cookie/log evidence and beta-before professional penetration testing remain independent production release blockers.
- Every implementation task uses a fresh implementer subagent and an independent spec/quality reviewer. Security-focused tasks use a security-developer implementer; Task 3 uses a frontend/E2E implementer; the HTTP boundary receives a read-only backend review; the final branch receives security and project-lead review.
- Code and documentation comments must explain security behavior and parameters without restating obvious syntax.

---

## File Structure

### New files

- `tests/e2e/ui-facade-boundary.ts` — parses and validates only the approved auth UI DSL.
- `tests/e2e/ui-facade-boundary.test.ts` — mutation tests for imports, callback grammar, methods, arguments, aliases, dynamic execution, and transports.
- `tests/e2e/support/safe-ui-error.ts` — fixed safe error codes and normalization.
- `tests/e2e/support/safe-ui-error.test.ts` — verifies exact safe messages, absent causes, and sentinel non-disclosure.
- `tests/e2e/support/transport-tripwire.ts` — installs and restores transport-global throwers.
- `tests/e2e/support/transport-tripwire.test.ts` — verifies blocking, descriptor restoration, failure restoration, and nesting policy.
- `tests/e2e/support/auth-ui-driver.ts` — the only UI module that owns raw Playwright/Axe capabilities.
- `tests/e2e/support/safe-ui-test.ts` — wraps base Playwright test registration and exposes only frozen `{ authUi }`.
- `tests/e2e/support/safe-ui-test.test.ts` — verifies callback payload shape, freezing, and safe error normalization.

### Modified files

- `tests/e2e/ui/auth-ui.spec.ts` — migrates raw Playwright scenarios to `authTest` and `AuthUi`.
- `tests/e2e/playwright.config.ts` — explicitly disables all browser artifacts.
- `tests/e2e/playwright-config.test.ts` — locks artifact settings and project ownership.
- `tests/e2e/package.json` — adds the new focused preflight tests and removes the retired analyzer test after cutover.
- `tests/e2e/tsconfig.json` — includes `support/**/*.ts`.
- `tests/e2e/README.md` — documents the auth facade boundary and extension process.
- `docs/guides/security-auth-testing.md` — records commands, RED/GREEN, exact SHAs, and CI evidence.
- `docs/architecture/backend-authentication.ko.md` — preserves UI/HTTP ownership and Korean security flow.
- `docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md` — supersedes the provenance implementation history.
- `docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md` — points to the approved facade replacement.
- `docs/superpowers/specs/2026-07-29-safe-auth-ui-capability-facade-design.md` — records final implementation/evidence status.

### Deleted after cutover

- `tests/e2e/ui-network-boundary.ts`
- `tests/e2e/ui-network-boundary.test.ts`

---

### Task 1: Define the auth UI facade grammar Gate

**Role:** Security developer implementer; security reviewer.

**Files:**
- Create: `tests/e2e/ui-facade-boundary.ts`
- Create: `tests/e2e/ui-facade-boundary.test.ts`

**Interfaces:**
- Consumes: TypeScript parser from the existing `typescript` workspace dependency.
- Produces:

```ts
export type UiFacadeBoundaryCapability =
  | "boundary-escape"
  | "unsupported-extension"
  | "unapproved-import"
  | "unapproved-top-level"
  | "unapproved-callback"
  | "unapproved-method"
  | "unsafe-argument";

export type UiFacadeBoundaryViolation = Readonly<{
  category: "boundary" | "import" | "syntax" | "capability";
  capability: UiFacadeBoundaryCapability;
}>;

export function findUiFacadeBoundaryViolations(options: Readonly<{
  rootDirectory: string;
  rootFile: string;
}>): readonly UiFacadeBoundaryViolation[];
```

- Approved methods:

```ts
const zeroArgumentMethods = new Set([
  "openLogin",
  "assertLoginUsable",
  "assertRejected",
  "assertAuthenticated",
  "assertNoBrowserCredentials",
  "assertNoAuthorizationHeaders",
]);
```

- `submit` accepts exactly one object literal with `email` and `password` shorthand identifiers that resolve to top-level `const` string declarations.

- [ ] **Step 1: Write the minimal allowed-grammar and raw-import mutation tests**

Create a temp-file helper that writes one `root.ts`, invokes the exported Gate, and removes the directory in `finally`. Start with these fixtures:

```ts
const allowed = `
  import { authTest } from "../support/safe-ui-test.js";
  const email = "verified@example.test";
  const password = "correct horse battery staple";
  authTest("successful login", async ({ authUi }) => {
    await authUi.openLogin();
    await authUi.submit({ email, password });
    await authUi.assertAuthenticated();
  });
`;

assert.deepEqual(inspect(allowed), []);

assert.deepEqual(
  inspect('import { test } from "@playwright/test"; void test;'),
  [{ category: "import", capability: "unapproved-import" }],
);
```

Add one mutation each for default/namespace/aliased imports and local helper imports. Expected diagnostics must be fixed literals.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-facade-boundary.test.ts
```

Expected: FAIL because `ui-facade-boundary.ts` does not exist.

- [ ] **Step 3: Implement canonical confinement and exact import validation**

Use `realpathSync`, `path.relative`, and `.ts`/`.tsx` extension validation. Parse with:

```ts
const sourceFile = ts.createSourceFile(
  rootFile,
  readFileSync(rootFile, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
```

Accept exactly:

```ts
import { authTest } from "../support/safe-ui-test.js";
```

Reject every other import/export/import-equals/dynamic import form with fixed diagnostics.

- [ ] **Step 4: Add callback and method grammar mutations and verify RED**

Add fixtures for:

```ts
authTest("x", async ({ authUi, page }) => {});
authTest("x", async (fixtures) => {});
authTest("x", async ({ authUi }) => { const page = authUi; });
authTest("x", async ({ authUi }) => { return authUi; });
authTest("x", async ({ authUi }) => { await authUi["openLogin"](); });
authTest("x", async ({ authUi }) => { await authUi.unknown(); });
authTest("x", async ({ authUi }) => { await authUi.submit({ email, password: "inline" }); });
```

Expected: the first four yield `syntax/unapproved-callback`, computed and unknown methods yield `capability/unapproved-method`, and the inline argument yields `capability/unsafe-argument`.

Run the focused command and record that these new cases fail before grammar implementation.

- [ ] **Step 5: Implement the closed callback grammar**

Validate:

- top-level statements are the one import, string `const` declarations, or direct `authTest` calls;
- title is a string literal;
- callback is async arrow/function with exact `{ authUi }`;
- callback statements are awaited direct `authUi.<approved>()` calls;
- zero-argument methods receive no arguments;
- `submit` receives the exact two-property shorthand object.

Do not traverse arbitrary aliases. Reject syntax outside this grammar.

- [ ] **Step 6: Add transport/dynamic-execution threat-parity mutations**

Add table-driven fixtures containing:

```ts
fetch("/health");
globalThis["fetch"]("/health");
const key = "fetch"; globalThis[key]("/health");
process.mainModule;
require("node:http");
import("node:http");
eval("fetch('/health')");
Function("return fetch('/health')")();
new WebSocket("ws://127.0.0.1");
```

They should all be rejected as `syntax/unapproved-callback` or
`syntax/unapproved-top-level`; tests assert only the fixed diagnostic.

- [ ] **Step 7: Run Gate tests, typecheck, lint, and diff check**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-facade-boundary.test.ts
pnpm --filter @account-book/e2e typecheck
pnpm lint
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- tests/e2e/ui-facade-boundary.ts tests/e2e/ui-facade-boundary.test.ts
git commit -m "test: define auth UI facade grammar"
```

---

### Task 2: Add fixed errors and the runtime Transport Tripwire

**Role:** Security developer implementer; security reviewer.

**Files:**
- Create: `tests/e2e/support/safe-ui-error.ts`
- Create: `tests/e2e/support/safe-ui-error.test.ts`
- Create: `tests/e2e/support/transport-tripwire.ts`
- Create: `tests/e2e/support/transport-tripwire.test.ts`
- Modify: `tests/e2e/tsconfig.json`

**Interfaces:**

```ts
export const safeAuthUiErrorCodes = [
  "AUTH_UI_LOGIN_NOT_READY",
  "AUTH_UI_LAYOUT_FAILED",
  "AUTH_UI_ACCESSIBILITY_FAILED",
  "AUTH_UI_REJECTION_FAILED",
  "AUTH_UI_SESSION_POLICY_FAILED",
  "AUTH_UI_BROWSER_CREDENTIAL_DETECTED",
  "AUTH_UI_AUTHORIZATION_HEADER_DETECTED",
  "AUTH_UI_TRANSPORT_BLOCKED",
  "AUTH_UI_UNEXPECTED_FAILURE",
] as const;

export type SafeAuthUiErrorCode = typeof safeAuthUiErrorCodes[number];

export class SafeAuthUiError extends Error {
  readonly code: SafeAuthUiErrorCode;
  constructor(code: SafeAuthUiErrorCode);
}

export function normalizeSafeAuthUiError(error: unknown): SafeAuthUiError;

export async function withTransportTripwire<T>(
  operation: () => Promise<T>,
  target?: object,
): Promise<T>;
```

- Transport names: `fetch`, `XMLHttpRequest`, `Request`, `Response`, `WebSocket`, and `EventSource`.
- `target` defaults to `globalThis`; the explicit target exists for deterministic descriptor tests and is part of the real implementation path, not a test-only production method.

- [ ] **Step 1: Write fixed-error disclosure tests**

```ts
test("normalizes unknown errors without carrying sentinel or cause", () => {
  const sentinel = "provider-refresh-token-must-not-escape";
  const normalized = normalizeSafeAuthUiError(new Error(sentinel));
  assert.equal(normalized.message, "AUTH_UI_UNEXPECTED_FAILURE");
  assert.equal(normalized.code, "AUTH_UI_UNEXPECTED_FAILURE");
  assert.equal("cause" in normalized, false);
  assert.equal(JSON.stringify(normalized).includes(sentinel), false);
});

test("preserves an existing fixed safe error", () => {
  const error = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");
  assert.equal(normalizeSafeAuthUiError(error), error);
});
```

- [ ] **Step 2: Run the error test and verify RED**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test support/safe-ui-error.test.ts
```

Expected: FAIL because the implementation module does not exist.

- [ ] **Step 3: Implement safe errors minimally**

`SafeAuthUiError` sets `name`, `code`, and `message` to fixed literals and does
not accept options or `cause`. `normalizeSafeAuthUiError` returns known instances
unchanged and maps every other value to `AUTH_UI_UNEXPECTED_FAILURE`.

- [ ] **Step 4: Write Tripwire RED tests**

Use a configurable fake target and test all six names:

```ts
test("blocks every configured transport and restores descriptors", async () => {
  const original = () => "original";
  const target = Object.fromEntries(
    transportGlobalNames.map((name) => [name, original]),
  );

  await withTransportTripwire(async () => {
    for (const name of transportGlobalNames) {
      assert.throws(
        () => Reflect.apply(Reflect.get(target, name) as Function, undefined, []),
        (error) => error instanceof SafeAuthUiError
          && error.code === "AUTH_UI_TRANSPORT_BLOCKED",
      );
    }
  }, target);

  for (const name of transportGlobalNames) {
    assert.equal(Reflect.get(target, name), original);
  }
});
```

Also test:

- a property absent before installation is deleted afterward;
- descriptors restore after callback rejection;
- a non-configurable transport fails closed before callback execution;
- a nested installation fails with `AUTH_UI_TRANSPORT_BLOCKED`;
- the real `globalThis.fetch` is blocked inside the callback and restored afterward.

- [ ] **Step 5: Run Tripwire tests and verify RED**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test support/transport-tripwire.test.ts
```

Expected: FAIL because `transport-tripwire.ts` does not exist.

- [ ] **Step 6: Implement descriptor-safe Tripwire**

Use a module-scoped active flag. Before callback execution:

```ts
const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
for (const name of transportGlobalNames) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (descriptor !== undefined && descriptor.configurable !== true) {
    throw new SafeAuthUiError("AUTH_UI_TRANSPORT_BLOCKED");
  }
  descriptors.set(name, descriptor);
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    writable: false,
    value: blockedTransport,
  });
}
```

Restore exact descriptors or delete previously absent properties in `finally`.
Reset the active flag only after restoration.

- [ ] **Step 7: Include support files and run verification**

Change `tests/e2e/tsconfig.json` include to:

```json
["*.ts", "ui/**/*.ts", "ui/**/*.tsx", "support/**/*.ts"]
```

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test support/safe-ui-error.test.ts support/transport-tripwire.test.ts
pnpm --filter @account-book/e2e typecheck
pnpm lint
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- tests/e2e/support/safe-ui-error.ts tests/e2e/support/safe-ui-error.test.ts tests/e2e/support/transport-tripwire.ts tests/e2e/support/transport-tripwire.test.ts tests/e2e/tsconfig.json
git commit -m "test: add auth UI transport tripwire"
```

---

### Task 3: Build `AuthUi`, register safe tests, and migrate the real spec

**Role:** Frontend/E2E implementer; frontend reviewer; read-only backend reviewer verifies `auth-response.spec.ts` ownership is unchanged.

**Files:**
- Create: `tests/e2e/support/auth-ui-driver.ts`
- Create: `tests/e2e/support/safe-ui-test.ts`
- Create: `tests/e2e/support/safe-ui-test.test.ts`
- Modify: `tests/e2e/ui/auth-ui.spec.ts`
- Modify: `tests/e2e/playwright.config.ts`
- Modify: `tests/e2e/playwright-config.test.ts`

**Interfaces:**

```ts
export type TestCredentials = Readonly<{
  email: string;
  password: string;
}>;

export interface AuthUi {
  openLogin(): Promise<void>;
  assertLoginUsable(): Promise<void>;
  submit(credentials: TestCredentials): Promise<void>;
  assertRejected(): Promise<void>;
  assertAuthenticated(): Promise<void>;
  assertNoBrowserCredentials(): Promise<void>;
  assertNoAuthorizationHeaders(): Promise<void>;
}

export function createAuthUi(input: Readonly<{
  page: Page;
  context: BrowserContext;
}>): AuthUi;

export type AuthTestFixtures = Readonly<{ authUi: AuthUi }>;

export function createAuthTestFixtures(authUi: AuthUi): AuthTestFixtures;

export async function runAuthUiCallback(
  callback: (fixtures: AuthTestFixtures) => Promise<void>,
  fixtures: AuthTestFixtures,
): Promise<void>;

export function authTest(
  title: string,
  callback: (fixtures: AuthTestFixtures) => Promise<void>,
): void;
```

- The UI Gate permits UI specs to import only the value `authTest`.
  `createAuthTestFixtures` and `runAuthUiCallback` are safe support-test seams;
  neither accepts nor returns a raw Playwright/network capability.

- [ ] **Step 1: Migrate the spec first and verify RED**

Replace `tests/e2e/ui/auth-ui.spec.ts` with:

```ts
import { authTest } from "../support/safe-ui-test.js";

const email = "verified@example.test";
const password = "correct horse battery staple";

authTest("login is responsive, labelled, keyboard reachable, and axe-clean", async ({ authUi }) => {
  await authUi.openLogin();
  await authUi.assertLoginUsable();
});

authTest("failed login stays fixed and never creates browser token state", async ({ authUi }) => {
  await authUi.openLogin();
  await authUi.submit({ email, password: `${password}!wrong` });
  await authUi.assertRejected();
  await authUi.assertNoBrowserCredentials();
  await authUi.assertNoAuthorizationHeaders();
});

authTest("successful login creates only an opaque cookie and reaches the application route", async ({ authUi }) => {
  await authUi.openLogin();
  await authUi.submit({ email, password });
  await authUi.assertAuthenticated();
  await authUi.assertNoBrowserCredentials();
  await authUi.assertNoAuthorizationHeaders();
});
```

The approved Gate originally permits `submit` shorthand only. Extend the
argument grammar narrowly to also permit the exact failed-login template
`` `${password}!wrong` `` whose identifier resolves to a top-level string
constant; add a RED mutation for arbitrary template expressions before doing so.

Run:

```powershell
pnpm --filter @account-book/e2e typecheck
```

Expected: FAIL because `safe-ui-test.ts` does not exist.

- [ ] **Step 2: Write callback payload and normalization tests**

```ts
test("exposes only one frozen authUi fixture", () => {
  const authUi = {} as AuthUi;
  const fixtures = createAuthTestFixtures(authUi);
  assert.deepEqual(Object.keys(fixtures), ["authUi"]);
  assert.equal(fixtures.authUi, authUi);
  assert.equal(Object.isFrozen(fixtures), true);
});
```

Add a test that invokes the internal callback runner with an error containing
the provider sentinel and sees only `AUTH_UI_UNEXPECTED_FAILURE`. The callback
runner is used by `authTest`; do not add a test-only path.

- [ ] **Step 3: Run the callback helper tests and verify RED**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test support/safe-ui-test.test.ts
```

Expected: FAIL because `safe-ui-test.ts` does not exist.

- [ ] **Step 4: Implement the frozen payload and callback error boundary**

Create `auth-ui-driver.ts` with the exact `TestCredentials` and `AuthUi`
interfaces from this task's Interfaces block, but do not add raw Playwright
fields to either type. Then create the initial `safe-ui-test.ts` with type-only
`AuthUi` import and these helper implementations:

```ts
export function createAuthTestFixtures(authUi: AuthUi): AuthTestFixtures {
  return Object.freeze({ authUi });
}

export async function runAuthUiCallback(
  callback: (fixtures: AuthTestFixtures) => Promise<void>,
  fixtures: AuthTestFixtures,
): Promise<void> {
  try {
    await callback(fixtures);
  } catch (error) {
    throw normalizeSafeAuthUiError(error);
  }
}
```

Run the Step 3 command again. Expected: callback helper tests pass even though
the actual `authTest` registration and driver remain to be implemented.

- [ ] **Step 5: Implement the driver error boundary and request boolean recorder**

Create `createAuthUi`. Register exactly one request listener during construction:

```ts
const authorizationPresence: Array<Promise<boolean>> = [];
page.on("request", function authorizationRecorder(request) {
  authorizationPresence.push(
    request.headerValue("authorization").then((value) => value !== null),
  );
});
```

Implement:

```ts
async function runStep(
  code: SafeAuthUiErrorCode,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch {
    throw new SafeAuthUiError(code);
  }
}
```

No raw error is assigned to a field, logged, or set as `cause`.

- [ ] **Step 6: Implement each `AuthUi` method with no outward data**

`openLogin`:

```ts
await runStep("AUTH_UI_LOGIN_NOT_READY", async () => {
  await page.goto("/login");
});
```

`assertLoginUsable` checks:

- email/password inputs visible;
- both labels have non-empty text;
- first Tab focuses email;
- browser-realm overflow is `<= 0`;
- `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()`
  returns zero violations.

Do not use a Playwright assertion whose rich error can escape `runStep`.

`submit` fills `#sign-in-email`, `#sign-in-password`, and clicks the first
`button[type="submit"]`.

`assertRejected` checks the visible fixed alert, `/login` suffix, and absence
of `__Host-ab_session`.

`assertAuthenticated` waits for `**/app`, checks `/app`, and verifies exactly
one cookie with:

```ts
{
  httpOnly: true,
  name: "__Host-ab_session",
  path: "/",
  sameSite: "Lax",
  secure: true,
}
```

It also verifies the selector with `/^[A-Za-z0-9_-]{43}$/u` internally.

`assertNoBrowserCredentials` projects local/session storage inside
`page.evaluate`, permits only `__next_debug_channel:<safe-id>` session keys,
and rejects the exact provider sentinel
`e2e-provider-refresh-token-must-never-reach-browser`, access/refresh token
labels, and compact JWT shapes without returning the serialized value.

`assertNoAuthorizationHeaders` awaits the boolean promises and rejects any
`true` without returning the array.

- [ ] **Step 7: Implement `authTest` with Tripwire and frozen payload**

Use base Playwright `test` internally:

```ts
export function authTest(
  title: string,
  callback: (fixtures: AuthTestFixtures) => Promise<void>,
): void {
  baseTest(title, async ({ page, context }) => {
    const authUi = createAuthUi({ page, context });
    await withTransportTripwire(async () => {
      await runAuthUiCallback(callback, createAuthTestFixtures(authUi));
    });
  });
}
```

The raw fixtures are never added to the callback payload.

- [ ] **Step 8: Lock artifact policy in config and RED/GREEN tests**

Set:

```ts
use: {
  baseURL,
  browserName: "chromium",
  ignoreHTTPSErrors: true,
  screenshot: "off",
  video: "off",
  trace: "off",
},
```

Add exact assertions to `playwright-config.test.ts` for all three values.
Run the config test before modifying the config to observe RED, then run it
afterward to observe GREEN.

- [ ] **Step 9: Run focused, type, and actual browser verification**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test support/safe-ui-test.test.ts playwright-config.test.ts ui-facade-boundary.test.ts
pnpm --filter @account-book/e2e typecheck
pnpm lint
pnpm --filter @account-book/e2e test
git diff --check
```

Expected locally:

- focused tests, typecheck, lint, and diff check exit `0`;
- both UI projects and HTTP project pass when disposable PostgreSQL and
  Chromium prerequisites exist;
- if local prerequisites are unavailable, record the fail-closed output and
  defer authority to exact-SHA CI without claiming success.

- [ ] **Step 10: Commit Task 3**

```powershell
git add -- tests/e2e/support/auth-ui-driver.ts tests/e2e/support/safe-ui-test.ts tests/e2e/support/safe-ui-test.test.ts tests/e2e/ui/auth-ui.spec.ts tests/e2e/playwright.config.ts tests/e2e/playwright-config.test.ts tests/e2e/ui-facade-boundary.ts tests/e2e/ui-facade-boundary.test.ts
git commit -m "test: route auth UI through safe facade"
```

---

### Task 4: Cut over preflight and retire the provenance analyzer

**Role:** Security developer implementer; security reviewer; project-lead scope reviewer.

**Files:**
- Modify: `tests/e2e/ui-facade-boundary.test.ts`
- Modify: `tests/e2e/package.json`
- Modify: `tests/e2e/README.md`
- Delete: `tests/e2e/ui-network-boundary.ts`
- Delete: `tests/e2e/ui-network-boundary.test.ts`

**Interfaces:**
- Consumes: the Gate, wrapper, driver, Tripwire, and migrated real spec from Tasks 1–3.
- Produces: one authoritative preflight path with no legacy string-provenance analyzer.

- [ ] **Step 1: Add actual-spec and threat-parity tests before deletion**

Add:

```ts
test("accepts the real auth UI spec", () => {
  assert.deepEqual(
    findUiFacadeBoundaryViolations({
      rootDirectory: fileURLToPath(new URL("./ui", import.meta.url)),
      rootFile: fileURLToPath(new URL("./ui/auth-ui.spec.ts", import.meta.url)),
    }),
    [],
  );
});
```

Create a table mapping every legacy threat family to a new Gate or runtime test:

- external/default/namespace/aliased/local/dynamic import;
- fetch/XHR/Request/Response/WebSocket/EventSource;
- Page/Context/Request/Route/APIRequestContext/Locator access;
- response consumption/status/navigation response;
- event observers and Authorization raw retention;
- alias, declaration/assignment destructuring, call/apply/bind, computed access;
- eval/Function/script injection;
- root escape and unsupported extension.

Each family must point to at least one named new test. Add any missing mutation
before deleting legacy tests, and observe RED before the covering Gate change.

- [ ] **Step 2: Run new and legacy suites together**

Run:

```powershell
pnpm --filter @account-book/e2e exec tsx --test ui-facade-boundary.test.ts ui-network-boundary.test.ts support/safe-ui-error.test.ts support/transport-tripwire.test.ts support/safe-ui-test.test.ts
```

Expected: both old and new suites pass before deletion.

- [ ] **Step 3: Switch preflight to the new boundary**

Set `test:preflight` to:

```json
"tsx --test production-fake-startup.test.ts playwright-environment.test.ts playwright-config.test.ts auth-response-policy.test.ts ui-facade-boundary.test.ts support/safe-ui-error.test.ts support/transport-tripwire.test.ts support/safe-ui-test.test.ts"
```

- [ ] **Step 4: Delete the legacy analyzer only after parity is GREEN**

Delete:

```text
tests/e2e/ui-network-boundary.ts
tests/e2e/ui-network-boundary.test.ts
```

Use native PowerShell `Remove-Item -LiteralPath` for these exact two files or
the patch tool; do not run a recursive delete.

- [ ] **Step 5: Document extension rules in the E2E README**

Add a Korean section explaining:

- UI specs import only `authTest`;
- HTTP assertions belong in `auth-response.spec.ts`;
- new `AuthUi` methods require a security code, RED Gate mutation, Tripwire
  compatibility, real mobile/desktop Chromium, and independent review;
- artifacts remain off;
- no exception may expose raw Playwright or network objects.

- [ ] **Step 6: Run full local verification**

Run:

```powershell
pnpm setup:hooks
pnpm run verify
pnpm --filter @account-book/e2e typecheck
pnpm --filter @account-book/e2e test:preflight
git diff --check
```

Then, when local prerequisites exist:

```powershell
pnpm run test:db
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e test
pnpm audit --prod --audit-level high
```

Record exact pass counts and every fail-closed local limitation.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- tests/e2e/ui-facade-boundary.test.ts tests/e2e/package.json tests/e2e/README.md tests/e2e/ui-network-boundary.ts tests/e2e/ui-network-boundary.test.ts
git commit -m "test: retire UI provenance analyzer"
```

The deleted paths are intentionally included so Git stages their removal.

---

### Task 5: Obtain exact-SHA evidence and update Korean/English security documentation

**Role:** Project-lead/documentation implementer; independent security reviewer; read-only frontend and backend reviewers.

**Files:**
- Modify: `docs/guides/security-auth-testing.md`
- Modify: `docs/architecture/backend-authentication.ko.md`
- Modify: `docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md`
- Modify: `docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-safe-auth-ui-capability-facade-design.md`

**Interfaces:**
- Consumes: clean reviewed code HEAD from Task 4.
- Produces: code-SHA and final-document-SHA push/PR evidence, with M1 closure
  decision kept separate from D2 and penetration-test release blockers.

- [ ] **Step 1: Confirm scope and push the exact code SHA**

Run:

```powershell
git status -sb
git diff --check
$codeSha = git rev-parse HEAD
git push -u origin feature/security-auth-foundation
$codeRuns = gh run list --repo jawon0407/account-book --commit $codeSha --json databaseId,event,headSha,status,conclusion,workflowName,url --limit 10 | ConvertFrom-Json
$codeRuns | ForEach-Object { gh run watch $_.databaseId --repo jawon0407/account-book --exit-status }
gh run list --repo jawon0407/account-book --commit $codeSha --json databaseId,event,headSha,status,conclusion,workflowName,url --limit 10
```

Expected:

- tracked worktree is clean;
- exactly one push and one pull-request `security-gate` run have
  `headSha=$codeSha`;
- both reach `status=completed`, `conclusion=success`.

Do not edit documentation until both exact code-SHA runs succeed.

- [ ] **Step 2: Record implementation and evidence without overclaiming**

Update all five documents with literal values from the completed commands:

- facade code SHA;
- push/PR run IDs and URLs;
- RED/GREEN commands and counts;
- local limitations;
- explicit replacement of the string-provenance analyzer;
- UI/HTTP ownership;
- artifact-off policy;
- independent review status.

Mark `d1a71a2`, `5cda542`, `5729d98`, and `ef0d1bc` as historical intermediate
evidence rather than final closure evidence. State that M1 remains blocked
until the final documentation SHA and independent branch review succeed.

- [ ] **Step 3: Validate and commit documentation**

Run:

```powershell
rg -n "TBD|TODO|미정|추후 결정" docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md docs/superpowers/specs/2026-07-29-safe-auth-ui-capability-facade-design.md
pnpm lint
git diff --check
git diff --stat
```

Expected: placeholder search returns no unresolved placeholder and therefore
`rg` exits `1`; lint and diff validation exit `0`.

Commit:

```powershell
git add -- docs/guides/security-auth-testing.md docs/architecture/backend-authentication.ko.md docs/superpowers/specs/2026-07-23-auth-e2e-boundary-design.md docs/superpowers/specs/2026-07-27-auth-ui-no-response-boundary-design.md docs/superpowers/specs/2026-07-29-safe-auth-ui-capability-facade-design.md
git commit -m "docs: record safe auth UI facade evidence"
```

- [ ] **Step 4: Push and verify the exact final documentation SHA**

Run:

```powershell
$finalSha = git rev-parse HEAD
git push origin feature/security-auth-foundation
$finalRuns = gh run list --repo jawon0407/account-book --commit $finalSha --json databaseId,event,headSha,status,conclusion,workflowName,url --limit 10 | ConvertFrom-Json
$finalRuns | ForEach-Object { gh run watch $_.databaseId --repo jawon0407/account-book --exit-status }
gh run list --repo jawon0407/account-book --commit $finalSha --json databaseId,event,headSha,status,conclusion,workflowName,url --limit 10
```

Expected: push and pull-request `security-gate` runs both use `$finalSha` and
reach `completed/success`.

- [ ] **Step 5: Run the final role reviews**

Generate a review package from the pre-plan base through `$finalSha`.

- Security reviewer: threat model, facade acquisition boundary, Tripwire,
  diagnostic/artifact disclosure, mutation honesty.
- Frontend reviewer: API readability, responsive/mobile/desktop behavior,
  accessibility behavior, future extension rule.
- Backend reviewer: confirms HTTP status/body/CSRF/logout/replay ownership and
  backend code are unchanged.
- Project lead/planner: scope, commits, exact-SHA evidence, documentation
  consistency, M1/M2 gate.

Any Critical or Important finding enters the bounded SDD fix loop. Do not
declare M1 complete while such a finding remains.

- [ ] **Step 6: Record the final decision**

When all final reviews are clean:

- mark M1.1 complete in the ignored SDD ledger;
- confirm M1 may close;
- keep D2 hosted-provider/TLS and professional penetration testing as
  production release blockers;
- do not automatically begin M2 until the controller updates the milestone
  plan and reports the transition.

Run:

```powershell
git status -sb
git rev-parse HEAD
git rev-parse origin/feature/security-auth-foundation
```

Expected: local and origin SHAs match and the tracked worktree is clean.
