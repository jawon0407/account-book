/** 합성 PR과 이벤트를 매번 새 객체로 만들어 테스트 간 상태 공유를 막는다. */
export function mainFixture() {
  const before = "1".repeat(40), after = "2".repeat(40), source = "3".repeat(40);
  const repository = "example/account-book";
  const context = { repository, repositoryId: 7, before, after };
  const candidate = {
    id: 120, number: 12, state: "closed", draft: false,
    merged_at: "2026-09-23T07:30:53Z", merge_commit_sha: after,
    base: { ref: "main", repo: { id: 7, full_name: repository } },
    head: { sha: source },
  };
  return {
    context, candidate, pullRequest: { ...structuredClone(candidate), merged: true },
    commit: { head: after, parents: [before, source] },
    event: { repository: { id: 7, full_name: repository }, ref: "refs/heads/main",
      before, after, forced: false, created: false, deleted: false },
    env: { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: after, GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: "7" },
    options: { mode: "ci", eventName: "push", targetRef: "refs/heads/main", base: before, head: after },
  };
}
