# 정상 PR 병합 증빙 CI 구현 기록

## 현재 상태

2026-09-28 보완 목표와 상세 계획을 승인받아 로컬 설정·PR 증거·문서를 보완했다. 원격 공개/보호 적용, push/PR/병합은 미실행이고 기존 P1은 여전히 미종결이다. 아래 기존 9월 24일 테스트와 이번 실행을 구분한다.

2026-09-24 사용자가 승인한 1번 방식(현재 세션 순차 구현 + 마지막 독립 리뷰)으로 진행한다. 기능 브랜치는 `feature/ci-merge-provenance`, 기준 main은 `9e2ff81`이다. 앱 기능·인증 런타임·DB·의존성은 변경하지 않는다. 사용자 `.gitignore`의 `.gstack/` 추가는 보존하고 커밋 대상에서 제외한다.

9월 24일 구현의 전체 로컬 검증은 통과했지만, 독립 리뷰에서 **Important(P1) 1건이 남아 완료/병합 가능 상태가 아니다**. 간접 병합 때문에 직접 main push 경로를 완전히 구분하지 못하는 설계 경계다. hosted CI/post-merge 검증도 별도다. push·PR 생성/병합·운영 배포·실계좌 접근은 진행하지 않았고 기존 PR #13도 변경하지 않았다.

## 무엇을 고쳤나

이전 CI는 GitHub의 push/main 이벤트를 전부 거부했다. 정상적인 PR 병합도 main을 갱신하기 때문에 잘못된 경보가 발생했다. 이제 메시지에 PR 번호가 있다는 이유로 허용하는 대신 실제 GitHub 병합 정보와 정확한 커밋 부모를 대조한다.

1. **입력 확인:** 실행 환경, 이벤트 파일, CLI 인자의 저장소 이름/ID·main ref·before/after가 같아야 한다. 강제 push/브랜치 생성·삭제는 거부한다.
2. **PR 확인:** 해당 결과 커밋의 PR 목록을 제한 안에서 끝까지 읽고, 정확히 하나의 후보를 상세 재조회한다. merged=true, closed, non-draft, 병합 시각·저장소·main·결과 SHA·identity를 검사한다.
3. **부모 확인:** 일반 merge는 `[이전 main, PR head]`, squash 같은 단일 결과는 `[이전 main]`이어야 한다. HEAD가 이벤트 결과와 다른 checkout이나 shallow는 거부한다.
4. **기존 검사 유지:** 정상 증빙이어도 구조 검사와 도입된 모든 커밋의 비밀값 검사를 실행한다. 로컬 main 직접 push는 계속 금지한다.
5. **권한 분리:** main 증빙 작업에만 PR 읽기 권한과 자동 토큰을 제공한다. 앱 테스트 작업은 그 결과부터 검사하며 실패·취소·예상 밖 skipped를 성공으로 바꾸지 않는다.

## 파일과 함수의 역할

| 파일 | 초급 개발자를 위한 설명 |
| --- | --- |
| scripts/security/merge-evidence.mjs | 입력을 받아 허용/거부를 결정하는 순수 함수. 네트워크 없이 테스트할 수 있다. 환경 복사 함수는 자식 프로세스로 넘어가는 GitHub 토큰을 제거한다. |
| scripts/security/github-merge-evidence.mjs | context와 token을 받아 고정 GitHub API만 조회한다. fetcher를 테스트에서 바꿀 수 있지만 실제 CLI에는 우회 옵션이 없다. |
| scripts/security/git-change-reader.mjs | rootDir와 head를 받아 현재 HEAD/부모를 읽는다. 부모 조회와 기존 secret scan 모두 Git replace를 무시해 동일한 원본 이력을 본다. |
| scripts/security-gate.mjs | 기존 CLI 입력을 받아 main CI에서만 이벤트 읽기→Git 확인→API 조회→동기 gate를 순서대로 연결한다. |
| scripts/security/gate.mjs / push-policy.mjs | 기존 검사 순서를 유지하며 main 증빙을 반드시 재검사한다. 증빙이 있어도 secret scan을 건너뛰지 않는다. |
| .github/workflows/security-gate.yml | main-provenance와 기존 security-gate의 권한·의존 관계를 분리한다. 기존 품질/DB/브라우저 검사 명령은 유지한다. |

응답은 본문 포함 전체 10초, 응답당 1MiB, 페이지당 100개·최대 3페이지다. 불완전한 결과는 허용하지 않는다. 이벤트 파일은 4MiB까지만 읽고 실패 로그에는 고정 코드/안내만 출력한다. 토큰·PR 본문·원문 이벤트/HTTP 응답은 저장하지 않는다.

## 테스트 작성과 실행 증거

RED는 원하는 새 동작을 검사하는 테스트가 아직 없는 기능 때문에 실패하는 단계, GREEN은 구현 후 같은 검사가 통과하는 단계다. 기존 동작의 회귀 검사가 처음부터 통과한 것은 새 기능의 RED라고 기록하지 않는다.

| 단계 | RED 확인 | GREEN 확인 / 커밋 |
| --- | --- | --- |
| 기준선 | 해당 없음 | 기존 보안 검사 47/47 |
| Task 1 순수 판정 | 새 모듈 미구현 | 78/78, lint 성공 / 79c7c87 |
| Task 2 HTTP 경계 | 새 조회 모듈 미구현 | Task 1+2 합계 110/110, lint 성공 / 09b3b7e |
| Task 3 연결 | 20개 중 7개 실패: export 없음·기존 main 거부·자식 환경 미분리 | 집중 20/20, 보안 162/162, 전체 테스트 1,126개·lint 성공 / 40ac359 |
| Task 4 workflow | 17개 중 7개 실패: 작업·권한·연결 미구현 | 정책 17/17, 보안 집중 164/164, 전체 verify 성공. 새 정규식의 lint 표기 오류 1건은 동일 의미의 `{2}` 표기로 수정. |

Task 3 전체 테스트 내역: legacy 169 + contracts 66 + database 단위 15 + API 148 + web 643 + E2E preflight 85 = 1,126개. 이는 실제 PostgreSQL 통합/브라우저 테스트를 의미하지 않는다.

Task 4 인증 coverage 재검증은 643개 통과(exit 0), branches 825/825=100%, statements 889/892=99.66%, functions 195/196=99.48%, lines 720/722=99.72%다. 기존 기준이나 대상 범위를 낮추지 않았다.

최종 Task 4 `pnpm verify`는 exit 0: lint·전체 타입 검사·테스트·API/웹 빌드를 통과했다. 테스트는 legacy 171 + contracts 66 + database 단위 15 + API 148 + web 643 + preflight 85 = **1,128개**다. `git diff --check`도 성공했다. 검사한 트리는 40ac359 이후 Task 4 변경이며 아래 커밋 이력으로 식별한다.

계획한 19파일 범위에서 작업했다. 코드/테스트/workflow는 15파일 +880/-24줄로, 예상 1,200~1,900줄보다 작다. 표 기반 테스트와 기존 reader 재사용으로 줄였으며 실패 조건을 생략하지 않았다. 나머지 4파일은 설계·계획·운영·이 결과 문서다. Task 2의 테스트 감시 시간은 계획대로 500ms로 맞추고 한국어 주석 오타를 수정해 HTTP 32개도 재검증했다.

실제 CLI 성공 테스트는 현재 checkout의 HEAD/부모를 읽고 GitHub HTTP만 합성 응답으로 대체한다. 임시 Git 저장소에서는 루트/단일/두 부모·stale HEAD·없는 SHA·shallow·Git replace를 확인했다. GitHub 토큰을 넣은 프로세스에서도 자식 Git/구조 검사의 환경에는 토큰이 없는지 확인했다.

## 결정과 미검증 범위

- 순수 판정 모듈의 응답 형태 검사를 HTTP 조회기도 재사용한다. 보안 규칙 중복을 피하기 위한 내부 export 추가이며 잘못된 분리였다면 내부 함수 계약을 조정해야 한다.
- 단일 커밋 rebase는 squash와 구분하지 못할 수 있다. 여러 커밋 rebase·배치 main 갱신·merge queue는 미지원이다.
- CI는 이미 도달한 push를 검사하는 사후 통제다. 서버 branch protection이나 리뷰 승인/병합 전 CI 확인을 대체하지 않는다.
- 새로운 hosted CI, 실제 GitHub API 권한, 승인된 병합 뒤 새 main 이벤트는 아직 검증하지 않았다. 과거 PR #12/#13의 성공 결과를 이번 변경의 성공으로 재사용하지 않는다.
- 독립 리뷰는 아래와 같이 완료했으며 중요한 설계 지적 1건은 사용자 판단 전 미해결로 유지한다.

## 독립 리뷰 — 완료 조건 미충족

리뷰 범위는 `9e2ff81..c535fec`, 판정은 **With fixes**다. Critical 0, Important 1, Minor 0이며 검토에서 제외한 항목은 없다. 리뷰어가 보안 검사 164/164와 diff 공백 검사를 별도로 통과시켰다. 전체 verify/coverage는 위 실행자 결과를 참조했다.

**P1: GitHub의 간접 병합은 직접 push와 정상 병합의 구분을 흐린다.** GitHub는 PR head가 다른 경로로 base에서 도달 가능해지면 해당 PR을 merged로 표시할 수 있으며, 직접 기본 브랜치 push도 포함한다. [GitHub 공식 간접 병합 설명](https://docs.github.com/en/pull-requests/reference/pull-request-merges#indirect-merges).

리뷰어와 실행자가 각각 합성 증빙으로 재현했다. `parents=[before]`, `PR head.sha=after`, `merge_commit_sha=after`, `merged=true`가 모두 맞으면 현재 판정기가 성공을 반환한다. 로컬에서 만든 두 부모 merge commit을 직접 push한 경우도 정상 병합과 같은 증빙 형태를 만들 수 있다. 실제 원격 main에 대한 우회 실험은 하지 않았으며, 공식 동작과 합성 판정 결과에 근거한 위험 분석이다.

이는 “리뷰 승인/병합 전 CI까지 증명하지 않는다”는 기존 한계보다 넓다. 현재 증빙은 PR과 결과 커밋의 연관성을 확인할 수 있지만, 그 결과가 허용된 병합 경로로 main에 도달했는지까지 증명하지 못한다. 기존 테스트 통과는 이 새로운 위협 사례의 해결을 의미하지 않는다.

### 이번에 내린 판단

1. 응답 형태 helper 공유는 유지한다. 보안 규칙 중복을 피하며 잘못된 모듈 분리라면 내부 계약 조정 비용이 남는다.
2. 단일 부모에서 `PR head.sha == after`만 거부하는 부분 패치는 아직 적용하지 않는다. 직접 로컬 merge push는 남기 때문에 전체 문제를 해결한 것으로 오해될 수 있고 허용 계약도 좁아진다. 이를 미해결 P1로 기록하며 현재 브랜치를 병합하지 않는다. 잘못 판단해 현재 상태를 배포하면 일부 직접 main push가 허용될 수 있다.

사용자 결정이 필요한 대안은 (1) 직접 push까지 통제할 추가 신뢰 경계/병합 절차를 비교 설계하거나, (2) 이번 기능을 PR 연관성 검증으로 범위 한정하고 간접 병합 잔여 위험 및 제한적 보완을 명시적으로 승인하는 것이다. 보안 우선 요구상 (1)을 권장한다. 새로운 자격 증명·쓰기 권한·요금제 변경·외부 서비스는 자동 추가하지 않는다.

## 다음 순서

보완 로컬 검증·독립 리뷰 → 공개 대상 전수 점검과 동결/직전 delta 확인 → 공개·보호 적용 별도 승인 → 원격 read-back·승인된 무민감 정상/거부 흐름 → 승인된 PR/최신 후보 CI → 별도 병합 승인·새 main 확인. 이후 10-A2 계좌 연결 DB로 돌아간다. 현재 실행 기록/작업 폴더를 보존한다.

## 2026-09-28 로컬 보완 실행

- 보호 JSON의 필수 검사 null을 strict security-gate/app_id 15368로 바꾸고 linear history를 false로 교정했다. 실제 서버 설정은 바꾸지 않았다.
- PR 양식은 H/B/C·run ID/event/URL·확인자/시각을 구분한다. 후보/검사 정의 변경 시 이전 확인은 무효다. 본인 확인은 절차이지 독립 타인 승인을 서버가 강제하는 기능이 아니다.
- 원격 main 9e2ff81의 체크 조회는 앱 ID 출처 확인이다. 해당 과거 실행은 failure였으며 현재 브랜치 CI 성공 증거가 아니다.
- 정책 RED: 19개 중 실제 JSON 계약 1개 실패(null 검사, linear=true), 수정 후 19개 통과. PR 양식 RED: 17개 중 1개 실패(H/B/C 기록 없음). 양식 교정 후 간접 병합 특성화 2개를 포함한 집중 검사 통과. 정확한 최종 개수는 아래 검증 결과에 기록한다.
- 앱 런타임·금융 DB·의존성·workflow 및 digest는 변경하지 않았다. 사용자 .gitignore 수정도 보존한다.

### 이번 실행의 검증 결과

검사 대상은 HEAD `7ecbcc0`에 이번 미커밋 로컬 보완을 더한 작업 트리다. 원격 CI나 해당 HEAD 단독의 결과가 아니다.

| 검사 | 2026-09-28 결과 |
| --- | --- |
| 설정 정책 | 19/19, exit 0 |
| workflow 정책 + 병합 증빙 | 97/97, exit 0 |
| 전체 보안 집중 | 185/185, exit 0; 실패·취소·skipped 0 |
| pnpm verify | 1,149개, lint·타입·API/웹 빌드 통과, exit 0 |
| 인증 coverage | 643개, branches 825/825=100%, exit 0 |
| 문서 링크 | 대상 9파일의 로컬 링크 81개 확인 |
| 실제 DB·브라우저 E2E | 실행 안 함: 이번 로컬 실행용 폐기 DB 미준비 |
| 원격 CI·보호·공개 감사 | 실행 안 함: 별도 단계 |

verify 합계는 legacy 192 + contracts 66 + database 단위 15 + API 148 + web 643 + E2E preflight 85다. coverage의 643개를 중복 합산하지 않는다. coverage 범위/기준은 그대로이며 statements 889/892, functions 195/196, lines 720/722다. 실제 DB/E2E·원격 보호 검증을 이 결과로 대체하지 않는다.

### 독립 최종 리뷰와 인계

새 검토자는 `9e2ff81..7ecbcc0` 누적 브랜치와 이번 미커밋 변경/신규 파일을 읽었다. 판정은 **DONE_WITH_CONCERNS: 로컬 보완 인계 가능, 원격 P1 때문에 브랜치 병합 준비 완료는 아님**이다. 신규 Critical 0 / Important 0 / Minor 1이며 기존 P1 1건은 유지한다. 검토자가 집중 검사 116/116과 diff 공백 검사를 독립 실행했다. 전체 verify/coverage는 실행자 로그로 확인했다.

보류한 Minor: 운영 가이드의 원격 read-back 설명이 API 필드 경로를 축약해 초급 사용자가 찾기 어렵다. 정확한 경로는 `required_status_checks.strict/checks`, `required_pull_request_reviews.required_approving_review_count`, `enforce_admins.enabled`, `allow_force_pushes.enabled`, `allow_deletions.enabled`, `required_linear_history.enabled`, `required_conversation_resolution.enabled`다. 불일치/미확인 시 중단하는 규칙은 유지되므로 우회 결함은 아니다. 실행 스킬의 경미 항목 보류 절차에 따라 다음 문서 정리 대상으로 기록했다.

검토 제외 항목에 대한 실행자 판단:

- 원격 보호·앱 출처 적용·rebase·정상/거부 흐름: 별도 승인된 원격 검증 전 P1 유지. 이를 완료로 오해하면 무보호 main 변경을 허용할 수 있다.
- 전체 노출/이력/로그/첨부/권리: T5 전수 감사 전 공개 금지. 생략하면 민감자료가 회수 불가능하게 복제될 수 있다.
- secret 보호의 활성/차단: 별도 미검증 gate 유지. 활성 추정은 유출 방어 공백을 숨길 수 있다.
- hosted PR/main·실제 DB/브라우저: 로컬 단위·preflight로 대체하지 않음. 혼동하면 통합 실패를 놓칠 수 있다.
- 사용자 .gitignore: 이번 산출물에서 제외하고 그대로 보존. 무단 포함하면 사용자 작업을 의도치 않게 전송할 수 있다.

### 기록 도구 재실행에서 발견한 기존 환경 한계

보안 종료 기록 도구가 Git Bash에서 pnpm.cmd를 찾지 못한 1회(exit 127)는 환경 오류로 테스트 미실행이다. 이후 Bash→PowerShell 래퍼 실행은 보안 184통과/1실패였다. 실패한 `executable pre-push hook forwards CLI arguments and Git stdin`은 기존 Windows 테스트가 첫 `git.exe` 경로에서 `../bin/sh.exe`를 계산하는데 Bash가 `Git/mingw64/bin/git.exe`를 먼저 선택해 존재하지 않는 sh 경로를 만든 것이 원인이다.

같은 단일 테스트가 직접 PowerShell에서 통과하고 Bash 경유에서 실패함을 재현했다. 실제 경로 존재 여부를 대조하고 기존 `Git/cmd`를 PATH 앞에 복원하니 통과했다. 테스트·제품 코드는 바꾸거나 생략하지 않았다. 원래 검증 환경을 복원한 전체 재실행 결과를 기록하며 새 기능의 RED로 해석하지 않는다.

추가 보류 Minor(실행자 발견): 다른 Windows Git 배치에도 견디는 테스트용 셸 탐색 개선. 현재 직접 PowerShell 경로의 검증은 유효하지만 Git Bash 경유도 항상 지원한다고 주장하지 않는다. 리뷰 Minor와 합쳐 경미한 후속 항목은 2건이다.

원래 Git/cmd 경로를 복원한 최종 전체 보안 재실행은 **185/185, exit 0**, 실패·취소·skipped 0으로 끝났다. Task 4 기록에도 실제 재실행 결과를 연결했다. 이번 로컬 대상은 기존 11파일+신규 정책 테스트/상세 계획 2파일=13파일이며, 이전 autoplan/테스트 계획 2문서의 상태 갱신은 별도다.

이번 구현은 아직 커밋·push하지 않았으며 미커밋 작업과 복구 기록을 보존한다. `finishing-a-development-branch`의 인계 원칙을 적용하되 승인 범위에 따라 브랜치를 유지한다. 공개/병합/배포 허가를 의미하지 않는다.

## 2026-09-28 T5 공개 전 노출 감사

[상세 보고서](../security/2026-09-28-public-exposure-audit.ko.md)를 작성했다. 원격 10브랜치·13 PR head·2 merge ref의 215커밋/1,250개 blob과 로컬 포함 합집합 239커밋/1,306개 blob, 현재 작업 파일을 검사했다. PR 13개·댓글 8개, Actions 122개 실행과 과거 재실행 2개 로그를 조회했다. artifact/릴리스/탐지된 GitHub 업로드 링크는 0개다.

실제 운영 secret 유출은 이번 범위에서 확정하지 못했다. 과거 JWT는 독립 검토로 합성 거부 테스트 데이터, 전화번호 패턴은 Git SHA/컨테이너 ID로 확인했다. 새 취약점이 없다는 보증은 아니다.

판정은 DONE_WITH_CONCERNS, 공개 보류다. 외부 Impeccable/modern-screenshot 복사본의 버전·라이선스 고지, Git 작성자 이메일 공개 결정, 자료 소유권·최종 노출 목록 확인이 남았다. fork 승인 조회는 비공개 제한 422, 신고/Pages 조회는 404, secret 보호는 null이라 활성으로 간주하지 않았다. 이 설정은 별도 원격 전환 절차에서 확인한다.

앱/DB/테스트/CI 코드는 변경하지 않았고 이번에 전체 verify를 재실행하지 않았다. 기존 사용자 .gitignore 변경도 보존했다. 커밋·push·공개·병합·원격 설정·실계좌 접근은 하지 않았다. 기존 P1은 계속 미종결이며 다음 제안은 라이선스/공개 범위 보완 후 최종 delta 감사다.

## 2026-09-28 외부 코드 고지 로컬 보완

사용자가 상세 계획을 승인하여 [외부 코드 고지](../../THIRD_PARTY_NOTICES.md)와 라이선스·NOTICE 원문 4개를 추가했다. Impeccable 105파일은 공식 스냅샷 `da99645a58400ed7acb201e6904f9413efd89c6e`와 일치하며 표시 3.9.1 태그와는 구분한다. modern-screenshot 4.7.0 MIT와 Platform Design Skills 파생 문서의 MIT 고지도 연결했다.

원문 4개 해시 일치·기존 외부 파일 105개 불변·로컬 링크 74개·승인한 10파일 외 변경 0을 검증했다. 독립 검토 Critical/Important/Minor 0건이며 Notion 기록도 재조회했다. 최종 근거는 [실행 기록](../superpowers/plans/2026-09-28-third-party-license-notices.md)에 있다. 앱 전체 테스트·DB·브라우저 검사는 이번 문서 전용 작업에서 재실행하지 않았다.

G2는 로컬 보완 상태이며 커밋·push 전이라 원격 미반영이다. 앱 전체 라이선스는 지정하지 않았고 `.gitignore` 등 기존 변경을 보존했다. G1 개인정보, G3 권리·최종 목록, P1 원격 보호는 계속 확인이 필요하다. 공개 전환·병합·배포는 하지 않았다.

## 2026-09-28 다음 단계 사전 점검 — 비공개 초안 PR 계획

원격은 PRIVATE이며 현재 기능 브랜치와 같은 head의 PR은 없다. 원격 main `9e2ff81` 이후 미푸시 커밋 8개가 있고, 이미 커밋된 변경만 21파일 +1,739/-25줄이다. 현재 미커밋 대상 22파일에 [전송 계획](../superpowers/plans/2026-09-28-private-review-handoff.md)을 더한 23파일을 검증·커밋하는 안을 작성했다. 사용자 `.gitignore` 수정은 제외한다.

권장은 비공개 유지 → 문서 상태 최신화 → 현재 후보 전체 검증 → 신규 noreply 커밋 → 기능 브랜치 push → 초안 PR·CI 확인이다. 실제 공개·보호 적용·병합·배포는 포함하지 않는다. 과거 이메일은 새 noreply로 지워지지 않으며 G1/G3/P1은 유지한다.

이번 턴은 읽기 점검과 계획 기록만 수행했다. 새로운 전체 테스트·stage·commit·push·PR 생성은 미실행이며 상세 계획의 승인 후 진행한다.

## 2026-09-28 비공개 초안 PR 실행 승인

후속 “진행하자” 요청으로 위 23파일과 기존 미푸시 8커밋의 검증·전송을 승인받았다. 현재 HEAD/main/PRIVATE/hooks/index를 재확인했고 사용자 `.gitignore`의 해시는 그대로다. T5 감사 완료·G2 로컬 반영과 G1/G3/P1 미종결을 운영 가이드·설계에 구분했다.

Node 22.15.1 / pnpm 11.9.0으로 현재 후보를 재검증한다. GitHub 과금 조회는 인증의 user scope 부족으로 HTTP 404였으며 권한·요금제를 변경하지 않았다. 추가 유료 사용 차단 여부 확인 전에는 push/PR을 실행하지 않는다. 공개·main 병합·배포는 승인 범위 밖이다.

재검증 결과: 보안 185/185, verify 1,149개(192+66+15+148+643+85)와 lint·타입·API/웹 빌드, 인증 coverage 643개·branches 825/825=100%, 최종 3명령 exit 0. 이 작업 트리에서 UTC 06:19:34~06:23:18에 실행한 결과이며 이전 통과 수치를 가져온 것이 아니다. 실제 DB·브라우저 E2E/hosted CI는 아직 미실행이다.

첫 verify에서는 route-wiring.test.ts:52가 5000ms timeout으로 실패했다(web 642통과/1실패, 당시 build/coverage 미실행). 같은 파일 단독 실행은 16/16, 해당 테스트 1427ms로 통과했고 동일 전체 재실행에서도 통과했다. 앱/테스트/제한값은 바꾸지 않았고 원인 미확정인 간헐 실패로 남긴다. Git 제외 실행 폴더에 첫 실패·마지막 성공을 분리 보존했다.

GitHub 무료 잔여량 또는 추가 과금 차단 확인 전에는 계획 Task 3/4를 보류한다. 현재 stage·commit·push·PR은 하지 않았으며 사용자 `.gitignore` 수정과 기존 8커밋을 보존한다.

독립 최종 리뷰: 신규 Critical/Important/Minor 0, 별도 집중 148/148 통과와 현재 23파일·원문 4개·외부 105파일·링크 113개 검증. 후보 내용은 비공개 초안 인계 가능하지만 전송 완료 또는 main 병합 준비 완료는 아니다. 기존 P1, API 필드 경로 축약·Windows 셸 탐색의 보류 Minor 2건, 간헐 timeout 원인 미확정은 유지한다. 원격 설정·hosted CI·실제 DB/E2E·공개 동의·소유권은 이 리뷰로 대체하지 않는다.

후속 사용자 답변 “유료사용 안되어있어”로 추가 유료 사용 비활성 상태를 확인하여 전송을 재개한다. 계정·PRIVATE·main 9e2ff81·hooksPath·파일 범위를 재조회했다. 결제 API 직접 검증으로 표현하지 않으며 유료 설정을 변경하지 않는다. 이 문서의 커밋 이전 시점에는 실제 push/PR은 아직 미실행이고, 그 결과는 Notion·Git 제외 실행 기록에 연결한다.
