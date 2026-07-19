import assert from "node:assert/strict";
import test from "node:test";

import {
  ZERO_SHA,
  assertCiPolicy,
  assertPrePushPolicy,
  parsePrePushInput,
} from "./push-policy.mjs";

const LOCAL_SHA = "1".repeat(40);
const REMOTE_SHA = "2".repeat(40);

test("pre-push input is parsed into named ref updates", () => {
  const [update] = parsePrePushInput(
    `refs/heads/feature/free-plan-security-gates ${LOCAL_SHA} refs/heads/feature/free-plan-security-gates ${ZERO_SHA}\n`,
  );

  assert.deepEqual(update, {
    localRef: "refs/heads/feature/free-plan-security-gates",
    localSha: LOCAL_SHA,
    remoteRef: "refs/heads/feature/free-plan-security-gates",
    remoteSha: ZERO_SHA,
  });
});

test("malformed or empty pre-push input fails closed", () => {
  assert.throws(() => parsePrePushInput(""), { code: "PRE_PUSH_INPUT_REQUIRED" });
  assert.throws(() => parsePrePushInput("refs/heads/feature/x bad"), {
    code: "INVALID_PRE_PUSH_INPUT",
  });
});

test("direct main pushes are rejected", () => {
  const updates = parsePrePushInput(
    `refs/heads/main ${LOCAL_SHA} refs/heads/main ${REMOTE_SHA}\n`,
  );
  assert.throws(() => assertPrePushPolicy(updates), {
    code: "DIRECT_MAIN_PUSH",
  });
});

test("Git deletion-form input fails closed during parsing", () => {
  assert.throws(
    () =>
      parsePrePushInput(
        `(delete) ${ZERO_SHA} refs/heads/main ${REMOTE_SHA}\n`,
      ),
    {
      code: "INVALID_PRE_PUSH_INPUT",
      message: "Git pre-push input contains an invalid ref or SHA.",
    },
  );
});

test("feature, hotfix, and maintenance refs are allowed", () => {
  for (const remoteRef of [
    "refs/heads/feature/security-auth-foundation",
    "refs/heads/hotfix/session-cookie",
    "refs/heads/maintenance-branch",
  ]) {
    assert.doesNotThrow(() =>
      assertPrePushPolicy([
        {
          localRef: remoteRef,
          localSha: LOCAL_SHA,
          remoteRef,
          remoteSha: ZERO_SHA,
        },
      ]),
    );
  }
});

test("unknown refs fail closed", () => {
  assert.throws(
    () =>
      assertPrePushPolicy([
        {
          localRef: "refs/heads/experiment",
          localSha: LOCAL_SHA,
          remoteRef: "refs/heads/experiment",
          remoteSha: ZERO_SHA,
        },
      ]),
    {
      code: "UNSUPPORTED_PUSH_REF",
      message: "Push target is outside the approved branch convention.",
    },
  );
});

test("policy diagnostics do not echo hostile refs or CI event names", () => {
  const hostileRemoteRef = "refs/heads/experiment\nforged\u202e";
  const hostileEventName = "workflow_dispatch\nforged\u202d";
  const hostileTargetRef = "refs/heads/unknown\nforged\u2066";

  assert.throws(
    () =>
      assertPrePushPolicy([
        {
          localRef: hostileRemoteRef,
          localSha: LOCAL_SHA,
          remoteRef: hostileRemoteRef,
          remoteSha: ZERO_SHA,
        },
      ]),
    {
      code: "UNSUPPORTED_PUSH_REF",
      message: "Push target is outside the approved branch convention.",
    },
  );
  assert.throws(
    () => assertCiPolicy({ eventName: "push", targetRef: hostileTargetRef }),
    {
      code: "UNSUPPORTED_PUSH_REF",
      message: "GitHub push target is outside the approved branch convention.",
    },
  );
  assert.throws(
    () =>
      assertCiPolicy({
        eventName: hostileEventName,
        targetRef: hostileTargetRef,
      }),
    {
      code: "UNSUPPORTED_CI_EVENT",
      message: "Unsupported CI event/ref combination.",
    },
  );
});

test("CI rejects a direct main push but accepts a PR targeting main", () => {
  assert.throws(
    () => assertCiPolicy({ eventName: "push", targetRef: "refs/heads/main" }),
    { code: "DIRECT_MAIN_PUSH_REACHED_REMOTE" },
  );
  assert.doesNotThrow(() =>
    assertCiPolicy({
      eventName: "pull_request",
      targetRef: "refs/heads/main",
    }),
  );
});
