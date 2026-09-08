import assert from "node:assert/strict";
import test from "node:test";
import { SafeAuthUiError } from "./safe-ui-error.js";
import {
  transportGlobalNames,
  withTransportTripwire,
} from "./transport-tripwire.js";

type TransportName = typeof transportGlobalNames[number];

/**
 * 전송 차단 오류가 고정 타입·이름·코드이고 cause가 없는지 검사한다.
 * @param error - 차단 동작에서 받은 임의 실패다.
 * @returns 조건을 모두 만족하면 true다.
 */
function isTransportBlocked(error: unknown): boolean {
  return error instanceof SafeAuthUiError
    && error.name === "SafeAuthUiError"
    && error.message === "AUTH_UI_TRANSPORT_BLOCKED"
    && error.code === "AUTH_UI_TRANSPORT_BLOCKED"
    && !("cause" in error);
}

/**
 * 일반 실패가 고정 안전 오류이며 cause/stack이 없는지 검사한다.
 * @param error - 정규화된 오류 후보다.
 * @returns 안전한 일반 실패 형태이면 true다.
 */
function isUnexpectedFailure(error: unknown): boolean {
  return error instanceof SafeAuthUiError
    && error.name === "SafeAuthUiError"
    && error.message === "AUTH_UI_UNEXPECTED_FAILURE"
    && error.code === "AUTH_UI_UNEXPECTED_FAILURE"
    && !("cause" in error)
    && !("stack" in error);
}

/**
 * 서로 다른 데이터/접근자 descriptor를 가진 전송 API 대역을 만든다.
 * @returns originals 함수 모음과 target. 복원 전후 참조·플래그 비교에 사용한다.
 */
function makeDescriptorTarget(): {
  originals: Record<TransportName, () => string>;
  target: object;
} {
  const originals = Object.fromEntries(
    transportGlobalNames.map((name) => [
      name,
      () => `original:${name}`,
    ]),
  ) as Record<TransportName, () => string>;
  /**
   * 접근자 setter의 동일성 복원을 검사할 무동작 함수를 제공한다.
   * @param value - 의도적으로 버리는 대입값이다.
   * @returns 반환값 없음. 어떤 상태도 변경하지 않는다.
   */
  const requestSetter = (value: unknown): void => {
    void value;
  };
  const target = {};

  Object.defineProperties(target, {
    fetch: {
      configurable: true,
      enumerable: true,
      value: originals.fetch,
      writable: true,
    },
    XMLHttpRequest: {
      configurable: true,
      enumerable: false,
      value: originals.XMLHttpRequest,
      writable: false,
    },
    Request: {
      configurable: true,
      enumerable: true,
      get: () => originals.Request,
      set: requestSetter,
    },
    Response: {
      configurable: true,
      enumerable: false,
      value: originals.Response,
      writable: true,
    },
    WebSocket: {
      configurable: true,
      enumerable: true,
      value: originals.WebSocket,
      writable: false,
    },
    EventSource: {
      configurable: true,
      enumerable: false,
      get: () => originals.EventSource,
    },
  });

  return { originals, target };
}

/**
 * 대상의 모든 전송 API 호출이 고정 차단 오류를 던지는지 검사한다.
 * @param target - tripwire가 설치된 객체다.
 * @returns 반환값 없음. Reflect.apply로 각 대역을 실제 호출하고 차단되지 않으면 assertion 실패다.
 */
function assertAllTransportsBlocked(target: object): void {
  for (const name of transportGlobalNames) {
    assert.throws(
      () => Reflect.apply(
        Reflect.get(target, name) as (...arguments_: unknown[]) => unknown,
        undefined,
        [],
      ),
      isTransportBlocked,
      `${name} must throw the fixed transport error`,
    );
  }
}

test("blocks every configured transport and restores exact descriptors", async () => {
  const { target } = makeDescriptorTarget();
  const before = Object.getOwnPropertyDescriptors(target);

  await withTransportTripwire(async () => {
    assertAllTransportsBlocked(target);
    const installedValue = Object.getOwnPropertyDescriptor(
      target,
      "fetch",
    )?.value;
    for (const name of transportGlobalNames) {
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(target, name),
        {
          configurable: true,
          enumerable: before[name]?.enumerable ?? false,
          value: installedValue,
          writable: false,
        },
        `${name} must have the exact blocker descriptor`,
      );
    }
  }, target);

  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
});

test("deletes every transport property that was absent before installation", async () => {
  const target = {};

  await withTransportTripwire(async () => {
    assertAllTransportsBlocked(target);
  }, target);

  assert.deepEqual(Object.getOwnPropertyDescriptors(target), {});
});

test("restores all exact descriptors after callback rejection and releases active state", async () => {
  const { target } = makeDescriptorTarget();
  const before = Object.getOwnPropertyDescriptors(target);
  const rejection = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");

  await assert.rejects(
    withTransportTripwire(async () => {
      throw rejection;
    }, target),
    (error) => error === rejection,
  );

  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);

  let nextOperationRan = false;
  await withTransportTripwire(async () => {
    nextOperationRan = true;
  }, target);
  assert.equal(nextOperationRan, true);
});

test("normalizes an unknown synchronous callback throw without disclosing its fields", async () => {
  const sentinel = "sync-callback-secret-must-not-escape";
  const { target } = makeDescriptorTarget();
  const before = Object.getOwnPropertyDescriptors(target);
  const original = new Error(sentinel, { cause: sentinel });
  original.stack = `local-path:${sentinel}`;
  Object.defineProperty(original, "customPath", {
    enumerable: true,
    value: `C:\\sensitive\\${sentinel}`,
  });
  /**
   * 비동기 타입을 가졌지만 동기적으로 원본 오류를 던지는 분기를 재현한다.
   * @returns 정상 반환 없이 합성 민감 필드가 있는 original 오류를 던진다.
   */
  const operation = (() => {
    throw original;
  }) as () => Promise<void>;

  await assert.rejects(
    withTransportTripwire(operation, target),
    (error) => {
      assert.equal(isUnexpectedFailure(error), true);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      return true;
    },
  );

  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
});

test("normalizes an unknown asynchronous callback rejection", async () => {
  const sentinel = "async-callback-secret-must-not-escape";
  const { target } = makeDescriptorTarget();
  const proxyError = new Proxy(
    new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED"),
    {
      /**
       * Proxy 오류 속성을 읽으면 추가 비밀 오류가 발생하는 적대적 대역이다.
       * @returns 정상 반환 없이 sentinel 오류를 던진다. 정규화가 이 trap을 읽지 않아야 한다.
       */
      get() {
        throw new Error(sentinel);
      },
    },
  );

  await assert.rejects(
    withTransportTripwire(async () => {
      await Promise.resolve();
      throw proxyError;
    }, target),
    (error) => {
      assert.equal(isUnexpectedFailure(error), true);
      assert.equal(error === proxyError, false);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      return true;
    },
  );
});

test("preserves a genuinely issued safe callback rejection", async () => {
  const { target } = makeDescriptorTarget();
  const rejection = new SafeAuthUiError("AUTH_UI_REJECTION_FAILED");

  await assert.rejects(
    withTransportTripwire(async () => {
      throw rejection;
    }, target),
    (error) => error === rejection,
  );
});

test("fails closed on a non-configurable transport before callback execution and restores prior installs", async () => {
  const sentinel = "descriptor-value-must-not-escape";
  const { originals, target } = makeDescriptorTarget();
  const nonConfigurableValue = Object.assign(
    () => sentinel,
    { descriptorValue: sentinel },
  );
  Object.defineProperty(target, "Response", {
    configurable: false,
    enumerable: true,
    value: nonConfigurableValue,
    writable: true,
  });
  const before = Object.getOwnPropertyDescriptors(target);
  let callbackRan = false;

  await assert.rejects(
    withTransportTripwire(async () => {
      callbackRan = true;
    }, target),
    (error) => {
      assert.equal(isTransportBlocked(error), true);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal((error as Error).stack?.includes(sentinel) ?? false, false);
      return true;
    },
  );

  assert.equal(callbackRan, false);
  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
  assert.equal(Reflect.get(target, "fetch"), originals.fetch);
});

test("rolls back partial installation on a non-extensible ordinary target", async () => {
  const { target } = makeDescriptorTarget();
  Reflect.deleteProperty(target, "Response");
  Reflect.deleteProperty(target, "WebSocket");
  Reflect.deleteProperty(target, "EventSource");
  Object.preventExtensions(target);
  const before = Object.getOwnPropertyDescriptors(target);
  let callbackRan = false;

  await assert.rejects(
    withTransportTripwire(async () => {
      callbackRan = true;
    }, target),
    isTransportBlocked,
  );

  assert.equal(callbackRan, false);
  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);

  let freshCallRan = false;
  await withTransportTripwire(async () => {
    freshCallRan = true;
  }, makeDescriptorTarget().target);
  assert.equal(freshCallRan, true);
});

test("rejects nested installation on a different target without releasing the outer tripwire", async () => {
  const outerTarget = makeDescriptorTarget().target;
  const innerTarget = makeDescriptorTarget().target;
  const outerBefore = Object.getOwnPropertyDescriptors(outerTarget);
  const innerBefore = Object.getOwnPropertyDescriptors(innerTarget);
  let nestedOperationRan = false;

  await withTransportTripwire(async () => {
    await assert.rejects(
      withTransportTripwire(async () => {
        nestedOperationRan = true;
      }, innerTarget),
      isTransportBlocked,
    );

    assert.equal(nestedOperationRan, false);
    assertAllTransportsBlocked(outerTarget);
    assert.deepEqual(
      Object.getOwnPropertyDescriptors(innerTarget),
      innerBefore,
    );
  }, outerTarget);

  assert.deepEqual(
    Object.getOwnPropertyDescriptors(outerTarget),
    outerBefore,
  );
});

test("rejects nested installation on the same target without releasing the outer tripwire", async () => {
  const target = makeDescriptorTarget().target;
  const before = Object.getOwnPropertyDescriptors(target);
  let nestedOperationRan = false;

  await withTransportTripwire(async () => {
    await assert.rejects(
      withTransportTripwire(async () => {
        nestedOperationRan = true;
      }, target),
      isTransportBlocked,
    );

    assert.equal(nestedOperationRan, false);
    assertAllTransportsBlocked(target);
  }, target);

  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
});

test("rejects a concurrent different-target installation until restoration completes", async () => {
  const firstTarget = makeDescriptorTarget().target;
  const secondTarget = makeDescriptorTarget().target;
  const firstBefore = Object.getOwnPropertyDescriptors(firstTarget);
  const secondBefore = Object.getOwnPropertyDescriptors(secondTarget);
  let enterFirst: (() => void) | undefined;
  let releaseFirst: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enterFirst = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let concurrentOperationRan = false;
  const firstOperation = withTransportTripwire(async () => {
    enterFirst?.();
    await release;
  }, firstTarget);

  await entered;
  await assert.rejects(
    withTransportTripwire(async () => {
      concurrentOperationRan = true;
    }, secondTarget),
    isTransportBlocked,
  );
  assert.equal(concurrentOperationRan, false);
  assertAllTransportsBlocked(firstTarget);
  releaseFirst?.();
  await firstOperation;

  assert.deepEqual(Object.getOwnPropertyDescriptors(firstTarget), firstBefore);
  assert.deepEqual(Object.getOwnPropertyDescriptors(secondTarget), secondBefore);

  await withTransportTripwire(async () => {
    concurrentOperationRan = true;
  }, secondTarget);
  assert.equal(concurrentOperationRan, true);
});

test("keeps active during restoration for nested same-target and different-target calls", async () => {
  const sentinel = "restore-timing-secret-must-not-escape";
  const target = makeDescriptorTarget().target;
  const differentTarget = makeDescriptorTarget().target;
  const before = Object.getOwnPropertyDescriptors(target);
  const differentBefore = Object.getOwnPropertyDescriptors(differentTarget);
  const reflectDefinePropertyDescriptor = Object.getOwnPropertyDescriptor(
    Reflect,
    "defineProperty",
  );
  assert.ok(reflectDefinePropertyDescriptor);
  const originalReflectDefineProperty = Reflect.defineProperty;
  let restorationStarted = false;
  let restoreObservationCount = 0;
  let nestedOperationRuns = 0;
  let sameTargetAttempt: Promise<boolean> | undefined;
  let differentTargetAttempt: Promise<boolean> | undefined;

  Object.defineProperty(Reflect, "defineProperty", {
    ...reflectDefinePropertyDescriptor,
    /**
     * 복원 시점의 Reflect.defineProperty를 관찰하여 중첩 차단이 유지되는지 시험한다.
     * @param instrumentedTarget - 속성을 정의할 대상이다.
     * @param propertyKey - 정의할 속성 키다.
     * @param attributes - 설치/복원할 descriptor다.
     * @returns 원래 Reflect.defineProperty 결과. 첫 fetch 복원 때 같은/다른 대상 중첩 실행을 시도한다.
     */
    value(
      instrumentedTarget: object,
      propertyKey: PropertyKey,
      attributes: PropertyDescriptor,
    ): boolean {
      if (
        restorationStarted
        && restoreObservationCount === 0
        && instrumentedTarget === target
        && propertyKey === "fetch"
        && attributes.value === before.fetch?.value
      ) {
        restoreObservationCount += 1;
        sameTargetAttempt = withTransportTripwire(async () => {
          nestedOperationRuns += 1;
          throw new Error(sentinel);
        }, target).then(
          () => false,
          isTransportBlocked,
        );
        differentTargetAttempt = withTransportTripwire(async () => {
          nestedOperationRuns += 1;
          throw new Error(sentinel);
        }, differentTarget).then(
          () => false,
          isTransportBlocked,
        );
      }
      return originalReflectDefineProperty(
        instrumentedTarget,
        propertyKey,
        attributes,
      );
    },
  });

  try {
    await withTransportTripwire(async () => {
      restorationStarted = true;
    }, target);
  } finally {
    Object.defineProperty(
      Reflect,
      "defineProperty",
      reflectDefinePropertyDescriptor,
    );
  }

  assert.equal(restoreObservationCount, 1);
  assert.ok(sameTargetAttempt);
  assert.ok(differentTargetAttempt);
  assert.equal(await sameTargetAttempt, true);
  assert.equal(await differentTargetAttempt, true);
  assert.equal(nestedOperationRuns, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
  assert.deepEqual(
    Object.getOwnPropertyDescriptors(differentTarget),
    differentBefore,
  );
});

test("blocks each transport as both a function call and a constructor", async () => {
  const { target } = makeDescriptorTarget();

  await withTransportTripwire(async () => {
    for (const name of transportGlobalNames) {
      const blocker = Reflect.get(target, name) as {
        new (): unknown;
        (): unknown;
      };
      assert.throws(() => blocker(), isTransportBlocked);
      assert.throws(() => new blocker(), isTransportBlocked);
    }
  }, target);
});

test("blocks and removes absent transports on an ordinary function target", async () => {
  /**
   * 함수도 전송 속성 설치 대상이 될 수 있는지 확인할 빈 함수다.
   * @returns 반환값 없음. 함수 본문은 아무 동작도 하지 않는다.
   */
  function target(): void {}

  for (const name of transportGlobalNames) {
    assert.equal(Object.getOwnPropertyDescriptor(target, name), undefined);
  }

  await withTransportTripwire(async () => {
    assertAllTransportsBlocked(target);
  }, target);

  for (const name of transportGlobalNames) {
    assert.equal(Object.getOwnPropertyDescriptor(target, name), undefined);
  }
});

test("does not execute original accessor getters while installing or restoring", async () => {
  const { originals, target } = makeDescriptorTarget();
  let getterCalls = 0;
  Object.defineProperty(target, "fetch", {
    configurable: true,
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return originals.fetch;
    },
  });
  const before = Object.getOwnPropertyDescriptors(target);

  await withTransportTripwire(async () => {
    assertAllTransportsBlocked(target);
    assert.equal(getterCalls, 0);
  }, target);

  assert.equal(getterCalls, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
});

test("rejects a runtime non-object target before callback execution", async () => {
  let callbackRuns = 0;

  for (const target of [null, 1, "target"]) {
    await assert.rejects(
      withTransportTripwire(async () => {
        callbackRuns += 1;
      }, target as unknown as object),
      isTransportBlocked,
    );
  }

  assert.equal(callbackRuns, 0);
  await withTransportTripwire(async () => {
    callbackRuns += 1;
  }, makeDescriptorTarget().target);
  assert.equal(callbackRuns, 1);
});

const proxyTrapFixtures = [
  {
    /** descriptor 조회가 원본 오류를 던지는 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** descriptor 접근 횟수를 기록하고 합성 오류를 던진다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      getOwnPropertyDescriptor() {
        countTrap();
        throw new Error("descriptor-trap-must-not-escape");
      },
    }),
    name: "descriptor-throwing",
  },
  {
    /** 속성 정의가 오류를 던지는 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** 정의 trap 실행을 기록하고 합성 오류를 던진다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      defineProperty() {
        countTrap();
        throw new Error("define-trap-must-not-escape");
      },
    }),
    name: "define-throwing",
  },
  {
    /** 속성 정의가 false로 거부되는 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** 정의 trap 실행을 기록하고 false로 거부한다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      defineProperty() {
        countTrap();
        return false;
      },
    }),
    name: "define-false",
  },
  {
    /** 정의가 성공했다고만 응답하는 무동작 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** 정의 trap 실행을 기록하고 실제 속성 변경 없이 true를 반환한다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      defineProperty() {
        countTrap();
        return true;
      },
    }),
    name: "define-no-op",
  },
  {
    /** 속성 삭제가 오류를 던지는 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** 삭제 trap 실행을 기록하고 합성 오류를 던진다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      deleteProperty() {
        countTrap();
        throw new Error("delete-trap-must-not-escape");
      },
    }),
    name: "delete-throwing",
  },
  {
    /** 속성 삭제가 false로 거부되는 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** 삭제 trap 실행을 기록하고 false로 거부한다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      deleteProperty() {
        countTrap();
        return false;
      },
    }),
    name: "delete-false",
  },
  {
    /** 삭제가 성공했다고만 응답하는 무동작 Proxy 대역을 만든다.
     * @param countTrap - trap이 실행되었음을 기록할 callback이다.
     * @returns 해당 실패/무동작 trap을 가진 ProxyHandler다. 생성만으로 trap은 실행하지 않는다.
     */
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      /** 삭제 trap 실행을 기록하고 실제 삭제 없이 true를 반환한다. 인자는 사용하지 않으며 원본 대상도 조작하지 않는다. */
      deleteProperty() {
        countTrap();
        return true;
      },
    }),
    name: "delete-no-op",
  },
] as const;

for (const fixture of proxyTrapFixtures) {
  test(`rejects a ${fixture.name} Proxy target before any trap or callback`, async () => {
    const backingTarget = makeDescriptorTarget().target;
    const before = Object.getOwnPropertyDescriptors(backingTarget);
    let trapCalls = 0;
    let callbackRuns = 0;
    const proxy = new Proxy(backingTarget, fixture.handler(() => {
      trapCalls += 1;
    }));

    await assert.rejects(
      withTransportTripwire(async () => {
        callbackRuns += 1;
      }, proxy),
      isTransportBlocked,
    );

    assert.equal(trapCalls, 0);
    assert.equal(callbackRuns, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(backingTarget), before);
  });
}

test("continues exact restoration after an ordinary descriptor becomes non-configurable", async () => {
  const { target } = makeDescriptorTarget();
  const before = Object.getOwnPropertyDescriptors(target);
  const freshTarget = makeDescriptorTarget().target;

  await assert.rejects(
    withTransportTripwire(async () => {
      const installed = Object.getOwnPropertyDescriptor(target, "Request");
      assert.ok(installed);
      Object.defineProperty(target, "Request", {
        ...installed,
        configurable: false,
      });
    }, target),
    isTransportBlocked,
  );

  for (const name of transportGlobalNames) {
    if (name === "Request") continue;
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(target, name),
      before[name],
      `${name} restoration must continue after Request fails`,
    );
  }
  const retained = Object.getOwnPropertyDescriptor(target, "Request");
  assert.equal(retained?.configurable, false);
  assert.throws(
    () => Reflect.apply(
      retained?.value as (...arguments_: unknown[]) => unknown,
      undefined,
      [],
    ),
    isTransportBlocked,
  );

  let nextOperationRan = false;
  await withTransportTripwire(async () => {
    nextOperationRan = true;
  }, freshTarget);
  assert.equal(nextOperationRan, true);
});

test("retains an ordinary absent-property blocker when exact deletion fails", async () => {
  const target = {};

  await assert.rejects(
    withTransportTripwire(async () => {
      const installed = Object.getOwnPropertyDescriptor(target, "Request");
      assert.ok(installed);
      Object.defineProperty(target, "Request", {
        ...installed,
        configurable: false,
      });
    }, target),
    isTransportBlocked,
  );

  for (const name of transportGlobalNames) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (name === "Request") {
      assert.equal(descriptor?.configurable, false);
      assert.throws(
        () => Reflect.apply(
          descriptor?.value as (...arguments_: unknown[]) => unknown,
          undefined,
          [],
        ),
        isTransportBlocked,
      );
    } else {
      assert.equal(descriptor, undefined, `${name} must still be deleted`);
    }
  }
});

test("prioritizes restoration failure over a genuine safe callback rejection", async () => {
  const { target } = makeDescriptorTarget();
  const callbackError = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");

  await assert.rejects(
    withTransportTripwire(async () => {
      const installed = Object.getOwnPropertyDescriptor(target, "Request");
      assert.ok(installed);
      Object.defineProperty(target, "Request", {
        ...installed,
        configurable: false,
      });
      throw callbackError;
    }, target),
    (error) => isTransportBlocked(error) && error !== callbackError,
  );
});

test("blocks and restores the real globalThis fetch descriptor", async () => {
  const before = Object.getOwnPropertyDescriptors(globalThis);

  await withTransportTripwire(async () => {
    assert.throws(
      () => Reflect.apply(globalThis.fetch, undefined, ["https://example.test"]),
      isTransportBlocked,
    );
  });

  for (const name of transportGlobalNames) {
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(globalThis, name),
      before[name],
      `${name} must be restored on globalThis`,
    );
  }
});
