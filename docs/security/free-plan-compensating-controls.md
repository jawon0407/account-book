# GitHub 무료 플랜 보완 통제

이 문서는 GitHub 무료 플랜의 비공개 저장소에서 사용할 수 없는 서버 측 통제를 대신해 현재 적용한 통제, 운영 절차, 남은 위험을 설명한다. 구현의 기술 구조는 [보안 아키텍처](security-architecture.md), 검토 시 확인할 항목은 [보안 검증 체크리스트](verification-checklist.md)를 함께 본다.

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
5. [검증 체크리스트](verification-checklist.md)를 수동으로 확인하고 squash merge한다.

CI 성공은 GitHub branch protection이 활성화됐다는 증거가 아니다. 반드시 같은 SHA의 결과인지 별도로 확인한다.

## 4. 수용한 잔여 위험

로컬 hook은 개발자가 `git push --no-verify`를 사용하거나 hooks 설정을 바꾸면 우회할 수 있다. CI는 GitHub에 도달한 push를 검사할 뿐 이미 도달한 commit을 되돌리거나 PR 없이 병합되는 것을 서버에서 막지 못한다. 저장소 관리자 권한을 가진 계정의 직접 변경도 이 보완 계층만으로 강제 차단할 수 없다.

따라서 현재 통제는 실수와 알려진 형식의 비밀정보 유출 가능성을 줄이는 방어 심층화 계층이지 branch protection, rulesets 또는 GitHub push protection과 동등한 통제가 아니다. 규칙이 알지 못하는 비밀정보 형식은 사람의 검토가 필요하다. 5 MiB 초과 blob은 단순 수동 승인 대상이 아니라 게이트가 해소될 때까지 push와 merge를 막는 조건이다.

`.github/CODEOWNERS`는 보안 관련 변경의 검토 책임자를 표시하지만 현재 플랜에서는 code owner 승인을 서버가 필수로 강제하지 않는다. `.github/pull_request_template.md`도 검토 증거 누락을 드러내는 운영 도구이며 체크하지 않은 항목을 자동 차단하지 않는다.

## 5. 사고 처리

직접 `main` push 또는 게이트 우회가 확인되면 추가 작업을 중단하고 SHA와 관련 CI 결과를 보존한 뒤 영향을 평가한다. 정상 `hotfix/*` 또는 `feature/*` PR로 복구하고 원인, 영향, 재발 방지를 기록한다.

실제 비밀정보가 Git 기록에 포함됐으면 commit 삭제만으로 해결된 것으로 간주하지 않는다. 즉시 해당 자격 증명을 폐기·회전하고 [사고 대응 절차](incident-response.md)를 따른다. 실제 일치 값은 이슈, PR, 로그 또는 fixture에 복사하지 않는다.

## 6. 위험 수용 종료 조건

지원 플랜 또는 동등한 서버 측 통제를 사용할 수 있게 되면 다음 항목을 API live read-back으로 확인하고 확인 날짜, 응답, 대상 저장소를 보안 변경 기록에 남긴다.

- `main`에 PR 필수, 강제 push 금지, 삭제 금지와 필요한 status check가 서버에서 강제된다.
- secret scanning과 push protection이 활성화되어 push 전에 차단한다.

그 뒤 이 문서에 위험 수용 종료일과 증거를 기록한다. 로컬 및 CI 게이트는 서버 측 통제가 생긴 뒤에도 방어 심층화 계층으로 유지한다.
