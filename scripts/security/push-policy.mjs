import { SecurityGateError } from "./errors.mjs";

export const ZERO_SHA = "0".repeat(40);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ALLOWED_PUSH_REFS = Object.freeze([
  /^refs\/heads\/feature\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^refs\/heads\/hotfix\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^refs\/heads\/maintenance-branch$/,
]);
const ALLOWED_PR_TARGETS = new Set([
  "refs/heads/main",
  "refs/heads/maintenance-branch",
]);

/**
 * Parses Git pre-push stdin lines.
 *
 * @param {string} input Raw lines in `<local-ref> <local-sha> <remote-ref> <remote-sha>` form.
 * @returns {Array<{localRef: string, localSha: string, remoteRef: string, remoteSha: string}>}
 * @throws {SecurityGateError} When input is empty, incomplete, or contains invalid refs/SHAs.
 */
export function parsePrePushInput(input) {
  const lines = input.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new SecurityGateError(
      "PRE_PUSH_INPUT_REQUIRED",
      "Git did not provide any pre-push ref updates; push blocked.",
    );
  }

  return lines.map((line) => {
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 4) {
      throw new SecurityGateError(
        "INVALID_PRE_PUSH_INPUT",
        "Git pre-push input must contain exactly four fields per line.",
      );
    }

    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (
      !localRef.startsWith("refs/") ||
      !remoteRef.startsWith("refs/") ||
      !SHA_PATTERN.test(localSha) ||
      !SHA_PATTERN.test(remoteSha)
    ) {
      throw new SecurityGateError(
        "INVALID_PRE_PUSH_INPUT",
        "Git pre-push input contains an invalid ref or SHA.",
      );
    }

    return { localRef, localSha, remoteRef, remoteSha };
  });
}

/**
 * Blocks direct main pushes and refs outside the approved branch convention.
 *
 * @param {ReturnType<typeof parsePrePushInput>} updates Parsed ref updates.
 * @returns {void}
 * @throws {SecurityGateError} When a target ref violates repository policy.
 */
export function assertPrePushPolicy(updates) {
  for (const update of updates) {
    if (update.remoteRef === "refs/heads/main") {
      throw new SecurityGateError(
        "DIRECT_MAIN_PUSH",
        "Direct pushes to main are prohibited. Push a feature/* or hotfix/* branch and open a PR.",
      );
    }

    if (!ALLOWED_PUSH_REFS.some((pattern) => pattern.test(update.remoteRef))) {
      throw new SecurityGateError(
        "UNSUPPORTED_PUSH_REF",
        "Push target is outside the approved branch convention.",
      );
    }
  }
}

/**
 * Applies the same branch policy to a GitHub Actions event.
 * PR targets are allowed because they use review flows, while a push event targeting main
 * is rejected as a direct-main policy violation.
 *
 * @param {{eventName: string, targetRef: string}} options Event and normalized target ref.
 * @returns {void}
 * @throws {SecurityGateError} When a direct main push or unknown event/ref is observed.
 */
export function assertCiPolicy({ eventName, targetRef }) {
  if (eventName === "push") {
    if (targetRef === "refs/heads/main") {
      throw new SecurityGateError(
        "DIRECT_MAIN_PUSH_REACHED_REMOTE",
        "A direct main push reached GitHub. Stop work and follow docs/security/incident-response.md.",
      );
    }
    if (!ALLOWED_PUSH_REFS.some((pattern) => pattern.test(targetRef))) {
      throw new SecurityGateError(
        "UNSUPPORTED_PUSH_REF",
        "GitHub push target is outside the approved branch convention.",
      );
    }
    return;
  }

  if (eventName === "pull_request" && ALLOWED_PR_TARGETS.has(targetRef)) {
    return;
  }

  throw new SecurityGateError(
    "UNSUPPORTED_CI_EVENT",
    "Unsupported CI event/ref combination.",
  );
}
