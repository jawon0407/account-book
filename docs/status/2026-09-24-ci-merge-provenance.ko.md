# 정상 PR 병합 증빙 CI 구현 기록

## 현재 상태

2026-09-24 사용자가 승인한 1번 방식(현재 세션 순차 구현 + 마지막 독립 리뷰)으로 진행한다. 기능 브랜치는 `feature/ci-merge-provenance`, 기준 main은 `9e2ff81`이다. 앱 기능·인증 런타임·DB·의존성은 변경하지 않는다. 사용자 `.gitignore`의 `.gstack/` 추가는 보존하고 커밋 대상에서 제외한다.

현재 구현의 전체 로컬 검증을 통과했으며 독립 리뷰 대기 상태다. hosted CI/post-merge 검증은 별도다. push·PR 생성/병합·운영 배포·실계좌 접근은 이번 승인에 포함하지 않는다. 기존 PR #13도 변경하지 않는다.

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
- 독립 리뷰는 전체 로컬 검증과 Task 4 커밋 후 수행하며 결과와 판단을 이 문서에 추가한다.

## 다음 순서

전체 verify → 독립 리뷰 → 필요한 중요 수정/재검증 → 기능 브랜치 push/PR 승인 요청 → 최신 head CI → 별도 병합 승인 → 새 main 이벤트 확인. 이후 기존 로드맵의 10-A2 계좌 연결 DB 설계·구현으로 돌아간다.
