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

test("rejects nested installation without releasing the outer tripwire", async () => {
  const { target } = makeDescriptorTarget();
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

test("normalizes installation failure, restores exact descriptors, and releases active state", async () => {
  const sentinel = "install-failure-must-not-escape";
  const { target } = makeDescriptorTarget();
  const before = Object.getOwnPropertyDescriptors(target);
  let callbackRan = false;
  let rejectInstall = true;
  const proxy = new Proxy(target, {
    defineProperty(innerTarget, property, descriptor) {
      if (rejectInstall && property === "Request") {
        rejectInstall = false;
        throw new Error(sentinel);
      }
      return Reflect.defineProperty(innerTarget, property, descriptor);
    },
  });

  await assert.rejects(
    withTransportTripwire(async () => {
      callbackRan = true;
    }, proxy),
    (error) => {
      assert.equal(isTransportBlocked(error), true);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal((error as Error).stack?.includes(sentinel) ?? false, false);
      return true;
    },
  );

  assert.equal(callbackRan, false);
  assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);

  let nextOperationRan = false;
  await withTransportTripwire(async () => {
    nextOperationRan = true;
  }, target);
  assert.equal(nextOperationRan, true);
});

test("fails closed on restoration failure without early release or permanent active-state lock", async () => {
  const sentinel = "restore-failure-must-not-escape";
  const { originals, target } = makeDescriptorTarget();
  const before = Object.getOwnPropertyDescriptors(target);
  const freshTarget = makeDescriptorTarget().target;
  let restorationStarted = false;
  let rejectedRestoration = false;
  let nestedOperationRan = false;
  let nestedAttempt: Promise<void> | undefined;
  const proxy = new Proxy(target, {
    defineProperty(innerTarget, property, descriptor) {
      if (
        restorationStarted
        && !rejectedRestoration
        && property === "Request"
        && descriptor.get === before.Request?.get
      ) {
        rejectedRestoration = true;
        nestedAttempt = withTransportTripwire(async () => {
          nestedOperationRan = true;
        }, freshTarget);
        throw new Error(sentinel);
      }
      return Reflect.defineProperty(innerTarget, property, descriptor);
    },
  });

  await assert.rejects(
    withTransportTripwire(async () => {
      assertAllTransportsBlocked(proxy);
      restorationStarted = true;
    }, proxy),
    (error) => {
      assert.equal(isTransportBlocked(error), true);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal((error as Error).stack?.includes(sentinel) ?? false, false);
      return true;
    },
  );

  assert.ok(nestedAttempt);
  await assert.rejects(nestedAttempt, isTransportBlocked);
  assert.equal(nestedOperationRan, false);

  for (const name of transportGlobalNames) {
    if (name === "Request") continue;
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(target, name),
      before[name],
      `${name} must still be restored after another descriptor fails`,
    );
  }
  assert.throws(
    () => Reflect.apply(
      Reflect.get(target, "Request") as (...arguments_: unknown[]) => unknown,
      undefined,
      [],
    ),
    isTransportBlocked,
  );
  assert.notEqual(Reflect.get(target, "Request"), originals.Request);

  let nextOperationRan = false;
  await withTransportTripwire(async () => {
    nextOperationRan = true;
  }, freshTarget);
  assert.equal(nextOperationRan, true);
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
