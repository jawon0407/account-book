import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { SecurityGateError } from "./errors.mjs";
import {
  rangeFromCi,
  rangesFromPrePushUpdates,
  readChangedBlobs,
} from "./git-change-reader.mjs";
import {
  assertCiPolicy,
  assertPrePushPolicy,
} from "./push-policy.mjs";
import {
  formatSecretFindings,
  scanBlobsForSecrets,
} from "./secret-scan.mjs";

/**
 * Runs both repository-contract commands while keeping all child output private.
 *
 * @param {string} rootDir Resolved repository top-level directory.
 * @returns {void}
 * @throws {SecurityGateError} With a fixed diagnostic when either command cannot
 * start, exceeds its output buffer, or exits unsuccessfully.
 */
function runRepositoryChecks(rootDir) {
  const commands = [
    [process.execPath, ["--test", join(rootDir, "scripts/verify-structure.test.mjs")]],
    [process.execPath, [join(rootDir, "scripts/verify-structure.mjs")]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      throw new SecurityGateError(
        "REPOSITORY_CHECK_FAILED",
        "Repository checks did not pass.",
      );
    }
  }
}

const PRODUCTION_DEPENDENCIES = Object.freeze({
  assertCiPolicy,
  assertPrePushPolicy,
  formatSecretFindings,
  rangeFromCi,
  rangesFromPrePushUpdates,
  readChangedBlobs,
  runRepositoryChecks,
  scanBlobsForSecrets,
});

/**
 * @typedef {object} SecurityGateDependencies
 * @property {typeof assertCiPolicy} assertCiPolicy Validates CI branch policy.
 * @property {typeof assertPrePushPolicy} assertPrePushPolicy Validates local push policy.
 * @property {typeof formatSecretFindings} formatSecretFindings Formats sanitized findings.
 * @property {typeof rangeFromCi} rangeFromCi Builds the validated CI range.
 * @property {typeof rangesFromPrePushUpdates} rangesFromPrePushUpdates Builds local ranges.
 * @property {typeof readChangedBlobs} readChangedBlobs Reads complete introduced history.
 * @property {typeof runRepositoryChecks} runRepositoryChecks Runs repository contracts.
 * @property {typeof scanBlobsForSecrets} scanBlobsForSecrets Produces sanitized findings.
 */

/**
 * Runs policy, repository-contract, and pushed-blob checks in fail-closed order.
 *
 * Production callers omit `dependencies`; tests and other controlled callers may
 * override individual functions while all unspecified functions retain the
 * production Task 2/3 implementations.
 *
 * @param {{mode: "pre-push"|"ci", rootDir: string, updates?: Array<{localRef: string, localSha: string, remoteRef: string, remoteSha: string}>, eventName?: string, targetRef?: string, base?: string, head?: string}} options Mode-specific policy inputs and repository root.
 * @param {Partial<SecurityGateDependencies>} [dependencies] Optional controlled overrides for policy, range, repository, blob, and secret operations.
 * @returns {{scannedBlobCount: number}} Non-sensitive verification summary.
 * @throws {SecurityGateError} When mode validation, branch policy, repository
 * checks, history/blob inspection, or secret detection fails closed.
 */
export function runSecurityGate(options, dependencies = {}) {
  const operations = { ...PRODUCTION_DEPENDENCIES, ...dependencies };
  let ranges;
  if (options.mode === "pre-push") {
    operations.assertPrePushPolicy(options.updates);
    ranges = operations.rangesFromPrePushUpdates(options.updates);
  } else if (options.mode === "ci") {
    operations.assertCiPolicy({
      eventName: options.eventName,
      targetRef: options.targetRef,
    });
    ranges = [operations.rangeFromCi({ base: options.base, head: options.head })];
  } else {
    throw new SecurityGateError("INVALID_MODE", "Mode must be pre-push or ci.");
  }

  operations.runRepositoryChecks(options.rootDir);
  const blobs = operations.readChangedBlobs({ rootDir: options.rootDir, ranges });
  const findings = operations.scanBlobsForSecrets(blobs);
  if (findings.length > 0) {
    throw new SecurityGateError(
      "SECRET_DETECTED",
      operations.formatSecretFindings(findings),
    );
  }
  return { scannedBlobCount: blobs.length };
}
