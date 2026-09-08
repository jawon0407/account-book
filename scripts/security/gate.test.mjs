import assert from "node:assert/strict";
import test from "node:test";

import { SecurityGateError } from "./errors.mjs";
import { runSecurityGate } from "./gate.mjs";

test("gate runs dependencies in fail-closed order and propagates repository failure", () => {
  const calls = [];
  const failure = new SecurityGateError(
    "REPOSITORY_CHECK_FAILED",
    "Repository checks did not pass.",
  );
  const updates = [{ remoteRef: "refs/heads/feature/review-fix" }];

  assert.throws(
    () => runSecurityGate(
      { mode: "pre-push", rootDir: "controlled-root", updates },
      {
        /** 정책 단계 호출 순서를 기록한다. @param actualUpdates - 원래 updates 객체와 같아야 할 입력. */
        assertPrePushPolicy(actualUpdates) {
          calls.push("policy");
          assert.equal(actualUpdates, updates);
        },
        /** 범위 단계 호출을 기록한다. @returns 실제 Git 조회 없이 만든 고정 SHA 범위. */
        rangesFromPrePushUpdates() {
          calls.push("ranges");
          return [{ base: null, head: "a".repeat(40) }];
        },
        /** 구조 검사 단계 실패를 흉내 낸다. @throws 미리 만든 failure를 던져 뒤 단계 중단 여부를 검사한다. */
        runRepositoryChecks() {
          calls.push("repository");
          throw failure;
        },
        /** 앞 단계 실패 시 호출되면 안 되는 blob 조회 대역이다. @returns 빈 파일 목록. */
        readChangedBlobs() {
          calls.push("blobs");
          return [];
        },
        /** 앞 단계 실패 시 호출되면 안 되는 비밀값 검사 대역이다. @returns 빈 탐지 결과. */
        scanBlobsForSecrets() {
          calls.push("secrets");
          return [];
        },
      },
    ),
    (error) => error === failure,
  );
  assert.deepEqual(calls, ["policy", "ranges", "repository"]);
});
