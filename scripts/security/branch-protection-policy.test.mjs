import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 서버 적용 여부가 아니라, 향후 보호 API에 전달할 로컬 요청 계약을 검사한다.
// app_id는 2026-09-28 이 저장소의 security-gate check-runs에서 확인했다.
const approvedPolicy = {
  required_status_checks: {
    strict: true,
    contexts: [],
    checks: [{ context: "security-gate", app_id: 15368 }],
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
    require_last_push_approval: false,
  },
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: false,
};

/**
 * @param {object} policy 보호 API에 전달할 JSON 객체 또는 변형한 테스트 입력.
 * 승인된 요청과 다르면 AssertionError를 던진다. 원격 보호를 조회/변경하지 않는다.
 */
function assertApprovedProtection(policy) {
  assert.deepEqual(policy, approvedPolicy);
}

test("local protection payload requires PR and the observed Actions check source", () => {
  const policy = JSON.parse(readFileSync(
    new URL("../../.github/settings/main-protection.json", import.meta.url), "utf8",
  ));
  assertApprovedProtection(policy);
});

// 정책 검사의 누락 방지용 변형 입력이다. GitHub 서버의 거부 동작을 흉내내지 않는다.
const mutations = [
  ["missing checks", p => { delete p.required_status_checks; }],
  ["null checks", p => { p.required_status_checks = null; }],
  ["outdated base permitted", p => { p.required_status_checks.strict = false; }],
  ["empty checks", p => { p.required_status_checks.checks = []; }],
  ["duplicate checks", p => { p.required_status_checks.checks.push({ context: "security-gate", app_id: 15368 }); }],
  ["post-push job required", p => { p.required_status_checks.checks[0].context = "main-provenance"; }],
  ["missing app", p => { delete p.required_status_checks.checks[0].app_id; }],
  ...[-1, 0, "15368", 15369].map(appId => [
    `unexpected app ${JSON.stringify(appId)}`,
    p => { p.required_status_checks.checks[0].app_id = appId; },
  ]),
  ["no PR required", p => { p.required_pull_request_reviews = null; }],
  ["unexpected reviewer count", p => { p.required_pull_request_reviews.required_approving_review_count = 1; }],
  ["admins bypass", p => { p.enforce_admins = false; }],
  ["force push", p => { p.allow_force_pushes = true; }],
  ["branch deletion", p => { p.allow_deletions = true; }],
  ["unresolved conversation", p => { p.required_conversation_resolution = false; }],
  ["merge commit forbidden", p => { p.required_linear_history = true; }],
];

for (const [label, mutate] of mutations) {
  test(`local policy rejects drift: ${label}`, () => {
    const policy = structuredClone(approvedPolicy);
    mutate(policy);
    assert.throws(() => assertApprovedProtection(policy), { code: "ERR_ASSERTION" });
  });
}
