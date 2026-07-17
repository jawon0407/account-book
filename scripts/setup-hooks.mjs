import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
let rootDir = process.cwd();
if (args.length > 0) {
  if (args.length !== 2 || args[0] !== "--root" || !args[1]) {
    console.error("[INVALID_ARGUMENT] Invalid command-line arguments.");
    process.exit(1);
  }
  rootDir = resolve(args[1]);
}

/**
 * Runs Git inside a selected directory with all child diagnostics captured.
 *
 * @param {string} directory Candidate or resolved repository directory.
 * @param {string[]} gitArgs Arguments passed directly to Git without shell parsing.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Git result.
 */
function runGit(directory, gitArgs) {
  return spawnSync("git", ["-C", directory, ...gitArgs], { encoding: "utf8" });
}

/**
 * Resolves Git's actual repository top level from any directory inside it.
 *
 * @param {string} directory User-selected starting directory.
 * @returns {string|null} Resolved top level, or null when Git cannot prove one.
 */
function resolveRepositoryRoot(directory) {
  const result = runGit(directory, ["rev-parse", "--show-toplevel"]);
  const topLevel = result.stdout?.trim();
  if (result.error || result.status !== 0 || !topLevel) return null;
  return resolve(topLevel);
}

const repositoryRoot = resolveRepositoryRoot(rootDir);
if (repositoryRoot === null) {
  console.error("[REPOSITORY_NOT_FOUND] Git repository could not be resolved.");
  process.exit(1);
}

/**
 * Proves that the common pre-push hook exists at the repository top level.
 *
 * @param {string} directory Resolved repository top-level directory.
 * @returns {Promise<boolean>} Whether `.githooks/pre-push` is a file. Missing
 * files and filesystem errors return false without exposing path details.
 */
async function prePushHookExists(directory) {
  try {
    return (await stat(join(directory, ".githooks", "pre-push"))).isFile();
  } catch {
    return false;
  }
}

/**
 * Writes the fixed repository-local hooks path with no shell interpolation.
 *
 * @param {string} directory Resolved repository top-level directory.
 * @returns {boolean} Whether Git completed the write successfully. Child errors
 * and output are reduced to false so public diagnostics stay fixed.
 */
function writeHooksPath(directory) {
  const result = runGit(
    directory,
    ["config", "--local", "core.hooksPath", ".githooks"],
  );
  return !result.error && result.status === 0;
}

/**
 * Reads back and compares the exact repository-local hooks path.
 *
 * @param {string} directory Resolved repository top-level directory.
 * @returns {boolean} Whether Git returned exactly `.githooks`. Read failures and
 * unexpected output return false without exposing repository-controlled data.
 */
function hooksPathIsConfigured(directory) {
  const result = runGit(
    directory,
    ["config", "--local", "--get", "core.hooksPath"],
  );
  return !result.error &&
    result.status === 0 &&
    result.stdout.trim() === ".githooks";
}

if (!(await prePushHookExists(repositoryRoot))) {
  console.error("[HOOK_NOT_FOUND] Required pre-push hook is missing.");
  process.exit(1);
}

if (!writeHooksPath(repositoryRoot)) {
  console.error("[HOOK_CONFIG_FAILED] Git could not set the local hooks path.");
  process.exit(1);
}

if (!hooksPathIsConfigured(repositoryRoot)) {
  console.error("[HOOK_CONFIG_VERIFY_FAILED] Local hooks path read-back failed.");
  process.exit(1);
}

console.log("Git hooks path configured: .githooks");
