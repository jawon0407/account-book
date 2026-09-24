# GitHub 무료 플랜 보완 통제

이 문서는 GitHub 무료 플랜의 비공개 저장소에서 사용할 수 없는 서버 측 통제를 대신해 현재 적용한 통제, 운영 절차, 남은 위험을 설명한다. 구현의 기술 구조는 [보안 아키텍처](security-architecture.md), 검토 시 확인할 항목은 [보안 검증 체크리스트](verification-checklist.md)를 함께 본다.

> 2026-09-24 주의: 아래 main 병합 증빙 개선은 기능 브랜치의 미배포 구현이다. 독립 리뷰에서 간접 병합 관련 P1이 발견되어 반영을 보류했다. GitHub가 직접 push 뒤에도 PR을 merged로 표시할 수 있으므로, 상태·SHA·부모의 일치만으로 모든 직접 push를 탐지한다고 해석하면 안 된다. [상세 기록](../status/2026-09-24-ci-merge-provenance.ko.md), [GitHub 근거](https://docs.github.com/en/pull-requests/reference/pull-request-merges#indirect-merges).

## 1. 확인된 플랫폼 상태

2026-07-17에 저장소 설정을 실제로 조회하고 변경을 시도한 결과는 다음과 같다.

| 항목 | 현재 상태 | 확인 결과 |
|---|---|---|
| 저장소 공개 범위 | 비공개 유지 | 비공개 저장소로 확인 |
| branch protection/rulesets | 사용할 수 없음 | API HTTP 403 |
| secret scanning/push protection | 사용할 수 없음 | API HTTP 422 |
| Dependabot vulnerability alerts | 활성화 | 설정 조회로 확인 |
| Dependabot automated security fixes | 활성화 | 설정 조회로 확인 |

따라서 GitHub 서버는 `main` 직접 push, 강제 push, 브랜치 삭제, 필수 PR 검토 또는 비밀정보가 포함된 push를 현재 설정으로 사전 차단하지 않는다. 저장소의 `.github/settings/main-protection.json`은 지원 플랜에서 적용할 목표 설정이며, 활성 상태를 의미하지 않는다.

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

## 3. 설치와 일상 검증 방법

저장소를 새로 clone하거나 worktree를 만들면 다음 명령을 실행한다.

```powershell
pnpm setup:hooks
git config --local --get core.hooksPath
pnpm test:security-gate
pnpm verify:structure
```

두 번째 명령은 정확히 `.githooks`를 출력해야 한다. 설치 또는 read-back이 실패하면 push를 진행하지 않는다. 테스트 통과 개수는 코드와 함께 변하므로 문서에 고정하지 않고 명령 출력과 검사한 commit SHA를 PR 증거에 기록한다.

일상 변경 흐름은 다음과 같다.

1. `feature/*` 또는 `hotfix/*`에서 변경하고 집중 테스트와 전체 테스트를 실행한다.
2. 로컬 pre-push 게이트를 통과해 원격 브랜치로 push한다.
3. `main` 또는 `maintenance-branch`를 대상으로 PR을 만든다.
4. 로컬 `git rev-parse HEAD`, PR의 `headRefOid`, 성공한 `security-gate` Check의 SHA가 같은지 확인한다.
5. [검증 체크리스트](verification-checklist.md)를 수동으로 확인하고 일반 merge commit 또는 squash merge한다. 여러 커밋 rebase·배치 main 갱신·merge queue는 이번 정책의 지원 범위가 아니다.
6. 승인된 병합 뒤 새 main push 실행에서 `main-provenance`와 `security-gate`가 모두 성공했는지 확인한다. 과거 실패 실행 재시작은 새 정책 코드의 검증이 아니다.

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

CI 성공은 GitHub branch protection이 활성화됐다는 증거가 아니다. 반드시 같은 SHA의 결과인지 별도로 확인한다.

## 4. 수용한 잔여 위험

로컬 hook은 개발자가 `git push --no-verify`를 사용하거나 hooks 설정을 바꾸면 우회할 수 있다. CI는 GitHub에 도달한 push를 검사할 뿐 이미 도달한 commit을 되돌리거나 PR 없이 병합되는 것을 서버에서 막지 못한다. 저장소 관리자 권한을 가진 계정의 직접 변경도 이 보완 계층만으로 강제 차단할 수 없다.

따라서 현재 통제는 실수와 알려진 형식의 비밀정보 유출 가능성을 줄이는 방어 심층화 계층이지 branch protection, rulesets 또는 GitHub push protection과 동등한 통제가 아니다. 규칙이 알지 못하는 비밀정보 형식은 사람의 검토가 필요하다. 5 MiB 초과 blob은 단순 수동 승인 대상이 아니라 게이트가 해소될 때까지 push와 merge를 막는 조건이다.

`.github/CODEOWNERS`는 보안 관련 변경의 검토 책임자를 표시하지만 현재 플랜에서는 code owner 승인을 서버가 필수로 강제하지 않는다. `.github/pull_request_template.md`도 검토 증거 누락을 드러내는 운영 도구이며 체크하지 않은 항목을 자동 차단하지 않는다.

## 5. 사고 처리

새 증빙 오류는 먼저 종류를 구분한다. 실패 자체를 즉시 침해 확정으로 해석하지 않는다.

| 코드 | 뜻 | 운영 대응 |
| --- | --- | --- |
| MAIN_PUSH_CONTEXT_INVALID | 이벤트·CLI 불일치 또는 읽기/크기 오류 | 이벤트 종류·SHA·파일 한도를 확인하고 원문 비밀값은 복사하지 않는다. |
| MAIN_MERGE_EVIDENCE_REJECTED | 일치하는 실제 병합 PR/부모를 증명하지 못함 | PR 번호·병합 결과 SHA·부모·지원 병합 방식과 API 반영 지연을 조사한다. |
| MAIN_MERGE_EVIDENCE_UNAVAILABLE | 권한·HTTP·시간·본문·페이지 한도로 확인 불가 | 최소 읽기 권한/API 상태를 확인하고 동일 이벤트를 수동 재실행한다. |
| MAIN_PROVENANCE_JOB_FAILED | 증빙 작업 실패/취소/예상 밖 skipped | 선행 작업 결과를 확인한다. 품질 작업만 성공으로 바꾸지 않는다. |

실행 ID·검사 SHA·안전한 오류 코드와 PR 상태를 보존한다. API 반영 지연은 동일 이벤트 재실행으로 확인하되 지속 실패를 자동 재시도나 main 검사 제외로 숨기지 않는다. 지원하지 않는 병합 방식이 원인이면 별도 설계·테스트 후 정책을 확장한다.

직접 `main` push 또는 게이트 우회가 확인되면 추가 작업을 중단하고 SHA와 관련 CI 결과를 보존한 뒤 영향을 평가한다. 정상 `hotfix/*` 또는 `feature/*` PR로 복구하고 원인, 영향, 재발 방지를 기록한다.

실제 비밀정보가 Git 기록에 포함됐으면 commit 삭제만으로 해결된 것으로 간주하지 않는다. 즉시 해당 자격 증명을 폐기·회전하고 [사고 대응 절차](incident-response.md)를 따른다. 실제 일치 값은 이슈, PR, 로그 또는 fixture에 복사하지 않는다.

## 6. 위험 수용 종료 조건

지원 플랜 또는 동등한 서버 측 통제를 사용할 수 있게 되면 다음 항목을 API live read-back으로 확인하고 확인 날짜, 응답, 대상 저장소를 보안 변경 기록에 남긴다.

- `main`에 PR 필수, 강제 push 금지, 삭제 금지와 필요한 status check가 서버에서 강제된다.
- secret scanning과 push protection이 활성화되어 push 전에 차단한다.

그 뒤 이 문서에 위험 수용 종료일과 증거를 기록한다. 로컬 및 CI 게이트는 서버 측 통제가 생긴 뒤에도 방어 심층화 계층으로 유지한다.
