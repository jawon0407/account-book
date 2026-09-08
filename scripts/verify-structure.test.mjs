import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { REQUIRED_PATHS, findMissingPaths } from "./required-structure.mjs";

const cliPath = fileURLToPath(
  new URL("./verify-structure.mjs", import.meta.url),
);

/**
 * 임시 구조를 저장소 루트로 삼아 실제 구조 검증 CLI를 별도 Node 프로세스로 실행한다.
 * @param {string} rootDir 테스트용 디렉터리.
 * @param {readonly string[]} requiredPaths CLI에 반복 옵션으로 전달할 필수 경로들.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} 종료 상태와 출력을 담은 검증 증거.
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

test("structure contract requires the pnpm lockfile", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-structure-"));

  try {
    assert.equal(REQUIRED_PATHS.includes("pnpm-lock.yaml"), true);
    assert.deepEqual(await findMissingPaths(rootDir, ["pnpm-lock.yaml"]), ["pnpm-lock.yaml"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
