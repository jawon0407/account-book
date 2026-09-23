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

/**
 * 저장소 구조 검증 테스트와 실제 구조 검사를 별도 Node 프로세스로 차례대로 실행한다.
 * 자식 프로세스의 출력은 그대로 공개하지 않아 경로나 비밀값이 오류 로그에 섞이지 않게 한다.
 * @param {string} rootDir 확인된 저장소 최상위 디렉터리.
 * @returns {void} 두 검사가 성공하면 반환값 없이 종료한다.
 * @throws {SecurityGateError} 실행 불가·출력 버퍼 초과·실패 종료이면 고정된 REPOSITORY_CHECK_FAILED 오류.
 */
function runRepositoryChecks(rootDir) {
  const commands = [
    [process.execPath, ["--test", join(rootDir, "scripts/verify-structure.test.mjs")]],
    [process.execPath, [join(rootDir, "scripts/verify-structure.mjs")]],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      throw new SecurityGateError(
        "REPOSITORY_CHECK_FAILED",
        "Repository checks did not pass.",
      );
    }
  }
}

const PRODUCTION_DEPENDENCIES = Object.freeze({
  assertCiPolicy,
  assertPrePushPolicy,
  formatSecretFindings,
  rangeFromCi,
  rangesFromPrePushUpdates,
  readChangedBlobs,
  runRepositoryChecks,
  scanBlobsForSecrets,
});

/**
 * @typedef {object} SecurityGateDependencies
 * @property {typeof assertCiPolicy} assertCiPolicy Validates CI branch policy.
 * @property {typeof assertPrePushPolicy} assertPrePushPolicy Validates local push policy.
 * @property {typeof formatSecretFindings} formatSecretFindings Formats sanitized findings.
 * @property {typeof rangeFromCi} rangeFromCi Builds the validated CI range.
 * @property {typeof rangesFromPrePushUpdates} rangesFromPrePushUpdates Builds local ranges.
 * @property {typeof readChangedBlobs} readChangedBlobs Reads complete introduced history.
 * @property {typeof runRepositoryChecks} runRepositoryChecks Runs repository contracts.
 * @property {typeof scanBlobsForSecrets} scanBlobsForSecrets Produces sanitized findings.
 */

/**
 * 브랜치 정책 → 저장소 구조 → 푸시할 이력의 파일 내용 → 비밀값 패턴 순서로 검사한다.
 * 하나라도 실패하면 통과로 간주하지 않는다. 기본 구현은 Git 읽기와 구조 검사 프로세스를 실행하지만 푸시하지 않는다.
 * @param {{mode: "pre-push"|"ci", rootDir: string, updates?: Array<{localRef: string, localSha: string, remoteRef: string, remoteSha: string}>, eventName?: string, targetRef?: string, base?: string, head?: string}} options 실행 모드에 맞는 정책 입력값과 저장소 루트.
 * @param {Partial<SecurityGateDependencies>} [dependencies] 테스트 등 통제된 호출에서 대체할 함수들. 생략한 항목은 기본 구현을 사용한다.
 * @returns {{scannedBlobCount: number}} 비밀값을 담지 않는 검사 대상 blob 수 요약.
 * @throws {SecurityGateError} 모드·브랜치·구조·이력 조회가 잘못되거나 비밀값 패턴이 발견되면 발생한다.
 */
export function runSecurityGate(options, dependencies = {}) {
  const operations = { ...PRODUCTION_DEPENDENCIES, ...dependencies };
  let ranges;
  if (options.mode === "pre-push") {
    operations.assertPrePushPolicy(options.updates);
    ranges = operations.rangesFromPrePushUpdates(options.updates);
  } else if (options.mode === "ci") {
    operations.assertCiPolicy({
      eventName: options.eventName,
      targetRef: options.targetRef,
    });
    ranges = [operations.rangeFromCi({ base: options.base, head: options.head })];
  } else {
    throw new SecurityGateError("INVALID_MODE", "Mode must be pre-push or ci.");
  }

  operations.runRepositoryChecks(options.rootDir);
  const blobs = operations.readChangedBlobs({ rootDir: options.rootDir, ranges });
  const findings = operations.scanBlobsForSecrets(blobs);
  if (findings.length > 0) {
    throw new SecurityGateError(
      "SECRET_DETECTED",
      operations.formatSecretFindings(findings),
    );
  }
  return { scannedBlobCount: blobs.length };
}
