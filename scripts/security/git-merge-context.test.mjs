import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readMainPushCommit, readChangedBlobs } from "./git-change-reader.mjs";

test("reads real parents, refuses stale/missing heads and ignores Git replace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "account-book-main-proof-"));
  const git = (...args) => childProcess.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  try {
    git("init"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
    await mkdir(join(root, "empty-hooks")); git("config", "core.hooksPath", join(root, "empty-hooks"));
    git("commit", "--allow-empty", "-m", "base"); const base = git("rev-parse", "HEAD");
    assert.deepEqual(readMainPushCommit({ rootDir: root, head: base }), { head: base, parents: [] });
    await writeFile(join(root, "proof.txt"), "original history"); git("add", "proof.txt");
    git("commit", "-m", "tip"); const head = git("rev-parse", "HEAD");
    assert.deepEqual(readMainPushCommit({ rootDir: root, head }), { head, parents: [base] });
    for (const stale of [base, "4".repeat(40)]) assert.throws(() => readMainPushCommit({ rootDir: root, head: stale }), { code: "GIT_READ_FAILED" });
    assert.throws(() => readMainPushCommit({ rootDir: root, head: "--evil" }), { code: "INVALID_GIT_RANGE" });
    git("replace", head, base);
    assert.deepEqual(readMainPushCommit({ rootDir: root, head }), { head, parents: [base] });
    assert.ok(readChangedBlobs({ rootDir: root, ranges: [{ base, head }] }).some(b => b.content.toString() === "original history"));
    git("replace", "-d", head);
    git("checkout", "-b", "side", base); git("commit", "--allow-empty", "-m", "side");
    const source = git("rev-parse", "HEAD"); git("checkout", "--detach", head);
    git("merge", "--no-ff", "side", "-m", "Merge pull request #999 (not evidence)");
    const merge = git("rev-parse", "HEAD");
    assert.deepEqual(readMainPushCommit({ rootDir: root, head: merge }), { head: merge, parents: [head, source] });
    const clone = join(root, "shallow"); git("clone", "--depth", "1", pathToFileURL(root).href, clone);
    assert.throws(() => readMainPushCommit({ rootDir: clone, head: merge }), { code: "SHALLOW_REPOSITORY_UNSUPPORTED" });
    const originalSpawn = childProcess.spawnSync;
    let calls = 0;
    t.mock.method(childProcess, "spawnSync", (command, args, options) => {
      calls++;
      assert.ok(!Object.keys(options.env).some(key => /^(github_token|gh_token)$/iu.test(key)));
      return originalSpawn(command, args, options);
    });
    syncBuiltinESMExports();
    const old = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "synthetic-child-canary";
    try { readMainPushCommit({ rootDir: root, head: merge }); assert.ok(calls >= 3); }
    finally { if (old === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = old;
      t.mock.restoreAll(); syncBuiltinESMExports(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
