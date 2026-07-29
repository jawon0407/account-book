import { SafeAuthUiError } from "./safe-ui-error.js";

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

export async function withTransportTripwire<T>(
  operation: () => Promise<T>,
  target: object = globalThis,
): Promise<T> {
  if (active) throw transportBlockedError();

  active = true;
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  let installationCompleted = false;
  let restorationFailed = false;
  let outcome:
    | { readonly error: unknown; readonly ok: false }
    | { readonly ok: true; readonly value: T };

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
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? false,
        writable: false,
        value: blockedTransport,
      });
    }
    installationCompleted = true;

    outcome = { ok: true, value: await operation() };
  } catch (error: unknown) {
    outcome = {
      error: installationCompleted ? error : transportBlockedError(),
      ok: false,
    };
  }

  for (const [name, descriptor] of descriptors) {
    try {
      if (descriptor === undefined) {
        if (!Reflect.deleteProperty(target, name)) restorationFailed = true;
      } else {
        Object.defineProperty(target, name, descriptor);
      }
    } catch {
      restorationFailed = true;
    }
  }

  // 동기 복원이 끝날 때까지 중첩 실행을 막고, 다음 독립 실행 전에만 해제한다.
  active = false;
  if (restorationFailed) throw transportBlockedError();
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
