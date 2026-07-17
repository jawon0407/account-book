import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("./setup-hooks.mjs", import.meta.url));

test("hook installer rejects a repository missing the pre-push hook", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-hooks-"));
  try {
    execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });
    const result = spawnSync(process.execPath, [cliPath, "--root", rootDir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "[HOOK_NOT_FOUND] Required pre-push hook is missing.\n",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("hook installer resolves the top level, sets hooks path, and reads it back", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-hooks-"));
  const nestedDir = join(rootDir, "nested", "directory");
  try {
    execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });
    await mkdir(join(rootDir, ".githooks"));
    await writeFile(join(rootDir, ".githooks", "pre-push"), "#!/bin/sh\n");
    await mkdir(nestedDir, { recursive: true });
    const result = spawnSync(process.execPath, [cliPath, "--root", nestedDir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Git hooks path configured: .githooks\n");
    const hooksPath = execFileSync(
      "git",
      ["config", "--local", "--get", "core.hooksPath"],
      { cwd: rootDir, encoding: "utf8" },
    ).trim();
    assert.equal(hooksPath, ".githooks");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
