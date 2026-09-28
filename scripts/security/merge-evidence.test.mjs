import assert from "node:assert/strict";
import test from "node:test";
import { assertMainMergeEvidence, normalizeMainPushContext, assertProvenanceJobResult,
  withoutGithubCredentials } from "./merge-evidence.mjs";
import { mainFixture } from "./merge-evidence.test-fixtures.mjs";

const prove = (f) => assertMainMergeEvidence({ base: f.options.base, head: f.options.head, evidence: f });
test("records association for single-parent indirect merge without proving transport", () => {
  const f = mainFixture();
  f.candidate.head.sha = f.context.after;
  f.pullRequest.head.sha = f.context.after;
  f.commit.parents = [f.context.before];
  // 직접 도달 뒤 merged로 기록된 PR도 이 입력을 만족한다. 경로 허가 증명이 아니다.
  assert.equal(prove(f).prNumber, 12);
});

test("two-parent association cannot distinguish a locally created merge transport", () => {
  const f = mainFixture();
  // 동일한 커밋은 로컬에서도 만들 수 있다. fixture에는 전송 경로를 구분할 입력이 없다.
  assert.deepEqual(f.commit.parents, [f.context.before, f.pullRequest.head.sha]);
  assert.deepEqual(prove(f), { prNumber: 12, sha: f.context.after });
});

test("accepts real merge and single-result commits, ignoring moving base SHA", () => {
  const f = mainFixture();
  assert.deepEqual(normalizeMainPushContext(f), f.context);
  assert.deepEqual(prove(f), { prNumber: 12, sha: "2".repeat(40) });
  f.commit.parents = [f.context.before];
  f.pullRequest.base.sha = "9".repeat(40);
  f.pullRequest.body = "ignored";
  assert.equal(prove(f).prNumber, 12);
});

const rejected = [
  ["unmerged", f => { f.pullRequest.merged = false; }],
  ["open", f => { f.pullRequest.state = "open"; }],
  ["draft", f => { f.pullRequest.draft = true; }],
  ["no merged date", f => { f.pullRequest.merged_at = null; }],
  ["no parents", f => { f.commit.parents = []; }],
  ["octopus", f => { f.commit.parents.push("4".repeat(40)); }],
  ["multi-commit rebase", f => { f.commit.parents = ["4".repeat(40)]; }],
  ["wrong second parent", f => { f.commit.parents[1] = "4".repeat(40); }],
  ["stale head", f => { f.commit.head = "4".repeat(40); }],
  ["wrong CLI base", f => { f.options.base = "4".repeat(40); }],
  ["wrong CLI head", f => { f.options.head = "4".repeat(40); }],
  ...["candidate", "pullRequest"].flatMap(key => [
    [`${key} id`, f => { f[key].id++; }],
    [`${key} number`, f => { f[key].number++; }],
    [`${key} SHA`, f => { f[key].merge_commit_sha = "4".repeat(40); }],
    [`${key} repository id`, f => { f[key].base.repo.id++; }],
    [`${key} repository name`, f => { f[key].base.repo.full_name = "other/repo"; }],
    [`${key} ref`, f => { f[key].base.ref = "other"; }],
    [`${key} source`, f => { f[key].head.sha = "4".repeat(40); }],
  ]),
];
for (const [label, mutate] of rejected) {
  test(`rejects ${label}`, () => {
    const f = mainFixture(); mutate(f);
    assert.throws(() => prove(f), { code: "MAIN_MERGE_EVIDENCE_REJECTED" });
  });
}
const malformed = [
  ["missing merged", f => { delete f.pullRequest.merged; }],
  ["string merged", f => { f.pullRequest.merged = "true"; }],
  ["malformed date", f => { f.pullRequest.merged_at = "canary"; }],
  ["array PR", f => { f.pullRequest = []; }],
  ["missing repo", f => { delete f.candidate.base.repo; }],
  ["missing SHA", f => { delete f.pullRequest.merge_commit_sha; }],
  ["string ID", f => { f.candidate.id = "120"; }],
  ["bad context ID", f => { f.context.repositoryId = NaN; }],
  ["bad context SHA", f => { f.context.after = "invalid"; }],
  ["array parents", f => { f.commit.parents = "invalid"; }],
];
for (const [label, mutate] of malformed) {
  test(`fails safely for ${label}`, () => {
    const f = mainFixture(); mutate(f);
    assert.throws(() => prove(f), { code: "MAIN_MERGE_EVIDENCE_UNAVAILABLE" });
  });
}
test("missing proof cannot authorize a main push", () => {
  assert.throws(() => assertMainMergeEvidence({}), { code: "MAIN_MERGE_EVIDENCE_REJECTED" });
});

const invalidContexts = [
  f => { f.event = []; }, f => { f.options.mode = "pre-push"; },
  f => { f.env.GITHUB_ACTIONS = "false"; }, f => { f.env.GITHUB_EVENT_NAME = "pull_request"; },
  f => { f.env.GITHUB_REF = "refs/heads/other"; }, f => { f.options.targetRef = "refs/heads/other"; },
  f => { f.event.ref = "refs/heads/other"; }, f => { f.options.eventName = "pull_request"; },
  f => { f.env.GITHUB_REPOSITORY_ID = "07"; }, f => { f.event.repository.id = 8; },
  f => { f.env.GITHUB_REPOSITORY = "other/repo"; }, f => { f.event.repository.full_name = "../repo"; },
  f => { f.event.after = "0".repeat(40); }, f => { f.event.before = f.event.after; },
  f => { f.env.GITHUB_SHA = "4".repeat(40); }, f => { f.options.base = "4".repeat(40); },
  f => { f.options.head = "4".repeat(40); }, f => { f.event.before = "--evil"; },
  ...["forced", "created", "deleted"].flatMap(key => [
    f => { f.event[key] = true; }, f => { delete f.event[key]; }, f => { f.event[key] = "false"; },
  ]),
];
for (const [index, mutate] of invalidContexts.entries()) {
  test(`rejects mismatched or malformed Actions context ${index + 1}`, () => {
    const f = mainFixture(); mutate(f);
    assert.throws(() => normalizeMainPushContext(f), { code: "MAIN_PUSH_CONTEXT_INVALID" });
  });
}
test("normalizes repository casing and SHA casing", () => {
  const f = mainFixture(); f.env.GITHUB_REPOSITORY = "EXAMPLE/ACCOUNT-BOOK";
  assert.equal(normalizeMainPushContext(f).repository, "example/account-book");
});

for (const result of ["success", "failure", "cancelled", "skipped", undefined, ""]) {
  test(`main job result ${result} must be explicit success`, () => {
    const run = () => assertProvenanceJobResult({ eventName: "push", targetRef: "refs/heads/main", result });
    if (result === "success") assert.doesNotThrow(run);
    else assert.throws(run, { code: "MAIN_PROVENANCE_JOB_FAILED" });
  });
}
for (const [eventName, targetRef] of [
  ["push", "refs/heads/feature/example"], ["push", "refs/heads/hotfix/example"],
  ["push", "refs/heads/maintenance-branch"], ["pull_request", "refs/heads/main"],
  ["pull_request", "refs/heads/maintenance-branch"],
]) {
  test(`only intentional skipped provenance for ${eventName}/${targetRef}`, () => {
    assert.doesNotThrow(() => assertProvenanceJobResult({ eventName, targetRef, result: "skipped" }));
    for (const result of ["success", "failure", "cancelled", undefined]) {
      assert.throws(() => assertProvenanceJobResult({ eventName, targetRef, result }), { code: "MAIN_PROVENANCE_JOB_FAILED" });
    }
  });
}
test("unknown events and branches never allow skipped proof", () => {
  for (const [eventName, targetRef] of [["workflow_dispatch", "refs/heads/main"], ["push", "refs/heads/bad"], ["pull_request", "refs/heads/feature/example"]]) {
    assert.throws(() => assertProvenanceJobResult({ eventName, targetRef, result: "skipped" }), { code: "MAIN_PROVENANCE_JOB_FAILED" });
  }
});
test("removes GitHub credentials case-insensitively without mutating environment", () => {
  const env = { PATH: "safe", GITHUB_TOKEN: "synthetic-canary", gh_token: "synthetic-canary" };
  assert.deepEqual(withoutGithubCredentials(env), { PATH: "safe" });
  assert.equal(env.GITHUB_TOKEN, "synthetic-canary");
});
