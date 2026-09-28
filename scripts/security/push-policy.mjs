import { SecurityGateError } from "./errors.mjs";
import { assertMainMergeEvidence } from "./merge-evidence.mjs";

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
 * Git pre-push 훅이 표준 입력으로 보낸 줄을 네 필드로 나눠 참조와 SHA 형식을 검사한다.
 * 이 단계는 refs/ 접두사와 SHA 형식만 확인하며 허용 브랜치 정책은 별도 함수가 검사한다.
 * @param {string} input `<local-ref> <local-sha> <remote-ref> <remote-sha>` 형식의 원시 여러 줄 문자열.
 * @returns {Array<{localRef: string, localSha: string, remoteRef: string, remoteSha: string}>} 빈 줄을 제외하고 파싱한 참조 변경 목록.
 * @throws {SecurityGateError} 입력이 비었거나 필드 수·참조 접두사·SHA 형식이 잘못되면 발생한다.
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
 * 원격 목적지가 main이거나 허용된 feature/*·hotfix/*·maintenance-branch 규칙 밖이면 푸시 검사를 실패시킨다.
 * @param {ReturnType<typeof parsePrePushInput>} updates 형식 검사가 끝난 참조 변경 목록.
 * @returns {void} 모든 원격 참조가 정책을 통과하면 반환값 없이 종료한다. 실제 푸시는 하지 않는다.
 * @throws {SecurityGateError} main 직접 푸시 또는 허용되지 않은 참조 이름이면 발생한다.
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
 * CI 이벤트 종류와 목적 브랜치를 검사한다. main push는 실제 병합 증빙이 있어야 한다.
 * pull_request는 main 또는 maintenance-branch를 대상으로 할 때 허용하지만 PR 승인 여부를 조회하지는 않는다.
 * @param {{eventName: string, targetRef: string, base?:string, head?:string, mergeEvidence?:object}} options 이벤트·참조·범위와 main 전용 증빙.
 * @returns {void} 허용된 이벤트·참조 조합이면 반환값 없이 종료한다.
 * @throws {SecurityGateError} main 직접 push, 허용되지 않은 브랜치 또는 알 수 없는 이벤트 조합이면 발생한다.
 */
export function assertCiPolicy({ eventName, targetRef, base, head, mergeEvidence }) {
  if (eventName === "push") {
    if (targetRef === "refs/heads/main") {
      assertMainMergeEvidence({ base, head, evidence: mergeEvidence });
      return;
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
