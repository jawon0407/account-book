import assert from "node:assert/strict";
import test from "node:test";
import { SafeAuthUiError } from "./safe-ui-error.js";
import {
  transportGlobalNames,
  withTransportTripwire,
} from "./transport-tripwire.js";

type TransportName = typeof transportGlobalNames[number];

function isTransportBlocked(error: unknown): boolean {
  return error instanceof SafeAuthUiError
    && error.name === "SafeAuthUiError"
    && error.message === "AUTH_UI_TRANSPORT_BLOCKED"
    && error.code === "AUTH_UI_TRANSPORT_BLOCKED"
    && !("cause" in error);
}

function isUnexpectedFailure(error: unknown): boolean {
  return error instanceof SafeAuthUiError
    && error.name === "SafeAuthUiError"
    && error.message === "AUTH_UI_UNEXPECTED_FAILURE"
    && error.code === "AUTH_UI_UNEXPECTED_FAILURE"
    && !("cause" in error)
    && !("stack" in error);
}

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
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      getOwnPropertyDescriptor() {
        countTrap();
        throw new Error("descriptor-trap-must-not-escape");
      },
    }),
    name: "descriptor-throwing",
  },
  {
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      defineProperty() {
        countTrap();
        throw new Error("define-trap-must-not-escape");
      },
    }),
    name: "define-throwing",
  },
  {
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      defineProperty() {
        countTrap();
        return false;
      },
    }),
    name: "define-false",
  },
  {
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      defineProperty() {
        countTrap();
        return true;
      },
    }),
    name: "define-no-op",
  },
  {
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      deleteProperty() {
        countTrap();
        throw new Error("delete-trap-must-not-escape");
      },
    }),
    name: "delete-throwing",
  },
  {
    handler: (countTrap: () => void): ProxyHandler<object> => ({
      deleteProperty() {
        countTrap();
        return false;
      },
    }),
    name: "delete-false",
  },
  {
    handler: (countTrap: () => void): ProxyHandler<object> => ({
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
