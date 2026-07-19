# Free Plan Security Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub 무료 플랜의 비공개 저장소에서 서버 측 브랜치 보호와 secret scanning을 사용할 수 없다는 잔여 위험을 명시하면서, 로컬 pre-push 훅·공통 Node 보안 게이트·읽기 전용 CI·PR 검토 증거로 실수와 비밀정보 유출 가능성을 줄인다.

**Architecture:** 브랜치 정책, Git 변경 범위 읽기, 비밀정보 탐지, 실행 오케스트레이션을 작은 Node ESM 모듈로 분리하고 `scripts/security-gate.mjs`가 pre-push와 CI의 공통 진입점이 된다. 로컬 훅과 GitHub Actions는 동일한 게이트를 호출하며, GitHub 무료 플랜의 우회 가능성을 문서와 PR 체크리스트에 계속 노출한다.

**Tech Stack:** Node.js `22.15.1`, pnpm `11.9.0`, Node 내장 `node:test`, Git, POSIX `sh`, GitHub Actions, GitHub CLI.

## Global Constraints

- 저장소는 `jawon0407/account-book` 비공개 상태를 유지하고 공개로 전환하지 않는다.
- `main`과 `origin/main`의 기준 SHA는 `f78c3a3ef13563716742e1671b19c60a1b685f97`다.
- 구현 브랜치는 현재 `feature/free-plan-security-gates`; 설계 커밋은 `eabf2b4f94ba32a38ae60190cc293bfa9155f3af`다.
- 브랜치는 `main`, `feature/{kebab-case}`, `maintenance-branch`, `hotfix/{kebab-case}`만 사용하며 `develop`은 만들지 않는다.
- 정책상 `main` 직접 push를 금지한다. 무료 플랜에서는 기술적 강제가 불가능하므로 우회 가능성을 숨기지 않는다.
- branch protection/rulesets는 HTTP 403, secret scanning/push protection은 HTTP 422로 현재 플랜에서 사용할 수 없다. 어떤 문서나 출력도 이 제어가 활성화됐다고 주장하지 않는다.
- Dependabot vulnerability alerts와 automated security fixes는 활성화 상태를 유지한다.
- 실제 토큰, 쿠키, OAuth code, 개인키, 계좌 식별자, 거래 원문을 코드·fixture·로그·보고서에 넣지 않는다.
- 합성 토큰은 테스트 실행 중 문자열 조합으로만 만들고 전체 값을 오류 출력에 포함하지 않는다.
- Node 내장 모듈만 사용한다. 런타임 또는 개발 의존성을 추가하지 않는다.
- 모든 export 함수와 보안상 비자명한 분기에는 행동 원리, 매개변수, 반환값, 실패 조건을 JSDoc 또는 인접 주석으로 설명한다.
- TDD는 테스트가 정상 로드된 뒤 assertion으로 실패하는 RED를 먼저 증명한다. import·구문·fixture 로드 실패는 유효한 RED가 아니다.
- 외부 GitHub Action은 전체 commit SHA로 고정한다. 2026-07-17 GitHub 공식 API로 확인한 핀은 `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` (`v7.0.0`)과 `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`)이다.
- GitHub Actions 권한은 `contents: read`만 허용하며 `pull_request_target`, 운영 secret, 배포 키를 사용하지 않는다.
- 관리자 페이지와 애플리케이션 인증·원장·데이터베이스 기능은 이 계획의 범위가 아니다.

---

## File Responsibility Map

| Path | Responsibility |
|---|---|
| `scripts/security/errors.mjs` | 안전한 오류 코드와 사용자 메시지 타입을 정의한다. |
| `scripts/security/push-policy.mjs` | pre-push 입력을 파싱하고 허용 브랜치와 CI 이벤트 정책을 판정한다. |
| `scripts/security/push-policy.test.mjs` | 브랜치 정책의 RED/GREEN 단위 테스트를 소유한다. |
| `scripts/security/git-change-reader.mjs` | push/CI SHA 범위를 Git blob 목록으로 변환한다. |
| `scripts/security/secret-scan.mjs` | blob 내용에서 비밀정보 규칙 ID만 반환하고 실제 일치값은 폐기한다. |
| `scripts/security/secret-scan.test.mjs` | 변경 범위와 마스킹 탐지 동작을 검증한다. |
| `scripts/security/gate.mjs` | 정책, 구조 검사, Git 변경 읽기, 비밀정보 검사를 한 트랜잭션으로 조정한다. |
| `scripts/security-gate.mjs` | `--mode pre-push|ci` CLI와 표준 입력/종료 코드를 제공한다. |
| `scripts/security-gate.test.mjs` | 공개 CLI의 fail-closed 및 하위 명령 실패 전파를 검증한다. |
| `.githooks/pre-push` | Git의 remote/ref 입력을 공통 CLI에 전달한다. |
| `scripts/setup-hooks.mjs` | 저장소 로컬 `core.hooksPath=.githooks`를 설정하고 다시 읽어 검증한다. |
| `scripts/setup-hooks.test.mjs` | 격리된 임시 Git 저장소에서 훅 설치를 검증한다. |
| `.github/workflows/security-gate.yml` | PR/push에서 읽기 전용 보안 게이트를 실행한다. |
| `scripts/security/workflow-policy.test.mjs` | CI 트리거, 권한, Action SHA, 금지 기능을 정적으로 검증한다. |
| `.github/CODEOWNERS` | 보안 관련 파일 검토 책임을 `@jawon0407`에 연결한다. |
| `.github/pull_request_template.md` | 테스트·보안·잔여 위험 증거를 PR에 남기게 한다. |
| `docs/security/free-plan-compensating-controls.md` | 무료 플랜 위험 수용, 운영 절차, 사고 처리, 업그레이드 조건을 설명한다. |
| `SECURITY.md` 및 `docs/security/*.md` | 실제 제어 상태와 PR 검증 절차를 일관되게 갱신한다. |
| `docs/guides/testing.md` | 개발자가 실행할 보안 테스트·훅 설치·시뮬레이션 명령을 제공한다. |
| `scripts/required-structure.mjs` | 새 필수 보안 파일을 저장소 구조 계약에 포함한다. |

---

### Task 1: Create and Publish the Maintenance Baseline

**Files:**

- Modify locally and remotely: Git branch `maintenance-branch`
- Read: `docs/superpowers/specs/2026-07-17-free-plan-security-gates-design.md`

**Interfaces:**

- Consumes: local `main` and `origin/main` at `f78c3a3ef13563716742e1671b19c60a1b685f97`
- Produces: local and remote `maintenance-branch` at the same SHA with upstream `origin/maintenance-branch`

- [ ] **Step 1: Prove the working tree and baseline are safe**

Run:

```powershell
git branch --show-current
git status --short --branch
git rev-parse main
git rev-parse origin/main
git branch --list maintenance-branch
git ls-remote --heads origin maintenance-branch
```

Expected: current branch is `feature/free-plan-security-gates`; status is clean; both main SHAs are `f78c3a3ef13563716742e1671b19c60a1b685f97`; maintenance branch searches are empty.

- [ ] **Step 2: Create the branch without moving the feature checkout**

Run:

```powershell
git branch maintenance-branch main
git rev-parse maintenance-branch
```

Expected: the returned SHA is `f78c3a3ef13563716742e1671b19c60a1b685f97` and the current checkout remains the feature branch.

- [ ] **Step 3: Push and establish tracking**

Run in the authenticated Windows user context:

```powershell
git push -u origin maintenance-branch
git branch --set-upstream-to=origin/maintenance-branch maintenance-branch
```

Expected: the remote branch is created and the local branch tracks `origin/maintenance-branch`.

- [ ] **Step 4: Read back all branch identities**

Run:

```powershell
$mainSha = git rev-parse main
$maintenanceSha = git rev-parse maintenance-branch
$remoteMaintenanceSha = git rev-parse origin/maintenance-branch
if ($mainSha -ne $maintenanceSha -or $mainSha -ne $remoteMaintenanceSha) {
  throw "main and maintenance-branch must share the initial SHA"
}
git ls-remote --heads origin main maintenance-branch
git status --short --branch
```

Expected: both live remote refs use the same initial SHA; feature checkout remains clean. This external-state task creates no commit.

---

### Task 2: Enforce the Branch Push Policy

**Files:**

- Create: `scripts/security/errors.mjs`
- Create: `scripts/security/push-policy.mjs`
- Create: `scripts/security/push-policy.test.mjs`

**Interfaces:**

- Produces: `SecurityGateError`, `ZERO_SHA`, `parsePrePushInput(input)`, `assertPrePushPolicy(updates)`, `assertCiPolicy({ eventName, targetRef })`
- Consumes later: Task 4 gate orchestration calls all three policy functions

- [ ] **Step 1: Write the failing branch-policy tests**

Create `scripts/security/push-policy.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  ZERO_SHA,
  assertCiPolicy,
  assertPrePushPolicy,
  parsePrePushInput,
} from "./push-policy.mjs";

const LOCAL_SHA = "1".repeat(40);
const REMOTE_SHA = "2".repeat(40);

test("pre-push input is parsed into named ref updates", () => {
  const [update] = parsePrePushInput(
    `refs/heads/feature/free-plan-security-gates ${LOCAL_SHA} refs/heads/feature/free-plan-security-gates ${ZERO_SHA}\n`,
  );

  assert.deepEqual(update, {
    localRef: "refs/heads/feature/free-plan-security-gates",
    localSha: LOCAL_SHA,
    remoteRef: "refs/heads/feature/free-plan-security-gates",
    remoteSha: ZERO_SHA,
  });
});

test("malformed or empty pre-push input fails closed", () => {
  assert.throws(() => parsePrePushInput(""), { code: "PRE_PUSH_INPUT_REQUIRED" });
  assert.throws(() => parsePrePushInput("refs/heads/feature/x bad"), {
    code: "INVALID_PRE_PUSH_INPUT",
  });
});

test("direct main pushes are rejected", () => {
  const updates = parsePrePushInput(
    `refs/heads/main ${LOCAL_SHA} refs/heads/main ${REMOTE_SHA}\n`,
  );
  assert.throws(() => assertPrePushPolicy(updates), {
    code: "DIRECT_MAIN_PUSH",
  });
});

test("Git deletion-form input fails closed during parsing", () => {
  assert.throws(
    () =>
      parsePrePushInput(
        `(delete) ${ZERO_SHA} refs/heads/main ${REMOTE_SHA}\n`,
      ),
    {
      code: "INVALID_PRE_PUSH_INPUT",
      message: "Git pre-push input contains an invalid ref or SHA.",
    },
  );
});

test("feature, hotfix, and maintenance refs are allowed", () => {
  for (const remoteRef of [
    "refs/heads/feature/security-auth-foundation",
    "refs/heads/hotfix/session-cookie",
    "refs/heads/maintenance-branch",
  ]) {
    assert.doesNotThrow(() =>
      assertPrePushPolicy([
        {
          localRef: remoteRef,
          localSha: LOCAL_SHA,
          remoteRef,
          remoteSha: ZERO_SHA,
        },
      ]),
    );
  }
});

test("unknown refs fail closed", () => {
  assert.throws(
    () =>
      assertPrePushPolicy([
        {
          localRef: "refs/heads/experiment",
          localSha: LOCAL_SHA,
          remoteRef: "refs/heads/experiment",
          remoteSha: ZERO_SHA,
        },
      ]),
    {
      code: "UNSUPPORTED_PUSH_REF",
      message: "Push target is outside the approved branch convention.",
    },
  );
});

test("policy diagnostics do not echo hostile refs or CI event names", () => {
  const hostileRemoteRef = "refs/heads/experiment\nforged\u202e";
  const hostileEventName = "workflow_dispatch\nforged\u202d";
  const hostileTargetRef = "refs/heads/unknown\nforged\u2066";

  assert.throws(
    () =>
      assertPrePushPolicy([
        {
          localRef: hostileRemoteRef,
          localSha: LOCAL_SHA,
          remoteRef: hostileRemoteRef,
          remoteSha: ZERO_SHA,
        },
      ]),
    {
      code: "UNSUPPORTED_PUSH_REF",
      message: "Push target is outside the approved branch convention.",
    },
  );
  assert.throws(
    () => assertCiPolicy({ eventName: "push", targetRef: hostileTargetRef }),
    {
      code: "UNSUPPORTED_PUSH_REF",
      message: "GitHub push target is outside the approved branch convention.",
    },
  );
  assert.throws(
    () =>
      assertCiPolicy({
        eventName: hostileEventName,
        targetRef: hostileTargetRef,
      }),
    {
      code: "UNSUPPORTED_CI_EVENT",
      message: "Unsupported CI event/ref combination.",
    },
  );
});

test("CI rejects a direct main push but accepts a PR targeting main", () => {
  assert.throws(
    () => assertCiPolicy({ eventName: "push", targetRef: "refs/heads/main" }),
    { code: "DIRECT_MAIN_PUSH_REACHED_REMOTE" },
  );
  assert.doesNotThrow(() =>
    assertCiPolicy({
      eventName: "pull_request",
      targetRef: "refs/heads/main",
    }),
  );
});
```

- [ ] **Step 2: Run the test and prove a valid RED**

Run:

```powershell
node --test scripts/security/push-policy.test.mjs
```

Expected: the runner first reports the missing module. This loader failure is setup evidence, not the accepted RED. Create `errors.mjs` with the Task 2 Step 3 content, then create this temporary `push-policy.mjs`:

```js
export const ZERO_SHA = "0".repeat(40);

export function parsePrePushInput(input) {
  if (input.trim().length === 0) return [];
  return input.trim().split(/\r?\n/u).map((line) => {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/u);
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

export function assertPrePushPolicy() {}
export function assertCiPolicy() {}
```

Rerun the command. Expected accepted RED: all 6 tests load; empty/malformed input, direct main push, unknown ref, and CI main push assertions fail. Replace the temporary module in Step 4.

- [ ] **Step 3: Implement the safe error type**

Create `scripts/security/errors.mjs`:

```js
/**
 * Error whose public code and message are safe to print without secret values.
 */
export class SecurityGateError extends Error {
  /**
   * @param {string} code Stable machine-readable failure identifier.
   * @param {string} message Sanitized explanation safe for terminal and CI logs.
   */
  constructor(code, message) {
    super(message);
    this.name = "SecurityGateError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Implement input parsing and branch policy**

Create `scripts/security/push-policy.mjs`:

```js
import { SecurityGateError } from "./errors.mjs";

export const ZERO_SHA = "0".repeat(40);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ALLOWED_PUSH_REFS = Object.freeze([
  /^refs\/heads\/feature\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^refs\/heads\/hotfix\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^refs\/heads\/maintenance-branch$/,
]);
const ALLOWED_PR_TARGETS = new Set([
  "refs/heads/main",
  "refs/heads/maintenance-branch",
]);

/**
 * Parses Git pre-push stdin lines.
 *
 * @param {string} input Raw lines in `<local-ref> <local-sha> <remote-ref> <remote-sha>` form.
 * @returns {Array<{localRef: string, localSha: string, remoteRef: string, remoteSha: string}>}
 * @throws {SecurityGateError} When input is empty, incomplete, or contains invalid refs/SHAs.
 */
export function parsePrePushInput(input) {
  const lines = input.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new SecurityGateError(
      "PRE_PUSH_INPUT_REQUIRED",
      "Git did not provide any pre-push ref updates; push blocked.",
    );
  }

  return lines.map((line) => {
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 4) {
      throw new SecurityGateError(
        "INVALID_PRE_PUSH_INPUT",
        "Git pre-push input must contain exactly four fields per line.",
      );
    }

    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (
      !localRef.startsWith("refs/") ||
      !remoteRef.startsWith("refs/") ||
      !SHA_PATTERN.test(localSha) ||
      !SHA_PATTERN.test(remoteSha)
    ) {
      throw new SecurityGateError(
        "INVALID_PRE_PUSH_INPUT",
        "Git pre-push input contains an invalid ref or SHA.",
      );
    }

    return { localRef, localSha, remoteRef, remoteSha };
  });
}

/**
 * Blocks direct main pushes and refs outside the approved branch convention.
 *
 * @param {ReturnType<typeof parsePrePushInput>} updates Parsed ref updates.
 * @throws {SecurityGateError} When a target ref violates repository policy.
 */
export function assertPrePushPolicy(updates) {
  for (const update of updates) {
    if (update.remoteRef === "refs/heads/main") {
      throw new SecurityGateError(
        "DIRECT_MAIN_PUSH",
        "Direct pushes to main are prohibited. Push a feature/* or hotfix/* branch and open a PR.",
      );
    }

    if (!ALLOWED_PUSH_REFS.some((pattern) => pattern.test(update.remoteRef))) {
      throw new SecurityGateError(
        "UNSUPPORTED_PUSH_REF",
        "Push target is outside the approved branch convention.",
      );
    }
  }
}

/**
 * Applies the same branch policy to a GitHub Actions event.
 *
 * @param {{eventName: string, targetRef: string}} options Event and normalized target ref.
 * @throws {SecurityGateError} When a direct main push or unknown event/ref is observed.
 */
export function assertCiPolicy({ eventName, targetRef }) {
  if (eventName === "push") {
    if (targetRef === "refs/heads/main") {
      throw new SecurityGateError(
        "DIRECT_MAIN_PUSH_REACHED_REMOTE",
        "A direct main push reached GitHub. Stop work and follow docs/security/incident-response.md.",
      );
    }
    if (!ALLOWED_PUSH_REFS.some((pattern) => pattern.test(targetRef))) {
      throw new SecurityGateError(
        "UNSUPPORTED_PUSH_REF",
        "GitHub push target is outside the approved branch convention.",
      );
    }
    return;
  }

  if (eventName === "pull_request" && ALLOWED_PR_TARGETS.has(targetRef)) {
    return;
  }

  throw new SecurityGateError(
    "UNSUPPORTED_CI_EVENT",
    "Unsupported CI event/ref combination.",
  );
}
```

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node --test scripts/security/push-policy.test.mjs
git diff --check
git add scripts/security/errors.mjs scripts/security/push-policy.mjs scripts/security/push-policy.test.mjs
git commit -m "feat: enforce push branch policy"
```

Expected: 6 tests pass, 0 fail; one focused commit is created.

---

### Task 3: Scan Pushed Commit Content Without Leaking Values

**Files:**

- Create: `scripts/security/git-change-reader.mjs`
- Create: `scripts/security/secret-scan.mjs`
- Create: `scripts/security/secret-scan.test.mjs`

**Interfaces:**

- Produces: `rangesFromPrePushUpdates(updates)`, `rangeFromCi({ base, head })`, `readChangedBlobs({ rootDir, ranges })`, `scanBlobsForSecrets(blobs)`, `formatSecretFindings(findings)`
- Consumes: `ZERO_SHA` and `SecurityGateError` from Task 2
- Produces for Task 4: sanitized `{ path, ruleId }` findings only

- [ ] **Step 1: Write secret-scan tests before implementation**

Create `scripts/security/secret-scan.test.mjs` with tests that:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readChangedBlobs } from "./git-change-reader.mjs";
import {
  formatSecretFindings,
  scanBlobsForSecrets,
} from "./secret-scan.mjs";

function git(rootDir, ...args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

test("changed commit blobs are read from the pushed SHA", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-security-"));
  try {
    git(rootDir, "init");
    git(rootDir, "config", "user.name", "Security Test");
    git(rootDir, "config", "user.email", "security-test@example.invalid");
    await writeFile(join(rootDir, "safe.txt"), "safe\n", "utf8");
    git(rootDir, "add", "safe.txt");
    git(rootDir, "commit", "-m", "base");
    const base = git(rootDir, "rev-parse", "HEAD");

    await writeFile(join(rootDir, "changed.txt"), "changed\n", "utf8");
    git(rootDir, "add", "changed.txt");
    git(rootDir, "commit", "-m", "change");
    const head = git(rootDir, "rev-parse", "HEAD");

    const blobs = readChangedBlobs({ rootDir, ranges: [{ base, head }] });
    assert.deepEqual(blobs.map(({ path }) => path), ["changed.txt"]);
    assert.equal(blobs[0].content.toString("utf8"), "changed\n");
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

  assert.deepEqual(findings, [{ path: "fixture.txt", ruleId: "GITHUB_TOKEN" }]);
  assert.match(report, /fixture\.txt/);
  assert.match(report, /GITHUB_TOKEN/);
  assert.doesNotMatch(report, new RegExp(syntheticToken));
});

test("private-key markers and AWS key IDs are detected", () => {
  const awsKey = `AKIA${"B".repeat(16)}`;
  const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const content = Buffer.from(`${awsKey}\n${privateKeyMarker}`);
  assert.deepEqual(scanBlobsForSecrets([{ path: "keys.txt", content }]), [
    { path: "keys.txt", ruleId: "AWS_ACCESS_KEY_ID" },
    { path: "keys.txt", ruleId: "PRIVATE_KEY" },
  ]);
});
```

- [ ] **Step 2: Prove assertion RED**

Create temporary modules so the runner reaches assertions.

Temporary `scripts/security/git-change-reader.mjs`:

```js
export function readChangedBlobs() {
  return [];
}
```

Temporary `scripts/security/secret-scan.mjs`:

```js
export function scanBlobsForSecrets() {
  return [];
}

export function formatSecretFindings() {
  return "";
}
```

Run:

```powershell
node --test scripts/security/secret-scan.test.mjs
```

Expected: 3 tests load; all 3 assertions fail because no blobs or findings are returned. Replace both temporary modules in Steps 3–4.

- [ ] **Step 3: Implement Git range and blob reading**

Create `scripts/security/git-change-reader.mjs` with these exact behaviors:

```js
import { spawnSync } from "node:child_process";

import { SecurityGateError } from "./errors.mjs";
import { ZERO_SHA } from "./push-policy.mjs";

const MAX_BLOB_BYTES = 5 * 1024 * 1024;

function runGit(rootDir, args, encoding = null) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding,
    maxBuffer: MAX_BLOB_BYTES + 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new SecurityGateError(
      "GIT_READ_FAILED",
      `Git could not inspect the pushed commit range for ${args[0]}.`,
    );
  }
  return result.stdout;
}

/** @param {Array<{localSha: string, remoteSha: string}>} updates */
export function rangesFromPrePushUpdates(updates) {
  return updates
    .filter(({ localSha }) => localSha !== ZERO_SHA)
    .map(({ localSha, remoteSha }) => ({
      base: remoteSha === ZERO_SHA ? null : remoteSha,
      head: localSha,
    }));
}

/** @param {{base: string, head: string}} options */
export function rangeFromCi({ base, head }) {
  if (!/^[0-9a-f]{40}$/iu.test(head) || !/^[0-9a-f]{40}$/iu.test(base)) {
    throw new SecurityGateError("INVALID_CI_RANGE", "CI base/head must be full Git SHAs.");
  }
  return { base: base === ZERO_SHA ? null : base, head };
}

/**
 * Reads only added, copied, modified, or renamed blobs from the pushed commit ranges.
 *
 * @param {{rootDir: string, ranges: Array<{base: string|null, head: string}>}} options
 * @returns {Array<{path: string, content: Buffer}>}
 */
export function readChangedBlobs({ rootDir, ranges }) {
  const blobs = [];
  const seen = new Set();

  for (const { base, head } of ranges) {
    const args = base
      ? ["diff", "--name-only", "--diff-filter=ACMR", "-z", base, head, "--"]
      : ["diff-tree", "--root", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-r", "-z", head];
    const paths = runGit(rootDir, args)
      .toString("utf8")
      .split("\0")
      .filter(Boolean);

    for (const path of paths) {
      const key = `${head}\0${path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const objectName = `${head}:${path}`;
      const size = Number.parseInt(runGit(rootDir, ["cat-file", "-s", objectName], "utf8"), 10);
      if (!Number.isSafeInteger(size) || size > MAX_BLOB_BYTES) {
        throw new SecurityGateError(
          "BLOB_REVIEW_REQUIRED",
          `Changed file ${path} exceeds the 5 MiB automatic scan limit.`,
        );
      }
      blobs.push({ path, content: runGit(rootDir, ["cat-file", "blob", objectName]) });
    }
  }

  return blobs;
}
```

- [ ] **Step 4: Implement value-discarding secret detection**

Create `scripts/security/secret-scan.mjs`:

```js
const SECRET_RULES = Object.freeze([
  { ruleId: "AWS_ACCESS_KEY_ID", pattern: /AKIA[0-9A-Z]{16}/u },
  { ruleId: "GITHUB_TOKEN", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/u },
  {
    ruleId: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
]);

/**
 * Returns only file paths and rule IDs; matched secret substrings are discarded.
 *
 * @param {Array<{path: string, content: Buffer}>} blobs Exact blobs from pushed commits.
 * @returns {Array<{path: string, ruleId: string}>} Sanitized deterministic findings.
 */
export function scanBlobsForSecrets(blobs) {
  const findings = [];
  for (const { path, content } of blobs) {
    const text = content.toString("latin1");
    for (const { ruleId, pattern } of SECRET_RULES) {
      if (pattern.test(text)) findings.push({ path, ruleId });
    }
  }
  return findings.sort((left, right) =>
    `${left.path}\0${left.ruleId}`.localeCompare(`${right.path}\0${right.ruleId}`),
  );
}

/** @param {Array<{path: string, ruleId: string}>} findings */
export function formatSecretFindings(findings) {
  return [
    "Potential secrets detected; matched values are intentionally hidden:",
    ...findings.map(({ path, ruleId }) => `- ${path}: ${ruleId}`),
  ].join("\n");
}
```

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node --test scripts/security/secret-scan.test.mjs
git diff --check
git add scripts/security/git-change-reader.mjs scripts/security/secret-scan.mjs scripts/security/secret-scan.test.mjs
git commit -m "feat: scan pushed commits for secrets"
```

Expected: 3 tests pass; output contains no synthetic token value.

---

### Task 4: Add the Common CLI and Local Hook

**Files:**

- Create: `scripts/security/gate.mjs`
- Create: `scripts/security-gate.mjs`
- Create: `scripts/security-gate.test.mjs`
- Create: `.githooks/pre-push`
- Create: `scripts/setup-hooks.mjs`
- Create: `scripts/setup-hooks.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `runSecurityGate(options, dependencies)`, CLI `--mode pre-push|ci`, `pnpm test:security-gate`, `pnpm setup:hooks`
- Consumes: branch policy and secret scan interfaces from Tasks 2–3
- Produces for Task 5: stable CLI invoked by GitHub Actions

- [ ] **Step 1: Write failing CLI and hook-install tests**

Create `scripts/security-gate.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = fileURLToPath(new URL("./security-gate.mjs", import.meta.url));
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();
// These policy tests only require a well-formed remote SHA. Keeping it synthetic
// avoids depending on a local `main` ref, which is absent in single-branch CI checkouts.
const BASE = "2".repeat(40);

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
```

Create `scripts/setup-hooks.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("./setup-hooks.mjs", import.meta.url));

test("hook installer sets the repository-local hooks path", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-hooks-"));
  try {
    execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });
    const result = spawnSync(process.execPath, [cliPath, "--root", rootDir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
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
```

- [ ] **Step 2: Prove assertion RED**

Create temporary `scripts/security-gate.mjs` and `scripts/setup-hooks.mjs` files containing only `console.log("not implemented");`, then run:

```powershell
node --test scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs
```

Expected: 4 tests load; the three CLI status assertions and hook-path assertion fail. Replace both temporary CLIs in Steps 4–5.

- [ ] **Step 3: Implement the orchestration library**

Create `scripts/security/gate.mjs` with:

```js
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { SecurityGateError } from "./errors.mjs";
import {
  rangeFromCi,
  rangesFromPrePushUpdates,
  readChangedBlobs,
} from "./git-change-reader.mjs";
import {
  assertCiPolicy,
  assertPrePushPolicy,
} from "./push-policy.mjs";
import {
  formatSecretFindings,
  scanBlobsForSecrets,
} from "./secret-scan.mjs";

function runRepositoryChecks(rootDir) {
  const commands = [
    [process.execPath, ["--test", join(rootDir, "scripts/verify-structure.test.mjs")]],
    [process.execPath, [join(rootDir, "scripts/verify-structure.mjs")]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
    if (result.status !== 0) {
      throw new SecurityGateError(
        "REPOSITORY_CHECK_FAILED",
        `Repository check failed with exit code ${result.status ?? "unknown"}.`,
      );
    }
  }
}

/**
 * Runs policy, repository-contract, and pushed-blob checks in fail-closed order.
 *
 * @param {{mode: "pre-push"|"ci", rootDir: string, updates?: Array, eventName?: string, targetRef?: string, base?: string, head?: string}} options
 * @returns {{scannedBlobCount: number}} Non-sensitive verification summary.
 */
export function runSecurityGate(options) {
  let ranges;
  if (options.mode === "pre-push") {
    assertPrePushPolicy(options.updates);
    ranges = rangesFromPrePushUpdates(options.updates);
  } else if (options.mode === "ci") {
    assertCiPolicy({ eventName: options.eventName, targetRef: options.targetRef });
    ranges = [rangeFromCi({ base: options.base, head: options.head })];
  } else {
    throw new SecurityGateError("INVALID_MODE", "Mode must be pre-push or ci.");
  }

  runRepositoryChecks(options.rootDir);
  const blobs = readChangedBlobs({ rootDir: options.rootDir, ranges });
  const findings = scanBlobsForSecrets(blobs);
  if (findings.length > 0) {
    throw new SecurityGateError("SECRET_DETECTED", formatSecretFindings(findings));
  }
  return { scannedBlobCount: blobs.length };
}
```

- [ ] **Step 4: Implement the public CLI**

Replace `scripts/security-gate.mjs` with:

```js
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SecurityGateError } from "./security/errors.mjs";
import { runSecurityGate } from "./security/gate.mjs";
import { parsePrePushInput } from "./security/push-policy.mjs";

const VALUE_OPTIONS = new Map([
  ["--mode", "mode"],
  ["--root", "rootDir"],
  ["--event", "eventName"],
  ["--target-ref", "targetRef"],
  ["--base", "base"],
  ["--head", "head"],
  ["--remote-name", "remoteName"],
  ["--remote-url", "remoteUrl"],
]);

/**
 * Parses public CLI options and validates mode-specific required values.
 *
 * @param {string[]} args Process arguments after the script path.
 * @returns {{mode: "pre-push"|"ci", rootDir: string, eventName?: string, targetRef?: string, base?: string, head?: string}}
 */
function parseArguments(args) {
  const options = { rootDir: process.cwd() };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const key = VALUE_OPTIONS.get(option);
    const value = args[index + 1];
    if (!key || !value) {
      throw new SecurityGateError(
        "INVALID_ARGUMENT",
        `Unknown option or missing value: ${option ?? "<none>"}.`,
      );
    }
    options[key] = key === "rootDir" ? resolve(value) : value;
  }

  if (options.mode !== "pre-push" && options.mode !== "ci") {
    throw new SecurityGateError("INVALID_MODE", "Mode must be pre-push or ci.");
  }
  if (
    options.mode === "ci" &&
    [options.eventName, options.targetRef, options.base, options.head].some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    throw new SecurityGateError(
      "CI_ARGUMENTS_REQUIRED",
      "CI mode requires event, target-ref, base, and head.",
    );
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === "pre-push") {
    options.updates = parsePrePushInput(await readFile(0, "utf8"));
  }
  const result = runSecurityGate(options);
  console.log(`Security gate passed; scanned ${result.scannedBlobCount} changed blobs.`);
} catch (error) {
  const code = error instanceof SecurityGateError ? error.code : "UNEXPECTED_FAILURE";
  const message = error instanceof SecurityGateError
    ? error.message
    : "Security gate failed without a safe diagnostic.";
  console.error(`[${code}] ${message}`);
  process.exitCode = 1;
}
```

- [ ] **Step 5: Add the hook and installer**

Create `.githooks/pre-push`:

```sh
#!/bin/sh
set -eu

# Git passes remote name/URL as $1/$2 and ref updates on stdin.
# The Node CLI inherits stdin so the exact pushed refs are checked.
node scripts/security-gate.mjs \
  --mode pre-push \
  --remote-name "$1" \
  --remote-url "$2"
```

Replace `scripts/setup-hooks.mjs` with:

```js
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let rootDir = process.cwd();
if (args.length > 0) {
  if (args.length !== 2 || args[0] !== "--root" || !args[1]) {
    console.error("[INVALID_ARGUMENT] Usage: setup-hooks.mjs [--root <path>]");
    process.exit(1);
  }
  rootDir = resolve(args[1]);
}

/**
 * Runs a Git config command inside one repository.
 *
 * @param {string[]} gitArgs Arguments passed directly to Git without shell parsing.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Git result.
 */
function runGit(gitArgs) {
  return spawnSync("git", ["-C", rootDir, ...gitArgs], { encoding: "utf8" });
}

const writeResult = runGit(["config", "--local", "core.hooksPath", ".githooks"]);
if (writeResult.status !== 0) {
  console.error("[HOOK_CONFIG_FAILED] Git could not set the local hooks path.");
  process.exit(1);
}

const readResult = runGit(["config", "--local", "--get", "core.hooksPath"]);
if (readResult.status !== 0 || readResult.stdout.trim() !== ".githooks") {
  console.error("[HOOK_CONFIG_VERIFY_FAILED] Local hooks path read-back failed.");
  process.exit(1);
}

console.log("Git hooks path configured: .githooks");
```

Update `package.json` scripts:

```json
{
  "test:structure": "node --test scripts/verify-structure.test.mjs",
  "test": "node --test scripts/verify-structure.test.mjs scripts/security/*.test.mjs scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs",
  "test:security-gate": "node --test scripts/security/*.test.mjs scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs",
  "setup:hooks": "node scripts/setup-hooks.mjs",
  "verify:structure": "node scripts/verify-structure.mjs"
}
```

- [ ] **Step 6: Run GREEN, install the hook, and commit**

Run:

```powershell
node --test scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs
pnpm test:security-gate
pnpm setup:hooks
git config --local --get core.hooksPath
git diff --check
git add package.json scripts/security/gate.mjs scripts/security-gate.mjs scripts/security-gate.test.mjs scripts/setup-hooks.mjs scripts/setup-hooks.test.mjs .githooks/pre-push
git commit -m "feat: add local security gate"
```

Expected: the 13 security-gate tests pass; hook path is `.githooks`; commit succeeds.

---

### Task 5: Add Read-Only CI and PR Governance

**Files:**

- Create: `.github/workflows/security-gate.yml`
- Create: `scripts/security/workflow-policy.test.mjs`
- Create: `.github/CODEOWNERS`
- Create: `.github/pull_request_template.md`

**Interfaces:**

- Consumes: Task 4 CLI
- Produces: GitHub Check named `security-gate`, static workflow policy tests, review ownership and PR evidence template

- [ ] **Step 1: Write the workflow policy test before YAML**

Create `scripts/security/workflow-policy.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(
  new URL("../../.github/workflows/security-gate.yml", import.meta.url),
);

test("security workflow is read-only and pins every action by SHA", () => {
  const source = readFileSync(workflowPath, "utf8");

  assert.match(source, /^on:\r?\n  pull_request:\r?\n  push:/mu);
  assert.match(source, /^permissions:\r?\n  contents: read$/mu);
  assert.doesNotMatch(source, /pull_request_target|contents:\s*write|secrets\./u);

  const usesLines = source.split(/\r?\n/u).filter((line) => line.includes("uses:"));
  assert.ok(usesLines.length >= 2);
  for (const line of usesLines) {
    assert.match(
      line,
      /uses:\s+[\w-]+\/[\w-]+@[0-9a-f]{40}(?:\s+#\s+v\d+\.\d+\.\d+)?$/u,
    );
  }

  assert.match(source, /persist-credentials:\s+false/u);
  assert.match(source, /fetch-depth:\s+0/u);
});
```

- [ ] **Step 2: Run assertion RED**

Create this intentionally noncompliant workflow to make the policy assertions fail for the expected reasons:

```yaml
name: security-gate
on:
  workflow_dispatch:
permissions: {}
jobs: {}
```

Run:

```powershell
node --test scripts/security/workflow-policy.test.mjs
```

Expected: the test loads and fails trigger, permission, and pinned-action assertions.

- [ ] **Step 3: Create the pinned read-only workflow**

Final-review decision: push concurrency uses the per-run `github.run_id`, not `github.sha`, because the same SHA can be pushed to a ref again while an earlier run is pending. Push runs remain non-cancellable; PR runs keep PR-number grouping and PR-only cancellation.

Create `.github/workflows/security-gate.yml`:

```yaml
name: security-gate

on:
  pull_request:
  push:

permissions:
  contents: read

concurrency:
  group: security-gate-${{ github.event_name }}-${{ github.event_name == 'push' && github.run_id || github.event.pull_request.number }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  security-gate:
    name: security-gate
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out the exact commit without persisted credentials
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Use the repository-pinned Node version
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          check-latest: false

      - name: Run security gate tests
        run: node --test scripts/verify-structure.test.mjs scripts/security/*.test.mjs scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs

      - name: Evaluate pushed or proposed commit range
        env:
          EVENT_NAME: ${{ github.event_name }}
          TARGET_REF: ${{ github.event_name == 'pull_request' && format('refs/heads/{0}', github.base_ref) || github.ref }}
          BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}
          HEAD_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
        run: >-
          node scripts/security-gate.mjs
          --mode ci
          --event "$EVENT_NAME"
          --target-ref "$TARGET_REF"
          --base "$BASE_SHA"
          --head "$HEAD_SHA"
```

- [ ] **Step 4: Add ownership and PR evidence**

Create `.github/CODEOWNERS`:

```text
* @jawon0407
/.github/ @jawon0407
/.githooks/ @jawon0407
/scripts/security/ @jawon0407
/scripts/security-gate.mjs @jawon0407
/SECURITY.md @jawon0407
/docs/security/ @jawon0407
```

Create `.github/pull_request_template.md`:

```markdown
## 변경 목적과 범위

- 목적:
- 포함한 변경:
- 제외한 변경:

## 검증 증거

- [ ] 실행한 명령과 통과/실패 개수를 아래에 기록했다.
- [ ] PR head SHA와 CI가 검사한 SHA가 같다.

- command:
- result:
- commit SHA:

## 보안 영향

- [ ] 인증·인가·세션·데이터 경계 변경 여부를 설명했다.
- [ ] 위협 모델 또는 `docs/security/` 변경 필요 여부를 확인했다.
- [ ] 코드, diff, 로그, fixture에 실제 비밀정보나 재무 데이터가 없다.
- [ ] GitHub 무료 플랜에서 main 보호와 push protection이 강제되지 않는 잔여 위험을 확인했다.

보안 설명:

## 데이터베이스와 롤백

- [ ] 마이그레이션 없음 또는 마이그레이션·롤백 절차를 기록했다.

마이그레이션/롤백:

## 알려진 잔여 위험

- 위험:
- 수용 또는 후속 조치:
```

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node --test scripts/security/workflow-policy.test.mjs
pnpm test
git diff --check
git add .github/workflows/security-gate.yml .github/CODEOWNERS .github/pull_request_template.md scripts/security/workflow-policy.test.mjs
git commit -m "ci: add free-plan security gate"
```

Expected: workflow policy and full local tests pass; CI files use only pinned official actions.

---

### Task 6: Document the Accepted Risk and Operational Controls

**Files:**

- Create: `docs/security/free-plan-compensating-controls.md`
- Modify: `SECURITY.md`
- Modify: `docs/security/README.md`
- Modify: `docs/security/security-architecture.md`
- Modify: `docs/security/verification-checklist.md`
- Modify: `docs/guides/testing.md`
- Modify: `scripts/required-structure.mjs`

**Interfaces:**

- Consumes: all implemented commands and actual GitHub plan responses
- Produces: truthful operator instructions and structure contract entries

- [ ] **Step 1: Write the structure-contract RED**

Add these paths to `REQUIRED_PATHS` before creating the control document:

```js
".githooks/pre-push",
".github/workflows/security-gate.yml",
".github/CODEOWNERS",
".github/pull_request_template.md",
"docs/security/free-plan-compensating-controls.md",
```

Run:

```powershell
pnpm verify:structure
```

Expected: exit 1 and only `docs/security/free-plan-compensating-controls.md` is missing at this stage.

- [ ] **Step 2: Create the compensating-control reference**

Create `docs/security/free-plan-compensating-controls.md` with this complete content:

````markdown
# GitHub 무료 플랜 보완 통제

## 실제 플랫폼 상태

- 비공개 저장소 유지
- branch protection/rulesets: 미지원, API HTTP 403
- secret scanning/push protection: 미지원, API HTTP 422
- Dependabot vulnerability alerts: 활성화
- automated security fixes: 활성화

## 잔여 위험 수용

로컬 훅은 `--no-verify`로 우회할 수 있고 CI는 이미 도달한 직접 push를 되돌리지 못한다. 이 통제는 서버 측 보호와 동등하지 않다.

## 로컬 설치와 확인

```powershell
pnpm setup:hooks
git config --local --get core.hooksPath
pnpm test:security-gate
```

마지막 Git 명령은 `.githooks`를 출력해야 한다. 실패하거나 훅이 설치되지 않은 개발 환경에서는 push를 진행하지 않는다.

## 필수 운영 흐름

`feature/*` 또는 `hotfix/*` -> 로컬 게이트 -> 원격 push -> PR -> 동일 SHA CI 확인 -> 수동 보안 체크 -> squash merge.

PR 병합 전 `git rev-parse HEAD`, GitHub PR `headRefOid`, `security-gate` Check의 SHA가 모두 같아야 한다. CI 성공은 서버 측 branch protection이 활성화됐다는 증거가 아니다.

## 직접 main push 사고 처리

후속 작업 중지, 증거 보존, 영향 평가, `hotfix/*` PR 복구, 원인·재발 방지 기록.

실제 비밀정보가 포함됐으면 커밋 삭제만으로 처리하지 않는다. 즉시 폐기·회전하고 [사고 대응 절차](incident-response.md)를 따른다.

## 보안 게이트가 차단하는 항목

- `main` 대상 직접 push와 삭제
- 승인되지 않은 브랜치 이름
- 저장소 구조·테스트 실패
- 변경 Git blob의 AWS access key ID, GitHub token, private-key 표식
- 5 MiB를 넘는 자동 검사 불가 blob

탐지 출력에는 일치한 비밀값을 표시하지 않고 파일 경로와 규칙 ID만 표시한다.

## 업그레이드 종료 조건

지원 플랜에서 branch protection과 secret scanning/push protection을 live read-back으로 확인한 날짜와 증거를 기록한 뒤 위험 수용을 종료한다.
````

- [ ] **Step 3: Update policy, architecture, checklist, and testing docs**

Append this section to `SECURITY.md`:

```markdown
## GitHub 무료 플랜 운영 제한

비공개 저장소의 branch protection과 secret scanning/push protection은 현재 플랜에서 사용할 수 없다. `main` 직접 push는 정책상 금지하며 `.githooks/pre-push`, `scripts/security-gate.mjs`, 읽기 전용 GitHub Actions, PR 수동 검토로 보완한다. 로컬 훅은 `--no-verify`로 우회할 수 있고 CI는 이미 도달한 push를 되돌리지 못하므로 서버 측 보호와 동등하지 않다. 세부 운영 절차는 `docs/security/free-plan-compensating-controls.md`를 따른다.
```

Insert this item in the ordered document list in `docs/security/README.md`, immediately after `security-architecture.md`:

```markdown
- `free-plan-compensating-controls.md`: 무료 플랜의 미지원 제어, 로컬·CI 보완책, 잔여 위험과 업그레이드 조건
```

Append this section to `docs/security/security-architecture.md`:

```markdown
## 무료 플랜 CI/CD 보완 계층

GitHub 서버는 현재 비공개 `main`의 PR 필수화, 강제 push·삭제 차단, secret scanning, push protection을 강제하지 못한다. 로컬 pre-push 훅이 첫 번째 차단점이고 읽기 전용 GitHub Actions가 두 번째 탐지점이다. 두 계층은 우회되거나 사후 탐지만 할 수 있으므로 PR 작성자는 동일 SHA의 CI 성공과 수동 체크리스트를 함께 증거로 남긴다.
```

Append this checklist group to `docs/security/verification-checklist.md`:

```markdown
## 무료 플랜 저장소 게이트

- [ ] `git config --local --get core.hooksPath`가 `.githooks`를 출력한다.
- [ ] `pnpm test:security-gate`의 전체 통과 개수와 commit SHA를 기록했다.
- [ ] workflow 권한이 `contents: read`이고 `pull_request_target`과 `secrets.*`가 없다.
- [ ] 모든 `uses:`가 전체 40자리 commit SHA로 고정됐다.
- [ ] 로컬 HEAD, PR `headRefOid`, 성공한 Check SHA가 같다.
- [ ] branch protection 403과 secret scanning/push protection 422 잔여 위험을 수동 확인했다.
- [ ] 코드, diff, 로그, fixture에 실제 비밀정보나 재무 데이터가 없다.
```

Append this section to `docs/guides/testing.md`:

````markdown
## 무료 플랜 보안 게이트

```powershell
pnpm test:security-gate
pnpm setup:hooks
git config --local --get core.hooksPath
```

`main` 차단은 원격을 변경하지 않는 합성 pre-push 입력으로 확인한다. `feature/*` 입력은 같은 방식으로 통과를 확인한다. CI 결과는 해당 commit의 로컬·원격 검사 증거이며 GitHub 서버 branch protection의 존재를 증명하지 않는다.
````

- [ ] **Step 4: Run GREEN and verify no false claims**

Run:

```powershell
pnpm test
pnpm verify:structure
rg -n "branch protection|secret scanning|push protection|403|422|--no-verify" SECURITY.md docs/security docs/guides/testing.md
git diff --check
```

Expected: all tests and structure checks pass; every platform-control statement clearly says unavailable or bypassable where applicable.

- [ ] **Step 5: Commit documentation and contract**

Run:

```powershell
git add SECURITY.md docs/security/README.md docs/security/security-architecture.md docs/security/verification-checklist.md docs/security/free-plan-compensating-controls.md docs/guides/testing.md scripts/required-structure.mjs
git commit -m "docs: record free-plan security controls"
```

Expected: one focused documentation/contract commit.

---

### Task 7: Verify, Push, and Open the Security-Gate PR

**Files:**

- Create ignored evidence: `.superpowers/sdd/free-plan-security-gates-final-report.md`
- Create ignored PR body: `.superpowers/sdd/free-plan-security-gates-pr.md`
- Modify externally: remote feature branch and GitHub pull request

**Interfaces:**

- Consumes: completed Tasks 1–6
- Produces: remote feature branch, passing `security-gate` Check, review-ready PR to `main`

- [ ] **Step 1: Run the complete local verification matrix**

Run:

```powershell
node --version
pnpm --version
pnpm test
pnpm verify:structure
pnpm setup:hooks
git config --local --get core.hooksPath
git diff --check
git status --short --branch
```

Expected: Node `v22.15.1`, pnpm `11.9.0`, all 16 tests pass (2 structure + 13 runtime/hook security + 1 workflow policy), structure passes, hook path is `.githooks`, diff/status are clean.

- [ ] **Step 2: Simulate policy decisions without changing a remote**

Run:

```powershell
$head = git rev-parse HEAD
$main = git rev-parse main
$mainInput = "refs/heads/main $head refs/heads/main $main"
$mainInput | node scripts/security-gate.mjs --mode pre-push
if ($LASTEXITCODE -eq 0) { throw "main simulation must be blocked" }

$zero = "0" * 40
$featureInput = "refs/heads/feature/free-plan-security-gates $head refs/heads/feature/free-plan-security-gates $zero"
$featureInput | node scripts/security-gate.mjs --mode pre-push
if ($LASTEXITCODE -ne 0) { throw "feature simulation must pass" }
```

Expected: main prints `[DIRECT_MAIN_PUSH]` and exits 1; feature prints a sanitized success summary and exits 0.

- [ ] **Step 3: Scan committed content for accidental credentials**

Run the existing tracked-content scan and confirm no matches:

```powershell
git grep -nE "AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----" -- . ":(exclude).agents/**"
```

Expected: exit 1 because no secret-shaped value is present. Do not print environment variables, keyring entries, or OAuth data.

- [ ] **Step 4: Push the approved feature ref**

Run in authenticated Windows user context:

```powershell
git push -u origin feature/free-plan-security-gates
git rev-parse HEAD
git rev-parse origin/feature/free-plan-security-gates
```

Expected: the local hook runs and passes; both SHAs are identical.

- [ ] **Step 5: Create a draft PR with complete evidence**

Write `.superpowers/sdd/free-plan-security-gates-pr.md` using `apply_patch`. Include scope, exact local test counts, GitHub free-plan limitations, bypassable residual risk, action pins, no database migration, no real secrets, and a statement that `main` is not server-protected.

Run:

```powershell
$gh = "C:\Users\PC\.codex\visualizations\2026\07\16\019f696e-e609-7f70-8d59-b46fae218ddc\gh-portable\bin\gh.exe"
& $gh pr create --repo jawon0407/account-book --base main --head feature/free-plan-security-gates --draft --title "Add free-plan security gates" --body-file .superpowers/sdd/free-plan-security-gates-pr.md
```

Expected: one draft PR URL is returned.

- [ ] **Step 6: Verify the exact PR SHA and CI checks**

Run in authenticated Windows user context:

```powershell
$localSha = git rev-parse HEAD
$pr = & $gh pr view --repo jawon0407/account-book --json number,url,headRefOid,baseRefName,isDraft,statusCheckRollup | ConvertFrom-Json
if ($pr.headRefOid -ne $localSha -or $pr.baseRefName -ne "main") {
  throw "PR head/base does not match the reviewed local commit"
}
& $gh pr checks $pr.number --repo jawon0407/account-book --watch
```

Expected: `security-gate` succeeds for the same SHA. If it fails, use `superpowers:systematic-debugging`; do not merge or weaken the workflow.

- [ ] **Step 7: Produce the final evidence report and hand off integration**

Write `.superpowers/sdd/free-plan-security-gates-final-report.md` with local/remote SHAs, test counts, hook simulation results, PR URL, Check result, known platform limitations, and the explicit residual risk acceptance. Run a fresh broad review using `superpowers:requesting-code-review`.

After a clean review, use `superpowers:finishing-a-development-branch`. The recommended integration is squash merge through the GitHub PR UI/API only after the user confirms the reviewed PR; never direct-push `main`.

---

## Plan Self-Review Result

- Spec coverage: every goal, non-goal, component, data flow, failure path, test requirement, documentation target, completion criterion, and upgrade path maps to Tasks 1–7.
- Dependency consistency: policy exports feed the Git reader and gate; the gate CLI is the only hook/CI entry point; package commands and workflow paths use the same filenames.
- Security consistency: no step claims unavailable GitHub controls are enabled; no test source contains a contiguous synthetic token; outputs discard match values.
- Scope consistency: no application feature, authentication flow, database, deployment, or administrator page is introduced.
