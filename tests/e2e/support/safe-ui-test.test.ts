import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page, Request } from "@playwright/test";
import {
  createAuthUi,
  type AuthUi,
} from "./auth-ui-driver.js";
import {
  createAuthTestFixtures,
  runAuthUiCallback,
} from "./safe-ui-test.js";

type StorageEntry = readonly [string, string];

type DriverHarnessOptions = Readonly<{
  alertText?: string;
  alertWait?: () => Promise<void>;
  alertVisible?: boolean;
  authorization?: string | null;
  cookies?: Awaited<ReturnType<BrowserContext["cookies"]>>;
  cookiesProvider?: () => Promise<Awaited<ReturnType<BrowserContext["cookies"]>>>;
  emailVisible?: boolean;
  local?: readonly StorageEntry[];
  session?: readonly StorageEntry[];
  url?: string;
}>;

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createStorage(entries: readonly StorageEntry[]): Storage {
  const values = new Map(entries);
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function runWithStorage<T>(
  local: readonly StorageEntry[],
  session: readonly StorageEntry[],
  operation: () => T,
): T {
  const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperties(globalThis, {
    localStorage: {
      configurable: true,
      value: createStorage(local),
    },
    sessionStorage: {
      configurable: true,
      value: createStorage(session),
    },
  });
  try {
    return operation();
  } finally {
    if (localDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", localDescriptor);
    }
    if (sessionDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    } else {
      Object.defineProperty(globalThis, "sessionStorage", sessionDescriptor);
    }
  }
}

function createDriverHarness(options: DriverHarnessOptions = {}) {
  const calls: Array<readonly [string, unknown?]> = [];
  let requestListener:
    | ((request: Pick<Request, "headerValue">) => void)
    | undefined;
  let requestListenerCount = 0;
  const cookies = options.cookies ?? [];
  const page = {
    evaluate(operation: () => unknown) {
      return Promise.resolve(runWithStorage(
        options.local ?? [],
        options.session ?? [],
        operation,
      ));
    },
    goto(url: string) {
      calls.push(["goto", url]);
      return Promise.resolve(null);
    },
    keyboard: {
      press(key: string) {
        calls.push(["press", key]);
        return Promise.resolve();
      },
    },
    locator(selector: string) {
      const locator = {
        click() {
          calls.push(["click", selector]);
          return Promise.resolve();
        },
        evaluate() {
          return Promise.resolve(true);
        },
        fill(value: string) {
          calls.push(["fill", [selector, value]]);
          return Promise.resolve();
        },
        first() {
          return locator;
        },
        isVisible() {
          if (selector === "#sign-in-email") {
            return Promise.resolve(options.emailVisible ?? true);
          }
          if (selector === '.auth-status[role="alert"]') {
            return Promise.resolve(options.alertVisible ?? true);
          }
          return Promise.resolve(true);
        },
        textContent() {
          return Promise.resolve(
            selector === '.auth-status[role="alert"]'
              ? options.alertText ?? "!이메일 또는 비밀번호를 확인해 주세요."
              : "Label",
          );
        },
        waitFor() {
          return options.alertWait?.() ?? Promise.resolve();
        },
      };
      return locator;
    },
    on(event: string, listener: (request: Pick<Request, "headerValue">) => void) {
      assert.equal(event, "request");
      requestListenerCount += 1;
      requestListener = listener;
      return page;
    },
    url() {
      return options.url ?? "https://127.0.0.1:4512/login";
    },
    waitForURL(url: string) {
      calls.push(["waitForURL", url]);
      return Promise.resolve();
    },
  };
  const context = {
    cookies() {
      return options.cookiesProvider?.() ?? Promise.resolve(cookies);
    },
  };

  return {
    calls,
    context: context as unknown as BrowserContext,
    emitRequest(
      headerValue: () => Promise<string | null> = () =>
        Promise.resolve(options.authorization ?? null),
    ) {
      assert.ok(requestListener);
      requestListener({
        headerValue(name: string) {
          assert.equal(name, "authorization");
          return headerValue();
        },
      });
    },
    page: page as unknown as Page,
    requestListenerCount: () => requestListenerCount,
  };
}

function isFixedError(code: string, sentinel?: string) {
  return (error: unknown): boolean => {
    assert.equal((error as Error).name, "SafeAuthUiError");
    assert.equal((error as Error).message, code);
    assert.equal((error as { code?: unknown }).code, code);
    assert.equal("cause" in (error as object), false);
    assert.equal("stack" in (error as object), false);
    if (sentinel !== undefined) {
      assert.equal(JSON.stringify(error).includes(sentinel), false);
    }
    return true;
  };
}

test("exposes only one frozen authUi fixture", () => {
  const authUi = {} as AuthUi;
  const fixtures = createAuthTestFixtures(authUi);

  assert.deepEqual(Object.keys(fixtures), ["authUi"]);
  assert.deepEqual(Reflect.ownKeys(fixtures), ["authUi"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(fixtures, "authUi"), {
    configurable: false,
    enumerable: true,
    value: authUi,
    writable: false,
  });
  assert.equal(fixtures.authUi, authUi);
  assert.equal(Object.isFrozen(fixtures), true);
  assert.equal("page" in fixtures, false);
  assert.equal("context" in fixtures, false);
  assert.equal("request" in fixtures, false);
  assert.equal("response" in fixtures, false);
});

test("constructs one frozen null-prototype facade and registers one request listener", () => {
  const harness = createDriverHarness();

  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });

  assert.equal(harness.requestListenerCount(), 1);
  assert.equal(Object.getPrototypeOf(authUi), null);
  assert.equal(Object.isFrozen(authUi), true);
  assert.deepEqual(Reflect.ownKeys(authUi), [
    "openLogin",
    "assertLoginUsable",
    "submit",
    "assertRejected",
    "assertAuthenticated",
    "assertNoBrowserCredentials",
    "assertNoAuthorizationHeaders",
  ]);
  assert.equal("page" in authUi, false);
  assert.equal("context" in authUi, false);
  assert.equal("request" in authUi, false);
  assert.equal("response" in authUi, false);
});

test("runs login and submit operations without returning raw capability data", async () => {
  const harness = createDriverHarness();
  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });

  try {
    assert.equal(await authUi.openLogin(), undefined);
    assert.equal(await authUi.submit({
      email: "verified@example.test",
      password: "correct horse battery staple",
    }), undefined);
  } catch {
    assert.fail(`unexpected fixed failure after calls: ${JSON.stringify(harness.calls)}`);
  }
  assert.deepEqual(harness.calls, [
    ["goto", "/login"],
    ["fill", ["#sign-in-email", "verified@example.test"]],
    ["fill", ["#sign-in-password", "correct horse battery staple"]],
    ["click", 'button[type="submit"]'],
  ]);
});

test("verifies rejected and authenticated outcomes with fixed cookie policy", async () => {
  const rejectedHarness = createDriverHarness();
  const rejected = createAuthUi({
    context: rejectedHarness.context,
    page: rejectedHarness.page,
  });
  try {
    assert.equal(await rejected.assertRejected(), undefined);
  } catch {
    assert.fail(`unexpected rejected-state failure after calls: ${JSON.stringify(rejectedHarness.calls)}`);
  }

  const authenticatedHarness = createDriverHarness({
    cookies: [{
      domain: "127.0.0.1",
      expires: -1,
      httpOnly: true,
      name: "__Host-ab_session",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "a".repeat(43),
    }],
    url: "https://127.0.0.1:4512/app",
  });
  const authenticated = createAuthUi({
    context: authenticatedHarness.context,
    page: authenticatedHarness.page,
  });

  assert.equal(await authenticated.assertAuthenticated(), undefined);
  assert.deepEqual(authenticatedHarness.calls, [["waitForURL", "**/app"]]);
});

test("waits for the fixed alert before taking the rejected cookie snapshot", async () => {
  const alertReady = deferred<void>();
  let cookieReads = 0;
  let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
  const harness = createDriverHarness({
    alertWait: () => alertReady.promise,
    cookiesProvider() {
      cookieReads += 1;
      return Promise.resolve(cookies);
    },
  });
  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });

  const assertion = authUi.assertRejected();
  await Promise.resolve();
  assert.equal(cookieReads, 0);

  cookies = [{
    domain: "127.0.0.1",
    expires: -1,
    httpOnly: true,
    name: "__Host-ab_session",
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "a".repeat(43),
  }];
  alertReady.resolve();

  await assert.rejects(
    assertion,
    isFixedError("AUTH_UI_REJECTION_FAILED"),
  );
  assert.equal(cookieReads, 1);
});

test("rejects non-fixed failed-login alert content", async () => {
  const harness = createDriverHarness({
    alertText: "provider error detail must not be accepted",
  });
  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });

  await assert.rejects(
    authUi.assertRejected(),
    isFixedError("AUTH_UI_REJECTION_FAILED"),
  );
});

test("projects browser storage to a boolean and rejects credential material", async () => {
  const safeHarness = createDriverHarness({
    session: [["__next_debug_channel:safe-id", "debug"]],
  });
  const safeAuthUi = createAuthUi({
    context: safeHarness.context,
    page: safeHarness.page,
  });
  assert.equal(await safeAuthUi.assertNoBrowserCredentials(), undefined);

  const sentinel = "e2e-provider-refresh-token-must-never-reach-browser";
  const unsafeHarness = createDriverHarness({
    local: [["provider", sentinel]],
  });
  const unsafeAuthUi = createAuthUi({
    context: unsafeHarness.context,
    page: unsafeHarness.page,
  });
  await assert.rejects(
    unsafeAuthUi.assertNoBrowserCredentials(),
    isFixedError("AUTH_UI_BROWSER_CREDENTIAL_DETECTED", sentinel),
  );
});

test("stores request authorization presence only as booleans", async () => {
  const safeHarness = createDriverHarness();
  const safeAuthUi = createAuthUi({
    context: safeHarness.context,
    page: safeHarness.page,
  });
  safeHarness.emitRequest();
  assert.equal(await safeAuthUi.assertNoAuthorizationHeaders(), undefined);

  const sentinel = "Bearer provider-secret-must-not-escape";
  const unsafeHarness = createDriverHarness({ authorization: sentinel });
  const unsafeAuthUi = createAuthUi({
    context: unsafeHarness.context,
    page: unsafeHarness.page,
  });
  unsafeHarness.emitRequest();
  await assert.rejects(
    unsafeAuthUi.assertNoAuthorizationHeaders(),
    isFixedError("AUTH_UI_AUTHORIZATION_HEADER_DETECTED", sentinel),
  );
});

test("projects a rejected authorization lookup immediately to fail-closed true", async () => {
  const sentinel = "raw-header-rejection-must-not-escape";
  const harness = createDriverHarness();
  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });
  const rejectedHeaderLookup = {
    then<TResult1 = string | null, TResult2 = never>(
      onfulfilled?: ((value: string | null) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      void onfulfilled;
      if (onrejected === undefined || onrejected === null) {
        return Promise.resolve(false as TResult1);
      }
      return Promise.resolve(onrejected(new Error(sentinel)));
    },
  } as Promise<string | null>;

  harness.emitRequest(() => rejectedHeaderLookup);

  await assert.rejects(
    authUi.assertNoAuthorizationHeaders(),
    isFixedError("AUTH_UI_AUTHORIZATION_HEADER_DETECTED", sentinel),
  );
});

test("drains a violating request appended while an earlier header lookup is pending", async () => {
  const firstHeader = deferred<string | null>();
  const harness = createDriverHarness();
  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });
  harness.emitRequest(() => firstHeader.promise);

  const assertion = authUi.assertNoAuthorizationHeaders();
  harness.emitRequest(() => Promise.resolve("Bearer second-request-secret"));
  firstHeader.resolve(null);

  await assert.rejects(
    assertion,
    isFixedError("AUTH_UI_AUTHORIZATION_HEADER_DETECTED"),
  );
});

test("maps rich driver failures to fixed public errors", async () => {
  const harness = createDriverHarness({ emailVisible: false });
  const authUi = createAuthUi({
    context: harness.context,
    page: harness.page,
  });

  await assert.rejects(
    authUi.assertLoginUsable(),
    isFixedError("AUTH_UI_LAYOUT_FAILED"),
  );

  const invalidSessionHarness = createDriverHarness({
    cookies: [{
      domain: "127.0.0.1",
      expires: -1,
      httpOnly: true,
      name: "__Host-ab_session",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "provider-session-value-must-not-escape",
    }],
    url: "https://127.0.0.1:4512/app",
  });
  const invalidSession = createAuthUi({
    context: invalidSessionHarness.context,
    page: invalidSessionHarness.page,
  });
  await assert.rejects(
    invalidSession.assertAuthenticated(),
    isFixedError(
      "AUTH_UI_SESSION_POLICY_FAILED",
      "provider-session-value-must-not-escape",
    ),
  );
});

test("normalizes callback failures without exposing the provider sentinel", async () => {
  const sentinel = "e2e-provider-refresh-token-must-never-reach-browser";
  const fixtures = createAuthTestFixtures({} as AuthUi);

  await assert.rejects(
    runAuthUiCallback(async () => {
      throw new Error(sentinel, { cause: { sentinel } });
    }, fixtures),
    (error) => {
      assert.equal((error as Error).name, "SafeAuthUiError");
      assert.equal((error as Error).message, "AUTH_UI_UNEXPECTED_FAILURE");
      assert.equal(
        (error as { code?: unknown }).code,
        "AUTH_UI_UNEXPECTED_FAILURE",
      );
      assert.equal("cause" in (error as object), false);
      assert.equal("stack" in (error as object), false);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      return true;
    },
  );
});

test("does not forward a runtime callback return value", async () => {
  const sentinel = "callback-return-must-not-escape";
  const fixtures = createAuthTestFixtures({} as AuthUi);
  const callback = (async () => ({ sentinel })) as unknown as (
    input: typeof fixtures
  ) => Promise<void>;

  const result = await runAuthUiCallback(callback, fixtures);

  assert.equal(result, undefined);
});
