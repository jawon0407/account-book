import { SecurityGateError } from "./errors.mjs";

const MAIN = "refs/heads/main";
const messages = Object.freeze({
  MAIN_PUSH_CONTEXT_INVALID: "Main push context is invalid.",
  MAIN_MERGE_EVIDENCE_REJECTED: "Main update is not linked to one supported merged pull request.",
  MAIN_MERGE_EVIDENCE_UNAVAILABLE: "GitHub merge evidence could not be verified.",
  MAIN_PROVENANCE_JOB_FAILED: "Main provenance job did not complete successfully.",
});
/** 고정 코드(code)만 받아 외부 입력을 담지 않는 공개 오류를 반환한다. */
export const mergeEvidenceError = (code) => new SecurityGateError(code, messages[code]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/iu.test(value) && !/^0{40}$/u.test(value);
const repository = value => typeof value === "string" && value.split("/").length === 2 &&
  value.split("/").every(part => /^[a-z0-9_.-]+$/iu.test(part) && part !== "." && part !== "..");
const lower = value => value.toLowerCase();
const sameSha = (left, right) => sha(left) && sha(right) && lower(left) === lower(right);
/** 조건(ok)이 거짓이면 지정된 고정 오류(code)를 던진다. 반환값은 없다. */
function requireValue(ok, code = "MAIN_MERGE_EVIDENCE_UNAVAILABLE") {
  if (!ok) throw mergeEvidenceError(code);
}

/**
 * context의 저장소·양의 ID·서로 다른 비영 SHA 형태를 재검사한다. I/O는 없다.
 * @param {object} context 정규화된 것으로 주장하는 입력. 잘못된 형태면 고정 오류를 던진다.
 * @param {string} code 호출 경계에 맞는 고정 오류 코드.
 * @returns {void}
 */
export function assertMainContextShape(context, code = "MAIN_MERGE_EVIDENCE_UNAVAILABLE") {
  requireValue(object(context) && repository(context.repository) && positiveId(context.repositoryId) &&
    sha(context.before) && sha(context.after) && !sameSha(context.before, context.after), code);
}

/**
 * event/환경(env)/CLI(options)를 대조해 소문자 저장소·SHA 컨텍스트를 반환한다.
 * @param {{event:object,env:object,options:object}} input GitHub push 정보. 누락·불일치면 context-invalid.
 * @returns {{repository:string,repositoryId:number,before:string,after:string}}
 */
export function normalizeMainPushContext({ event, env, options }) {
  const code = "MAIN_PUSH_CONTEXT_INVALID";
  requireValue(object(event) && object(env) && object(options) && object(event.repository), code);
  const context = { repository: event.repository.full_name, repositoryId: event.repository.id,
    before: event.before, after: event.after };
  assertMainContextShape(context, code);
  requireValue(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "push" &&
    env.GITHUB_REF === MAIN && event.ref === MAIN && options.mode === "ci" &&
    options.eventName === "push" && options.targetRef === MAIN &&
    event.forced === false && event.created === false && event.deleted === false &&
    repository(env.GITHUB_REPOSITORY) && lower(env.GITHUB_REPOSITORY) === lower(context.repository) &&
    typeof env.GITHUB_REPOSITORY_ID === "string" && /^[1-9][0-9]*$/u.test(env.GITHUB_REPOSITORY_ID) &&
    Number(env.GITHUB_REPOSITORY_ID) === context.repositoryId &&
    sameSha(env.GITHUB_SHA, context.after) && sameSha(options.head, context.after) &&
    sameSha(options.base, context.before), code);
  return { ...context, repository: lower(context.repository), before: lower(context.before), after: lower(context.after) };
}

/**
 * 목록/상세 PR의 필수 응답 형태를 검사한다. null 병합 값은 정상적인 미병합 상태다.
 * @param {object} pr GitHub PR 응답. 날짜·필수 필드가 깨지면 unavailable 오류.
 * @param {boolean} detail 상세 응답이면 merged boolean도 요구한다.
 * @returns {void}
 */
export function assertPullRequestShape(pr, detail = false) {
  requireValue(object(pr) && positiveId(pr.id) && positiveId(pr.number) &&
    typeof pr.state === "string" && typeof pr.draft === "boolean" &&
    (pr.merge_commit_sha === null || sha(pr.merge_commit_sha)) &&
    object(pr.base) && typeof pr.base.ref === "string" && object(pr.base.repo) &&
    positiveId(pr.base.repo.id) && repository(pr.base.repo.full_name) &&
    object(pr.head) && sha(pr.head.sha) && (!detail || typeof pr.merged === "boolean"));
  requireValue(pr.merged_at === null || (typeof pr.merged_at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(pr.merged_at) &&
    Number.isFinite(Date.parse(pr.merged_at)) && new Date(pr.merged_at).toISOString() === pr.merged_at.replace("Z", ".000Z")));
}

/**
 * candidate/detail의 실제 병합 상태와 identity를 context에 맞춰 교차 검사한다.
 * @param {object} context 검증할 저장소와 결과 SHA.
 * @param {object} candidate 목록에서 찾은 후보.
 * @param {object} pullRequest 상세 재조회 결과. 정상 형태의 정책 불일치는 rejected다.
 * @returns {void}
 */
export function assertPullRequestEvidence(context, candidate, pullRequest) {
  assertMainContextShape(context);
  assertPullRequestShape(candidate);
  assertPullRequestShape(pullRequest, true);
  const code = "MAIN_MERGE_EVIDENCE_REJECTED";
  for (const pr of [candidate, pullRequest]) {
    requireValue(pr.state === "closed" && pr.draft === false && pr.merged_at !== null &&
      pr.base.ref === "main" && pr.base.repo.id === context.repositoryId &&
      lower(pr.base.repo.full_name) === lower(context.repository) && sameSha(pr.merge_commit_sha, context.after), code);
  }
  requireValue(pullRequest.merged === true && candidate.id === pullRequest.id &&
    candidate.number === pullRequest.number && sameSha(candidate.head.sha, pullRequest.head.sha), code);
}

/**
 * 증빙 전체와 Git 부모를 확인하고 PR 번호/SHA만 반환한다. 외부 호출·토큰 접근은 없다.
 * @param {{base:string,head:string,evidence:object}} input CLI 범위와 event/PR/commit 증빙.
 * @returns {{prNumber:number,sha:string}} 성공 요약. 증빙 없음·연결 불일치는 rejected.
 */
export function assertMainMergeEvidence({ base, head, evidence }) {
  const code = "MAIN_MERGE_EVIDENCE_REJECTED";
  requireValue(object(evidence), code);
  const { context, candidate, pullRequest, commit } = evidence;
  assertPullRequestEvidence(context, candidate, pullRequest);
  requireValue(object(commit) && sha(commit.head) && Array.isArray(commit.parents) && commit.parents.every(sha));
  requireValue(sameSha(base, context.before) && sameSha(head, context.after) && sameSha(commit.head, head) &&
    sameSha(commit.parents[0], base) && (commit.parents.length === 1 ||
      (commit.parents.length === 2 && sameSha(commit.parents[1], pullRequest.head.sha))), code);
  return { prNumber: pullRequest.number, sha: lower(head) };
}

/**
 * needs 결과를 검증한다. main push는 success, 기존 지원 non-main 이벤트는 skipped만 허용한다.
 * @param {{eventName:string,targetRef:string,result:string}} input 작업 이벤트/목적 ref/needs 결과.
 * @returns {void} 실패·취소·누락·지원하지 않는 조합이면 고정 job-failed 오류.
 */
export function assertProvenanceJobResult({ eventName, targetRef, result }) {
  const main = eventName === "push" && targetRef === MAIN;
  const other = (eventName === "pull_request" && [MAIN, "refs/heads/maintenance-branch"].includes(targetRef)) ||
    (eventName === "push" && typeof targetRef === "string" &&
      /^refs\/heads\/(?:maintenance-branch|(?:feature|hotfix)\/[a-z0-9]+(?:-[a-z0-9]+)*)$/u.test(targetRef));
  requireValue(main ? result === "success" : other && result === "skipped", "MAIN_PROVENANCE_JOB_FAILED");
}

/**
 * 자식 프로세스용 환경을 복사해 GitHub 인증값만 대소문자 무시로 제거한다.
 * @param {Record<string,string|undefined>} env 원본 환경. 원본은 변경하지 않는다.
 * @returns {Record<string,string|undefined>} 인증값을 제외한 환경 복사본.
 */
export function withoutGithubCredentials(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(?:GITHUB_TOKEN|GH_TOKEN)$/iu.test(key)));
}
