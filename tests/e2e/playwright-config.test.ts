import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { before } from "node:test";
import { pathToFileURL } from "node:url";

before(() => {
  process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
  process.env.TEST_DATABASE_DISPOSABLE = "true";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

test("mutation: project routing, serial execution, or trace-off policy cannot drift", async () => {
  const { default: config } = await import("./playwright.config.js");
  const projects = new Map((config.projects ?? []).map((project) => [project.name, project]));

  assert.deepEqual([...projects.keys()].sort(), ["http-contract", "layout-desktop-width-boundaries", "ui-desktop-1440x900", "ui-mobile-390x844"]);
  assert.equal(projects.get("ui-mobile-390x844")?.testMatch, "ui/auth-ui.spec.ts");
  assert.equal(projects.get("ui-desktop-1440x900")?.testMatch, "ui/auth-ui.spec.ts");
  assert.equal(projects.get("layout-desktop-width-boundaries")?.testMatch, "layout/auth-shell-width.spec.ts");
  assert.equal(projects.get("http-contract")?.testMatch, "auth-response.spec.ts");
  assert.equal(config.fullyParallel, false);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.use?.screenshot, "off");
  assert.equal(config.use?.video, "off");
  assert.equal(config.use?.trace, "off");
});

test("PR browser runner preserves full Git history and excludes source metadata", async () => {
  // 위 테스트와 같은 설정을 읽되 실제 서버·브라우저 대신 Git 수집 플러그인만 실행한다.
  const { default: config } = await import("./playwright.config.js");
  const require = createRequire(import.meta.url);
  const playwrightPath = require.resolve("@playwright/test");
  const cliPath = join(dirname(require.resolve("@playwright/test/package.json")), "cli.js");
  const root = mkdtempSync(join(tmpdir(), "account-book-playwright-history-"));
  const origin = join(root, "origin");
  const checkout = join(root, "checkout");
  mkdirSync(origin);

  /**
   * 이 테스트가 만든 임시 저장소에서만 Git을 실행한다.
   * @param cwd - 명령이 실행될 임시 저장소 경로.
   * @param args - 셸을 거치지 않고 Git에 전달할 인수 목록.
   * @returns 명령의 표준 출력. 실패·시간 초과는 테스트 실패로 전파한다.
   */
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 10_000, windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_COMMITTER_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  try {
    git(origin, "init", "--initial-branch=main");
    git(origin, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture root");
    git(origin, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture base");
    const base = git(origin, "rev-parse", "HEAD");
    // file://은 실제 fetch 프로토콜을 사용해 --depth=1의 부작용까지 재현한다.
    git(root, "clone", pathToFileURL(origin).href, checkout);
    git(checkout, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture head");
    const head = git(checkout, "rev-parse", "HEAD");
    const eventPath = join(root, "event.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { title: "fixture", number: 1, base: { sha: base } } }));
    writeFileSync(join(checkout, "playwright.config.cjs"), `module.exports = ${JSON.stringify({
      testDir: ".", testMatch: "probe.spec.cjs", workers: 1, reporter: "json",
      captureGitInfo: config.captureGitInfo,
    })};`);
    writeFileSync(join(checkout, "probe.spec.cjs"),
      `const { test, expect } = require(${JSON.stringify(playwrightPath)}); test("probe", () => expect(1).toBe(1));`);
    assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "false");
    const output = execFileSync(process.execPath, [cliPath, "test", "--config", "playwright.config.cjs"], {
      cwd: checkout, encoding: "utf8", timeout: 30_000, windowsHide: true,
      env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: head, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "fixture/fixture",
        GITHUB_RUN_ID: "1", DEBUG_GIT_COMMIT_INFO: "", PLAYWRIGHT_JSON_OUTPUT_FILE: "",
        PLAYWRIGHT_JSON_OUTPUT_DIR: "", PLAYWRIGHT_JSON_OUTPUT_NAME: "" },
    });
    const report = JSON.parse(output);
    assert.equal(report.stats.expected, 1, "the real Playwright runner must execute the probe");
    assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "false", "report metadata must not truncate Git history");
    assert.equal(git(checkout, "rev-list", "--count", "HEAD"), "3");
    assert.equal(report.config.metadata.gitDiff, undefined);
    assert.equal(report.config.metadata.gitCommit, undefined);
  } finally {
    // mkdtemp가 만든 정확한 하위 경로만 제거하며 사용자 체크아웃은 건드리지 않는다.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});
