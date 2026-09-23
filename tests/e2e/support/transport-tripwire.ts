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

/**
 * 교체된 전송 API 호출을 즉시 거부한다.
 * @returns 정상 반환하지 않으며 AUTH_UI_TRANSPORT_BLOCKED를 던진다.
 */
function blockedTransport(): never {
  throw new SafeAuthUiError("AUTH_UI_TRANSPORT_BLOCKED");
}

/**
 * 전송 차단 경계용 고정 오류를 만든다.
 * @returns 원본 정보를 포함하지 않는 새 AUTH_UI_TRANSPORT_BLOCKED 오류다.
 */
function transportBlockedError(): SafeAuthUiError {
  return new SafeAuthUiError("AUTH_UI_TRANSPORT_BLOCKED");
}

/**
 * 속성 descriptor를 교체할 수 있는 객체/함수 후보인지 검사한다.
 * @param target - 전송 API를 가진 후보 객체다.
 * @returns null이 아닌 객체 또는 함수이면 true. 교체 가능성까지 보장하지는 않는다.
 */
function isTargetObject(target: unknown): target is object {
  return target !== null
    && (typeof target === "object" || typeof target === "function");
}

/**
 * 속성의 데이터/접근자 종류와 플래그·참조를 비교한다.
 * @param actual - 설치 또는 복원 후 읽은 descriptor다.
 * @param expected - 원래 또는 설치 예정 descriptor다.
 * @returns 두 descriptor가 동등하면 true. getter/setter를 실행하지 않는다.
 */
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

/**
 * 전송 전역을 차단 함수로 교체하고 작업 후 원래 descriptor를 복원한다.
 * @param operation - 차단 상태에서 실행할 비동기 작업이다.
 * @param target - 교체 대상 객체. 기본값은 테스트 프로세스 globalThis다.
 * @returns 작업 결과 T의 Promise. 작업 실패는 안전한 오류로 바꾼다.
 * @throws Proxy·중첩 실행·설치/복원 실패는 고정 전송 차단 오류다. 호출 중 대상 전역 속성을 변경한다.
 */
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
