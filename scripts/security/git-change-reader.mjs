import { spawnSync } from "node:child_process";

import { SecurityGateError } from "./errors.mjs";
import { ZERO_SHA } from "./push-policy.mjs";

const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;

/**
 * Runs a read-only Git command while keeping Git stderr out of public diagnostics.
 *
 * @param {string} rootDir Repository working directory.
 * @param {string[]} args Git arguments passed without shell interpolation.
 * @param {BufferEncoding|null} [encoding=null] Optional stdout text encoding.
 * @returns {Buffer|string} Captured stdout in the requested representation.
 * @throws {SecurityGateError} When Git fails or exceeds the bounded output buffer.
 */
function runGit(rootDir, args, encoding = null) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding,
    maxBuffer: MAX_BLOB_BYTES + 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Git stderr can contain hostile paths or other repository-controlled values.
    throw new SecurityGateError(
      "GIT_READ_FAILED",
      `Git could not inspect the pushed commit range for ${args[0]}.`,
    );
  }
  return result.stdout;
}

/**
 * Validates a public range before any value can be interpreted as a Git option/revision.
 *
 * @param {string|null} base Previously remote commit, or null for a new ref.
 * @param {string} head Commit being pushed.
 * @returns {void}
 * @throws {SecurityGateError} When either revision is not a full Git SHA.
 */
function assertValidRange(base, head) {
  if (!SHA_PATTERN.test(head) || (base !== null && !SHA_PATTERN.test(base))) {
    // Fail before invoking Git so an untrusted revision cannot become an option.
    throw new SecurityGateError(
      "INVALID_GIT_RANGE",
      "Pushed commit ranges must contain full Git SHAs.",
    );
  }
}

/**
 * Proves that local history is complete before any commit range is inspected.
 *
 * @param {string} rootDir Repository working directory.
 * @returns {void}
 * @throws {SecurityGateError} When the repository is shallow or Git returns an
 * unrecognized shallow-state response.
 */
function assertCompleteRepositoryHistory(rootDir) {
  const shallowState = runGit(
    rootDir,
    ["rev-parse", "--is-shallow-repository"],
    "utf8",
  ).trim();
  if (shallowState === "true") {
    // A shallow boundary hides reachable ancestors, so any scan would be partial.
    throw new SecurityGateError(
      "SHALLOW_REPOSITORY_UNSUPPORTED",
      "Shallow repositories cannot prove complete pushed history; fetch full history before scanning.",
    );
  }
  if (shallowState !== "false") {
    // Unexpected plumbing output cannot be treated as proof of complete history.
    throw new SecurityGateError(
      "GIT_READ_FAILED",
      "Git could not verify that repository history is complete.",
    );
  }
}

/**
 * Enumerates every commit introduced by a range in oldest-first order.
 *
 * @param {string} rootDir Repository working directory.
 * @param {string|null} base Previously remote commit, or null for all head history.
 * @param {string} head Commit being pushed.
 * @returns {string[]} Full object IDs for all introduced commits.
 * @throws {SecurityGateError} When Git cannot enumerate the range or returns malformed IDs.
 */
function listIntroducedCommits(rootDir, base, head) {
  const args = ["rev-list", "--reverse", head];
  if (base !== null) args.push(`^${base}`);
  args.push("--");

  const output = runGit(rootDir, args, "utf8");
  const commits = output.split(/\s+/u).filter(Boolean);
  if (commits.some((commit) => !SHA_PATTERN.test(commit))) {
    // Treat malformed plumbing output as a gate failure, never as an empty safe range.
    throw new SecurityGateError(
      "GIT_READ_FAILED",
      "Git returned an invalid commit while inspecting the pushed range.",
    );
  }
  return commits;
}

/**
 * Lists every blob and path in a commit tree without reading blob content.
 *
 * @param {string} rootDir Repository working directory.
 * @param {string} commit Full commit object ID.
 * @returns {Array<{objectId: string, path: string}>} Blob identities and repository paths.
 * @throws {SecurityGateError} When Git fails or returns malformed tree records.
 */
function listTreeBlobs(rootDir, commit) {
  const output = runGit(
    rootDir,
    ["ls-tree", "-r", "-z", "--full-tree", commit, "--"],
  ).toString("utf8");
  const entries = [];

  for (const record of output.split("\0").filter(Boolean)) {
    const separator = record.indexOf("\t");
    const metadata = separator === -1 ? [] : record.slice(0, separator).split(" ");
    if (metadata.length !== 3 || !SHA_PATTERN.test(metadata[2])) {
      // Unexpected tree output must fail closed instead of silently skipping content.
      throw new SecurityGateError(
        "GIT_READ_FAILED",
        "Git returned an invalid tree entry while inspecting the pushed range.",
      );
    }
    const [, objectType, objectId] = metadata;
    if (objectType === "blob") {
      entries.push({ objectId, path: record.slice(separator + 1) });
    }
  }

  return entries;
}

/**
 * Converts parsed pre-push updates to scan ranges and ignores ref deletions.
 * A new remote ref is represented by a null base so all reachable history is scanned.
 *
 * @param {Array<{localSha: string, remoteSha: string}>} updates Parsed pre-push updates.
 * @returns {Array<{base: string|null, head: string}>} Ranges for non-deletion updates.
 */
export function rangesFromPrePushUpdates(updates) {
  return updates
    .filter(({ localSha }) => localSha !== ZERO_SHA)
    .map(({ localSha, remoteSha }) => ({
      base: remoteSha === ZERO_SHA ? null : remoteSha,
      head: localSha,
    }));
}

/**
 * Converts CI base/head values to one scan range after strict SHA validation.
 * A zero base denotes a new ref and becomes null.
 *
 * @param {{base: string, head: string}} options CI-provided full Git SHAs.
 * @returns {{base: string|null, head: string}} Validated range for blob inspection.
 * @throws {SecurityGateError} When base or head is not a full Git SHA.
 */
export function rangeFromCi({ base, head }) {
  if (!SHA_PATTERN.test(head) || !SHA_PATTERN.test(base)) {
    throw new SecurityGateError("INVALID_CI_RANGE", "CI base/head must be full Git SHAs.");
  }
  return { base: base === ZERO_SHA ? null : base, head };
}

/**
 * Reads tree blobs from every commit introduced by the pushed ranges.
 * Blob size/content reads are deduplicated by Git object ID, while each distinct
 * path/object pairing is retained so findings identify every affected path.
 *
 * @param {{rootDir: string, ranges: Array<{base: string|null, head: string}>}} options Repository and pushed ranges.
 * @returns {Array<{path: string, content: Buffer}>} Exact blob bytes paired with repository paths.
 * @throws {SecurityGateError} When the repository is shallow, a range is invalid, Git
 * inspection fails, tree data is malformed, or any blob exceeds the 5 MiB automatic scan limit.
 */
export function readChangedBlobs({ rootDir, ranges }) {
  assertCompleteRepositoryHistory(rootDir);
  const blobs = [];
  const contentsByObjectId = new Map();
  const emittedPathObjects = new Set();

  for (const { base, head } of ranges) {
    assertValidRange(base, head);
    const commits = listIntroducedCommits(rootDir, base, head);

    for (const commit of commits) {
      for (const { objectId, path } of listTreeBlobs(rootDir, commit)) {
        const pathObjectKey = `${objectId}\0${path}`;
        if (emittedPathObjects.has(pathObjectKey)) continue;

        let content = contentsByObjectId.get(objectId);
        if (content === undefined) {
          const sizeOutput = runGit(rootDir, ["cat-file", "-s", objectId], "utf8");
          const size = Number.parseInt(sizeOutput, 10);
          if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB_BYTES) {
            // Quote/escape the repository-controlled path to prevent diagnostic injection.
            throw new SecurityGateError(
              "BLOB_REVIEW_REQUIRED",
              `Changed file ${JSON.stringify(path)} exceeds the 5 MiB automatic scan limit.`,
            );
          }
          content = runGit(rootDir, ["cat-file", "blob", objectId]);
          contentsByObjectId.set(objectId, content);
        }

        emittedPathObjects.add(pathObjectKey);
        blobs.push({ path, content });
      }
    }
  }

  return blobs;
}
