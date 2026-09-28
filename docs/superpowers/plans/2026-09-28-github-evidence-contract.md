# GitHub 병합 증거 API 계약 보완

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 최신 사용자 요청에 따라 일반 구현 재승인은 생략하고 검증과 기록을 유지한다.

**Goal:** 정상 PR 병합을 main 사후 검사에서 정확히 확인한다.
**Architecture:** 기존 REST 목록·상세·Git 부모의 교차 검증을 유지하고, 해당 응답 필드가 제공되는 지원 API 버전을 고정한다.
**Tech Stack:** Node22, GitHub REST, node:test. 추가 의존성 없음.
**Spec:** 아래 실제 실패·선택·보안 불변 조건이 이번 좁은 수정의 설계다.

## 근거와 대안

PR #14는 c4ba4a5 push/PR 각각 필수13단계 성공 후 정상 merge되어 main은da17f4f다. main 실행36399193418은 `MAIN_MERGE_EVIDENCE_UNAVAILABLE`로 중단됐다. 2026-03-10 버전의 실제 목록/상세 응답에 merge_commit_sha가 없고 2022-11-28에는 실제 병합 SHA가 있다. mock fixture는 구형 응답을 최신 헤더와 함께 반환해 이 불일치를 잡지 못했다.

1. 지원 중인 2022-11-28 REST 계약 고정: 현재 검증 모델을 유지하고 수정량이 작다. 지원 종료 전 이관이 필요하다. **선택**.
2. GraphQL mergeCommit 기반으로 전면 이관: 최신 계약을 사용할 수 있지만 별도 질의·페이지·오류·권한 경계와 테스트가 추가된다. 후속 유지보수에서 다룬다.
3. 누락된 SHA를 생략하고 merged=true만 확인: 결과 커밋 결속이 약해지므로 제외한다.

[GitHub 공식 지원 표](https://docs.github.com/en/rest/about-the-rest-api/api-versions)는 2022-11-28의 종료일을2028-03-10으로 명시한다(2026-09-28 확인). 지원 계약 선택은 라이브러리 취약 버전 복원이 아니다. 2027-09 정기 운영 점검 또는 Deprecation/Sunset 안내 확인 중 먼저 도달한 시점에 이관 설계를 검토한다. 자동 예약을 생성한 것은 아니다.

## 불변 조건·범위

- 정확한 결과 SHA·저장소 identity·PR 목록/상세·실제 Git 부모 검사는 완화하지 않는다.
- 단일 고정 API 버전만 사용하고 실패 시 버전 fallback/재시도/검사 우회를 하지 않는다.
- 410·권한 거부·필드 누락은 계속 fail-closed. timeout10초·본문1MiB·고정 host·redirect 거부 유지.
- 운영 DB·앱 인증·은행 호출·의존성·workflow 권한 변경 없음.
- 별도 feature/ci-github-evidence-contract. 사용자 .gitignore는 보존/커밋 제외.
- 약5파일·80~140줄 예상: 조회 어댑터1, 테스트1, 이 계획1, 한국어 결과 기록1, 이전 계획의 API 버전 정정1.

## Task 1: 계약 회귀와 최소 수정

- [x] scripts/security/github-merge-evidence.test.mjs: 지원 버전 헤더 기대값과 버전별 응답 shape 회귀. 수정 전34개 중2실패(RED).
- [x] 410을 기존 HTTP 거부 회귀에 추가하고 오류 원문·토큰 출력/자동 재시도가 없는지 유지한다.
- [x] scripts/security/github-merge-evidence.mjs: 헤더를2022-11-28로 고정하고 이유·이관 조건 주석. 그 밖의 판정은 변경하지 않는다.
- [x] 집중 회귀114/114 GREEN, 실제 PR #14 읽기 조회로 결과 SHA·PR identity·Git 부모 검증. 원시 API 응답과 인증 토큰은 로그/문서에 복제하지 않는다.

## Task 2: 통합 검증과 기록

- [x] 전체 pnpm verify exit0(1,153개·lint·타입·빌드). 독립 최종 리뷰 Critical0/Important0/Minor0, 집중115/115 및 실제 읽기 probe 재실행 성공.
- [x] docs/status/2026-09-28-public-protection-execution.ko.md 및 Notion08의 현재 상태/근거/다음 액션 갱신. 새 원격 결과에 맞춰 계속 갱신한다.
- [x] 후보971ecb9 push36400190560/PR36400228384 각필수13단계·H/B/C 대조, 보호 read-back 후 PR #17 정상 merge. 새 main e43260d 실행36400707374의 실제 provenance·전체 품질 성공 확인.
- [x] 실패했던36399193418은 과거 실패로 유지하고 새 main 성공으로 복구를 입증했다. A1 최신 기준 재검증·통합 재개.

## 자체 검토

실제 실패가 응답 버전 불일치임을 양쪽 API에서 확인했다. 선택안은 기존 교차 검증을 보존하며, 회귀가 헤더와 응답 shape의 관계를 함께 검사한다. 실환경 조회는 읽기만 수행한다. 지원 종료 위험과 별도 이관 시점을 기록했다. 이전 main 실패를 단순 재실행으로 숨기지 않는다.
