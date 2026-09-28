# 공개 저장소 보호 로컬 보완 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 세션에서 순차 구현한 뒤 독립 최종 리뷰를 받는다.

**Goal:** 승인된 A안에 맞춰 로컬 보호 설정·검사·한국어 운영 문서를 일치시키되 원격 보호가 이미 적용됐다고 오해하지 않게 한다.

**Architecture:** 기존 classic 보호 JSON과 Node 테스트를 재사용한다. 새 정책 테스트는 별도 파일로 분리하고 기존 workflow 실행 순서는 유지한다. 공개 전수 점검과 실제 원격 변경은 이 로컬 구현 묶음 이후 별도 단계다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, node:test, JSON, Markdown, 기존 GitHub Actions.

**Spec:** [기본 설계](../specs/2026-09-24-public-repository-branch-protection-design.md), [승인된 autoplan 보완](2026-09-27-public-repository-autoplan-review.md), [테스트 계약](2026-09-28-public-repository-test-plan.md).

상태: 2026-09-28 Task 1~4 로컬 보완·검증·독립 리뷰 완료. 기존 원격 P1 미종결, 경미 후속 2건 보류. 원격 작업 및 커밋은 미실행.

## Global Constraints

- 무료 플랜 유지. PR 필수, required_approving_review_count=0, 최종 사용자 확인 유지.
- 목표는 PR·필수 검사 조건 미충족 main 변경 차단이다. GitHub UI/API만 사용했다는 경로 증명은 아니다.
- 기존 classic JSON 한 개를 사용한다. 새 ruleset·서비스·PAT·GitHub App·의존성·DB 변경 없음.
- 필수 검사는 security-gate, strict=true. main-provenance는 PR 필수 검사로 지정하지 않는다.
- enforce_admins=true, allow_force_pushes=false, allow_deletions=false, required_conversation_resolution=true.
- required_linear_history=false. merge/squash 지원, rebase 비활성화는 후속 승인된 원격 단계에서만 한다.
- 실제 secret·금융 데이터 사용 금지. 기존 사용자 .gitignore 변경은 수정하거나 stage하지 않는다.
- 공개 전환·원격 설정 변경·자원 생성·push·PR 생성/병합·배포·이력 재작성은 이번 실행 범위가 아니다.
- 앱 ID와 같은 이름의 체크는 검사 내용 자체의 신뢰를 증명하지 않는다. workflow·보안 스크립트·package scripts 변경은 최종 후보 diff 확인 대상이다.
- P1은 로컬 테스트만으로 종결하지 않는다. 원격 보호·정상/거부 흐름·독립 검토 증거가 필요하다.

## Review Focus

1. 설정이 null이거나 출처가 임의 값이면 필수 보호가 빠진다 → Task 1의 실제 JSON·변형 입력 검사.
2. PR head H와 CI checkout C를 같다고 강제하면 정상 merge-ref 검사를 오판한다 → Task 2의 H/B/C·run/event 양식 검사.
3. 간접 병합의 PR 연관성을 전송 경로 증명으로 오해할 수 있다 → Task 2의 부모 1개/2개 특성화 테스트.
4. same-app 체크 및 skipped/neutral을 무조건 신뢰하면 변경된 검사 정의를 놓친다 → Task 2 기존 실행 조건 회귀 유지, Task 3 수동 정의 검토·플랫폼 한계 명시.
5. 설정 파일이나 빈 체크 목록을 원격 보호 완료로 오인할 수 있다 → Task 3 상태별 운영 절차와 Task 4 미실행 항목 분리 검증.

## 확인된 기준과 규모

- 작업 위치: `.worktrees/ledger-public-contracts`, 브랜치 `feature/ci-merge-provenance`, HEAD `7ecbcc00718f1027dc2690f6e099f9cfc02fa329`.
- 원격 main 확인 SHA: `9e2ff81b88c8f6290f68c9bebb1b4bb43493cac5`. 오래된 로컬 main을 비교 기준으로 사용하지 않는다.
- 2026-09-28 GitHub check-runs 읽기 조회: `security-gate`, `github-actions`, app_id **15368**, 위 main SHA, conclusion **failure**.
- 출처: [해당 검사 실행](https://github.com/jawon0407/account-book/actions/runs/35832112508/job/107086890347). 이 증거는 앱 식별자 확인이며 현재 브랜치의 통과 증거가 아니다. 원격 적용 직전 다시 확인한다.
- 중간 규모. 전체 후속 후보 14파일 중 이번 상세 계획을 포함한 로컬 묶음은 13파일, 공개 전수 점검 보고 1파일은 다음 단계다. 기존 autoplan/테스트 계획 기록 갱신은 별도다.

| 파일 | 현재 규모 | 책임 / 변경 예상 |
| --- | --- | --- |
| `.github/settings/main-protection.json` | 18줄 | 필수 검사·일반 merge 지원, 10~20줄 |
| `scripts/security/branch-protection-policy.test.mjs` | 신규 | JSON 정책 회귀, 70~130줄 |
| `scripts/security/workflow-policy.test.mjs` | 562줄 | PR 양식 계약만 보완, 15~35줄 |
| `scripts/security/merge-evidence.test.mjs` | 121줄 | 연관성 검사의 한계, 20~40줄 |
| `.github/pull_request_template.md` | 34줄 | 후보·실행·본인 확인, 10~25줄 |
| `docs/security/free-plan-compensating-controls.md` | 128줄 | 시작/상태/실패/전환 절차, 70~120줄 |
| `SECURITY.md` | 62줄 | 보장·보고 채널 상태, 5~15줄 |
| `README.md` | 기존 | 운영 문서 진입 링크, 2~5줄 |
| `docs/README.md` | 60줄 | 문서 지도, 5~15줄 |
| `docs/superpowers/specs/2026-09-24-ci-merge-provenance-design.md` | 127줄 | 연관성 보장 경계, 10~25줄 |
| `docs/superpowers/specs/2026-09-24-public-repository-branch-protection-design.md` | 109줄 | 승인된 보완, 20~40줄 |
| `docs/status/2026-09-24-ci-merge-provenance.ko.md` | 81줄 | 실제 검증·남은 P1, 20~40줄 |
| 이 상세 실행 계획 | 신규 | 실행 체크리스트·검증 기록 |

`.github/workflows/security-gate.yml`은 읽기 검토만 한다. canonical digest를 바꾸지 않는다. 신규 결함으로 수정이 필요하면 먼저 범위와 이유를 알린다.

### Task 1: 목표 보호 설정 고정

**Files:** Create `scripts/security/branch-protection-policy.test.mjs`; Modify `.github/settings/main-protection.json`.

**Interfaces:** JSON을 UTF-8로 읽는 로컬 Node 테스트만 추가한다. 테스트 내부 `assertApprovedProtection(policy: object): void`는 승인된 전체 정책과 비교하여 불일치 시 AssertionError를 던진다. 새 런타임 API는 없다.

- [x] **1. RED 테스트 작성.** 실제 JSON에 아래 계약을 검사한다. 기존 나머지 필드도 유지한다.

```js
assert.deepEqual(policy.required_status_checks, {
  strict: true, contexts: [],
  checks: [{ context: "security-gate", app_id: 15368 }],
});
assert.equal(policy.required_pull_request_reviews.required_approving_review_count, 0);
assert.equal(policy.required_linear_history, false);
```

  승인된 fixture를 복제해 required_status_checks 누락/null, strict=false, checks 비움/중복/다른 context, app_id 누락/-1/0/문자열/다른 양수, PR 객체 null, 승인 수 1, admins=false, force/delete=true, conversation=false, linear=true를 각각 변형한다. 각 `assert.throws(() => assertApprovedProtection(mutant))`를 확인한다. 이 테스트는 정책 회귀이며 서버 적용 검사라고 이름 붙이지 않는다. 함수 주석에는 입력 정책과 예외 의미를 쓴다.
- [x] **2. RED 확인.** `node --test scripts/security/branch-protection-policy.test.mjs` → 현재 null/linear 설정 때문에 실패해야 한다. 환경 오류를 의도한 RED로 기록하지 않는다.
- [x] **3. 최소 설정 변경.** required_status_checks를 위 계약으로, required_linear_history를 false로 변경한다. 원격 API 쓰기 없음.
- [x] **4. GREEN 확인.** 같은 명령 → 모든 테스트 통과. 예상한 정책이 아닌 테스트를 느슨하게 만들어 통과시키지 않는다.
- [x] **5. diff 점검.** Task 1 두 파일만 변경했는지 확인하고 결과를 이 문서에 기록한다. 커밋은 사용자 승인 범위를 확인한 뒤 명시 파일만 대상으로 한다.

### Task 2: 후보 증거와 연관성의 한계

**Files:** Modify `scripts/security/workflow-policy.test.mjs`, `scripts/security/merge-evidence.test.mjs`, `.github/pull_request_template.md`.

**Interfaces:** 기존 `prove(fixture)`와 `mainFixture()`를 사용한다. PR Markdown은 H/B/C, run ID/event/URL, 최종 본인 확인 및 무효화 조건을 제공한다. 증빙 production 함수·workflow는 변경하지 않는다.

- [x] **1. PR 양식 RED 테스트 작성.** 기존 한국어 UTF-8 계약에서 SHA 동일 문구·무료면 항상 보호 불가 문구를 제거하고 다음 줄의 존재를 확인한다.

```js
for (const line of ["- PR head SHA (H):", "- base SHA (B):", "- CI checkout SHA (C):",
  "- run ID:", "- event:", "- run URL:", "- 최종 본인 확인자/시각:"]) {
  assert.ok(lines.includes(line), `missing evidence field: ${line}`);
}
assert.ok(!source.includes("PR head SHA와 CI가 검사한 SHA가 같다."));
```

  체크리스트에 `H/B/C와 실행 결과의 대응을 확인했다.`, `head/base/검사 정의가 바뀌면 이전 확인은 무효다.`, `원격 main 보호와 secret 보호의 실제 상태를 각각 확인했다.`를 필수 한국어 줄로 추가한다. workflow·보안 scripts·package scripts diff 확인도 필수로 둔다.
- [x] **2. RED 확인.** `node --test scripts/security/workflow-policy.test.mjs` → 새 양식 필드 부재로 실패, 기존 workflow 계약은 그대로 유지되어야 한다.
- [x] **3. PR 양식 수정.** 위 필드를 넣고 H는 PR 코드, B는 검사 기준 base, C는 실제 검사 checkout이라고 설명한다. PR merge-ref에서는 H와 C가 다를 수 있다. 필드 작성은 자동 인가 시스템이 아닌 사람의 확인 절차임을 쓴다.
- [x] **4. 특성화 테스트 추가.** `merge-evidence.test.mjs`에 `records association for single-parent indirect merge without proving transport`를 추가한다. fixture의 candidate/head와 pullRequest/head SHA를 after로 맞추고 parents=[before]일 때 `assert.equal(prove(f).prNumber, 12)`를 검사한다. 부모 2개 fixture도 같은 결과를 검사하며 로컬 생성·전송 여부를 구별할 입력이 없음을 주석에 기록한다.
- [x] **5. GREEN 확인.** `node --test scripts/security/workflow-policy.test.mjs scripts/security/merge-evidence.test.mjs` → 통과. 특성화 테스트는 기존 동작 기록이라 처음부터 통과할 수 있으며 허위 RED를 만들지 않는다. main 사후 failure/cancelled/skipped 거부 테스트를 제거하지 않는다.
- [x] **6. diff 점검.** workflow digest와 production 증빙 함수가 바뀌지 않았는지 확인하고 결과 기록. 커밋은 별도 승인 범위에 따른다.

### Task 3: 초급 개발자용 운영 절차 일치

**Files:** 위 파일 지도에 기재된 운영 가이드, SECURITY, README 2개, 설계 2개, 상태 문서.

**Interfaces:** Task 1 목표 정책과 Task 2 증거 용어를 그대로 사용한다. 현재/목표/미검증을 표로 구분하며 새 기능·명령 도구는 만들지 않는다.

- [x] **1. 기존 모순 검색.** `rg -n "직접 push|무료|SHA|보호|간접 병합"`으로 대상 문서만 조사한다. 역사 기록은 삭제하지 않고 날짜 있는 현재 설명으로 교정한다.
- [x] **2. 운영 가이드 수정.** 준비(도구/인증)→읽기 확인→후보별 본인 확인→실패 복구 순서로 쓴다. `gh auth status`, `gh pr view <번호> --json headRefOid,baseRefOid,url`, `gh pr checks <번호>`, `gh pr checks <번호> --required`의 용도와 체크 없음/pending/failure/권한 오류를 구분한다. 보호 API 조회 403/404는 성공이 아니라 미확인이다. 실제 secret 출력 명령을 넣지 않는다.
- [x] **3. 공개 전환 절차 교정.** 최종 refs/이력/PR/댓글/로그/artifact/첨부/라이선스 목록 확정부터 동결, 전환 직전 delta 확인, 접근 불가면 중단. 비밀값 발견 시 폐기·교체 우선, 이력 재작성 별도 승인. 공개·분기 보호·secret 보호 완료 조건을 각각 둔다.
- [x] **4. 신뢰·장애 한계 기록.** same-app/이름/digest는 승인된 정의를 증명하지 않으며 skipped/neutral의 플랫폼 취급을 별도로 설명한다. 사후 API 장애로 품질 검사가 미실행될 수 있고 복구 후 같은 이벤트를 수동 재실행한다. 자동 우회 없음.
- [x] **5. 나머지 문서 연결.** 루트 README→운영 가이드→설계/상태 링크를 연결한다. 보안 보고 채널은 실제 사용 가능 여부를 확인하기 전 활성이라고 쓰지 않는다. 공개 저장소 자체가 금융 DB 공개를 뜻하지 않지만 이력 속 개인정보 노출은 별개라고 설명한다.
- [x] **6. 문서 검증.** 링크 대상 존재, H/B/C 용어 일치, 현재 상태와 목표 혼용 없음, 무단 원격 쓰기 예제 없음 확인. 기록된 과거 테스트와 이번 실행 결과를 분리한다. 문서만을 위한 무의미한 테스트 수 확대는 하지 않는다.

### Task 4: 회귀와 독립 최종 검토

**Files:** Update 이 계획, CI 상태 문서, 필요한 경우 발견된 결함의 원래 담당 파일.

**Interfaces:** Task 1~3 전체 diff가 입력. 출력은 명령/시각/종료 코드/통과·실패·미실행 결과 및 남은 위험 목록이다.

- [x] **1. 집중 회귀.** `pnpm test:security-gate` → 종료 0, 실패/취소 0. 이전 164개 수치를 새 실행 결과로 복사하지 않는다.
- [x] **2. 전체 검증.** `pnpm verify` → lint/typecheck/test/build 전체 종료 0. 실패하면 원인과 영향 범위부터 확인하며 관계없는 대규모 수정을 하지 않는다.
- [x] **3. 인증 커버리지.** `pnpm --filter @account-book/web test:coverage` → 기존 인증 분기 100% 기준 유지. 실제 설정된 범위와 보고서로 확인하고 전체 앱 100%라고 확대하지 않는다.
- [x] **4. 환경 경계 확인.** DB/E2E는 명시적으로 준비된 폐기용 환경이 없으면 미실행으로 기록한다. 운영 DB·실계좌·실제 금융정보를 대체 환경으로 사용하지 않는다.
- [x] **5. 독립 리뷰.** requesting-code-review 절차로 새 검토자 한 명에게 최종 diff·설계·테스트 증거를 전달한다. 리뷰는 읽기 전용, 원격 변경 권한 없음. 중요한 지적은 수정 후 관련 검사를 다시 실행한다.
- [x] **6. 완료 보고.** 실제 파일/줄 수, 새 검증 결과, 잔여 P1, 미실행 원격 항목을 기록하고 Notion 개발 기록에도 요약한다. push/merge/public 전환은 하지 않는다.

## 후속 단계와 완료 경계

로컬 완료 뒤 T5 공개 대상 전수 점검 보고를 별도로 작성한다. 보고가 통과해도 실제 공개·보호 적용·거부 fixture 자원 생성은 최종 승인을 받고 진행한다. 보호 적용 후 원격 read-back, 승인된 PR CI, 정상/거부 흐름, 독립 확인 전에는 P1이 닫히지 않는다. 그 다음 제품 개발은 10-A2(은행 연결 DB·최소 권한)이며 이번에 모바일·실은행 API를 구현하지 않는다.

2026-09-28 T5 승인 후 [노출 감사 보고](../../security/2026-09-28-public-exposure-audit.ko.md)를 작성했다. 조회 가능한 원격 이력·PR·댓글·124개 실행/재실행 로그를 검사했지만 라이선스 고지·작성자 정보 공개 결정·최종 동결이 남아 공개 gate는 보류다. T5를 전체 공개 승인 완료로 표시하지 않는다. 원격 변경과 이력 정리는 하지 않았다.

## 자체 점검 및 실행 기록

- 설계 대응: 설정 §5→Task 1, 보장 §2/후보 확인→Task 2, 공개 §4/오류 §6→Task 3, 검증 §8→Task 4. 원격 §8은 명시적 후속 단계다.
- 단계/타입: 정책 테스트의 입력은 JSON object, 증빙 fixture와 기존 prove 반환값은 변경 없음. H/B/C 용어 전 문서 통일.
- Review Focus 다섯 항목을 Task 1~4에 배정했다. 서버 실제 동작은 로컬 테스트로 증명하지 않는다.
- 분량: 구현 body를 설계하지 않고 필수 값·검증과 작업 순서를 고정했다.
- 2026-09-28 계획 작성 당시에는 문서·출처 확인만 수행했다. 이후 사용자 구현 승인으로 Task 1~3을 실행했다.
- 기준선 보안 164/164, 정책 RED 18통과/1실패→GREEN 19/19, 양식 RED 16/1→양식·증빙 집중 97/97. 간접 병합 2건은 특성화 테스트다.
- 문서 9파일의 로컬 링크 81개 존재 확인. 인증 coverage 643개 통과, branches 825/825=100%, statements 889/892, functions 195/196, lines 720/722. 전체 verify 1,149개와 lint/타입/API·웹 빌드 통과(exit 0). 독립 리뷰는 신규 Critical/Important 0, Minor 1이며 기존 P1 유지.
- 이번 요청은 구현이므로 커밋·push·원격 변경은 하지 않고 작업 트리와 기록을 보존한다.
- 최종 보안 회귀는 경로 복원 후 185/185(exit 0), 실패·취소·skipped 0. 기록 래퍼의 pnpm 탐색 실패(exit127)와 Git Bash 경유 hook 1건 실패(184/185)는 원인 조사·재현 기록과 구분한다. 테스트 자체는 수정/생략하지 않았다.
- 보류 Minor 2건: 운영 가이드 read-back 응답 키 표기의 정확성(리뷰), 기존 Windows hook 테스트의 Git 설치 경로 가정(실행자). 상세 원인과 후속은 결과 문서 참조.
- 독립 검토 제외 항목에 대한 판단: 원격 보호/앱/rebase는 P1 유지(오판 시 무보호 main), 전수 노출/권리는 공개 보류(오판 시 회수 불가 노출), secret 보호는 별도 미검증(오판 시 유출 방어 공백), hosted/DB/E2E는 로컬 대체 금지(오판 시 통합 실패 누락), 사용자 .gitignore는 제외·보존(오판 시 무단 전송).
- 실제 대상: 기존 11파일 + 신규 정책 테스트/상세 계획 2파일 = 13파일. 이전 autoplan·테스트 계획 2문서는 상태 기록 갱신으로 별도다. 새 앱 코드/DB/의존성/워크플로 변경 0. 미커밋 상태라 작업 폴더와 검증 로그를 지우지 않는다.
