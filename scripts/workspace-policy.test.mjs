import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(rootDir, "package.json");
const apiPackagePath = join(rootDir, "apps", "api", "package.json");
const webPackagePath = join(rootDir, "apps", "web", "package.json");
const e2ePackagePath = join(rootDir, "tests", "e2e", "package.json");
const tsconfigPath = join(rootDir, "tsconfig.base.json");
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const lockfilePath = join(rootDir, "pnpm-lock.yaml");
const npmrcPath = join(rootDir, ".npmrc");
const configReadmePath = join(rootDir, "packages", "config", "README.md");
const eslintConfigPath = join(rootDir, "eslint.config.mjs");

const expectedDevDependencies = {
  typescript: "6.0.3",
  vitest: "4.1.11",
  "@vitest/coverage-v8": "4.1.11",
  eslint: "10.7.0",
  "@eslint/js": "10.0.1",
  "typescript-eslint": "8.64.0",
  globals: "17.7.0",
  prettier: "3.9.5",
  tsx: "4.23.1",
  "@types/node": "22.20.1",
};

const expectedScripts = {
  "test:workspace": "pnpm build:packages && pnpm --filter @account-book/contracts --filter @account-book/database --filter @account-book/web --filter @account-book/api test",
  "test:e2e-preflight": "pnpm --filter @account-book/e2e test:preflight",
  test: "pnpm test:legacy && pnpm test:workspace && pnpm test:e2e-preflight",
  "test:db": "pnpm --filter @account-book/database-tests test",
  lint: "eslint . --max-warnings=0",
  "build:packages": "pnpm --filter @account-book/contracts build && pnpm --filter @account-book/database build",
  "typecheck:workspace": "pnpm --filter @account-book/contracts --filter @account-book/database --filter @account-book/web --filter @account-book/api --filter @account-book/database-tests --filter @account-book/e2e typecheck",
  typecheck: "pnpm build:packages && pnpm typecheck:workspace",
  build: "pnpm build:packages && pnpm --filter @account-book/api build && pnpm --filter @account-book/web build",
  verify: "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
};

const approvedPackageLocalSkipLibCheck = [
  "apps/web/tsconfig.json",
  "packages/database/tsconfig.json",
  "tests/database/tsconfig.json",
];

const expectedWorkspaceOverrides = {
  "next@16.3.6>sharp": "-",
  "next@16.3.6>postcss": "8.5.23",
  "next@16.3.6>baseline-browser-mapping": "2.11.0",
  "nanoid@3.3.16": "3.3.18",
  "find-my-way@9.6.0": "9.7.0",
  "@nestjs/platform-fastify@11.2.5>fastify": "5.12.5",
  "fast-uri@3.1.5": "3.1.8",
  "fast-uri@4.1.2": "4.1.5",
};

/**
 * 디렉터리를 재귀 탐색해 tsconfig 이름 패턴에 맞는 파일을 모은다.
 * @param directory - 탐색할 시작 디렉터리.
 * @returns 일치한 파일 경로 목록. 읽기 실패는 파일 시스템 오류로 전파된다.
 */
function tsconfigFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return tsconfigFiles(path);
    }
    return /^tsconfig(?:\..+)?\.json$/u.test(entry.name) ? [path] : [];
  });
}

/**
 * apps·packages·tests 아래의 TypeScript 설정을 모두 모아 우회 설정을 검사할 준비를 한다.
 * @returns 저장소 하위 tsconfig 파일 경로 목록.
 */
function workspaceTsconfigFiles() {
  return ["apps", "packages", "tests"].flatMap((directory) => tsconfigFiles(join(rootDir, directory)));
}

/**
 * overrides 블록의 따옴표로 둘러싼 단순 키·값을 읽어 의존성 강제 버전을 비교한다.
 * @param {string} workspace 검사할 pnpm 워크스페이스 YAML 원문.
 * @returns {Record<string, string>} 선택자와 강제값의 맵. 블록 누락이나 예상 밖 문법은 테스트 실패.
 */
function workspaceScalarOverrides(workspace) {
  const overrideBlock = workspace.match(/^overrides:\r?\n((?: {2}[^\r\n]+\r?\n?)*)/mu)?.[1];
  assert.notEqual(overrideBlock, undefined, "pnpm workspace must define an overrides map");

  return Object.fromEntries(
    overrideBlock
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => {
        const scalar = line.match(/^ {2}"([^"]+)": "([^"]+)"$/u);
        assert.notEqual(scalar, null, `workspace override must be a quoted scalar entry: ${line}`);
        return [scalar[1], scalar[2]];
      }),
  );
}

/**
 * lockfile의 packages·snapshots 양쪽에서 검토한 패치 버전이 있고 취약 버전 표기가 없는지 단언한다.
 * @param {string} lockfile 생성된 pnpm lockfile 원문. 이 함수는 파일을 변경하지 않는다.
 * @returns {void} 일치하면 반환값 없이 종료한다. 섹션 누락·버전 불일치는 테스트 실패.
 */
function assertPatchedProductionResolutions(lockfile) {
  const packagesStart = lockfile.indexOf("packages:");
  const snapshotsStart = lockfile.search(/\r?\nsnapshots:/u);
  assert.notEqual(packagesStart, -1, "lockfile must contain a packages section");
  assert.notEqual(snapshotsStart, -1, "lockfile must contain a snapshots section");

  const resolutionSections = [
    lockfile.slice(packagesStart, snapshotsStart),
    lockfile.slice(snapshotsStart),
  ];
  const patchedEntries = [
    /^ {2}postcss@8\.5\.23:\r?$/mu,
    /^ {2}nanoid@3\.3\.18:(?: \{\})?\r?$/mu,
    /^ {2}find-my-way@9\.7\.0:\r?$/mu,
    /^ {2}fastify@5\.12\.5:\r?$/mu,
    /^ {2}fast-uri@3\.1\.8:(?: \{\})?\r?$/mu,
    /^ {2}fast-uri@4\.1\.5:(?: \{\})?\r?$/mu,
  ];
  const vulnerableEntries = [
    /^ {2}postcss@8\.5\.22:\r?$/mu,
    /^ {2}nanoid@3\.3\.16:(?: \{\})?\r?$/mu,
    /^ {2}find-my-way@9\.6\.0:\r?$/mu,
    /^ {2}fastify@5\.10\.0:\r?$/mu,
    /^ {2}fastify@5\.12\.[34]:\r?$/mu,
    /^ {2}fast-uri@3\.1\.4:(?: \{\})?\r?$/mu,
    /^ {2}fast-uri@4\.1\.1:(?: \{\})?\r?$/mu,
    /^ {2}fast-uri@3\.1\.5:(?: \{\})?\r?$/mu,
    /^ {2}fast-uri@3\.1\.[67]:(?: \{\})?\r?$/mu,
    /^ {2}fast-uri@4\.1\.2:(?: \{\})?\r?$/mu,
    /^ {2}fast-uri@4\.1\.[34]:(?: \{\})?\r?$/mu,
  ];

  for (const section of resolutionSections) {
    for (const patchedEntry of patchedEntries) {
      assert.match(section, patchedEntry, "patched production dependency resolution must exist");
    }
    for (const vulnerableEntry of vulnerableEntries) {
      assert.doesNotMatch(section, vulnerableEntry, "vulnerable production dependency resolution must be absent");
    }
  }
}

test("workspace pins strict TypeScript, boundaries, and verification policy", () => {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const apiPackage = JSON.parse(readFileSync(apiPackagePath, "utf8"));
  const webPackage = JSON.parse(readFileSync(webPackagePath, "utf8"));
  const e2ePackage = JSON.parse(readFileSync(e2ePackagePath, "utf8"));
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  const workspace = readFileSync(workspacePath, "utf8");
  const npmrc = readFileSync(npmrcPath, "utf8");

  assert.deepEqual(pkg.devDependencies, expectedDevDependencies);
  assert.equal(apiPackage.dependencies.fastify, "5.12.5");
  assert.equal(webPackage.dependencies.next, "16.3.6");
  for (const name of ["@nestjs/common", "@nestjs/core", "@nestjs/platform-fastify"]) assert.equal(apiPackage.dependencies[name], "11.2.5");
  assert.equal(apiPackage.devDependencies["@nestjs/testing"], "11.2.5");
  assert.equal(
    e2ePackage.scripts["test:preflight"],
    "tsx --test production-fake-startup.test.ts playwright-environment.test.ts playwright-config.test.ts auth-response-policy.test.ts ui-facade-boundary.test.ts support/safe-ui-error.test.ts support/transport-tripwire.test.ts support/safe-ui-test.test.ts",
  );
  assert.equal(
    e2ePackage.scripts.test,
    "pnpm run test:preflight && playwright test --config playwright.config.ts",
  );
  assert.equal(
    pkg.scripts["test:legacy"],
    "node --test scripts/verify-structure.test.mjs scripts/workspace-policy.test.mjs scripts/security/*.test.mjs scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs scripts/local-auth/*.test.mjs",
  );
  for (const [name, command] of Object.entries(expectedScripts)) {
    assert.equal(pkg.scripts[name], command);
  }
  assert.equal(tsconfig.compilerOptions.target, "ES2023");
  assert.deepEqual(tsconfig.compilerOptions.lib, ["ES2023", "DOM", "DOM.Iterable"]);
  assert.equal(tsconfig.compilerOptions.module, "NodeNext");
  assert.equal(tsconfig.compilerOptions.moduleResolution, "NodeNext");
  for (const option of [
    "strict",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "useUnknownInCatchVariables",
    "noImplicitOverride",
    "noFallthroughCasesInSwitch",
    "verbatimModuleSyntax",
  ]) {
    assert.equal(tsconfig.compilerOptions[option], true);
  }
  assert.equal(tsconfig.compilerOptions.skipLibCheck, false);
  const workspaceTsconfigs = workspaceTsconfigFiles();
  for (const path of workspaceTsconfigs.filter((path) => path.endsWith("tsconfig.json"))) {
    const packageConfig = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(packageConfig.extends, relative(dirname(path), tsconfigPath).replaceAll("\\", "/"));
  }
  const packageLocalSkipLibCheck = workspaceTsconfigs
    .filter((path) => JSON.parse(readFileSync(path, "utf8")).compilerOptions?.skipLibCheck === true)
    .map((path) => path.slice(rootDir.length + 1).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(packageLocalSkipLibCheck, approvedPackageLocalSkipLibCheck);
  for (const boundary of ["apps/*", "packages/*", "tests/*"]) {
    assert.equal(workspace.includes(`  - ${boundary}`), true);
  }
  const allowBuilds = Object.fromEntries(
    (workspace.match(/^allowBuilds:\r?\n((?: {2}[^\r\n]+\r?\n?)*)/m)?.[1] ?? "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, value] = line.trim().split(/:\s*/, 2);
        return [name, value === "true" ? true : value];
      }),
  );
  assert.deepEqual(allowBuilds, { esbuild: true });
  // Next 16.3.6 declares sharp only as an optional image optimizer.
  // The app has no next/image usage, so keep that unused native dependency absent.
  // Its production PostCSS dependency and Fastify stack are pinned to patched releases.
  assert.deepEqual(workspaceScalarOverrides(workspace), expectedWorkspaceOverrides);
  for (const policy of ["engine-strict=true", "save-exact=true", "strict-peer-dependencies=true"]) {
    assert.match(npmrc, new RegExp(`^${policy}$`, "m"));
  }
  assert.equal(existsSync(join(rootDir, "eslint.config.mjs")), true);
  assert.equal(existsSync(join(rootDir, "pnpm-lock.yaml")), true);
  const eslintConfig = readFileSync(eslintConfigPath, "utf8");
  assert.match(eslintConfig, /import tseslint from "typescript-eslint"/);
  assert.match(eslintConfig, /\.\{ts,tsx\}/);
  for (const ignoredPath of ["**/dist/**", ".agents/**", ".codex/**", ".superpowers/**", ".worktrees/**"]) {
    assert.equal(eslintConfig.includes(`"${ignoredPath}"`), true);
  }
  assert.match(eslintConfig, /tseslint\.configs\.recommended\.map/);
  assert.doesNotMatch(eslintConfig, /\.\.\.tseslint\.configs\.recommended,\s/);
  assert.equal(existsSync(join(rootDir, "packages", "config", "package.json")), false);
  assert.match(readFileSync(configReadmePath, "utf8"), /non-package placeholder/i);
});

test("Next security update excludes audited vulnerable resolutions", () => {
  // 생성된 잠금파일을 검사해 승인 버전 누락·취약 버전 또는 불필요한 이미지 의존성 재유입을 막는다.
  // 콜백 매개변수는 없으며 파일 읽기 외에 설치나 네트워크 부작용은 없다.
  const lockfile = readFileSync(lockfilePath, "utf8");
  assert.equal(/^ {2}next@16\.3\.6:/mu.test(lockfile), true, "patched Next resolution must exist");
  assert.equal(/^ {2}next@16\.3\.[0-5]:/mu.test(lockfile), false, "vulnerable ImageResponse Next must be absent");
  assert.equal(/^ {2}next@16\.2\.11:/mu.test(lockfile), false, "audited vulnerable Next must be absent");
  assert.equal(/^ {2}baseline-browser-mapping@2\.10\.43:/mu.test(lockfile), false, "audited vulnerable browser mapping must be absent");
  assert.equal(/^ {2}sharp@/mu.test(lockfile), false, "unused native image optimizer must remain absent");
});

test("workspace policy detects unapproved local TypeScript config overrides", () => {
  const helperName = `tsconfig.${process.pid}-${randomUUID()}.json`;
  const helperPath = join(rootDir, "packages", "contracts", helperName);
  const helperRelativePath = `packages/contracts/${helperName}`;
  writeFileSync(helperPath, '{"compilerOptions":{"skipLibCheck":true}}\n', "utf8");
  try {
    const packageLocalSkipLibCheck = workspaceTsconfigFiles()
      .filter((path) => JSON.parse(readFileSync(path, "utf8")).compilerOptions?.skipLibCheck === true)
      .map((path) => path.slice(rootDir.length + 1).replaceAll("\\", "/"))
      .sort();
    assert.equal(packageLocalSkipLibCheck.includes(helperRelativePath), true);
  } finally {
    rmSync(helperPath, { force: true });
  }
});

test("lockfile resolves only patched production dependency versions", () => {
  const lockfile = readFileSync(lockfilePath, "utf8");

  assertPatchedProductionResolutions(lockfile);
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("postcss@8.5.23", "postcss@8.5.22")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("nanoid@3.3.18", "nanoid@3.3.16")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("find-my-way@9.7.0", "find-my-way@9.6.0")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("fastify@5.12.5", "fastify@5.10.0")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () =>
      assertPatchedProductionResolutions(
        lockfile.replace("\nsnapshots:", "\n  postcss@8.5.22:\n\nsnapshots:"),
      ),
    /vulnerable production dependency resolution/u,
  );
  assert.throws(
    () =>
      assertPatchedProductionResolutions(
        lockfile.replace("\nsnapshots:", "\nsnapshots:\n  find-my-way@9.6.0:"),
      ),
    /vulnerable production dependency resolution/u,
  );
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("fast-uri@3.1.8", "fast-uri@3.1.5")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("fast-uri@4.1.5", "fast-uri@4.1.2")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () =>
      assertPatchedProductionResolutions(
        lockfile.replace("\nsnapshots:", "\nsnapshots:\n  fast-uri@3.1.5:"),
      ),
    /vulnerable production dependency resolution/u,
  );
  assert.throws(
    () =>
      assertPatchedProductionResolutions(
        lockfile.replace("\nsnapshots:", "\nsnapshots:\n  fast-uri@4.1.2:"),
      ),
    /vulnerable production dependency resolution/u,
  );
  // mailto 필드명 인코딩 취약 버전이 새 패치와 함께 재유입돼도 거부한다.
  for (const version of ["4.1.3", "4.1.4"]) {
    assert.throws(
      () => assertPatchedProductionResolutions(lockfile.replace("\nsnapshots:", `\nsnapshots:\n  fast-uri@${version}:`)),
      /vulnerable production dependency resolution/u,
    );
  }
});
