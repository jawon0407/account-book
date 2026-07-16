import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("./verify-structure.mjs", import.meta.url),
);

/**
 * Runs the public structure-verification CLI against an isolated fixture.
 *
 * @param {string} rootDir Fixture directory treated as the repository root.
 * @param {readonly string[]} requiredPaths Contract paths passed to the CLI.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Process evidence.
 */
function runVerifier(rootDir, requiredPaths) {
  const args = [cliPath, "--root", rootDir];
  for (const path of requiredPaths) {
    args.push("--required-path", path);
  }

  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("CLI reports only contract paths absent from the root", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-structure-"));

  try {
    await mkdir(join(rootDir, "apps", "web"), { recursive: true });

    const result = runVerifier(rootDir, [
      "apps/web",
      "apps/api",
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /apps\/api/);
    assert.doesNotMatch(result.stderr, /apps\/web/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("CLI succeeds when every contract path exists", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-structure-"));

  try {
    await mkdir(join(rootDir, "apps", "web"), { recursive: true });
    await mkdir(join(rootDir, "apps", "api"), { recursive: true });

    const result = runVerifier(rootDir, [
      "apps/web",
      "apps/api",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Repository structure verification passed\./);
    assert.equal(result.stderr, "");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
