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
 * 지정한 디렉터리에서 Git을 동기 실행하고 출력과 오류를 결과 객체에 모은다.
 * 인자를 셸 문자열로 합치지 않고 배열로 직접 전달하며 읽기/쓰기 여부는 gitArgs가 결정한다.
 * @param {string} directory 저장소를 찾거나 명령을 실행할 디렉터리.
 * @param {string[]} gitArgs Git에 전달할 하위 명령과 인자.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} 종료 상태·표준 출력·오류를 담은 실행 결과. 성공 판정은 호출자가 한다.
 */
function runGit(directory, gitArgs) {
  return spawnSync("git", ["-C", directory, ...gitArgs], { encoding: "utf8" });
}

/**
 * Git rev-parse로 현재 위치가 속한 저장소의 최상위 경로를 찾는다.
 * @param {string} directory 사용자가 선택한 시작 디렉터리.
 * @returns {string|null} 저장소 루트의 절대 경로. 실행 오류·실패·빈 출력이면 null.
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
 * 저장소 루트의 .githooks/pre-push가 실제 파일인지 확인한다. 내용을 실행하지 않는다.
 * @param {string} directory 확인된 저장소 최상위 디렉터리.
 * @returns {Promise<boolean>} 파일이면 true. 누락이나 파일 시스템 오류는 상세 경로를 노출하지 않고 false.
 */
async function prePushHookExists(directory) {
  try {
    return (await stat(join(directory, ".githooks", "pre-push"))).isFile();
  } catch {
    return false;
  }
}

/**
 * 현재 저장소의 로컬 Git 설정에 core.hooksPath=.githooks를 기록한다.
 * @param {string} directory 확인된 저장소 최상위 디렉터리.
 * @returns {boolean} 설정 쓰기가 성공했으면 true, Git 실행 오류나 실패이면 false.
 * @remarks 전역 설정이 아니라 해당 저장소의 Git 설정을 변경하는 함수다.
 */
function writeHooksPath(directory) {
  const result = runGit(
    directory,
    ["config", "--local", "core.hooksPath", ".githooks"],
  );
  return !result.error && result.status === 0;
}

/**
 * 저장소의 로컬 hooksPath를 다시 읽어 방금 설정한 값과 정확히 같은지 확인한다.
 * @param {string} directory 확인된 저장소 최상위 디렉터리.
 * @returns {boolean} 앞뒤 공백을 제거한 값이 .githooks이면 true, 읽기 실패나 다른 값이면 false.
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
