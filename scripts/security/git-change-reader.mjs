import { spawnSync } from "node:child_process";

import { sanitizeDiagnosticPath } from "./diagnostic-path-sanitizer.mjs";
import { SecurityGateError } from "./errors.mjs";
import { withoutGithubCredentials } from "./merge-evidence.mjs";
import { ZERO_SHA } from "./push-policy.mjs";

const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;

/**
 * 읽기용 Git 명령을 동기 실행하고 표준 출력을 수집한다. Git의 원래 오류 출력은 공개하지 않는다.
 * @param {string} rootDir Git 명령을 실행할 저장소 디렉터리.
 * @param {string[]} args 셸 해석 없이 배열로 전달할 내부 Git 명령 인자.
 * @param {BufferEncoding|null} [encoding=null] 텍스트로 읽을 인코딩. null이면 바이트 그대로 읽는다.
 * @returns {Buffer|string} 요청한 형식의 표준 출력.
 * @throws {SecurityGateError} Git 실행 실패나 제한된 출력 버퍼 초과 시 GIT_READ_FAILED 오류.
 */
function runGit(rootDir, args, encoding = null) {
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd: rootDir,
    encoding,
    env: withoutGithubCredentials(process.env),
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
 * 커밋 범위를 Git에 넘기기 전에 40자리 SHA 형식인지 검사해 옵션 문자열 주입을 막는다.
 * @param {string|null} base 기존 원격 커밋. 새 참조여서 전체 이력을 볼 때는 null.
 * @param {string} head 푸시할 끝 커밋.
 * @returns {void} 형식이 유효하면 반환값 없이 종료한다. 커밋 존재 여부는 검사하지 않는다.
 * @throws {SecurityGateError} 허용되지 않은 SHA 형식이면 INVALID_GIT_RANGE 오류.
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
 * Git이 이 저장소를 얕은 복제(shallow)로 표시하는지 확인해 생략된 조상 이력을 놓치지 않게 한다.
 * @param {string} rootDir 확인할 저장소 디렉터리.
 * @returns {void} Git 응답이 정확히 false일 때만 반환한다. 이력을 내려받지는 않는다.
 * @throws {SecurityGateError} 얕은 복제, Git 실패 또는 예상하지 못한 응답이면 검사를 중단한다.
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
 * head에서 도달할 수 있지만 base에서는 도달할 수 없는 커밋을 Git rev-list의 역순으로 열거한다.
 * @param {string} rootDir 저장소 디렉터리.
 * @param {string|null} base 제외할 기존 이력의 끝. null이면 head의 전체 도달 가능한 이력.
 * @param {string} head 푸시할 끝 커밋.
 * @returns {string[]} 대상 커밋의 전체 객체 ID 목록. 최신순 출력을 뒤집은 순서다.
 * @throws {SecurityGateError} Git 조회 실패 또는 출력에 잘못된 SHA가 있으면 발생한다.
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
 * 현재 checkout과 정확한 커밋 부모를 원본 Git 객체에서 읽는다. replace 객체는 무시한다.
 * @param {{rootDir:string,head:string}} options 저장소 위치와 이벤트 after 전체 SHA.
 * @returns {{head:string,parents:string[]}} 읽은 HEAD/부모. 루트·다중 부모의 허용 판정은 순수 판정기가 한다.
 * @throws {SecurityGateError} 잘못된 SHA·shallow·없는 커밋·stale checkout·출력 불일치면 중단한다.
 */
export function readMainPushCommit({ rootDir, head }) {
  assertValidRange(null, head);
  assertCompleteRepositoryHistory(rootDir);
  const actual = runGit(rootDir, ["rev-parse", "HEAD"], "utf8").trim();
  const row = runGit(rootDir, ["rev-list", "--parents", "-n", "1", head, "--"], "utf8").trim();
  const [returnedHead, ...parents] = row.split(" ");
  if (actual !== head.toLowerCase() || returnedHead !== actual ||
    !SHA_PATTERN.test(returnedHead) || parents.some(parent => !SHA_PATTERN.test(parent))) {
    throw new SecurityGateError("GIT_READ_FAILED", "Git could not verify the exact pushed commit and parents.");
  }
  return { head: actual, parents };
}

/**
 * 한 커밋의 전체 파일 트리를 읽어 blob(파일 내용 객체)의 ID와 경로만 모은다. 내용은 아직 읽지 않는다.
 * @param {string} rootDir 저장소 디렉터리.
 * @param {string} commit 조회할 전체 커밋 객체 ID.
 * @returns {Array<{objectId: string, path: string}>} blob 객체 ID와 저장소 내 경로의 목록.
 * @throws {SecurityGateError} Git 실행 실패나 잘못된 트리 레코드는 건너뛰지 않고 오류로 처리한다.
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
 * pre-push 변경 정보를 검사 범위로 바꾸고 삭제 요청은 제외한다.
 * 새 원격 참조의 base는 null로 만들어 이후 단계가 전체 이력을 확인하게 한다.
 * @param {Array<{localSha: string, remoteSha: string}>} updates 앞 단계에서 파싱한 로컬·원격 SHA 목록.
 * @returns {Array<{base: string|null, head: string}>} 삭제가 아닌 변경의 범위 목록. 여기서는 Git을 실행하지 않는다.
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
 * CI의 시작·끝 SHA를 형식 검사한 뒤 하나의 파일 검사 범위로 바꾼다.
 * @param {{base: string, head: string}} options CI가 제공한 전체 Git SHA 두 개.
 * @returns {{base: string|null, head: string}} 검증된 범위. 0만 있는 base는 새 참조를 뜻하는 null로 바꾼다.
 * @throws {SecurityGateError} base나 head가 전체 SHA 형식이 아니면 INVALID_CI_RANGE 오류.
 */
export function rangeFromCi({ base, head }) {
  if (!SHA_PATTERN.test(head) || !SHA_PATTERN.test(base)) {
    throw new SecurityGateError("INVALID_CI_RANGE", "CI base/head must be full Git SHAs.");
  }
  return { base: base === ZERO_SHA ? null : base, head };
}

/**
 * 푸시에 포함되는 각 커밋의 전체 파일 트리를 읽어 중간 커밋에서만 존재했던 비밀값도 검사 대상으로 모은다.
 * 같은 내용은 객체 ID로 한 번만 읽되, 경로가 다르면 각 경로와 내용의 조합을 결과에 유지한다.
 * @param {{rootDir: string, ranges: Array<{base: string|null, head: string}>}} options 저장소 루트와 푸시할 커밋 범위들.
 * @returns {Array<{path: string, content: Buffer}>} 저장소 경로와 정확한 blob 바이트 목록. 작업 파일이나 Git 이력은 바꾸지 않는다.
 * @throws {SecurityGateError} 얕은 복제, 잘못된 범위·트리, Git 실패, 잘못된 크기 또는 5 MiB 초과 파일이면 검사를 중단한다.
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
            // Redact credentials and escape the repository-controlled path before diagnostics.
            throw new SecurityGateError(
              "BLOB_REVIEW_REQUIRED",
              `Changed file ${JSON.stringify(sanitizeDiagnosticPath(path))} exceeds the 5 MiB automatic scan limit.`,
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
