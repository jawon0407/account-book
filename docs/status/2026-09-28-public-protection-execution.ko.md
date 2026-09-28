# 공개 저장소 보호 적용·개발 재개 기록

기준일: 2026-09-28. 앱 배포·실계좌 연결 완료 보고서가 아니다.

## 현재 결론

사용자가 Git 작성자 정보 공개 수용과 자료 공개 권한을 확인했다. 마지막 변경분 감사 후 `jawon0407/account-book`을 PUBLIC으로 전환하고 main 보호를 실제 적용했다. 무료 플랜을 유지했으며 결제·권한 확대·운영 DB 변경은 하지 않았다.

PR #14의 라이선스/CI 보완은 main에 정상 통합됐다(da17f4f, UTC08:44:41). 다만 main 전용 사후 검사에서 GitHub API 응답 계약 불일치가 발견돼 후속 보완 중이다. PR #13의 은행 보안 기반 통합은 이 문제가 해결될 때까지 보류한다. P1은 설정·PR 병합만으로 닫지 않고 실제 main 검사 성공까지 추적한다.

## 완료한 점검

| 항목 | 실제 결과 | 한계 |
| --- | --- | --- |
| 공개 직전 변경분 | refs3·객체119·신규 로그2(860,770바이트), 신규 민감값 후보0 | 탐지 규칙 밖 정보의 부재를 보증하지 않음 |
| 라이선스 | 후보7ca4868의 고지5파일 원격/로컬 바이트 일치 | main 반영은 PR 통합 단계 |
| main 보호 | PR 필수, security-gate/Actions app15368, strict·admins=true | UI/API만의 병합 경로 독점 증명은 아님 |
| 보호 세부값 | force/delete=false, 미해결 대화 차단, 타인 필수 승인0 | 1인 개발의 사람 독립 승인 강제는 없음 |
| 병합 방식 | merge/squash=true, rebase=false | rebase·merge queue 증빙은 미지원 |
| Actions | 모든 외부 기여자 실행 승인, 기본 토큰 read·PR 승인 불가 | workflow 변경은 최종 diff에서 별도 검토 |
| 무료 보안 | secret scanning·push protection enabled, 비공개 취약점 신고 enabled | 실제 키를 공개하는 탐지 실험은 하지 않음 |

공개 직후 GitHub의 `Repository has been locked` 403으로 후속 설정을 멈췄다. 읽기 API에서 isLocked=false를 확인한 뒤 같은 설정을 재시도했다. 일시적 전환 잠금으로 추정하며 정확한 플랫폼 내부 원인은 알 수 없다.

그다음 실제 API가 구형 `contexts=[]`와 `checks`의 동시 제출을 422로 거절했다. 중복 필드 회귀를 먼저 실패시킨 뒤 `checks`만 남겼다. 앱15368 결속과 보호 강도는 유지했다. 원격 적용 및 재조회가 성공한 형식으로 문서도 수정했다.

## 이번 검증

- 설정 회귀 RED: 20개 중1개 실패. 원인: 실제 요청 JSON의 불필요한 contexts.
- 설정 회귀 GREEN: 20/20 통과.
- 전체 `pnpm verify`: exit0. lint·타입·빌드와 테스트1,150개(legacy193 + contracts66 + DB단위15 + API148 + web643 + preflight85).
- 기존 후보7ca4868 PR CI: 실행36391522124, H7ca4868/B9e2ff81/C95e14e4, 원격 DB22·인증 브라우저10 통과 기록. 새 후보는 별도 CI가 필요하다.
- 실제 은행·운영 배포·실기기·전문 침투 테스트는 이번 검증에 포함되지 않는다.

## 기능별 다음 순서

### 정상 병합 후 GitHub API 계약 불일치

후보c4ba4a5의 push36398693308/PR36398697836은 각각 필수13단계 실제 성공했다. PR checkout C80b9810의 부모는 B9e2ff81/Hc4ba4a5와 일치했다. 보호 재조회·독립 리뷰 후 SHA를 고정해 정상 병합했으며 main은da17f4f다.

이후 main 실행36399193418의 `main-provenance`가 `MAIN_MERGE_EVIDENCE_UNAVAILABLE`로 실패했고, 후속 품질 검사도 의도대로 중단됐다. 실제 GitHub 2026-03-10 응답은 `merge_commit_sha`를 제공하지 않지만 검증기가 그 값을 요구했다. 테스트 대역이 최신 헤더에도 구형 필드가 있는 응답을 반환해 이 계약 불일치를 놓쳤다.

후속 feature/ci-github-evidence-contract에서 **지원 중인2022-11-28 계약을 명시적으로 고정**한다. SHA 일치·저장소·PR 목록/상세·실제 Git 부모 판정과 HTTP/시간/크기 제한은 바꾸지 않는다. 누락된 SHA를 생략하거나 자동 fallback하지 않는다. [공식 지원 표](https://docs.github.com/en/rest/about-the-rest-api/api-versions)에 따른 종료일은2028-03-10이다. 2027-09 정기 점검 또는 공급자 종료 안내 중 먼저 오는 시점에 별도 이관을 검토한다.

RED: 버전별 응답 shape 회귀34개 중2개 실패, 실제 GitHub 읽기 응답을 넣은 현행 파서도 동일 오류. GREEN: 집중114/114, 실제 PR #14 목록·상세 조회와 로컬 Git 부모를 대조해 정확한 결과da17f4f 확인. 로컬 읽기 probe는 GitHub CLI 인증을 사용했으며 Actions 토큰 경로까지 검증했다고 주장하지 않는다. 전체 `pnpm verify`도 exit0, lint·타입·빌드 및1,153개(195+66+15+148+643+86) 성공. 독립 리뷰·후속 PR·main 사후 실행은 별도 완료 항목이다.

### PR에서만 실패하던 이력 검사 원인과 수정

후보 `dbe910f`의 push 실행36396500422는 성공했지만 PR 실행36396505166의 attempt1·2는 마지막 범위 검사에서 `SHALLOW_REPOSITORY_UNSUPPORTED`로 실패했다. 앞선 전체 검증·커버리지·DB·브라우저·의존성 단계는 통과했다. 실패를 삭제하거나 단순 재실행 성공으로 대체하지 않는다.

전체 이력을 가져오는 checkout 자체는 정상이었다. 격리 실행36397514031에서 같은 PR merge commit으로 checkout·설치·legacy·범위 검사까지 성공했고, 설치된 Playwright1.61.1의 Git 정보 플러그인에서 원인을 확인했다. PR 이벤트의 base SHA가 있으면 보고서용 diff 수집이 `git fetch origin <base> --depth=1`을 실행한다. 이 과정이 마지막 보안 검사 전에 저장소를 shallow 상태로 만들었다.

변경 범위는 `tests/e2e/playwright.config.ts`의 보고서 메타데이터 설정과 `playwright-config.test.ts`의 회귀 검증이다. 실제 브라우저 테스트, 전체 이력 보안 검사, checkout 깊이는 바꾸지 않는다. `captureGitInfo: { commit: false, diff: false }`로 불필요한 보고서용 소스·작성자 복제도 막는다. 이 설정의 CI 기본 동작은 [Playwright 공식 문서](https://playwright.dev/docs/api/class-testconfig#test-config-capture-git-info)를 참조한다.

회귀는 문자열 검색이나 Git mock이 아니다. 테스트가 만든 3개 커밋의 임시 저장소와 `file://` origin, 합성 PR 이벤트에서 실제 Playwright runner를 실행한다. RED에서는 정상 이력이 shallow로 변경됐고, 수정 후 GREEN에서는 3개 커밋과 전체 이력이 보존되며 보고서에 gitDiff/gitCommit이 없는 것을 확인했다(2/2). 실제 은행·브라우저·DB 접근은 이 회귀 안에서 하지 않는다.

수정 후 `pnpm verify` exit0: lint·타입·빌드 및 1,151개(193+66+15+148+643+86) 통과. 사용자 `.gitignore` 변경은 그대로 보존하고 커밋에서 제외한다. 새 원격 CI·main 통합은 이 로컬 성공과 구분해 별도 기록한다.

### 보호 조건의 실제 거부·정상 검증

앱 이력과 연결되지 않은 합성 문서·workflow만으로 `feature/protection-validation-20260928` 브랜치를 만들고 main과 같은 핵심 보호값을 적용했다. [검증 PR #15](https://github.com/jawon0407/account-book/pull/15)와 [기준 갱신 PR #16](https://github.com/jawon0407/account-book/pull/16)은 main 대상이 아니다.

| 조건 | 관측 결과 |
| --- | --- |
| PR 없는 직접 변경 | 422, PR 및 필수 검사 요구, 기준 SHA 불변 |
| 필수 검사 없음 | 405, 필수 검사 expected, 기준 SHA 불변 |
| 실제 Actions 검사 failure | 실행36395806167, 405 failing, SHA 불변 |
| 실제 Actions 검사 cancelled | 실행36396021421, 405 cancelled, SHA 불변 |
| 이전 기준에서 success지만 base 갱신됨 | mergeable_state=behind, 405, SHA 불변 |
| 정상 검사·최신 기준 | PR #16·갱신 후 #15 정상 merge 성공, 앱 main9e2ff81 불변 |

합성 fixture는 GitHub 서버 조건을 검증하며 앱 전체 품질을 대신하지 않는다. 실제 금융정보·운영 키·비용 기능은 사용하지 않았다. 테스트 브랜치는 증거 보존을 위해 보호를 유지한다.

1. 격리 fixture에서 직접 변경/검사 누락·실패·취소/오래된 기준 차단과 정상 PR 통합을 검증한다. main에 의도적 실패 커밋을 보내지 않는다.
2. PR #14의 새 후보를 검증·통합하고 main CI를 확인한다.
3. A1 PR #13에 최신 main을 반영해 재검증·통합한다.
4. A2: 은행 연결 요청·동의·암호화 자료 DB, 사용자 격리, 일회성 원자 처리, 만료 정리, 공유 요청 제한을 구현한다.
5. A3 API → A4 웹 → A5 통합 검증 → A6 공식 KFTC 테스트 연결 순서로 진행한다. 이후 거래 수집·분류/메모·별도 모바일·동기화로 확장한다.

진행 상태는 [Notion 기능별 보드](https://app.notion.com/p/817d15a21e174eac86a7d3608a21b457)의 08·10·20·21번과 함께 갱신한다. 구현, 검증, 병합, 운영 사용 가능을 하나의 완료 표시로 합치지 않는다.

## 사용자에게 별도 알릴 항목

반복적인 설계·구현 승인은 요청하지 않는다. 실제 비용·계약·금융기관 자격·실계좌 동의·운영 비밀값 입력·출시 동의는 사용자 결정이 필요하다. 해당 조건을 만나도 독립적으로 가능한 개발을 함께 진행하며, 운영 검증이 안 된 부분을 완료로 표시하지 않는다.

AI 보조 점검은 전문 보안 감사/침투 테스트를 대체하지 않는다. 관리자 계정 침해, workflow 자체의 악성 수정, skipped/neutral 체크가 허용될 수 있는 플랫폼 특성은 별도 절차와 잔여 위험으로 관리한다.
