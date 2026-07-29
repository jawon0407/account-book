import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSafeAuthUiError,
  SafeAuthUiError,
} from "./safe-ui-error.js";

test("normalizes unknown errors without carrying sentinel or cause", () => {
  const sentinel = "provider-refresh-token-must-not-escape";
  const original = new Error(sentinel, { cause: { credential: sentinel } });
  original.stack = `sensitive-stack:${sentinel}`;
  Object.defineProperty(original, "descriptorSecret", {
    enumerable: true,
    value: sentinel,
  });

  const normalized = normalizeSafeAuthUiError(original);

  assert.notEqual(normalized, original);
  assert.equal(normalized.name, "SafeAuthUiError");
  assert.equal(normalized.message, "AUTH_UI_UNEXPECTED_FAILURE");
  assert.equal(normalized.code, "AUTH_UI_UNEXPECTED_FAILURE");
  assert.equal("cause" in normalized, false);
  assert.equal("descriptorSecret" in normalized, false);
  assert.equal("stack" in normalized, false);
  assert.equal(JSON.stringify(normalized).includes(sentinel), false);
});

test("normalizes arbitrary input values to the same fixed error", () => {
  const sentinel = "raw-provider-token-must-not-escape";

  for (const value of [
    sentinel,
    { message: sentinel, stack: sentinel, cause: sentinel, value: sentinel },
    null,
    undefined,
  ]) {
    const normalized = normalizeSafeAuthUiError(value);

    assert.equal(normalized.name, "SafeAuthUiError");
    assert.equal(normalized.message, "AUTH_UI_UNEXPECTED_FAILURE");
    assert.equal(normalized.code, "AUTH_UI_UNEXPECTED_FAILURE");
    assert.equal("cause" in normalized, false);
    assert.equal("stack" in normalized, false);
    assert.equal(JSON.stringify(normalized).includes(sentinel), false);
  }
});

test("preserves an existing fixed safe error", () => {
  const error = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");

  assert.equal(normalizeSafeAuthUiError(error), error);
});

test("does not trust an object with the SafeAuthUiError prototype", () => {
  const forged = Object.create(SafeAuthUiError.prototype) as SafeAuthUiError;
  Object.defineProperties(forged, {
    code: { enumerable: true, value: "AUTH_UI_LAYOUT_FAILED" },
    message: { value: "AUTH_UI_LAYOUT_FAILED" },
    name: { enumerable: true, value: "SafeAuthUiError" },
  });

  const normalized = normalizeSafeAuthUiError(forged);

  assert.notEqual(normalized, forged);
  assert.equal(normalized.code, "AUTH_UI_UNEXPECTED_FAILURE");
});

test("does not trust a Proxy around a genuinely issued safe error", () => {
  const genuine = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");
  const proxy = new Proxy(genuine, {});

  const normalized = normalizeSafeAuthUiError(proxy);

  assert.notEqual(normalized, proxy);
  assert.equal(normalized.code, "AUTH_UI_UNEXPECTED_FAILURE");
});

test("maps an invalid runtime code to a fixed unexpected error", () => {
  const sentinel = "invalid-runtime-code-must-not-escape";
  const RuntimeSafeAuthUiError = SafeAuthUiError as unknown as new (
    code: string,
  ) => SafeAuthUiError;

  const error = new RuntimeSafeAuthUiError(sentinel);

  assert.equal(error.code, "AUTH_UI_UNEXPECTED_FAILURE");
  assert.equal(error.message, "AUTH_UI_UNEXPECTED_FAILURE");
  assert.equal(JSON.stringify(error).includes(sentinel), false);
});

test("freezes issued errors and removes stack and cause properties", () => {
  const error = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");

  assert.equal(Object.isFrozen(error), true);
  assert.equal("stack" in error, false);
  assert.equal("cause" in error, false);
  assert.equal(
    Reflect.set(error, "code", "AUTH_UI_UNEXPECTED_FAILURE"),
    false,
  );
  assert.equal(error.code, "AUTH_UI_LAYOUT_FAILED");
  assert.equal(normalizeSafeAuthUiError(error), error);
});

test("rejects subclass construction with inherited disclosure properties", () => {
  const sentinel = "subclass-inherited-secret-must-not-escape";
  class DisclosingSafeAuthUiError extends SafeAuthUiError {}
  Object.defineProperties(DisclosingSafeAuthUiError.prototype, {
    cause: { value: { sentinel } },
    path: { value: `C:\\sensitive\\${sentinel}` },
    toJSON: {
      value: () => ({ sentinel }),
    },
  });

  assert.throws(
    () => new DisclosingSafeAuthUiError("AUTH_UI_LAYOUT_FAILED"),
    (error) => {
      assert.equal(Object.getPrototypeOf(error), SafeAuthUiError.prototype);
      assert.equal(error instanceof SafeAuthUiError, true);
      assert.equal((error as SafeAuthUiError).code, "AUTH_UI_UNEXPECTED_FAILURE");
      assert.equal((error as Error).message, "AUTH_UI_UNEXPECTED_FAILURE");
      assert.equal("stack" in (error as object), false);
      assert.equal("cause" in (error as object), false);
      assert.equal("path" in (error as object), false);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal(normalizeSafeAuthUiError(error), error);
      return true;
    },
  );
});

test("rejects Reflect.construct with a custom newTarget", () => {
  const sentinel = "custom-new-target-secret-must-not-escape";
  const customPrototype = {
    cause: { sentinel },
    path: `C:\\sensitive\\${sentinel}`,
    toJSON: () => ({ sentinel }),
  };
  function CustomNewTarget(): void {}
  CustomNewTarget.prototype = customPrototype;

  assert.throws(
    () => Reflect.construct(
      SafeAuthUiError,
      ["AUTH_UI_LAYOUT_FAILED"],
      CustomNewTarget,
    ),
    (error) => {
      assert.equal(Object.getPrototypeOf(error), SafeAuthUiError.prototype);
      assert.equal(error instanceof SafeAuthUiError, true);
      assert.equal((error as SafeAuthUiError).code, "AUTH_UI_UNEXPECTED_FAILURE");
      assert.equal((error as Error).message, "AUTH_UI_UNEXPECTED_FAILURE");
      assert.equal("stack" in (error as object), false);
      assert.equal("cause" in (error as object), false);
      assert.equal("path" in (error as object), false);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal(normalizeSafeAuthUiError(error), error);
      return true;
    },
  );
});
