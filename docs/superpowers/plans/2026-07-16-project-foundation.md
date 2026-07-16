# Account Book Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증 가능한 모노레포 폴더 구조를 `main`에 확정한 뒤 비공개 GitHub 저장소에 처음 푸시하고, `main` 보호와 `maintenance-branch`를 설정한다.

**Architecture:** 이 계획은 애플리케이션 기능이나 외부 런타임 의존성을 추가하지 않는다. Node 내장 테스트 러너로 저장소 구조 계약을 검증하고, 문서가 들어 있는 실제 디렉터리만 Git에 기록한다. 첫 원격 푸시가 끝난 뒤 `main`을 보호하며, 이후 기능 구현은 `feature/*`에서만 시작한다.

**Tech Stack:** Git, GitHub private repository, PowerShell, Node.js `22.15.1`, pnpm `11.9.0`, Node built-in test runner

## Global Constraints

- 보안은 기능, 일정, 편의성보다 우선하며 `SECURITY.md`의 중단 조건을 모든 단계에 적용한다.
- 브라우저 PWA, Next.js BFF, NestJS API, PostgreSQL, Supabase Auth·Storage의 세부 구현은 이 계획에서 시작하지 않는다.
- `main`은 첫 원격 푸시 직후 보호하고 이후 직접 푸시하지 않는다.
- `develop` 브랜치는 만들지 않는다.
- 기능은 `feature/{kebab-case}`, 긴급 수정은 `hotfix/{kebab-case}`, 유지보수는 `maintenance-branch`를 사용한다.
- 운영 비밀정보, Supabase 키, OAuth client secret, 토큰을 파일·명령 인자·Git 기록에 넣지 않는다.
- 새 JavaScript 공개 함수에는 목적, 행동, `@param`, `@returns`, 실패 동작을 JSDoc으로 설명한다.
- 관리자 페이지는 핵심 사용자 앱 구현과 보안 검증 이후 별도 명세·위협 모델로 진행한다.
- 이 계획 다음의 독립 구현 계획 순서는 `security-auth-foundation`, `ledger-core`, `budget-recurring-assets`, `offline-sync`, `csv-pwa-release`다.

## Scope Decomposition

승인된 제품 명세에는 인증, 원장, 예산, 반복 거래, 자산, 오프라인 동기화, CSV, PWA가 포함되어 있으므로 하나의 거대 계획으로 실행하지 않는다. 이 문서는 사용자가 지정한 최초 저장소 단계만 다룬다. 완료 결과는 구조 검증 테스트가 통과하는 비공개 저장소, 보호된 `main`, 동일 기준점의 `maintenance-branch`다.

## File Map

| 경로 | 책임 |
|---|---|
| `.nvmrc` | 초기 Node 버전을 고정한다. |
| `.npmrc` | 정확한 의존성 저장과 엄격한 엔진·peer dependency 정책을 선언한다. |
| `.editorconfig` | 편집기와 운영체제 사이의 기본 포맷을 통일한다. |
| `package.json` | private pnpm workspace와 구조 검증 명령만 선언한다. |
| `pnpm-workspace.yaml` | 앱과 공통 패키지 경계를 선언한다. |
| `scripts/required-structure.mjs` | 저장소에 반드시 존재해야 하는 경로와 검증 함수를 제공한다. |
| `scripts/verify-structure.test.mjs` | 구조 검증 함수의 실패·성공 동작을 Node 내장 테스트로 검증한다. |
| `scripts/verify-structure.mjs` | 현재 작업 트리의 필수 경로를 검사하는 CLI 진입점이다. |
| `apps/*/README.md` | 웹과 API 앱의 책임 경계를 기록한다. |
| `packages/*/README.md` | 계약, DB, 공통 설정 패키지의 책임 경계를 기록한다. |
| `supabase/*/README.md` | 마이그레이션과 seed 정책을 기록한다. |
| `docs/*/README.md` | 아키텍처, API, DB, 가이드, 로드맵 문서의 색인을 만든다. |
| `tests/e2e/README.md` | 후속 브라우저 E2E 테스트의 범위를 기록한다. |
| `.github/settings/main-protection.json` | 첫 푸시 후 적용할 `main` 보호 정책을 버전 관리한다. |
| `README.md` | 제품 소개, 현재 단계, 문서와 구조 검증 명령을 제공한다. |

---

### Task 1: Workspace Contract and Test-Driven Structure Validator

**Files:**

- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `.editorconfig`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `scripts/verify-structure.test.mjs`
- Create: `scripts/required-structure.mjs`
- Create: `scripts/verify-structure.mjs`

**Interfaces:**

- Consumes: Node.js `22.15.1` built-in `node:test`, `node:fs/promises`, `node:path`
- Produces: `REQUIRED_PATHS: readonly string[]`
- Produces: `findMissingPaths(rootDir: string, requiredPaths?: readonly string[]): Promise<string[]>`
- Produces: `pnpm test:structure` and `pnpm verify:structure`

- [ ] **Step 1: Pin the toolchain and declare the private workspace**

Create `.nvmrc`:

```text
22.15.1
```

Create `.npmrc`:

```ini
engine-strict=true
save-exact=true
strict-peer-dependencies=true
```

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

Create `package.json`:

```json
{
  "name": "account-book",
  "version": "0.0.0",
  "private": true,
  "description": "Security-first, synchronized personal account book for desktop and mobile.",
  "packageManager": "pnpm@11.9.0",
  "engines": {
    "node": "22.15.1",
    "pnpm": "11.9.0"
  },
  "scripts": {
    "test:structure": "node --test scripts/verify-structure.test.mjs",
    "verify:structure": "node scripts/verify-structure.mjs"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 2: Write the failing validator test**

Create `scripts/verify-structure.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findMissingPaths } from "./required-structure.mjs";

test("findMissingPaths returns only paths absent from the root", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-structure-"));

  try {
    await mkdir(join(rootDir, "apps", "web"), { recursive: true });

    const missingPaths = await findMissingPaths(rootDir, [
      "apps/web",
      "apps/api",
    ]);

    assert.deepEqual(missingPaths, ["apps/api"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMissingPaths returns an empty list when every path exists", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "account-book-structure-"));

  try {
    await mkdir(join(rootDir, "apps", "web"), { recursive: true });
    await mkdir(join(rootDir, "apps", "api"), { recursive: true });

    const missingPaths = await findMissingPaths(rootDir, [
      "apps/web",
      "apps/api",
    ]);

    assert.deepEqual(missingPaths, []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the test and verify the expected red state**

Run:

```powershell
pnpm test:structure
```

Expected: exit code `1` with `ERR_MODULE_NOT_FOUND` for `scripts/required-structure.mjs`.

- [ ] **Step 4: Implement the structure contract**

Create `scripts/required-structure.mjs`:

```js
import { access } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_PATHS = Object.freeze([
  "apps/web/README.md",
  "apps/api/README.md",
  "packages/contracts/README.md",
  "packages/database/README.md",
  "packages/config/README.md",
  "supabase/migrations/README.md",
  "supabase/seed/README.md",
  "docs/architecture/README.md",
  "docs/api/README.md",
  "docs/database/README.md",
  "docs/guides/README.md",
  "docs/roadmap/README.md",
  "docs/security/README.md",
  "tests/e2e/README.md",
  ".github/settings/main-protection.json",
  "README.md",
  "SECURITY.md",
  "PRODUCT.md",
  "DESIGN.md",
]);

/**
 * Returns repository contract paths that do not exist below a root directory.
 *
 * Each path is checked independently so callers receive the complete missing
 * set in the same deterministic order as the supplied contract.
 *
 * @param {string} rootDir Absolute or relative directory used as the contract root.
 * @param {readonly string[]} [requiredPaths=REQUIRED_PATHS] Paths to verify.
 * @returns {Promise<string[]>} Missing paths in contract order.
 * @throws {TypeError} If `rootDir` is empty or a contract path is not a string.
 */
export async function findMissingPaths(
  rootDir,
  requiredPaths = REQUIRED_PATHS,
) {
  if (typeof rootDir !== "string" || rootDir.trim().length === 0) {
    throw new TypeError("rootDir must be a non-empty string");
  }

  if (requiredPaths.some((path) => typeof path !== "string")) {
    throw new TypeError("requiredPaths must contain only strings");
  }

  const checks = requiredPaths.map(async (path) => {
    try {
      await access(join(rootDir, path));
      return null;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return path;
      }

      throw error;
    }
  });

  return (await Promise.all(checks)).filter((path) => path !== null);
}
```

Create `scripts/verify-structure.mjs`:

```js
import { findMissingPaths } from "./required-structure.mjs";

const missingPaths = await findMissingPaths(process.cwd());

if (missingPaths.length > 0) {
  console.error("Repository structure verification failed:");
  for (const path of missingPaths) {
    console.error(`- ${path}`);
  }
  process.exitCode = 1;
} else {
  console.log("Repository structure verification passed.");
}
```

- [ ] **Step 5: Run the unit test and verify the green state**

Run:

```powershell
pnpm test:structure
```

Expected: exit code `0`, `2` tests passed, `0` failed.

- [ ] **Step 6: Run the repository CLI and verify it reports the not-yet-created paths**

Run:

```powershell
pnpm verify:structure
```

Expected: exit code `1` and a list beginning with `apps/web/README.md`; this confirms the contract fails before Task 2 creates the structure.

### Task 2: Materialize the Documented Monorepo Structure

**Files:**

- Create: `README.md`
- Create: `apps/web/README.md`
- Create: `apps/api/README.md`
- Create: `packages/contracts/README.md`
- Create: `packages/database/README.md`
- Create: `packages/config/README.md`
- Create: `supabase/migrations/README.md`
- Create: `supabase/seed/README.md`
- Create: `docs/architecture/README.md`
- Create: `docs/api/README.md`
- Create: `docs/database/README.md`
- Create: `docs/guides/README.md`
- Create: `docs/roadmap/README.md`
- Create: `tests/e2e/README.md`
- Create: `.github/settings/main-protection.json`

**Interfaces:**

- Consumes: `REQUIRED_PATHS` from Task 1
- Produces: a Git-trackable directory for each approved application, package, database, documentation, and E2E boundary
- Produces: GitHub branch protection input consumed by Task 5

- [ ] **Step 1: Create the root project guide**

Create `README.md`:

```markdown
# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

프로젝트 구조와 개발·보안 기준을 확정하는 단계입니다. 애플리케이션 기능은 `feature/*` 브랜치에서 별도 계획과 테스트를 통해 구현합니다.

## Planned Stack

- Web: Next.js responsive PWA with a same-origin BFF
- API: Node.js, NestJS, Fastify
- Data: Supabase PostgreSQL, Drizzle ORM, Supabase Storage
- Auth: Supabase Auth with email, Google, Kakao, Naver
- Offline: IndexedDB queue with server-side ownership and version validation

## Documentation

- [Product principles](PRODUCT.md)
- [Design system](DESIGN.md)
- [Security policy](SECURITY.md)
- [Security architecture](docs/security/security-architecture.md)
- [Approved application specification](docs/superpowers/specs/2026-07-16-account-book-app-design.md)

## Verify the Repository Structure

```powershell
pnpm test:structure
pnpm verify:structure
```

Do not commit `.env` files, tokens, OAuth secrets, Supabase service-role keys, or production data.
```

- [ ] **Step 2: Create the application boundary documents**

Create `apps/web/README.md`:

```markdown
# Web Application

This directory will contain the Next.js responsive PWA and same-origin BFF. Browser code must not access financial tables, refresh tokens, or service credentials directly.
```

Create `apps/api/README.md`:

```markdown
# API Application

This directory will contain the NestJS application using the Fastify adapter. The API is the final authority for JWT validation, ownership, input schemas, versions, idempotency, and financial data changes.
```

- [ ] **Step 3: Create the shared package boundary documents**

Create `packages/contracts/README.md`:

```markdown
# Contracts Package

This package will own shared runtime schemas, request and response types, error codes, and OpenAPI-compatible examples. It must not contain database or UI implementation details.
```

Create `packages/database/README.md`:

```markdown
# Database Package

This package will own Drizzle schemas, migrations support, repository interfaces, transaction helpers, and PostgreSQL access policies. Financial queries must preserve user ownership and use a role without `BYPASSRLS`.
```

Create `packages/config/README.md`:

```markdown
# Shared Configuration Package

This package will own reusable TypeScript, lint, format, test, and build configuration. Secrets and environment-specific credentials do not belong here.
```

- [ ] **Step 4: Create the Supabase boundary documents**

Create `supabase/migrations/README.md`:

```markdown
# Database Migrations

Store ordered PostgreSQL schema, constraint, index, role, and RLS migrations here. Every migration requires rollback analysis, backup verification, and user-isolation tests before release.
```

Create `supabase/seed/README.md`:

```markdown
# Development Seed Data

Store deterministic local and test seed definitions here. Seed data must be synthetic and must never contain copied production transactions, emails, tokens, or account identifiers.
```

- [ ] **Step 5: Create the development documentation indexes**

Create `docs/architecture/README.md`:

```markdown
# Architecture Documentation

System context, trust boundaries, data flows, deployment topology, and Architecture Decision Records belong here. Security-sensitive decisions must link to the threat model.
```

Create `docs/api/README.md`:

```markdown
# API Documentation

OpenAPI output, authentication flow, authorization rules, error codes, pagination, rate limits, and request examples belong here.
```

Create `docs/database/README.md`:

```markdown
# Database Documentation

ERD, table contracts, constraints, indexes, RLS policies, transaction boundaries, sync cursors, and migration runbooks belong here.
```

Create `docs/guides/README.md`:

```markdown
# Guides

Local development, testing, secure configuration, deployment, recovery, and user operation guides belong here.
```

Create `docs/roadmap/README.md`:

```markdown
# Roadmap

Implementation proceeds through project foundation, security and authentication, ledger core, budgets and assets, offline sync, CSV and PWA release, receipt OCR, financial institution integration, and finally the separately secured administrator application.
```

- [ ] **Step 6: Create the E2E boundary document**

Create `tests/e2e/README.md`:

```markdown
# End-to-End Tests

Browser-level desktop, tablet, mobile, authentication, authorization, offline sync, accessibility, and security smoke scenarios belong here. Tests use synthetic accounts and isolated data.
```

- [ ] **Step 7: Create the versioned `main` protection policy**

Create `.github/settings/main-protection.json`:

```json
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

The zero required approvals preserves a solo-developer workflow while the non-null pull-request rule still blocks direct changes to `main`. The first CI workflow plan will add required status checks before feature code can merge.

- [ ] **Step 8: Run the complete structure verification**

Run:

```powershell
pnpm test:structure
pnpm verify:structure
```

Expected: both commands exit `0`; unit output reports `2` passed and the CLI prints `Repository structure verification passed.`

### Task 3: Verify and Commit the Local Foundation on `main`

**Files:**

- Stage: only the files created in Tasks 1 and 2
- Do not stage: environment files, editor state, `.superpowers/`, local logs, or unrelated user changes

**Interfaces:**

- Consumes: the green structure test and CLI from Tasks 1 and 2
- Produces: commit `chore: scaffold project workspace` on local `main`

- [ ] **Step 1: Confirm the branch and review the exact change set**

Run:

```powershell
git branch --show-current
git status --short
git diff --check
```

Expected: current branch is `main`; only planned foundation files are untracked or modified; `git diff --check` exits `0`.

- [ ] **Step 2: Run all available foundation checks**

Run:

```powershell
pnpm test:structure
pnpm verify:structure
$secretMatches = git grep -nE "AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----" -- . ":(exclude).agents/**"
if ($LASTEXITCODE -eq 0) { throw "Secret-like value detected:`n$secretMatches" }
if ($LASTEXITCODE -ne 1) { throw "Secret scan command failed with exit code $LASTEXITCODE" }
```

Expected: both pnpm commands exit `0`; the wrapper exits without an exception because Git reports no matching secret format.

- [ ] **Step 3: Stage only the planned scaffold**

Run:

```powershell
git add -- .nvmrc .npmrc .editorconfig package.json pnpm-workspace.yaml README.md scripts apps packages supabase docs/architecture docs/api docs/database docs/guides docs/roadmap tests/e2e .github/settings/main-protection.json
git diff --cached --check
git diff --cached --stat
```

Expected: cached whitespace check exits `0`; the stat contains only the listed foundation paths.

- [ ] **Step 4: Commit the verified scaffold**

Run:

```powershell
git commit -m "chore: scaffold project workspace"
```

Expected: one new commit on `main` and no commit hook failure.

- [ ] **Step 5: Re-run checks against the committed state**

Run:

```powershell
pnpm test:structure
pnpm verify:structure
git status --short --branch
git log -3 --oneline --decorate
```

Expected: both checks exit `0`; status is exactly `## main`; latest commit is `chore: scaffold project workspace`.

### Task 4: Create the Private GitHub Repository and Perform the First Push

**Files:**

- Modify externally: GitHub repository `account-book`
- Modify locally: Git remote named `origin`

**Interfaces:**

- Consumes: clean committed local `main`
- Produces: a private GitHub repository whose default branch and remote-tracking branch are `main`

- [ ] **Step 1: Install GitHub CLI only if it remains unavailable**

Run:

```powershell
Get-Command gh -ErrorAction SilentlyContinue
```

Expected in the current environment: no command is returned.

If still missing, run:

```powershell
winget install --id GitHub.cli --exact --source winget
```

Close and reopen the terminal session if `gh` is not added to `PATH`, then run:

```powershell
gh --version
```

Expected: GitHub CLI prints a version and exits `0`.

- [ ] **Step 2: Authenticate GitHub CLI without exposing a token**

Run:

```powershell
gh auth status --hostname github.com
```

If unauthenticated, run:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

Complete the browser authorization, then run `gh auth status --hostname github.com` again.

Expected: status identifies the authenticated GitHub account and does not print an authentication failure.

- [ ] **Step 3: Prove the target repository name is not already occupied**

Run:

```powershell
$owner = gh api user --jq .login
gh repo view "$owner/account-book" --json nameWithOwner,visibility,url
```

Expected for a new repository: the second command exits non-zero with `Could not resolve to a Repository`. If it succeeds, stop this plan and report the existing repository URL; never overwrite or repoint it automatically.

- [ ] **Step 4: Create the private repository and push `main` once**

Run:

```powershell
gh repo create account-book --private --source . --remote origin --push --description "Security-first synchronized personal account book for desktop and mobile"
```

Expected: repository creation succeeds, `origin` is added, and local `main` tracks `origin/main`.

- [ ] **Step 5: Verify visibility, default branch, remote, and commit identity**

Run:

```powershell
gh repo view --json nameWithOwner,visibility,isPrivate,defaultBranchRef,url
git remote -v
git rev-parse main
git rev-parse origin/main
```

Expected: `visibility` is `PRIVATE`, `isPrivate` is `true`, default branch is `main`, both hashes are identical, and `origin` contains no credential in its URL.

### Task 5: Protect `main` and Enable Repository Security Settings

**Files:**

- Read: `.github/settings/main-protection.json`
- Modify externally: GitHub branch protection and repository security settings

**Interfaces:**

- Consumes: private repository and initial `origin/main` from Task 4
- Produces: enforced pull-request flow, linear history, force-push and deletion protection, Dependabot alerts, automated security fixes, secret scanning, and push protection

- [ ] **Step 1: Apply the versioned branch protection payload**

Run:

```powershell
$owner = gh api user --jq .login
gh api --method PUT -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$owner/account-book/branches/main/protection" --input .github/settings/main-protection.json
```

Expected: HTTP success. A `403` or `422` means the account or repository plan cannot enforce this policy; stop before feature work and report the exact response instead of claiming `main` is protected.

- [ ] **Step 2: Enable dependency alerts and automated security fixes**

Run:

```powershell
$owner = gh api user --jq .login
gh api --method PUT -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$owner/account-book/vulnerability-alerts"
gh api --method PUT -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$owner/account-book/automated-security-fixes"
```

Expected: both commands succeed without response bodies.

- [ ] **Step 3: Enable secret scanning and push protection**

Run:

```powershell
$owner = gh api user --jq .login
gh api --method PATCH -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$owner/account-book" -F "security_and_analysis[secret_scanning][status]=enabled" -F "security_and_analysis[secret_scanning_push_protection][status]=enabled"
```

Expected: response shows both statuses as `enabled`. If GitHub returns an availability or billing error for the private repository, retain the local no-secret policy, record the unavailable control, and do not report it as enabled.

- [ ] **Step 4: Read back the protection and security evidence**

Run:

```powershell
$owner = gh api user --jq .login
gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$owner/account-book/branches/main/protection" --jq "{enforce_admins: .enforce_admins.enabled, required_pull_request_reviews: (.required_pull_request_reviews != null), required_approvals: .required_pull_request_reviews.required_approving_review_count, required_linear_history: .required_linear_history.enabled, allow_force_pushes: .allow_force_pushes.enabled, allow_deletions: .allow_deletions.enabled}"
gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$owner/account-book" --jq .security_and_analysis
```

Expected: admin enforcement, PR requirement, and linear history are `true`; required approvals are `0`; force pushes and deletions are `false`; available security controls report `enabled`.

### Task 6: Create and Push `maintenance-branch`

**Files:**

- Modify locally and remotely: Git branch `maintenance-branch`
- Preserve: current `main` commit and protection

**Interfaces:**

- Consumes: protected `origin/main`
- Produces: `maintenance-branch` at the exact same commit with upstream `origin/maintenance-branch`

- [ ] **Step 1: Confirm the clean protected base**

Run:

```powershell
git switch main
git status --short --branch
git rev-parse main
git rev-parse origin/main
```

Expected: clean `main` and identical local and remote hashes.

- [ ] **Step 2: Create the maintenance branch from `main`**

Run:

```powershell
git branch maintenance-branch main
git switch maintenance-branch
```

Expected: current branch is `maintenance-branch`; no files change.

- [ ] **Step 3: Push the maintenance branch and establish tracking**

Run:

```powershell
git push -u origin maintenance-branch
```

Expected: remote branch is created and local branch tracks `origin/maintenance-branch`.

- [ ] **Step 4: Return to `main` and verify both branch tips**

Run:

```powershell
git switch main
$mainSha = git rev-parse main
$maintenanceSha = git rev-parse maintenance-branch
if ($mainSha -ne $maintenanceSha) { throw "main and maintenance-branch must start at the same commit" }
git ls-remote --heads origin main maintenance-branch
```

Expected: no exception; two remote refs print the same commit SHA.

### Task 7: Foundation Completion Gate and Next-Plan Handoff

**Files:**

- Read: all foundation files and remote settings
- Modify: none

**Interfaces:**

- Consumes: Tasks 1 through 6
- Produces: evidence that the foundation is ready for a new `feature/security-auth-foundation` branch in the next approved execution plan

- [ ] **Step 1: Run the complete local verification from committed `main`**

Run:

```powershell
pnpm test:structure
pnpm verify:structure
git diff --check
git status --short --branch
```

Expected: tests and structure verification exit `0`; diff check exits `0`; status is `## main...origin/main` with no file entries.

- [ ] **Step 2: Verify branch policy and naming constraints**

Run:

```powershell
git branch --all
git branch --all | Select-String -Pattern "develop"
$owner = gh api user --jq .login
gh api "repos/$owner/account-book/branches/main/protection" --jq ".required_pull_request_reviews.required_approving_review_count"
```

Expected: `main` and `maintenance-branch` exist locally and remotely; the `develop` search prints nothing; branch protection returns `0` approvals with a required PR rule.

- [ ] **Step 3: Verify the GitHub repository summary**

Run:

```powershell
gh repo view --json nameWithOwner,visibility,isPrivate,defaultBranchRef,url
git remote show origin
git log -3 --oneline --decorate
```

Expected: private repository, default `main`, tracked `origin/main` and `origin/maintenance-branch`, and the local scaffold commit visible on the remote.

- [ ] **Step 4: Stop before feature implementation**

Do not create application code or a feature branch in this plan. The next plan must begin from updated `main`, create `feature/security-auth-foundation`, and add security CI plus the Next.js BFF, NestJS API, Supabase local configuration, and authentication contracts using TDD.

## Plan Self-Review Record

- Spec coverage: initial folder structure, private repository creation, first `main` push, immediate `main` protection, no `develop`, `maintenance-branch`, security-first policy, and administrator deferral each map to an explicit task or global constraint.
- Scope boundary: no user feature, auth implementation, database migration, dependency installation, or administrator code is included.
- Type consistency: `findMissingPaths(rootDir, requiredPaths)` and `REQUIRED_PATHS` use the same names and signatures in test, implementation, CLI, and task interfaces.
- Failure behavior: existing remote repositories, unavailable GitHub protection, unavailable security controls, dirty Git state, secret-pattern matches, and unequal branch hashes have explicit stop conditions.
- Completeness check: every action names its file, command, expected result, and explicit stop condition where external state may conflict.
