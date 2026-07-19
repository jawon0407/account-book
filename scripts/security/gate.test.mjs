import assert from "node:assert/strict";
import test from "node:test";

import { SecurityGateError } from "./errors.mjs";
import { runSecurityGate } from "./gate.mjs";

test("gate runs dependencies in fail-closed order and propagates repository failure", () => {
  const calls = [];
  const failure = new SecurityGateError(
    "REPOSITORY_CHECK_FAILED",
    "Repository checks did not pass.",
  );
  const updates = [{ remoteRef: "refs/heads/feature/review-fix" }];

  assert.throws(
    () => runSecurityGate(
      { mode: "pre-push", rootDir: "controlled-root", updates },
      {
        assertPrePushPolicy(actualUpdates) {
          calls.push("policy");
          assert.equal(actualUpdates, updates);
        },
        rangesFromPrePushUpdates() {
          calls.push("ranges");
          return [{ base: null, head: "a".repeat(40) }];
        },
        runRepositoryChecks() {
          calls.push("repository");
          throw failure;
        },
        readChangedBlobs() {
          calls.push("blobs");
          return [];
        },
        scanBlobsForSecrets() {
          calls.push("secrets");
          return [];
        },
      },
    ),
    (error) => error === failure,
  );
  assert.deepEqual(calls, ["policy", "ranges", "repository"]);
});
