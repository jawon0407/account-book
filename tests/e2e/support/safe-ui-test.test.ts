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

/**
 * 테스트가 완료 시점을 정할 Promise와 resolve 함수를 만든다.
 * @returns {promise,resolve}. resolve(value)는 T 또는 PromiseLike<T>로 대기를 완료한다.
 */
function deferred<T>() {
  /** 초기 resolve 자리표시자다. Promise 생성 시 실제 완료 함수로 교체되며 호출해도 상태를 바꾸지 않는다. */
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

/**
 * Map으로 독립 Storage 대역을 만든다.
 * @param entries - 초기 [키,값] 문자열 쌍 목록이다.
 * @returns 실제 브라우저 저장소와 분리된 메모리 대역이다.
 */
function createStorage(entries: readonly StorageEntry[]): Storage {
  const values = new Map(entries);
  return {
    /**
     * 대역의 모든 항목을 제거한다.
     * @returns 반환값 없음. 내부 Map만 변경한다.
     */
    clear() {
      values.clear();
    },
    /**
     * 지정 키의 저장값을 읽는다.
     * @param key - 조회할 키다.
     * @returns 값 또는 없으면 null이다.
     */
    getItem(key) {
      return values.get(key) ?? null;
    },
    /**
     * 삽입 순서상 지정 위치의 키를 읽는다.
     * @param index - 0부터 시작하는 위치다.
     * @returns 키 또는 범위 밖이면 null이다.
     */
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    /**
     * 현재 항목 수를 읽는다.
     * @returns 내부 Map 크기. 상태를 바꾸지 않는다.
     */
    get length() {
      return values.size;
    },
    /**
     * 지정 키를 내부 Map에서 제거한다.
     * @param key - 삭제할 키. 없는 키는 무시한다.
     * @returns 반환값 없음.
     */
    removeItem(key) {
      values.delete(key);
    },
    /**
     * 내부 Map에 값을 추가하거나 덮어쓴다.
     * @param key - 저장 키다.
     * @param value - 저장 문자열이다.
     * @returns 반환값 없음.
     */
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

/**
 * 전역 저장소를 대역으로 교체해 동기 작업 후 원래 descriptor를 복원한다.
 * @param local - localStorage 초기 항목이다.
 * @param session - sessionStorage 초기 항목이다.
 * @param operation - 실행할 동기 함수다.
 * @returns T 결과. 예외는 전파하고 finally에서 복원한다. 비동기 완료를 기다리지는 않는다.
 */
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

/**
 * 브라우저 없이 인증 driver를 검사할 Page/Context 대역과 호출 기록을 만든다.
 * @param options - 문구·가시성·URL·쿠키·저장소·헤더 및 대기 응답이다.
 * @returns page/context, calls, emitRequest와 리스너 수 조회 함수를 제공한다.
 */
function createDriverHarness(options: DriverHarnessOptions = {}) {
  const calls: Array<readonly [string, unknown?]> = [];
  let requestListener:
    | ((request: Pick<Request, "headerValue">) => void)
    | undefined;
  let requestListenerCount = 0;
  const cookies = options.cookies ?? [];
  const page = {
    /**
     * 저장소 대역으로 페이지 평가 함수를 현재 테스트 프로세스에서 실행한다.
     * @param operation - 동기 평가 callback이다.
     * @returns 결과 Promise. 실제 브라우저에서는 실행하지 않는다.
     */
    evaluate(operation: () => unknown) {
      return Promise.resolve(runWithStorage(
        options.local ?? [],
        options.session ?? [],
        operation,
      ));
    },
    /**
     * 이동 요청을 호출 기록에 남긴다.
     * @param url - 기록할 목적지다.
     * @returns null Promise. 실제 탐색은 없다.
     */
    goto(url: string) {
      calls.push(["goto", url]);
      return Promise.resolve(null);
    },
    keyboard: {
      /**
       * 키보드 입력 의도를 기록한다.
       * @param key - Tab 등 눌렀다고 가정할 키다.
       * @returns 완료 Promise. 실제 키 입력은 없다.
       */
      press(key: string) {
        calls.push(["press", key]);
        return Promise.resolve();
      },
    },
    /**
     * selector별 UI 조작·조회 대역을 만든다.
     * @param selector - driver의 CSS selector다.
     * @returns 옵션으로 응답하고 호출을 기록하는 locator다.
     */
    locator(selector: string) {
      const locator = {
        /**
         * 현재 selector의 클릭 의도를 기록한다.
         * @returns 완료 Promise. 실제 클릭은 없다.
         */
        click() {
          calls.push(["click", selector]);
          return Promise.resolve();
        },
        /**
         * 요소 포커스 검사를 항상 성공으로 재현한다.
         * @returns true Promise. 전달된 DOM callback은 실행하지 않는다.
         */
        evaluate() {
          return Promise.resolve(true);
        },
        /**
         * selector와 합성 입력값을 기록한다.
         * @param value - 입력했다고 가정할 문자열이다.
         * @returns 완료 Promise. 실제 DOM 변경은 없다.
         */
        fill(value: string) {
          calls.push(["fill", [selector, value]]);
          return Promise.resolve();
        },
        /**
         * 첫 요소 선택 체이닝을 같은 대역으로 연결한다.
         * @returns 현재 locator. 실제 요소 검색은 없다.
         */
        first() {
          return locator;
        },
        /**
         * 이메일·alert별 지정 가시성 또는 기본 true를 제공한다.
         * @returns 가시성 Promise. 실제 DOM 조회는 없다.
         */
        isVisible() {
          if (selector === "#sign-in-email") {
            return Promise.resolve(options.emailVisible ?? true);
          }
          if (selector === '.auth-status[role="alert"]') {
            return Promise.resolve(options.alertVisible ?? true);
          }
          return Promise.resolve(true);
        },
        /**
         * alert에는 지정 거부 문구, 나머지는 고정 Label을 제공한다.
         * @returns 텍스트 Promise. 실제 페이지 내용은 읽지 않는다.
         */
        textContent() {
          return Promise.resolve(
            selector === '.auth-status[role="alert"]'
              ? options.alertText ?? "!이메일 또는 비밀번호를 확인해 주세요."
              : "Label",
          );
        },
        /**
         * alert 준비 시점을 주입된 대기 함수로 제어한다.
         * @returns alertWait 결과 또는 즉시 완료 Promise. 주입 함수 실패는 전파한다.
         */
        waitFor() {
          return options.alertWait?.() ?? Promise.resolve();
        },
      };
      return locator;
    },
    /**
     * request 리스너 등록 횟수와 마지막 callback을 보관한다.
     * @param event - request만 허용하며 다른 값은 assertion 실패다.
     * @param listener - 합성 요청을 받을 callback이다.
     * @returns page 대역. 실제 이벤트 구독은 없다.
     */
    on(event: string, listener: (request: Pick<Request, "headerValue">) => void) {
      assert.equal(event, "request");
      requestListenerCount += 1;
      requestListener = listener;
      return page;
    },
    /**
     * 지정 URL 또는 기본 로그인 URL을 제공한다.
     * @returns URL 문자열. goto 기록과 자동 동기화하지 않는다.
     */
    url() {
      return options.url ?? "https://127.0.0.1:4512/login";
    },
    /**
     * URL 대기 의도를 기록하고 즉시 완료한다.
     * @param url - 기대 URL 패턴이다.
     * @returns 완료 Promise. 실제 탐색 여부는 검사하지 않는다.
     */
    waitForURL(url: string) {
      calls.push(["waitForURL", url]);
      return Promise.resolve();
    },
  };
  const context = {
    /**
     * 주입한 조회 함수 또는 고정 배열로 쿠키 조회를 재현한다.
     * @returns 쿠키 배열 Promise. 주입 함수 실패는 전파한다.
     */
    cookies() {
      return options.cookiesProvider?.() ?? Promise.resolve(cookies);
    },
  };

  return {
    calls,
    context: context as unknown as BrowserContext,
    /**
     * 저장한 request 리스너에 합성 요청을 전달한다.
     * @param headerValue - 헤더 조회 Promise 함수. 기본은 options.authorization 또는 null이다.
     * @returns 반환값 없음. 미등록 리스너는 assertion 실패다.
     */
    emitRequest(
      headerValue: () => Promise<string | null> = () =>
        Promise.resolve(options.authorization ?? null),
    ) {
      assert.ok(requestListener);
      requestListener({
        /**
         * 합성 요청의 헤더 조회를 주입 함수에 위임한다.
         * @param name - authorization이어야 한다.
         * @returns 헤더값 Promise. 다른 헤더 이름은 assertion 실패다.
         */
        headerValue(name: string) {
          assert.equal(name, "authorization");
          return headerValue();
        },
      });
    },
    page: page as unknown as Page,
    /**
     * request 리스너 등록 횟수를 읽는다.
     * @returns 현재 횟수. 기록을 초기화하지 않는다.
     */
    requestListenerCount: () => requestListenerCount,
  };
}

/**
 * 오류 이름·코드·비공개 필드 부재를 검사할 callback을 만든다.
 * @param code - 기대 공개 코드다.
 * @param sentinel - 결과에 없어야 할 선택 합성 비밀 문자열이다.
 * @returns error를 검사해 true를 반환하는 함수. 불일치는 assertion 실패다.
 */
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
    /**
     * alert 준비 이후 쿠키 조회 시점을 기록한다.
     * @returns 현재 cookies Promise. 호출 때 cookieReads를 증가시킨다.
     */
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
    /**
     * 실패하는 헤더 Promise를 재현해 rejection의 즉시 처리를 시험한다.
     * @param onfulfilled - 사용하지 않는 성공 callback이다.
     * @param onrejected - 합성 오류를 받을 실패 callback이다.
     * @returns 실패 callback 결과 Promise, callback이 없으면 false Promise다.
     */
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
  /**
   * 타입과 다른 반환값이 UI 경계를 넘어가지 않는지 시험한다.
   * @returns 합성 sentinel 객체 Promise. 반환값을 의도적으로 만든다.
   */
  const callback = (async () => ({ sentinel })) as unknown as (
    input: typeof fixtures
  ) => Promise<void>;

  const result = await runAuthUiCallback(callback, fixtures);

  assert.equal(result, undefined);
});
