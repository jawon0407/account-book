import assert from "node:assert/strict";
import test from "node:test";
import {
  containsCredentialMaterial,
  containsCredentialMaterialInJson,
  isAuthErrorResponse,
  isCsrfResponse,
  isMeResponse,
  isSignInResponse,
  isSignOutResponse,
  parseJsonSafely,
} from "./auth-response-policy.js";

const secretFixture = "nested-secret-fixture-must-not-appear";
const syntheticEmail = "verified@example.test";
const userId = "123e4567-e89b-42d3-a456-426614174001";

test("mutation: nested credential values and sensitive response keys are rejected as booleans", () => {
  const rawLeaks = [
    JSON.stringify({ user: { debug: { password: secretFixture } } }),
    JSON.stringify({ user: { debug: { csrfToken: "new-token" } } }),
    JSON.stringify({ user: { debug: { selector: "new-selector" } } }),
  ];
  for (const body of rawLeaks) {
    assert.equal(containsCredentialMaterial(body, [secretFixture]), true);
  }

  assert.equal(
    containsCredentialMaterialInJson(
      { user: { email: syntheticEmail }, debug: { nested: { email: syntheticEmail } } },
      [syntheticEmail],
      { publicEmail: syntheticEmail },
    ),
    true,
  );
  assert.equal(
    containsCredentialMaterialInJson(
      { user: { email: syntheticEmail } },
      [syntheticEmail],
      { publicEmail: syntheticEmail },
    ),
    false,
  );
});

test("mutation: malformed JSON becomes a fixed boolean-safe parse failure", () => {
  const result = parseJsonSafely(`{"debug":"${secretFixture}"`);
  assert.equal(result.ok, false);
  assert.equal("value" in result, false);
});

test("mutation: malformed or extra nested public contracts are rejected as booleans", () => {
  const malformedContracts = [
    isCsrfResponse({ csrfToken: "token", extra: { password: secretFixture } }),
    isAuthErrorResponse({
      code: "AUTH_INVALID_CREDENTIALS",
      fieldErrors: [],
      message: "The authentication input was rejected.",
      requestId: "123e4567-e89b-42d3-a456-426614174099",
      retryable: false,
      extra: { selector: secretFixture },
    }, "AUTH_INVALID_CREDENTIALS"),
    isSignInResponse({
      absoluteExpiresAt: "2026-07-28T00:00:00.000Z",
      expiresAt: "2026-07-27T23:00:00.000Z",
      user: { email: syntheticEmail, emailVerified: true, id: userId, csrfToken: secretFixture },
    }, { email: syntheticEmail, userId }),
    isMeResponse({
      email: null,
      emailVerified: true,
      id: userId,
      debug: { password: secretFixture },
    }, { email: null, userId }),
    isSignOutResponse({ signedOut: true, debug: { selector: secretFixture } }),
  ];
  for (const accepted of malformedContracts) assert.equal(accepted, false);
});

test("mutation guard: exact fixed public contracts remain accepted", () => {
  assert.equal(isCsrfResponse({ csrfToken: "token" }), true);
  assert.equal(isAuthErrorResponse({
    code: "AUTH_INVALID_CREDENTIALS",
    fieldErrors: [],
    message: "The authentication input was rejected.",
    requestId: "123e4567-e89b-42d3-a456-426614174099",
    retryable: false,
  }, "AUTH_INVALID_CREDENTIALS"), true);
  assert.equal(isSignInResponse({
    absoluteExpiresAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-07-27T23:00:00.000Z",
    user: { email: syntheticEmail, emailVerified: true, id: userId },
  }, { email: syntheticEmail, userId }), true);
  assert.equal(isMeResponse({ email: null, emailVerified: false, id: userId }, { email: null, userId }), true);
  assert.equal(isMeResponse({ email: null, emailVerified: true, id: userId }, { email: null, userId }), false);
  assert.equal(isSignOutResponse({ signedOut: true }), true);
});
