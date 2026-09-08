import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  rangeFromCi,
  rangesFromPrePushUpdates,
  readChangedBlobs,
} from "./git-change-reader.mjs";
import { ZERO_SHA } from "./push-policy.mjs";
import {
  formatSecretFindings,
  scanBlobsForSecrets,
} from "./secret-scan.mjs";

/**
 * 테스트 저장소에서 Git 명령을 실제 실행한다. 인자에 따라 커밋 등 임시 상태를 바꿀 수 있다.
 * @param rootDir - 명령을 실행할 저장소 경로.
 * @param args - 셸 없이 Git에 전달할 인자 목록.
 * @returns 앞뒤 공백을 제거한 출력. 실행 실패는 오류로 전파된다.
 */
function git(rootDir, ...args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

/**
 * 임시 Git 저장소를 초기화하고 줄바꿈과 테스트 작성자 정보를 로컬 설정에 기록한다.
 * @param rootDir - 테스트가 만든 임시 디렉터리.
 * @returns 반환값 없음. 이 디렉터리의 Git 상태를 변경한다.
 */
function initGitFixture(rootDir) {
  git(rootDir, "init");
  git(rootDir, "config", "core.autocrlf", "false");
  git(rootDir, "config", "user.name", "Security Test");
  git(rootDir, "config", "user.email", "security-test@example.invalid");
}

/**
 * 탐지 결과가 경로와 규칙 ID 두 필드만 포함하는지 고정 메시지로 단언한다.
 * @param findings - 실제 스캐너 결과.
 * @param expected - 기대하는 순서의 경로·규칙 목록.
 * @returns 반환값 없음. 값·키·개수 불일치는 상세 비밀값 없이 테스트 실패.
 */
function assertSanitizedFindings(findings, expected) {
  const matches =
    Array.isArray(findings) &&
    findings.length === expected.length &&
    findings.every((finding, index) => {
      const keys =
        finding !== null && typeof finding === "object"
          ? Object.keys(finding).sort()
          : [];
      return (
        keys.length === 2 &&
        keys[0] === "path" &&
        keys[1] === "ruleId" &&
        finding.path === expected[index].path &&
        finding.ruleId === expected[index].ruleId
      );
    });
  assert.equal(
    matches,
    true,
    "findings must contain only the expected paths and rule IDs",
  );
}

/**
 * 실제 개인키 대신 탐지 규칙을 자극할 시작 마커 문자열만 만든다.
 * @param label - RSA·ENCRYPTED 등 선택적인 마커 종류.
 * @returns 조합한 가짜 개인키 시작 마커.
 */
function syntheticPrivateKeyMarker(label = "") {
  return [
    "-----BEGIN ",
    label,
    label.length > 0 ? " " : "",
    "PRIVATE KEY-----",
  ].join("");
}

/**
 * 토큰 모양의 가짜 문자열과 방향 제어문자가 든 경로를 만들어 로그 정화를 시험한다.
 * @returns 합성 경로와 각 구성 문자열. 실제 자격 증명이나 파일을 만들지는 않는다.
 */
function credentialShapedFilename() {
  const githubToken = ["gh", "p_", "P".repeat(36)].join("");
  const awsKey = ["AK", "IA", "W".repeat(16)].join("");
  const privateKey = ["-----", "BEGIN", " ", "PRIVATE", " ", "KEY-----"].join("");
  const bidiControl = "\u202e";
  return {
    awsKey,
    bidiControl,
    githubToken,
    path: ["credential-shaped", githubToken, awsKey, privateKey, bidiControl, "file.bin"].join("-"),
    privateKey,
  };
}

test("all tree blobs are read from each introduced pushed commit", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-security-"));
  try {
    initGitFixture(rootDir);
    await writeFile(join(rootDir, "safe.txt"), "safe\n", "utf8");
    git(rootDir, "add", "safe.txt");
    git(rootDir, "commit", "-m", "base");
    const base = git(rootDir, "rev-parse", "HEAD");

    await writeFile(join(rootDir, "changed.txt"), "changed\n", "utf8");
    git(rootDir, "add", "changed.txt");
    git(rootDir, "commit", "-m", "change");
    const head = git(rootDir, "rev-parse", "HEAD");

    const blobs = readChangedBlobs({ rootDir, ranges: [{ base, head }] });
    assert.deepEqual(blobs.map(({ path }) => path), ["changed.txt", "safe.txt"]);
    assert.equal(
      blobs.find(({ path }) => path === "changed.txt").content.toString("utf8"),
      "changed\n",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("synthetic secrets return rule IDs without the matched value", () => {
  const syntheticToken = `ghp_${"A".repeat(36)}`;
  const findings = scanBlobsForSecrets([
    { path: "fixture.txt", content: Buffer.from(syntheticToken) },
  ]);
  const report = formatSecretFindings(findings);

  assertSanitizedFindings(findings, [
    { path: "fixture.txt", ruleId: "GITHUB_TOKEN" },
  ]);
  assert.equal(report.includes("fixture.txt"), true, "report must identify the path");
  assert.equal(report.includes("GITHUB_TOKEN"), true, "report must identify the rule");
  assert.equal(
    report.includes(syntheticToken),
    false,
    "formatted findings must not contain matched secret values",
  );
});

test("formatted findings redact every supported credential form and render bidi controls safely", () => {
  const { awsKey, bidiControl, githubToken, path, privateKey } = credentialShapedFilename();
  const report = formatSecretFindings([{ path, ruleId: "GITHUB_TOKEN" }]);

  for (const credential of [githubToken, awsKey, privateKey]) {
    assert.equal(
      report.includes(credential),
      false,
      "formatted findings must not reveal credential-shaped path text",
    );
  }
  assert.equal(report.includes(bidiControl), false, "formatted findings must not contain raw bidi controls");
  assert.match(report, /\[REDACTED:GITHUB_TOKEN\]/u);
  assert.match(report, /\[REDACTED:AWS_ACCESS_KEY_ID\]/u);
  assert.match(report, /\[REDACTED:PRIVATE_KEY\]/u);
  assert.match(report, /\\u202e/u);
});

test("private-key markers and AWS key IDs are detected", () => {
  const awsKey = `AKIA${"B".repeat(16)}`;
  const content = Buffer.from(`${awsKey}\n${syntheticPrivateKeyMarker()}`);
  assertSanitizedFindings(scanBlobsForSecrets([{ path: "keys.txt", content }]), [
    { path: "keys.txt", ruleId: "AWS_ACCESS_KEY_ID" },
    { path: "keys.txt", ruleId: "PRIVATE_KEY" },
  ]);
});

test("a secret introduced and removed in intermediate pushed history is detected", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-security-"));
  try {
    initGitFixture(rootDir);
    await writeFile(join(rootDir, "safe.txt"), "safe\n", "utf8");
    git(rootDir, "add", "safe.txt");
    git(rootDir, "commit", "-m", "base");
    const base = git(rootDir, "rev-parse", "HEAD");

    const syntheticToken = ["ghp_", "H".repeat(36)].join("");
    await writeFile(join(rootDir, "history.txt"), syntheticToken, "utf8");
    git(rootDir, "add", "history.txt");
    git(rootDir, "commit", "-m", "introduce secret");
    await writeFile(join(rootDir, "history.txt"), "safe again\n", "utf8");
    git(rootDir, "add", "history.txt");
    git(rootDir, "commit", "-m", "remove secret");
    const head = git(rootDir, "rev-parse", "HEAD");

    const findings = scanBlobsForSecrets(
      readChangedBlobs({ rootDir, ranges: [{ base, head }] }),
    );
    assertSanitizedFindings(findings, [
      { path: "history.txt", ruleId: "GITHUB_TOKEN" },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("a zero-base new ref scans secrets from all reachable history", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-security-"));
  try {
    initGitFixture(rootDir);
    const syntheticToken = ["ghp_", "N".repeat(36)].join("");
    await writeFile(join(rootDir, "history.txt"), syntheticToken, "utf8");
    git(rootDir, "add", "history.txt");
    git(rootDir, "commit", "-m", "root secret");
    await writeFile(join(rootDir, "history.txt"), "safe at head\n", "utf8");
    git(rootDir, "add", "history.txt");
    git(rootDir, "commit", "-m", "remove root secret");
    const head = git(rootDir, "rev-parse", "HEAD");

    const findings = scanBlobsForSecrets(
      readChangedBlobs({ rootDir, ranges: [{ base: null, head }] }),
    );
    assertSanitizedFindings(findings, [
      { path: "history.txt", ruleId: "GITHUB_TOKEN" },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("repository reachable history contains no supported secret signatures", () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const head = git(repositoryRoot, "rev-parse", "HEAD");
  const findings = scanBlobsForSecrets(
    readChangedBlobs({
      rootDir: repositoryRoot,
      ranges: [{ base: null, head }],
    }),
  );

  assert.deepEqual(findings, []);
});

test("ref deletions do not produce commit ranges", () => {
  assert.deepEqual(
    rangesFromPrePushUpdates([
      { localSha: ZERO_SHA, remoteSha: "a".repeat(40) },
    ]),
    [],
  );
});

test("invalid CI and reader ranges fail closed with sanitized errors", () => {
  assert.throws(
    () => rangeFromCi({ base: "invalid", head: "b".repeat(40) }),
    ({ code, message }) =>
      code === "INVALID_CI_RANGE" &&
      message === "CI base/head must be full Git SHAs.",
  );
  assert.throws(
    () => readChangedBlobs({ rootDir: ".", ranges: [{ base: null, head: "--all" }] }),
    ({ code, message }) =>
      code === "INVALID_GIT_RANGE" &&
      message === "Pushed commit ranges must contain full Git SHAs.",
  );
});

test("oversized blobs fail closed before their content is read", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-security-"));
  try {
    initGitFixture(rootDir);
    await writeFile(join(rootDir, "large.bin"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x41));
    git(rootDir, "add", "large.bin");
    git(rootDir, "commit", "-m", "large blob");
    const head = git(rootDir, "rev-parse", "HEAD");

    assert.throws(
      () => readChangedBlobs({ rootDir, ranges: [{ base: null, head }] }),
      ({ code, message }) =>
        code === "BLOB_REVIEW_REQUIRED" &&
        message === "Changed file \"large.bin\" exceeds the 5 MiB automatic scan limit.",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("oversized-blob errors redact credential-shaped filenames and render bidi controls safely", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-security-"));
  try {
    initGitFixture(rootDir);
    const { awsKey, bidiControl, githubToken, path, privateKey } = credentialShapedFilename();
    await writeFile(join(rootDir, path), Buffer.alloc(5 * 1024 * 1024 + 1, 0x41));
    git(rootDir, "add", path);
    git(rootDir, "commit", "-m", "oversized credential-shaped filename");
    const head = git(rootDir, "rev-parse", "HEAD");

    let error;
    try {
      readChangedBlobs({ rootDir, ranges: [{ base: null, head }] });
    } catch (caught) {
      error = caught;
    }

    assert.equal(error?.code, "BLOB_REVIEW_REQUIRED");
    for (const credential of [githubToken, awsKey, privateKey]) {
      assert.equal(
        error.message.includes(credential),
        false,
        "oversized-blob errors must not reveal credential-shaped path text",
      );
    }
    assert.equal(error.message.includes(bidiControl), false, "oversized-blob errors must not contain raw bidi controls");
    assert.match(error.message, /\[REDACTED:GITHUB_TOKEN\]/u);
    assert.match(error.message, /\[REDACTED:AWS_ACCESS_KEY_ID\]/u);
    assert.match(error.message, /\[REDACTED:PRIVATE_KEY\]/u);
    assert.match(error.message, /\\u202e/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("binary content is scanned without embedding matched values in findings", () => {
  const syntheticToken = ["ghp_", "Z".repeat(36)].join("");
  const content = Buffer.concat([
    Buffer.from([0x00, 0xff, 0x01]),
    Buffer.from(syntheticToken, "ascii"),
    Buffer.from([0x00]),
  ]);
  const findings = scanBlobsForSecrets([{ path: "binary.dat", content }]);

  assertSanitizedFindings(findings, [
    { path: "binary.dat", ruleId: "GITHUB_TOKEN" },
  ]);
  assert.equal(
    JSON.stringify(findings).includes(syntheticToken),
    false,
    "sanitized findings must not contain matched secret values",
  );
});

test("hostile paths are JSON escaped in formatted findings", () => {
  const hostilePath = "line-break\nspoofed-rule: PRIVATE_KEY";
  const report = formatSecretFindings([
    { path: hostilePath, ruleId: "GITHUB_TOKEN" },
  ]);

  assert.equal(
    report,
    [
      "Potential secrets detected; matched values are intentionally hidden:",
      `- ${JSON.stringify(hostilePath)}: GITHUB_TOKEN`,
    ].join("\n"),
  );
});

test("expanded GitHub, AWS, and private-key credential forms are detected", () => {
  const fineGrainedPat = ["github_pat_", "F".repeat(24), "_", "9".repeat(24)].join("");
  const temporaryAwsKey = ["ASIA", "T".repeat(16)].join("");
  const content = Buffer.from(
    [
      fineGrainedPat,
      temporaryAwsKey,
      syntheticPrivateKeyMarker("ENCRYPTED"),
      syntheticPrivateKeyMarker("DSA"),
    ].join("\n"),
  );

  assertSanitizedFindings(scanBlobsForSecrets([{ path: "expanded.txt", content }]), [
    { path: "expanded.txt", ruleId: "AWS_ACCESS_KEY_ID" },
    { path: "expanded.txt", ruleId: "GITHUB_TOKEN" },
    { path: "expanded.txt", ruleId: "PRIVATE_KEY" },
  ]);
});

test("shallow repositories fail closed before returning partial blobs", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "account-book-security-"));
  const sourceDir = join(fixtureRoot, "source");
  const shallowDir = join(fixtureRoot, "shallow");
  try {
    git(fixtureRoot, "init", sourceDir);
    git(sourceDir, "config", "core.autocrlf", "false");
    git(sourceDir, "config", "user.name", "Security Test");
    git(sourceDir, "config", "user.email", "security-test@example.invalid");
    await writeFile(join(sourceDir, "history.txt"), "first commit\n", "utf8");
    git(sourceDir, "add", "history.txt");
    git(sourceDir, "commit", "-m", "first");
    await writeFile(join(sourceDir, "history.txt"), "second commit\n", "utf8");
    git(sourceDir, "add", "history.txt");
    git(sourceDir, "commit", "-m", "second");

    execFileSync(
      "git",
      ["clone", "--depth", "1", pathToFileURL(sourceDir).href, shallowDir],
      { cwd: fixtureRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    git(shallowDir, "config", "core.autocrlf", "false");
    assert.equal(git(shallowDir, "rev-parse", "--is-shallow-repository"), "true");
    const head = git(shallowDir, "rev-parse", "HEAD");

    assert.throws(
      () => readChangedBlobs({ rootDir: shallowDir, ranges: [{ base: null, head }] }),
      ({ code, message }) =>
        code === "SHALLOW_REPOSITORY_UNSUPPORTED" &&
        message ===
          "Shallow repositories cannot prove complete pushed history; fetch full history before scanning.",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
