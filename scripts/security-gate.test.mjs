import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = fileURLToPath(new URL("./security-gate.mjs", import.meta.url));
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();
const BASE = execFileSync("git", ["rev-parse", "main"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();
const shellPath = process.platform === "win32"
  ? join(
      dirname(execFileSync("where.exe", ["git.exe"], { encoding: "utf8" }).trim().split(/\r?\n/u)[0]),
      "..",
      "bin",
      "sh.exe",
    )
  : "sh";

/**
 * Executes the public CLI with controlled stdin.
 *
 * @param {{args: string[], input?: string}} options CLI arguments and pre-push input.
 */
function runCli({ args, input = "" }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: rootDir,
    input,
    encoding: "utf8",
  });
}

test("CLI blocks direct main pre-push input", () => {
  const result = runCli({
    args: ["--mode", "pre-push"],
    input: `refs/heads/main ${HEAD} refs/heads/main ${BASE}\n`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DIRECT_MAIN_PUSH/);
});

test("CLI fails closed on malformed input", () => {
  const result = runCli({ args: ["--mode", "pre-push"], input: "broken\n" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_PRE_PUSH_INPUT/);
});

test("CI blocks a push event targeting main", () => {
  const result = runCli({
    args: [
      "--mode", "ci", "--event", "push", "--target-ref", "refs/heads/main",
      "--base", BASE, "--head", HEAD,
    ],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DIRECT_MAIN_PUSH_REACHED_REMOTE/);
});

test("allowed feature update reaches repository checks with sanitized failure", async () => {
  const invalidRoot = await mkdtemp(join(tmpdir(), "account-book-gate-root-"));
  try {
    const result = runCli({
      args: ["--mode", "pre-push", "--root", invalidRoot],
      input: `refs/heads/feature/review-fix ${HEAD} refs/heads/feature/review-fix ${BASE}\n`,
    });
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "[REPOSITORY_CHECK_FAILED] Repository checks did not pass.\n",
    );
    assert.equal(result.stdout, "");
  } finally {
    await rm(invalidRoot, { recursive: true, force: true });
  }
});

test("invalid option forms fail closed without echoing attacker input", () => {
  const cases = [
    ["--mode", "ci", "--mode", "pre-push"],
    ["--mode", "pre-push", "--event", "push"],
    ["--mode", "ci", "--remote-name", "origin"],
    ["--mode"],
    ["--attacker-controlled-option", "attacker-controlled-value"],
  ];

  for (const args of cases) {
    const result = runCli({ args });
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "[INVALID_ARGUMENT] Invalid command-line arguments.\n",
    );
    assert.doesNotMatch(result.stderr, /attacker-controlled/u);
  }
});

test("executable pre-push hook forwards CLI arguments and Git stdin", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "account-book-hook-run-"));
  const binDir = join(tempRoot, "bin");
  const captureDir = join(tempRoot, "capture");
  const shimPath = join(binDir, "node");
  const hookPath = join(rootDir, ".githooks", "pre-push");
  const input = `refs/heads/feature/review-fix ${HEAD} refs/heads/feature/review-fix ${BASE}\n`;
  try {
    await mkdir(binDir);
    await mkdir(captureDir);
    await writeFile(
      shimPath,
      "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOOK_CAPTURE_DIR/args\"\ncat > \"$HOOK_CAPTURE_DIR/stdin\"\n",
    );
    await chmod(shimPath, 0o755);

    const result = spawnSync(
      shellPath,
      [hookPath, "origin", "ssh://example.invalid/account-book.git"],
      {
        cwd: rootDir,
        input,
        encoding: "utf8",
        env: {
          ...process.env,
          HOOK_CAPTURE_DIR: captureDir,
          PATH: `${binDir}${delimiter}${process.env.PATH}`,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      (await readFile(join(captureDir, "args"), "utf8")).trim().split(/\r?\n/u),
      [
        "scripts/security-gate.mjs",
        "--mode",
        "pre-push",
        "--remote-name",
        "origin",
        "--remote-url",
        "ssh://example.invalid/account-book.git",
      ],
    );
    assert.equal(await readFile(join(captureDir, "stdin"), "utf8"), input);

    const stagedMode = execFileSync(
      "git",
      ["ls-files", "--stage", ".githooks/pre-push"],
      { cwd: rootDir, encoding: "utf8" },
    );
    assert.match(stagedMode, /^100755 /u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
