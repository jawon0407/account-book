# 공개 저장소 보호 적용과 계좌 연결 개발 재개

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 일반 작업은 사용자 재승인 없이 순차 실행하고, 실제 권한·계약·비밀값·비용 선택이 필요한 경우만 사용자에게 알린다.

**Goal:** 공개 승인을 반영해 원격 보호를 검증하고 은행 연결 개발의 안전한 통합 기준을 마련한다.
**Architecture:** 기존 classic main 보호 설정을 그대로 사용한다. 공개 변경분 감사 → 공개/보호 read-back → 격리 거부 검증 → 정상 PR 통합과 main CI 순서다.
**Tech Stack:** GitHub REST/CLI, Node 22.15.1, pnpm 11.9.0, 한국어 Markdown/Notion.
**Spec:** [공개 보호 설계](../specs/2026-09-24-public-repository-branch-protection-design.md).

## 사용자 결정과 Global Constraints

- 2026-09-28 사용자가 과거 Git 이력의 개인 이메일·작성자 정보 공개를 수용하고 자료 공개 권한을 확인했다. G1 및 G3 소유자 확인은 이 답변으로 기록하되 값 자체는 문서에 복사하지 않는다.
- 사용자는 전체 개발 흐름의 일반 설계·구현·검증을 반복 승인 없이 진행하고 기능별 Notion 체크 상태를 계속 갱신하도록 요청했다. 기존 단계별 승인 대기는 이 운영 방식으로 대체한다. 완료하지 않은 작업을 완료로 바꾸라는 승인은 아니다.
- 무료 유지. 결제·유료 업그레이드·새 PAT 권한 확대·실계좌·운영 DB 변경·이력 재작성·force push·검사 우회는 하지 않는다.
- 기존 사용자 .gitignore 변경과 이전 실행 로그를 보존한다.
- 공개는 소스·Git 이력·PR·Actions 로그 공개이며 서비스 DB 공개/서비스 배포가 아니다. 다시 비공개로 바꿔도 복제된 사본은 회수할 수 없다.
- 라이선스 고지 5파일은 원격 feature/ci-merge-provenance의7ca4868에 있다. main 반영은 정상 PR #14 통합의 별도 완료 항목으로 추적하며, 과거 모든 커밋이 소급 수정됐다고 주장하지 않는다.
- 현재 보안 기준의 PR 요구·security-gate/Actions app15368·strict·관리자 적용·force/delete 금지를 완화하지 않는다.
- main에 의도적 불량 커밋을 보내는 거부 테스트를 하지 않는다. 앱과 분리한 무민감 fixture 브랜치에서만 실시한다.
- 실제 설정·필수 단계와 H/B/C를 대조한다. skipped/neutral은 품질 통과로 대체하지 않는다.
- 공개/보호/병합 단계 중 실패하면 현재 상태를 기록하고 다음 원격 변경을 멈춘다. 독립된 문서·설계 작업은 계속할 수 있다.

## Review Focus

1. 공개 감사 중 refs 변경: 최종 대상이 달라졌으면 재검사한다.
2. protection의 app/context/strict/admins 불일치: 보호 성공으로 기록하지 않는다.
3. draft 또는 head/base가 바뀐 PR: 과거 CI로 병합하지 않는다.
4. synthetic fixture 테스트 성공: 실제 main 보호 read-back 및 정상 main CI를 대체하지 않는다.
5. 사용자 공개 승인: 실계좌 연결·운영 데이터 변경·유료 실행 승인으로 확대하지 않는다.

## 파일 지도와 규모

최초 예상은 문서4~6파일, 180~300줄 수준이었다. 실제 API 422 보완으로 설정1·테스트1·운영 방식 가이드/설계 정정을 포함해 총10파일 범위가 됐다. 앱·DB·의존성 변경은 없다. 사용자 .gitignore는 제외한다.

- 신규: 이 실행 계획, docs/status/2026-09-28-public-protection-execution.ko.md.
- 갱신: docs/status/2026-09-24-project-map.ko.md, docs/status/2026-09-24-ci-merge-provenance.ko.md, docs/README.md.
- 원격: 저장소 visibility, main classic protection, rebase 병합 비활성, 외부 PR 실행 승인 정책, 무료 secret 보호·신고 기능을 조회/설정 후 검증.
- 내부 증거: .superpowers/public-audit/delta-20260928.json 및 .superpowers/public-protection/의 값 제거 기록. Git 제외 상태 유지.
- 기존 보호 대상 PR #14와 A1 PR #13의 통합은 각각 최신 CI·변경 범위 확인 뒤 정상 PR 경로로 한다. 보호 우회나 admin 강제 병합을 사용하지 않는다.

Task4 추가 범위: PR CI만 반복 실패한 원인을 조사해 Playwright의 보고서용 Git diff 수집이 전체 이력을 shallow로 변경함을 재현했다. 테스트 설정1파일·실제 runner 회귀1파일과 결과/운영 문서를 수정한다. 브라우저 검사나 보안 gate 자체는 변경하지 않는다. 이 새 동작 변경은 별도 독립 리뷰와 새 후보 CI 대상이다.

## Task 1: 최종 변경분 감사

**Inputs:** 이전 T5 감사 스냅샷, 사용자 G1/G3 확인, PR14 H7ca4868/B9e2ff81.
**Outputs:** 현재 공개 refs/새 객체/PR·댓글/추가 CI 로그/첨부 검증 기록.

- [x] 원격 상태 확인: PRIVATE; main protection/rulesets 조회는 무료 비공개 제한403. 공개 전 보호 활성으로 추정하지 않는다.
- [x] 이전 감사 이후 refs 3개 추가, 객체119개(commit10/tree56/blob53) 대조. 기존 일치6개 외 새 값 지문0.
- [x] PR14개·댓글8개·리뷰댓글0·릴리스0 검사에서 민감값 규칙 일치0.
- [x] 새 Actions 로그2개 합계860,770바이트 검사, 규칙 일치0·artifact0.
- [x] 감사 시작/종료 refs 동일. 기준 시각UTC07:55:18. 탐지 패턴 밖 비밀정보 부재까지 보증하지 않는다.
- [x] 공개 바로 전 동일 refs 및 라이선스 고지 원격 바이트를 다시 확인한다.

## Task 2: 공개와 기본 보호

**Inputs:** Task1 증거와 명시적 사용자 공개 확인.
**Outputs:** PUBLIC 및 main 보호, 외부 PR 정책, 무료 보안 기능의 read-back.

- [x] 공개 전 Actions를 잠시 정지하고 현재 설정을 기록했다. 실행 중 workflow가 없음을 확인했다.
- [x] 저장소 ID1302870990 확인 및 PUBLIC 전환.
- [x] 기존 classic 보호/ruleset 없음 확인 후 main 보호 적용. checks/security-gate app15368, strict/admins=true, reviews 객체/승인수0, force/delete=false, conversation resolution=true 재조회.
- [x] rebase=false; merge/squash=true 유지.
- [x] all_external_contributors 실행 승인, GITHUB_TOKEN 기본 read·PR 승인false 재조회.
- [x] 무료 secret scanning/push protection 및 private vulnerability reporting 활성·재조회. 유료 변경 없음.
- [x] Actions 복원·설정 스냅샷 저장. 전환 직후 잠금403은 isLocked=false 확인 후 재개했고, payload 중복422는 RED/GREEN 회귀로 교정했다.

## Task 3: 무민감 거부·정상 흐름

**Inputs:** 실제 main 보호 스냅샷.
**Outputs:** 별도 fixture에서 조건 미충족 변경 거부와 정상 PR 허용 증거.

- [x] feature/protection-validation-20260928 및 cases/advance 새 ref 사용. 기존 ref 덮어쓰기 없음, 부모 없는 합성 문서·workflow로 앱과 분리.
- [x] 실제 main과 동일한 보호 핵심값 적용·재조회.
- [x] PR 없는 직접 변경422, 누락/실패/취소/오래된 기준405 거부 확인. 각 기준 SHA 불변.
- [x] Actions app15368의 success·최신 base 확인 후 PR #16과 갱신한 #15 정상 통합. 앱 main9e2ff81 불변 확인.
- [x] 테스트 PR 용도 명시·Codex 연결. 보호를 제거하거나 우회하지 않았고 증거 보존을 위해 fixture 브랜치를 유지.

## Task 4: 정상 후보 통합과 기록

**Inputs:** PR14 최신 H/B/C·CI, 실제 보호, 실패/정상 검증.
**Outputs:** 최신 main과 main-provenance/security-gate 실제 실행 증거.

- [x] 기존 AI 독립 리뷰와 새 Playwright/API 계약 보완의 별도 독립 리뷰 완료. 미해결 Critical/Important 없음.
- [x] PR14를 ready로 전환해 SHA 고정 정상 merge. 이후 API 계약 보완 PR17도 보호를 유지해 정상 merge.
- [x] 첫 main36399193418 실패 시 A1 통합 보류. 최소 API 계약 보완 후 새 main e43260d/36400707374 실제 provenance·품질 성공 확인.
- [ ] PR13은 A1 보안 기반9파일의 독립 변경이다. 최신 main을 반영해 새 CI를 검증한 뒤 정상 통합한다. 이전 main 기준 CI를 그대로 재사용하지 않는다.
- [x] 문서/Notion에서 완료·미검증·보류를 구분했다. 전체 증거·독립 검토·main 실행 충족으로 서버 조건 강제 범위 P1 종결. UI/API 경로 독점·관리자 침해·실금융 운영 적합성은 제외.
- [ ] 10-A2 상세 설계·계획·RED/GREEN 구현으로 이어간다. 본 계획 완료가 계좌 연결 기능 완료는 아니다.

## 검증과 출처

- 최초 범위는 설정/문서 작업이었다. 실제 protection API 계약 회귀와 이후 Playwright Git 이력 훼손 회귀를 추가했다. 기존 security185/verify1149/DB22/Chromium10 증거는 후보7ca4868의 결과이며 새 후보에는 재검증한다.
- CSO 적용 범위는 공개 노출 변경분과 GitHub 설정이다. 전역 스킬 스캔·텔레메트리 전송·도구 업그레이드·앱 침투 테스트는 포함하지 않는다.
- [GitHub protection API](https://docs.github.com/en/rest/branches/branch-protection).
- [외부 PR 실행 승인 API](https://docs.github.com/en/rest/actions/permissions#set-fork-pr-contributor-approval-permissions-for-a-repository).
- [공개 전환 영향](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

AI 보조 감사는 전문 보안 감사/침투 테스트를 대체하지 않으며 금융정보 운영 출시 전 별도 전문 검토가 필요하다.
