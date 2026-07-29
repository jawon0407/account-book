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
  assert.equal(normalized.stack?.includes(sentinel) ?? false, false);
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
    assert.equal(JSON.stringify(normalized).includes(sentinel), false);
  }
});

test("preserves an existing fixed safe error", () => {
  const error = new SafeAuthUiError("AUTH_UI_LAYOUT_FAILED");

  assert.equal(normalizeSafeAuthUiError(error), error);
});
