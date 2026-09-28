import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mainFixture } from "./security/merge-evidence.test-fixtures.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = fileURLToPath(new URL("./security-gate.mjs", import.meta.url));
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();
// These policy tests only require a well-formed remote SHA. Keeping it synthetic
// avoids depending on a local `main` ref, which is absent in single-branch CI checkouts.
const BASE = "2".repeat(40);
const shellPath = process.platform === "win32"
  ? join(
      dirname(execFileSync("where.exe", ["git.exe"], { encoding: "utf8" }).trim().split(/\r?\n/u)[0]),
      "..",
      "bin",
      "sh.exe",
    )
  : "sh";

/**
 * 통제한 표준 입력으로 실제 보안 게이트 CLI를 별도 프로세스에서 실행한다.
 * @param {{args: string[], input?: string}} options 모드별 CLI 인자와 Git pre-push 입력.
 * @returns 종료 상태·stdout·stderr가 담긴 결과. 실제 push는 실행하지 않는다.
 */
function runCli({ args, input = "", env = process.env }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: rootDir,
    input,
    encoding: "utf8",
    env,
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

test("CI blocks a main push without Actions context", () => {
  const result = runCli({
    env: { ...process.env, GITHUB_ACTIONS: "false", GITHUB_EVENT_PATH: "" },
    args: [
      "--mode", "ci", "--event", "push", "--target-ref", "refs/heads/main",
      "--base", BASE, "--head", HEAD,
    ],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MAIN_PUSH_CONTEXT_INVALID/);
});

test("real CLI verifies matching merge proof and fails safely without it", async () => {
  const temp = await mkdtemp(join(tmpdir(), "account-book-proof-cli-"));
  try {
    const f = mainFixture();
    const [head, base, source = f.candidate.head.sha] = execFileSync("git", ["--no-replace-objects", "rev-list", "--parents", "-n", "1", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim().split(" ");
    f.event.before = base; f.event.after = head;
    f.env.GITHUB_SHA = head;
    f.candidate.head.sha = source; f.candidate.merge_commit_sha = head;
    f.pullRequest = { ...structuredClone(f.candidate), merged: true };
    const eventPath = join(temp, "event.json"), preloadPath = join(temp, "fetch.mjs");
    await writeFile(eventPath, JSON.stringify(f.event));
    const args = ["--mode", "ci", "--event", "push", "--target-ref", "refs/heads/main", "--base", base, "--head", head];
    const env = { ...process.env, ...f.env, GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "synthetic-cli-canary" };
    for (const mode of ["success", "absent", "http"]) {
      await writeFile(preloadPath, `globalThis.fetch = async (url) => ${mode === "http"
        ? 'new Response("synthetic-cli-canary", {status:403})'
        : `Response.json(url.includes("/commits/") ? ${JSON.stringify(mode === "absent" ? [] : [f.candidate])} : ${JSON.stringify(f.pullRequest)})`};`);
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(preloadPath).href, cliPath, ...args], { cwd: rootDir, env, encoding: "utf8", timeout: 180000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, mode === "success" ? 0 : 1, result.stderr);
      if (mode === "success") { assert.match(result.stdout, /PR #12/u); assert.ok(result.stdout.includes(head)); }
      else assert.match(result.stderr, mode === "absent" ? /MAIN_MERGE_EVIDENCE_REJECTED/u : /MAIN_MERGE_EVIDENCE_UNAVAILABLE/u);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-cli-canary/u);
    }
    for (const content of ["raw-synthetic-cli-canary", " ".repeat(4 * 1024 * 1024 + 1)]) {
      await writeFile(eventPath, content);
      const result = runCli({ args, env });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /MAIN_PUSH_CONTEXT_INVALID/u);
      assert.doesNotMatch(result.stderr, /synthetic-cli-canary/u);
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
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
