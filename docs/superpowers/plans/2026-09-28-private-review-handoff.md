# 비공개 검증·커밋·초안 PR 인계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 기존 현재 세션 순차 실행 방식을 유지하며 최종 독립 검토를 받는다.

**Goal:** 기존 보안 보완과 라이선스 고지를 검증한 뒤 현재 비공개 저장소의 기능 브랜치와 초안 PR로 인계한다. 공개·병합은 하지 않는다.

**Architecture:** 기존 브랜치의 미푸시 8커밋을 보존하고, 허용 목록의 미커밋 파일만 추가 커밋한다. 검토·전송 단계와 되돌릴 수 없는 공개 전환을 분리한다.

**Tech Stack:** Git, GitHub CLI, Node 22.15.1, pnpm 11.9.0, 기존 CI/보안 테스트, Markdown.

**Spec:** [공개 보호 설계](../specs/2026-09-24-public-repository-branch-protection-design.md), [노출 감사 G1/G2/G3](../../security/2026-09-28-public-exposure-audit.ko.md), [작업 변경 절차](../../guides/change-workflow.ko.md).

상태: 2026-09-28 로컬 재검증·독립 리뷰 완료. 사용자가 “유료사용 안되어있어”로 추가 유료 사용 비활성 상태를 확인하여 Task 3/4를 재개한다. PRIVATE 유지·기존 8커밋 포함·신규 noreply·23파일 명시적 커밋·초안 PR 범위이며 main 병합·공개·보호 변경·배포는 제외한다.

## Global Constraints

- 대상은 `jawon0407/account-book`, `feature/ci-merge-provenance` → `main` 초안 PR 하나다. 다른 PR·브랜치·태그를 변경하지 않는다.
- 저장소는 PRIVATE 유지. 공개 전환, 병합/자동 병합, 보호 적용, rebase 설정 변경, 임시 보호 브랜치 생성, secret canary, 배포, 결제는 제외한다.
- 기존 Git 이력을 재작성하지 않고 force push, reset, hook 우회, 검사 삭제·완화를 하지 않는다.
- 앱·DB·의존성·외부 스킬 코드는 새로 수정하지 않는다. 아래 기존 변경을 검증·전송하는 작업이다.
- 사용자 `.gitignore`의 `.gstack/` 추가 1줄은 수정·stage하지 않는다. 미추적 파일까지 포함하는 `git add .` / `git add -A`는 사용하지 않는다.
- 원본 LICENSE/NOTICE 바이트, 앱 라이선스 미지정, Impeccable live 실행 보류를 유지한다.
- 신규 커밋에만 GitHub noreply를 명령 단위로 지정한다. 전역/저장소 Git 설정과 과거 author/committer는 바꾸지 않는다.
- G1 개인정보·G3 권리/최종 공개 목록·P1 원격 보호는 초안 PR/CI 성공으로 닫지 않는다. 고지 역시 기능 브랜치 반영과 main 반영을 구분한다.
- 실계좌·운영 DB·실제 토큰을 테스트에 쓰지 않는다. 검사 실패·플랜 한도·권한 거부는 기록하고 중단하며, 비용 한도를 늘리지 않는다.

## Review Focus

1. 허용 목록 밖 사용자 변경을 같이 stage할 위험 → Task 1/3에서 index 목록과 `.gitignore` 불변을 대조한다.
2. 라이선스만 push한다고 오인할 위험 → Task 1/4에서 기존 미푸시 8커밋과 원격 후보 SHA까지 명시한다.
3. 새 커밋에도 개인 이메일을 추가할 위험 → Task 3에서 author/committer 이메일을 출력 없이 정확한 noreply와 비교한다. 과거 주소 제거로 주장하지 않는다.
4. 이전 테스트 또는 다른 SHA의 CI를 재사용할 위험 → Task 2/4에서 새 로컬 결과와 실제 후보의 H/B/C·run/event를 구분한다.
5. 초안 PR·고지 반영을 공개/보호/병합 완료로 오인할 위험 → Task 4에서 PRIVATE·isDraft·base/head·main 불변과 열린 조건을 확인한다.

## 1. 현재 확인한 사실

- HEAD: `7ecbcc00718f1027dc2690f6e099f9cfc02fa329`. 원격 main 및 merge-base: `9e2ff81b88c8f6290f68c9bebb1b4bb43493cac5`.
- 현재 기능 브랜치는 원격에 없고 동일 head의 PR도 없다. 원격 브랜치 10개와 로컬 origin/main을 읽기 대조했다.
- 미푸시 커밋은 8개다. 원격 main 대비 이미 커밋된 변경은 21파일, +1,739/-25줄이다. 라이선스만 전송하는 작업이 아니다.
- 기존 미커밋 대상은 `.gitignore` 제외 22파일이다. 추적 파일 diff +237/-39줄, 미추적 11파일 1,422줄이다. 이 계획을 포함하면 커밋 허용 목록은 23파일이다.
- 실제 광고된 원격 refs를 제외한 현재 HEAD의 새 Git 객체는 79개다. 그 경로 목록에서 `.env`, DOCX/DB/덤프/압축/이미지 후보는 없었다. 경로 검사만으로 secret 부재를 보증하지 않는다.
- 저장소 PRIVATE, 로컬 hooksPath는 `.githooks`. Git 이메일은 설정돼 있으나 GitHub noreply는 아니다. 개인 주소 원문은 기록하지 않는다.
- API로 확인한 로그인은 `jawon0407`, 계정 ID는 `71521075`, 생성일은 2020-09-18이다. 공식 규칙에 따른 신규 커밋용 주소는 `71521075+jawon0407@users.noreply.github.com`이다.
- 라이선스 원문·105파일·독립 리뷰는 직전 작업의 결과다. 이번 커밋/전송 후보 전체의 fresh 검증은 아직 수행하지 않았다.

## 2. 대안과 선택

| 방식 | 장점 | 단점·위험 | 제안 |
| --- | --- | --- | --- |
| 비공개 상태에서 기존 보안+고지를 한 초안 PR로 준비 | 이미 진행한 이력 보존, 공개 전에 CI·검토 자료 확보 | PR에 기존 8커밋도 포함, 아직 main 보호는 미해결 | 권장 |
| 고지만 main 기준 새 브랜치로 분리 | 첫 PR 범위가 작음 | 새 분리 작업과 문서 참조 정리 필요, 기존 보안 작업은 그대로 남음 | 별도 요청 시 계획 |
| 공개 전환부터 수행 | 무료 공개 보호 설정을 먼저 시작 가능 | G1/G3 미확인, 복제된 이력·로그 회수 불가 | 현재 진행하지 않음 |

무료 비공개 저장소도 초안 PR을 만들 수 있다. 다만 CI의 실제 실행 가능 여부는 계정 한도·플랫폼 상태에 따라 확인한다. 사용량·유료 기능을 임의 변경하지 않는다.

## 3. 파일 지도와 규모

이번 새 작성은 이 계획 128줄과 진행 기록 8줄이다. 승인 후에는 기존 상태를 최신화할 문서만 약 10~25줄 수정하고, 이미 구현한 아래 파일을 검증·커밋한다. 새 런타임 기능 코드는 0줄이다. 전체 전송 규모와 이번 신규 작성량을 혼동하지 않는다.

| 구분 | 명시적 stage 허용 파일 |
| --- | --- |
| 보안 설정·회귀 5개 | `.github/pull_request_template.md`, `.github/settings/main-protection.json`, `scripts/security/merge-evidence.test.mjs`, `scripts/security/workflow-policy.test.mjs`, `scripts/security/branch-protection-policy.test.mjs` |
| 기존 문서 12개 | `README.md`, `SECURITY.md`, `docs/README.md`, `docs/security/free-plan-compensating-controls.md`, `docs/status/2026-09-24-ci-merge-provenance.ko.md`, `docs/superpowers/specs/2026-09-24-ci-merge-provenance-design.md`, `docs/superpowers/specs/2026-09-24-public-repository-branch-protection-design.md`, `docs/security/2026-09-28-public-exposure-audit.ko.md`, `docs/superpowers/plans/2026-09-27-public-repository-autoplan-review.md`, `docs/superpowers/plans/2026-09-28-public-repository-local-hardening.md`, `docs/superpowers/plans/2026-09-28-public-repository-test-plan.md`, `docs/superpowers/plans/2026-09-28-third-party-license-notices.md` |
| 외부 고지 5개 | `THIRD_PARTY_NOTICES.md`, `licenses/impeccable/LICENSE`, `licenses/impeccable/NOTICE.md`, `licenses/modern-screenshot/LICENSE`, `licenses/platform-design-skills/LICENSE` |
| 이번 계획 1개 | `docs/superpowers/plans/2026-09-28-private-review-handoff.md` |

수정 허용 문서: 보호 운영 가이드와 공개 보호 설계의 오래된 “공개 전수 점검 미실행/로컬 구현 진행” 문구를 “T5 감사 완료·G2 로컬 반영·G1/G3/P1 미종결”로 구분한다. 진행 기록과 이 계획에는 로컬 검증 결과를 남긴다. 나머지는 기존 변경을 보존하며 계획되지 않은 보안 코드 수정은 하지 않는다.

Git 제외 실행 로그·PR 본문 초안은 이 계획 전용 `.superpowers/sdd/2026-09-28-private-review-handoff/`에 둔다. 기존 작업의 비공개 로그·캐시·원시 감사 자료는 전송하지 않는다.

### Task 1: 전송 범위 고정과 상태 문서 정리

**Files:** 위 23파일은 읽기·검증/후속 stage 허용. 실제 추가 수정은 이 계획·진행 기록·운영 가이드·공개 보호 설계다.
**Interfaces:** 현재 HEAD/main SHA와 23개 경로를 입력으로 받아 허용 목록·문서 최신 상태·변경 전 해시를 전용 실행 기록에 보관한다.

- [x] 사용자에게 기존 8커밋 포함, PRIVATE 유지, 신규 noreply, 초안 PR, main 병합 제외를 포함한 이 계획의 실행 승인을 받는다.
- [x] Git branch/HEAD/index/원격 refs/visibility를 재조회한다. Expected: 현재 branch, PRIVATE, index 비어 있음, 원격 main 일치. 차이가 있으면 새 변경 소유권과 범위를 먼저 확인한다.
- [x] 허용 목록 및 `.gitignore` 해시를 저장하고 오래된 상태 문구만 갱신한다. Expected: 새 제품/CI 코드 변경 없음, 감사 완료와 공개 완료를 구분.
- [x] 문서 링크 존재, `git diff --check`, 원문 4개 SHA-256, 기존 외부 파일 105개 불변을 검사한다. Expected: 오류 0. 원문 기준은 [라이선스 검증 계약](2026-09-28-third-party-license-notices.md)의 4개 고정 해시다.

### Task 2: 현재 후보 검증과 최종 읽기 리뷰

**Files:** 제품/테스트 파일은 수정하지 않고 실행한다. 이 계획·진행 기록에 실제 결과만 추가한다.
**Interfaces:** Task 1의 고정 파일 범위를 입력으로 받아 검증 명령·시각·종료 코드·검사 수와 실패/미실행 기록을 만든다.

- [x] 설치된 Node/pnpm 버전을 확인한다. Expected: 22.15.1 / 11.9.0. PowerShell에서 실행하고 Git/cmd 경로를 유지한다. 이미 있는 적합한 런타임을 사용하며 새 설치는 자동 진행하지 않는다.
- [x] `pnpm test:security-gate`와 `pnpm verify`를 실행한다. Expected: 모두 exit 0. 이전 185/1,149 수치를 새 실행으로 재사용하지 않는다.
- [x] `pnpm --filter @account-book/web test:coverage`를 실행한다. Expected: exit 0, 기존 인증 분기 100% 정책 유지. 검사 오류·미실행을 숫자에 합산하지 않는다.
- [x] Task 1의 문서/해시/변경 범위를 다시 검사하고, 최종 독립 검토자가 전체 제출 후보와 미해결 P1을 확인한다. Expected: 이번 변경의 미해결 Critical/Important 0. 기존 P1은 초안 단계에서 명시적으로 유지한다.
- [x] 실패 시 검사·정책을 완화하지 않고 원인과 필요한 수정 범위를 보고한다. DB/E2E의 실제 폐기용 환경 검사는 hosted CI 결과와 분리한다.

### Task 3: 명시적 파일 커밋과 비공개 기능 브랜치 push

**Files:** 승인한 23파일만 stage. `.gitignore`와 원시 자료는 제외한다.
**Interfaces:** 검증된 목록을 하나의 신규 커밋 SHA H로 고정하고, 원격 feature ref=H를 확인한다. 기존 8커밋은 변경하지 않는다.

- [x] 실행 직전 외부 계정/원격 저장소·PRIVATE·main SHA·hooksPath를 다시 확인한다. Expected: 동일 계정·대상, hooksPath `.githooks`. push/PR이 CI를 시작하므로 무료 할당량 또는 추가 과금 차단도 확인하며, 확인 불가면 사용자에게 먼저 확인한다. 비용 한도·결제 설정은 바꾸지 않고 대상 변경 시 전송 중단.
- [ ] 파일 경로를 하나씩 명시하여 stage하고 `git diff --cached --name-only`가 정확히 허용 목록과 일치하는지 검사한다. Expected: 23파일, `.gitignore`/`.env`/캐시/원시 증거 0. 새 파일도 내용 검토 후 포함한다.
- [ ] `git -c user.email=71521075+jawon0407@users.noreply.github.com commit -m "chore: prepare security controls and license notices for review"`로 새 커밋 하나를 만든다. author/committer override 환경변수가 있으면 덮어쓰기 전에 중단한다. Expected: author/committer가 모두 noreply이고 부모는 기존 HEAD. 주소 비교는 값을 출력하지 않는다.
- [ ] 새 HEAD의 전체 tree와 새로 도입될 이력을 기존 secret/구조 게이트로 확인하고 `git push -u origin feature/ci-merge-provenance`를 실행한다. Expected: pre-push 성공, exit 0, 원격 feature SHA=H. force/no-verify는 금지한다.
- [ ] main과 다른 refs가 의도치 않게 바뀌지 않았는지 대조한다. 비공개 push라도 기존 author 메타데이터가 함께 전송된다는 점은 기록한다. 기존 개인정보 제거 작업은 아니다.

### Task 4: 초안 PR·CI 증거·인계

**Files:** 앱 파일 변경 없음. Git 제외 PR 본문과 실행 기록, Notion 진행 기록을 갱신한다.
**Interfaces:** 원격 H와 main B를 입력으로 받아 초안 PR URL 및 해당 실행의 H/B/C·event/run 결과를 남긴다. 공개/병합 승인으로 전달하지 않는다.

- [ ] 같은 head의 PR을 재조회한다. Expected: 없음이면 생성, 이미 생겼으면 대상·상태를 확인하고 중복 생성하지 않는다.
- [ ] 현재 PR 양식으로 범위·검증·공개 미실행·P1 미종결을 기입한 본문을 준비한다. `gh pr create --repo jawon0407/account-book --base main --head feature/ci-merge-provenance --draft --title "Security controls and third-party license notices" --body-file <준비한 파일>`로 생성한다. 이 명령의 dry-run도 push할 수 있으므로 읽기 검사 용도로 쓰지 않는다.
- [ ] 반환 URL을 Codex PR 첨부 도구에 연결하고 PR을 다시 읽는다. Expected: isDraft=true, base=main, head=H, 저장소 PRIVATE. 실제 PR 번호를 고정 번호로 추측하지 않는다.
- [ ] 해당 후보의 push/PR CI 실행을 확인한다. H와 checkout C를 구분하고 실제 필수 단계·폐기용 DB/E2E의 성공/실패/미실행을 기록한다. pending/skipped/neutral을 품질 성공으로 대체하지 않는다. 비용·계정 제한이면 초안 유지와 차단 사유를 보고한다.
- [ ] 원격 결과는 Notion과 Git 제외 실행 기록에 우선 기록한다. 결과만 적으려고 새 커밋/재실행을 반복하지 않는다. 후속 저장소 문서 커밋은 별도 작업으로 남긴다.
- [ ] 최종 보고: 신규 커밋 SHA, 함께 전송한 기존 8커밋, PR URL, CI 결과, 사용자 변경 보존, G1/G3/P1 및 공개 전 최종 delta 재검사 필요. 공개·merge·보호 적용·배포를 하지 않는다.

## 4. 이후 단계와 사용자 결정

2026-09-28 실행 기록: 보안 185/185, 전체 verify 1,149개 및 lint·타입·API/웹 빌드, 인증 coverage 643개·branches 825/825=100%를 새로 통과했다. 최종 3명령은 UTC 06:19:34~06:23:18, 모두 exit 0이다. 첫 verify는 route-wiring.test.ts:52의 5초 timeout 1건으로 실패했고, 단독 16/16(해당 case 1427ms) 및 동일 전체 재실행에서 재현되지 않았다. 코드·한도를 바꾸지 않았으며 원인 확정이나 수정 완료로 주장하지 않는다. 첫 실패와 마지막 성공 로그는 별도 보존한다.

전송 차단: billing API의 user scope 부족(HTTP 404)으로 무료 잔여량/추가 과금 차단을 확인하지 못했다. 사용자가 추가 유료 사용 차단을 확인하기 전 Task 3/4를 보류하며 stage·commit·push·PR은 아직 실행하지 않았다. 권한 확대·요금제 변경·공개 전환으로 우회하지 않는다.

차단 해소: 후속 사용자 답변으로 추가 유료 사용 비활성 상태를 확인했다. 이는 사용자의 확인이며 API로 결제 설정을 직접 검증한 결과는 아니다. 계정·PRIVATE·main SHA·hooksPath와 빈 index, author/committer override 없음, 23파일 범위를 재확인했다. 비용 설정은 변경하지 않고 전송을 재개한다. 실제 커밋 SHA·PR·CI 결과는 승인된 방식대로 Notion과 Git 제외 실행 기록에 남긴다.

형식 보완: 신규 문서가 stage된 뒤 공백 검사에서 로컬 보완 계획 문서의 말미 빈 줄 1개가 검출됐다(exit 2). 동일 제출 목록의 `2026-09-28-public-repository-local-hardening.md`에서 마지막 LF 하나만 제거했다. 이를 되붙인 바이트의 SHA-256이 최초 기준과 일치하는지 검사하여 본문 변경 없이 1줄 정리로 한정한다. 새 제품 코드·라이선스 원문·사용자 파일은 수정하지 않는다.

독립 리뷰: 신규 Critical/Important/Minor 0, 기존 P1과 보류 Minor 2건 유지. 별도 검토자가 집중 148/148, 범위·라이선스·105파일·링크 113개를 확인하고 새 전체 실행 로그를 읽었다. 후보 내용은 비공개 초안 인계 가능하나 비용 조건과 이후 실제 staged/커밋/원격 검증은 미충족이며 main 병합 준비 완료가 아니다. 간헐 timeout은 CI에서 재발하면 별도 진단한다.

이 계획은 비공개 검증·전송까지만 포함한다. 그 다음 공개 전환 전에 사용자는 (1) 과거 Git 작성자 개인정보가 공개되는 것을 수용할지, (2) 자료 공개 권한과 제3자 제한 자료 부재를 확인해야 한다. 이를 확인한 뒤 최종 refs/PR/새 CI 로그를 포함해 delta 감사하고 원격 공개·보호 실행 계획을 별도로 승인한다.

새 noreply 사용은 과거 주소를 지우지 않는다. 과거 주소 비공개를 원하면 이력/PR 참조 정리를 별도 설계하며 이번 브랜치를 강제 변경하지 않는다. 공개 후에는 소스와 Actions 기록이 공개될 수 있고 타인이 이미 복제한 내용을 회수할 수 없다는 점을 유지한다.

## 5. 자기 검토와 출처

- spec의 공개 차단 조건은 Global Constraints/이후 단계로 유지했다. 이번 산출물은 공개·main 보호가 아니라 PRIVATE 초안 PR이다.
- Review Focus 5개는 Task 1~4의 목록·이메일·SHA/CI·원격 상태 검사에 각각 연결했다. 단계 간 입력은 경로 목록 → 검증 결과 → H → PR/CI 증거로 일치한다.
- 현재 코드 수정이 아니라 검증·Git 전송 절차이므로 새 제품 테스트는 만들지 않고 기존 테스트를 재실행한다. 지금 작성한 계획을 실행 완료 증거로 사용하지 않는다.
- [GitHub 커밋 이메일 설정](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address), [noreply 형식](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference).
- [무료 비공개 저장소의 초안 PR 지원](https://github.blog/changelog/2025-05-01-draft-pull-requests-are-now-available-in-all-repositories/), [PR 생성 옵션](https://cli.github.com/manual/gh_pr_create).
- [공개 전환 영향](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
