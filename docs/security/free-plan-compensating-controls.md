# GitHub 무료 플랜 보호 운영 — 현재 통제와 공개 전환

이 문서는 현재의 로컬/CI 보완 통제와 승인된 무료·공개 저장소 보호 목표를 구분한다. 로컬 JSON 수정은 GitHub 서버 설정 변경이 아니다. 구현의 기술 구조는 [보안 아키텍처](security-architecture.md), 검토 항목은 [보안 검증 체크리스트](verification-checklist.md)를 함께 본다.

> 2026-09-24 주의: 아래 main 병합 증빙 개선은 기능 브랜치의 미배포 구현이다. 독립 리뷰에서 간접 병합 관련 P1이 발견되어 반영을 보류했다. GitHub가 직접 push 뒤에도 PR을 merged로 표시할 수 있으므로, 상태·SHA·부모의 일치만으로 모든 직접 push를 탐지한다고 해석하면 안 된다. [상세 기록](../status/2026-09-24-ci-merge-provenance.ko.md), [GitHub 근거](https://docs.github.com/en/pull-requests/reference/pull-request-merges#indirect-merges).

## 1. 현재 상태와 목표

2026-09-28 후속 실행 기준이다. [T5 노출 감사](2026-09-28-public-exposure-audit.ko.md) 이후 변경분을 검사했고 사용자가 G1 개인정보 공개 수용·G3 자료 공개 권한을 확인했다. 저장소를 PUBLIC으로 바꾸고 아래 보호를 실제 적용·재조회했다. G2 고지 파일은 PR #14에 있으며 main 통합은 별도다. P1은 거부/정상 흐름·독립 검토까지 완료해야 종결한다. [실행 기록](../status/2026-09-28-public-protection-execution.ko.md), [GitHub 공식 지원 범위](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

| 구분 | 현재 | 승인된 목표 / 완료 증거 |
| --- | --- | --- |
| 공개 범위 | PUBLIC 실제 확인 | 소유자 확인·최종 delta 감사 후 전환 |
| main 보호 | 적용·재조회 통과 | PR 필수·strict security-gate·앱15368·관리자 적용, force/delete 금지 |
| 로컬 목표 JSON | 필수 검사와 merge 호환 정책 반영 | 파일은 요청 payload일 뿐 서버 적용 증거 아님 |
| secret scanning / push protection | 모두 enabled 실제 확인 | 활성 설정 증거이며 실제 키를 밀어 넣는 탐지 실험은 하지 않음 |
| 외부 PR / 신고 | 전체 외부 기여자 실행 승인·비공개 신고 활성 | Actions 복원·기본 토큰 읽기 전용·PR 승인 불가 재조회 |
| 본인 최종 확인 | PR 양식으로 기록하는 절차 | 최신 H/B/C·실행·검사 정의에 결속, 타인 강제 승인 0 |
| 간접 병합 P1 | 미종결 | 목표 재정의만으로 닫지 않고 원격 정상/거부 흐름과 독립 확인 필요 |

요청 JSON의 `required_status_checks`는 `strict=true`, `checks=[{context:"security-gate", app_id:15368}]`다. 구형 `contexts`는 보내지 않는다. 실제 API가 `contexts`와 `checks` 동시 제출을 422로 거절해 회귀 테스트 후 수정했다. [보호 API 계약](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection)의 앱 결속 checks를 사용하며 any-source로 완화하지 않는다. PR 객체는 유지하고 required_approving_review_count=0, enforce_admins=true, force/delete=false, conversation_resolution=true, linear_history=false다. 일반 merge/squash를 유지하고 rebase는 실제 비활성화했다. main-provenance는 main push 전용이므로 PR 필수 검사에 넣지 않는다.

앱 ID 15368은 2026-09-28 main `9e2ff81b88c8f6290f68c9bebb1b4bb43493cac5`의 [security-gate 실행](https://github.com/jawon0407/account-book/actions/runs/35832112508/job/107086890347)에서 `github-actions`로 조회했다. 해당 실행의 결론은 failure였으므로 출처 확인만 의미한다. 원격 적용 직전 실제 후보에서도 출처를 재확인한다.

### 과거 기록: 2026-07-17

2026-07-17에 저장소 설정을 실제로 조회하고 변경을 시도한 결과는 다음과 같다.

| 항목 | 당시 상태 | 당시 확인 결과 |
|---|---|---|
| 저장소 공개 범위 | 비공개 유지 | 비공개 저장소로 확인 |
| branch protection/rulesets | 사용할 수 없음 | API HTTP 403 |
| secret scanning/push protection | 사용할 수 없음 | API HTTP 422 |
| Dependabot vulnerability alerts | 활성화 | 설정 조회로 확인 |
| Dependabot automated security fixes | 활성화 | 설정 조회로 확인 |

이 과거 기록을 모든 무료 저장소의 현재 제한으로 일반화하지 않는다. `.github/settings/main-protection.json`의 존재나 CI 성공으로 원격 보호 활성화를 추정하지 않는다.

## 2. 적용한 보완 통제

### 로컬 pre-push 게이트

`.githooks/pre-push`는 `scripts/security-gate.mjs --mode pre-push`를 실행한다. 게이트는 다음 순서로 실패 시 push를 중단한다.

1. `main` 직접 push와 승인되지 않은 브랜치 이름을 거부한다. 허용 대상은 소문자 kebab-case 이름의 `feature/*`, `hotfix/*`와 정확히 `maintenance-branch`다.
2. 저장소 구조 테스트와 실제 필수 경로 검사를 실행한다.
3. push가 도입하는 모든 커밋을 오래된 순서로 열거하고 각 커밋의 전체 tree blob을 검사한다.
4. GitHub 토큰, AWS access key ID, private key 형식은 실제 일치 값을 보존하거나 출력하지 않고 파일 경로와 안정적인 규칙 ID만 보고한다.

기존 원격 ref를 갱신하면 원격 기준 SHA 이후 도입된 모든 커밋을 검사한다. 새 ref는 해당 head에서 도달 가능한 전체 이력을 검사한다. 같은 Git blob은 object ID로 내용 읽기를 중복 제거하지만 서로 다른 경로는 각각 검사 결과에 보존한다.

검사가 불완전해질 수 있는 shallow 저장소는 fail closed로 거부한다. blob이 5 MiB를 초과하면 `BLOB_REVIEW_REQUIRED`로 중단한다. 이 실패는 수동 승인만으로 우회할 수 없다. 파일을 제거하거나 검토된 별도 저장소로 옮기거나, 보안 검토와 회귀 테스트를 거쳐 검사 코드와 한도를 변경할 때까지 push와 merge를 진행하지 않는다. Git 오류, 잘못된 SHA, 비정상 tree 출력도 통과로 취급하지 않는다.

### 읽기 전용 CI 게이트

`.github/workflows/security-gate.yml`은 `pull_request`와 `push`에서 같은 `scripts/security-gate.mjs`를 CI 모드로 실행한다.

- workflow 최상위 권한은 `contents: read`뿐이다.
- main push에서만 `main-provenance` 작업에 `contents: read`와 `pull-requests: read`를 제공한다. 자동 `github.token`은 해당 증빙 실행 단계의 환경에만 넣으며 새 PAT나 운영 secret을 만들지 않는다.
- 품질 작업 `security-gate`는 `contents: read`만 가진다. main 증빙 결과가 성공인지 먼저 검사한 뒤 기존 설치·lint·타입·테스트·빌드·coverage·DB·브라우저·감사를 실행한다. main 실패/취소/누락/skipped는 통과시키지 않는다. non-main에서만 의도된 skipped를 허용한다.
- 저장소 secret을 참조하지 않는다.
- 모든 `uses:`는 검토한 전체 40자리 commit SHA에 고정한다.
- checkout은 `fetch-depth: 0`으로 전체 이력을 가져오고 `persist-credentials: false`로 Git 자격 증명을 남기지 않는다.
- push 실행의 concurrency group에는 실행마다 고유한 `github.run_id`를 사용하고 취소를 비활성화한다. 따라서 같은 SHA를 다시 가리키는 ref push도 pending 실행을 대체하지 않고 각각 검사한다. PR 실행만 PR 번호로 그룹화하고 새 실행이 이전 실행을 대체하도록 취소한다.
- 정적 정책 테스트는 이벤트, 권한, secret 참조, 승인된 Action, checkout 설정, CLI 연결을 확인한다.
- canonical workflow 정책 테스트는 정규화한 workflow 전체의 SHA-256 digest를 검토값과 비교해 구조 검사를 우회하는 YAML 변경도 fail closed로 막는다.

workflow를 의도적으로 바꿀 때는 변경의 보안 영향을 검토하고 전체 파일 digest와 구조 assertion을 같은 변경에서 갱신한 뒤 `pnpm test:security-gate`를 실행한다. digest만 갱신해 실패를 없애는 것은 승인 절차가 아니다.

같은 GitHub Actions 앱·체크 이름은 **누가 체크를 보냈는지**를 제한할 뿐 **무슨 검사를 했는지**를 보장하지 않는다. 테스트와 digest도 같은 PR에서 바뀔 수 있다. 본인이 workflow·보안 scripts·package scripts 최종 diff와 실제 job/step 실행을 확인해야 한다. GitHub는 필수 체크의 skipped/neutral을 허용할 수 있으므로 서버 보호가 이것까지 항상 실패시킨다고 주장하지 않는다. 이 프로젝트의 확인 절차에서는 품질 검사가 실제 완료되지 않은 후보를 승인하지 않는다.

## 3. 설치와 일상 검증 방법

### 준비: 설치와 조회를 구분하기

Node 22.15.1·pnpm 11.9.0·Git·GitHub CLI가 필요하다. 이미 설치된 환경에서는 재설치하지 않는다. `gh auth status`로 인증 상태만 확인하고 토큰 출력 옵션은 사용하지 않는다. 새 clone/worktree에서 다음 설치는 로컬 Git 설정을 바꾸므로 별도로 의식해서 실행한다.

```powershell
pnpm setup:hooks
git config --local --get core.hooksPath
pnpm test:security-gate
pnpm verify:structure
```

두 번째 명령은 정확히 `.githooks`를 출력해야 한다. 설치 또는 read-back이 실패하면 push를 진행하지 않는다. 테스트 통과 개수는 코드와 함께 변하므로 문서에 고정하지 않고 명령 출력과 검사한 commit SHA를 PR 증거에 기록한다.

### 읽기 전용 첫 확인

아래 번호는 예시가 아니라 현재 작업 대상 PR 번호로 입력한다. 이번 로컬 보완은 아직 push/PR 생성하지 않았다. 첫 확인의 목표는 짧게 상태를 파악하는 것이며 소요 시간은 실측하지 않았다.

```powershell
$pr = Read-Host '확인할 PR 번호'
gh pr view $pr --repo jawon0407/account-book --json headRefOid,baseRefOid,url
gh pr checks $pr --repo jawon0407/account-book
gh pr checks $pr --repo jawon0407/account-book --required
gh api repos/jawon0407/account-book/branches/main/protection
```

전체 체크 목록과 required 목록을 둘 다 본다. 빈 required 목록은 검사가 필요 없다는 허가가 아니라 보호 설정을 확인할 이유다. API 응답은 로컬 요청 JSON과 형태가 다르므로 객체 전체를 비교하지 말고 strict/checks의 context·app_id, PR 승인 수, admins.enabled, force/delete.enabled, linear.enabled, conversation.enabled를 대조한다. contexts는 서버가 checks에서 파생하여 반환할 수 있다. 중복 classic 규칙·ruleset 적용 여부도 원격 변경 전에 확인한다.

| 상태 | 의미 / 다음 행동 |
| --- | --- |
| 인증 실패 | 로그인 계정·권한을 확인, 토큰을 채팅/로그에 출력하지 않음 |
| pending | 아직 실행 중. [gh pr checks](https://cli.github.com/manual/gh_pr_checks)의 종료 코드 8은 성공 아님 |
| failure / cancelled | 원인과 해당 run 확인 후 수정/재실행, 검사 제거 금지 |
| 체크 없음 / skipped / neutral | 실제 필수 품질 단계 실행을 확인하기 전 본인 승인 보류 |
| 보호 조회 403 / 404 | 권한·가시성·플랜·규칙 존재 여부 미확인, 자동 성공/우회 금지 |
| 보호 값 불일치 | 실제 적용 완료로 표시하지 않고 변경·병합 중단 |

### 일상 변경과 본인 확인

1. `feature/*` 또는 `hotfix/*`에서 변경하고 집중 테스트와 전체 테스트를 실행한다.
2. 로컬 pre-push 게이트를 통과해 원격 브랜치로 push한다.
3. `main` 또는 `maintenance-branch`를 대상으로 PR을 만든다.
4. PR 양식에 H(PR head), B(검사 기준 base), C(실제 checkout), run ID/event/URL을 각각 기록한다. PR 실행은 시험 병합 커밋 C를 검사할 수 있어 H=C를 강제하지 않는다. 현재 PR 값만 보지 말고 해당 실행의 checkout 로그와 실행 당시 PR/base 기록을 대조한다. 확인할 증거가 없으면 미검증이다.
5. [검증 체크리스트](verification-checklist.md)를 수동으로 확인하고 일반 merge commit 또는 squash merge한다. 여러 커밋 rebase·배치 main 갱신·merge queue는 이번 정책의 지원 범위가 아니다.
6. 승인된 병합 뒤 새 main push 실행에서 `main-provenance`와 `security-gate`가 모두 성공했는지 확인한다. 과거 실패 실행 재시작은 새 정책 코드의 검증이 아니다.

확인자는 검사 정의 diff·전체 단계 결과·후보 H/B/C를 확인한 후 이름과 시각을 기록한다. head/base/검사 정의가 변경되면 이전 확인은 무효이며 새 실행과 새 확인이 필요하다. 이는 사람의 운영 절차이고 필수 타인 승인 0 설정이 본인 확인을 자동 강제하는 것은 아니다.

### 정상 병합을 확인하는 흐름

초급 개발자 관점에서 SHA는 커밋의 고유 식별자이며, 부모는 그 커밋이 이어받은 이전 상태다. `before`는 이번 push 직전 main, `after`는 직후 main이다. 원격 main이 나중에 더 진행되어도 이번 이벤트의 두 값을 기준으로 검사한다.

1. CLI는 GitHub 이벤트 파일·실행 환경·전달 인자의 저장소 이름/숫자 ID, main ref, before/after를 대조한다. 강제 push·브랜치 생성/삭제·0 SHA·같은 SHA·누락된 flags는 거부한다.
2. Git reader는 현재 HEAD=after인지와 원본 커밋 부모를 읽는다. shallow와 Git replace로 축약·변조된 이력은 허용하지 않는다. secret scan도 같은 원본 그래프를 사용한다.
3. HTTP 조회기는 고정 `api.github.com`의 해당 커밋 관련 PR 목록을 모두 확인한 뒤 하나의 후보를 상세 재조회한다. 목록의 시험 병합 SHA만으로 성공시키지 않는다.
4. 순수 판정기는 실제 merged=true, 유효한 merged_at, closed/non-draft, 정확한 저장소/main/결과 SHA와 목록/상세 identity를 검증한다. 두 부모면 `[before, PR head]`, 한 부모면 `[before]`여야 한다.
5. 정상 증빙이어도 저장소 구조와 도입된 전체 커밋의 secret scan을 실행한다. 성공 로그에는 PR 번호·결과 SHA·검사 blob 수만 남긴다.

단일 커밋 rebase는 squash와 같은 증빙을 만족할 수 있어 명칭으로 구별하지 않는다. 여러 커밋 rebase나 여러 병합을 모은 push는 부모 계약과 맞지 않아 실패한다. 리뷰 승인과 병합 전 정확한 head CI 성공은 별도로 수동 확인해야 한다.

### 자원·자격 증명 경계

- Next.js나 금융 데이터 로직은 관여하지 않는다. 증빙 작업은 의존성 설치/앱 실행 없이 Node 내장 기능과 Git만 사용한다.
- 조회 전체 시간은 본문 포함 10초, 응답당 1MiB, 페이지당 100개·최대 3페이지다. 첫 페이지에서 후보를 찾아도 남은 페이지를 생략하지 않으며 중복 후보와 한도 초과는 실패한다.
- 응답 Link URL은 요청 주소로 쓰지 않고 next 존재만 확인한다. 다음 주소는 고정 호스트·경로와 증가하는 페이지 번호로 만든다. redirect와 자동 재시도는 없다.
- 이벤트 파일은 일반 파일만 최대 4MiB까지 읽는다. 그보다 큰 정상 이벤트도 확인 불가로 종료될 수 있어 검토 없이 한도를 우회하지 않는다.
- Git/구조 검사 자식 프로세스에는 GITHUB_TOKEN/GH_TOKEN을 대소문자 구분 없이 제거한 환경을 전달한다. 토큰·원시 이벤트·응답·HTTP 오류 원문은 로그나 증빙 파일에 기록하지 않는다.

CI 성공은 GitHub branch protection이 활성화됐다는 증거가 아니다. 해당 후보의 H/B/C·실행 결과와 원격 보호 상태를 각각 확인한다.

## 4. 수용한 잔여 위험

로컬 hook은 개발자가 `git push --no-verify`를 사용하거나 hooks 설정을 바꾸면 우회할 수 있다. CI는 GitHub에 도달한 push를 검사할 뿐 이미 도달한 commit을 되돌리거나 PR 없이 병합되는 것을 서버에서 막지 못한다. 저장소 관리자 권한을 가진 계정의 직접 변경도 이 보완 계층만으로 강제 차단할 수 없다.

따라서 현재 통제는 실수와 알려진 형식의 비밀정보 유출 가능성을 줄이는 방어 심층화 계층이지 branch protection, rulesets 또는 GitHub push protection과 동등한 통제가 아니다. 규칙이 알지 못하는 비밀정보 형식은 사람의 검토가 필요하다. 5 MiB 초과 blob은 단순 수동 승인 대상이 아니라 게이트가 해소될 때까지 push와 merge를 막는 조건이다.

`.github/CODEOWNERS`는 검토 책임자를 표시하지만 승인된 목표도 code owner/타인 승인을 필수로 강제하지 않는다. `.github/pull_request_template.md`는 누락을 드러내는 운영 도구이며 체크하지 않은 항목을 자동 차단하지 않는다. 관리자에게 보호를 적용해도 관리자가 규칙 자체를 변경할 권한까지 제거하지는 못하므로 MFA·계정 권한·설정 변경 기록을 별도로 관리한다.

## 5. 사고 처리

새 증빙 오류는 먼저 종류를 구분한다. 실패 자체를 즉시 침해 확정으로 해석하지 않는다.

| 코드 | 뜻 | 운영 대응 |
| --- | --- | --- |
| MAIN_PUSH_CONTEXT_INVALID | 이벤트·CLI 불일치 또는 읽기/크기 오류 | 이벤트 종류·SHA·파일 한도를 확인하고 원문 비밀값은 복사하지 않는다. |
| MAIN_MERGE_EVIDENCE_REJECTED | 일치하는 실제 병합 PR/부모를 증명하지 못함 | PR 번호·병합 결과 SHA·부모·지원 병합 방식과 API 반영 지연을 조사한다. |
| MAIN_MERGE_EVIDENCE_UNAVAILABLE | 권한·HTTP·시간·본문·페이지 한도로 확인 불가 | 최소 읽기 권한/API 상태를 확인하고 동일 이벤트를 수동 재실행한다. |
| MAIN_PROVENANCE_JOB_FAILED | 증빙 작업 실패/취소/예상 밖 skipped | 선행 작업 결과를 확인한다. 품질 작업만 성공으로 바꾸지 않는다. |

실행 ID·검사 SHA·안전한 오류 코드와 PR 상태를 보존한다. API 반영 지연은 동일 이벤트 재실행으로 확인하되 지속 실패를 자동 재시도나 main 검사 제외로 숨기지 않는다. 지원하지 않는 병합 방식이 원인이면 별도 설계·테스트 후 정책을 확장한다.

현재 사후 증빙→품질 순서를 유지하므로 main 증빙 조회 장애가 나면 후속 품질 검사가 실행되지 않을 수 있다. 보고서는 증빙 실패와 품질 미실행을 구별한다. 원인이 해소된 뒤 같은 이벤트를 수동 재실행한다. 새 코드 검증이 필요하다면 승인된 새 PR/이벤트가 필요하며, 사후 CI가 main 변경을 자동 취소하지는 않는다.

직접 `main` push 또는 게이트 우회가 확인되면 추가 작업을 중단하고 SHA와 관련 CI 결과를 보존한 뒤 영향을 평가한다. 정상 `hotfix/*` 또는 `feature/*` PR로 복구하고 원인, 영향, 재발 방지를 기록한다.

실제 비밀정보가 Git 기록에 포함됐으면 commit 삭제만으로 해결된 것으로 간주하지 않는다. 즉시 해당 자격 증명을 폐기·회전하고 [사고 대응 절차](incident-response.md)를 따른다. 실제 일치 값은 이슈, PR, 로그 또는 fixture에 복사하지 않는다.

## 6. 공개 전 점검과 단계별 종료 조건

1. 공개할 refs·태그·전체 이력, PR 본문/댓글, Actions 로그/artifact, 스크린샷/첨부, DB 덤프/백업, raon 자료, 외부 자산·라이선스·공개 권리를 목록화한다. Git 검사만으로 전체 노출 점검을 대신하지 않는다.
2. **최종 목록 확정 시점부터 동결**하고 시각·refs SHA·검토한 항목/미검증 항목을 기록한다. 접근 불가나 미확인 자료가 있으면 공개 보류다. 실제 키 발견 시 폐기·교체를 먼저 하고 이력 정리는 별도 승인받는다.
3. 보고서 검토 후 공개 전환의 최종 승인을 받는다. 전환 직전 목록과 변경분을 다시 확인하며 차이가 있으면 감사·확인을 갱신한다. 소스 공개는 DB 공개와 다르지만 이력의 금융정보 노출은 별개다. 다시 비공개로 바꿔도 복제본은 회수할 수 없다.
4. 별도 승인된 원격 단계에서 공개·보호를 적용하고 read-back한다. 두 변경이 원자적이라고 가정하지 않는다. 보호 실패 시 동결을 유지하고 main push·병합·배포를 하지 않는다.

| 종료 대상 | 필요한 증거 | 현재 |
| --- | --- | --- |
| 공개 점검 | 전체 목록·동결·직전 delta·권리·최종 승인 | T5 감사 완료, G2 로컬 반영; G1/G3·최종 delta/공개 승인 대기 |
| main 보호 / P1 | 원격 목표 값, rebase 비활성화, 후보 CI, 승인된 무민감 fixture의 거부/정상 흐름, 정상 PR/main 실행, 독립 확인 | 미검증, P1 유지 |
| secret 보호 | secret scanning·push protection 각 상태 및 승인된 합성 canary 검증 | 미검증 |

실제 main에 우회 코드를 push하지 않는다. 거부 실험을 위한 임시 보호 브랜치/테스트 저장소 생성도 별도 승인이다. 각 종료일·대상·증거를 따로 기록하고 로컬/CI 게이트는 유지한다. 상세 범위는 [공개 보호 설계](../superpowers/specs/2026-09-24-public-repository-branch-protection-design.md), [실행 계획](../superpowers/plans/2026-09-28-public-repository-local-hardening.md), [결과 기록](../status/2026-09-24-ci-merge-provenance.ko.md)을 따른다.
