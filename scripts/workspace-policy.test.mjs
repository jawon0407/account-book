import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(rootDir, "package.json");
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
  vitest: "4.1.10",
  "@vitest/coverage-v8": "4.1.10",
  eslint: "10.7.0",
  "@eslint/js": "10.0.1",
  "typescript-eslint": "8.64.0",
  globals: "17.7.0",
  prettier: "3.9.5",
  tsx: "4.23.1",
  "@types/node": "22.20.1",
};

const expectedScripts = {
  "test:workspace": "pnpm --filter @account-book/contracts --filter @account-book/database --filter @account-book/web --filter @account-book/api test",
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
  "next@16.2.11>sharp": "-",
  "next@16.2.11>postcss": "8.5.19",
  "find-my-way@9.6.0": "9.7.0",
};

function tsconfigFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return tsconfigFiles(path);
    }
    return /^tsconfig(?:\..+)?\.json$/u.test(entry.name) ? [path] : [];
  });
}

function workspaceTsconfigFiles() {
  return ["apps", "packages", "tests"].flatMap((directory) => tsconfigFiles(join(rootDir, directory)));
}

/**
 * Extracts the top-level scalar entries from the workspace `overrides` map.
 *
 * @param {string} workspace The pnpm workspace YAML source to inspect.
 * @returns {Record<string, string>} The exact quoted selector-to-value entries in `overrides`.
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
 * Verifies that both lockfile graphs resolve the production dependencies to
 * reviewed patch versions and retain no package entry for the vulnerable versions.
 *
 * @param {string} lockfile The generated pnpm lockfile source.
 * @returns {void}
 */
function assertPatchedProductionResolutions(lockfile) {
  const packagesStart = lockfile.indexOf("packages:");
  const snapshotsStart = lockfile.indexOf("\nsnapshots:");
  assert.notEqual(packagesStart, -1, "lockfile must contain a packages section");
  assert.notEqual(snapshotsStart, -1, "lockfile must contain a snapshots section");

  const resolutionSections = [
    lockfile.slice(packagesStart, snapshotsStart),
    lockfile.slice(snapshotsStart),
  ];
  const patchedEntries = [/^ {2}postcss@8\.5\.19:\r?$/mu, /^ {2}find-my-way@9\.7\.0:\r?$/mu];
  const vulnerableEntries = [/^ {2}postcss@8\.5\.10:\r?$/mu, /^ {2}find-my-way@9\.6\.0:\r?$/mu];

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
  const webPackage = JSON.parse(readFileSync(webPackagePath, "utf8"));
  const e2ePackage = JSON.parse(readFileSync(e2ePackagePath, "utf8"));
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  const workspace = readFileSync(workspacePath, "utf8");
  const npmrc = readFileSync(npmrcPath, "utf8");

  assert.deepEqual(pkg.devDependencies, expectedDevDependencies);
  assert.equal(webPackage.dependencies.next, "16.2.11");
  assert.equal(
    e2ePackage.scripts["test:preflight"],
    "tsx --test production-fake-startup.test.ts playwright-environment.test.ts",
  );
  assert.equal(
    e2ePackage.scripts.test,
    "tsx --test production-fake-startup.test.ts playwright-config.test.ts && playwright test --config playwright.config.ts",
  );
  assert.equal(
    pkg.scripts["test:legacy"],
    "node --test scripts/verify-structure.test.mjs scripts/workspace-policy.test.mjs scripts/security/*.test.mjs scripts/security-gate.test.mjs scripts/setup-hooks.test.mjs",
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
  // Next 16.2.11 pulls sharp 0.34.5 only as an optional image optimizer.
  // The app has no next/image usage, so keep that unused native dependency absent.
  // Its production PostCSS dependency and Fastify router are pinned to patched releases.
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

test("lockfile resolves only the patched PostCSS and Fastify router versions", () => {
  const lockfile = readFileSync(lockfilePath, "utf8");

  assertPatchedProductionResolutions(lockfile);
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("postcss@8.5.19", "postcss@8.5.10")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () => assertPatchedProductionResolutions(lockfile.replaceAll("find-my-way@9.7.0", "find-my-way@9.6.0")),
    /patched production dependency resolution/u,
  );
  assert.throws(
    () =>
      assertPatchedProductionResolutions(
        lockfile.replace("\nsnapshots:", "\n  postcss@8.5.10:\n\nsnapshots:"),
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
});
