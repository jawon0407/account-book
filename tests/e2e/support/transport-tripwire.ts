import { isProxy } from "node:util/types";
import {
  normalizeSafeAuthUiError,
  SafeAuthUiError,
} from "./safe-ui-error.js";

export const transportGlobalNames = [
  "fetch",
  "XMLHttpRequest",
  "Request",
  "Response",
  "WebSocket",
  "EventSource",
] as const;

let active = false;

function blockedTransport(): never {
  throw new SafeAuthUiError("AUTH_UI_TRANSPORT_BLOCKED");
}

function transportBlockedError(): SafeAuthUiError {
  return new SafeAuthUiError("AUTH_UI_TRANSPORT_BLOCKED");
}

function isTargetObject(target: unknown): target is object {
  return target !== null
    && (typeof target === "object" || typeof target === "function");
}

function descriptorsMatch(
  actual: PropertyDescriptor | undefined,
  expected: PropertyDescriptor | undefined,
): boolean {
  if (actual === undefined || expected === undefined) {
    return actual === expected;
  }
  if (
    actual.configurable !== expected.configurable
    || actual.enumerable !== expected.enumerable
  ) {
    return false;
  }

  const actualIsData = "value" in actual || "writable" in actual;
  const expectedIsData = "value" in expected || "writable" in expected;
  if (actualIsData !== expectedIsData) return false;

  if (actualIsData && expectedIsData) {
    return actual.writable === expected.writable
      && Object.is(actual.value, expected.value);
  }
  return Object.is(actual.get, expected.get)
    && Object.is(actual.set, expected.set);
}

export async function withTransportTripwire<T>(
  operation: () => Promise<T>,
  target: object = globalThis,
): Promise<T> {
  if (!isTargetObject(target) || isProxy(target)) throw transportBlockedError();
  if (active) throw transportBlockedError();

  active = true;
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  let restorationFailed = false;
  let outcome:
    | { readonly error: unknown; readonly ok: false }
    | { readonly ok: true; readonly value: T }
    | undefined;

  try {
    for (const name of transportGlobalNames) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (descriptor !== undefined && descriptor.configurable !== true) {
        throw transportBlockedError();
      }
      descriptors.set(name, descriptor);
    }

    for (const name of transportGlobalNames) {
      const descriptor = descriptors.get(name);
      const installedDescriptor = {
        configurable: true,
        enumerable: descriptor?.enumerable ?? false,
        writable: false,
        value: blockedTransport,
      } satisfies PropertyDescriptor;
      const installed = Reflect.defineProperty(
        target,
        name,
        installedDescriptor,
      );
      if (
        !installed
        || !descriptorsMatch(
          Object.getOwnPropertyDescriptor(target, name),
          installedDescriptor,
        )
      ) {
        throw transportBlockedError();
      }
    }

    try {
      outcome = { ok: true, value: await operation() };
    } catch (error: unknown) {
      outcome = { error: normalizeSafeAuthUiError(error), ok: false };
    }
  } catch (error: unknown) {
    void error;
    outcome = { error: transportBlockedError(), ok: false };
  }

  for (const [name, descriptor] of descriptors) {
    try {
      if (descriptor === undefined) {
        const deleted = Reflect.deleteProperty(target, name);
        if (
          !deleted
          || Object.getOwnPropertyDescriptor(target, name) !== undefined
        ) {
          restorationFailed = true;
        }
      } else {
        const restored = Reflect.defineProperty(target, name, descriptor);
        if (
          !restored
          || !descriptorsMatch(
            Object.getOwnPropertyDescriptor(target, name),
            descriptor,
          )
        ) {
          restorationFailed = true;
        }
      }
    } catch {
      restorationFailed = true;
    }
  }

  // 동기 복원이 끝날 때까지 중첩 실행을 막고, 다음 독립 실행 전에만 해제한다.
  active = false;
  if (restorationFailed) throw transportBlockedError();
  if (outcome === undefined) throw transportBlockedError();
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
