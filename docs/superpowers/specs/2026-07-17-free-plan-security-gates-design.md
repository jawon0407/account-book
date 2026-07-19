# 무료 플랜 보완 보안 게이트 설계

작성일: 2026-07-17

상태: 승인됨
대상 저장소: `jawon0407/account-book`

## 1. 배경과 결정

저장소는 비공개 상태를 유지한다. 현재 GitHub 플랜에서는 비공개 저장소의 `main` 브랜치 보호 API가 HTTP 403을 반환하고, secret scanning과 push protection 활성화 요청은 HTTP 422를 반환한다. Dependabot 취약점 경고와 자동 보안 수정은 활성화되어 있다.

사용자는 유료 플랜으로 전환하지 않고 무료 플랜을 유지하기로 결정했다. 따라서 서버가 직접 푸시, 강제 푸시, 브랜치 삭제, 필수 PR 검토를 강제하지 못하는 잔여 위험을 명시적으로 수용한다. 이 문서의 보완 통제는 실수와 일반적인 비밀정보 유출을 줄이지만 GitHub 브랜치 보호나 서버 측 push protection과 동등하지 않다.

## 2. 목표

- 정책상 `main` 직접 푸시를 금지하고 `feature/*`, `maintenance-branch`, `hotfix/*`와 PR 중심 흐름을 사용한다.
- 로컬 pre-push 훅과 GitHub Actions가 같은 보안 게이트를 실행한다.
- 저장소 구조, 테스트, 비밀정보 패턴, 브랜치 흐름 오류를 조기에 차단한다.
- CI 권한과 외부 Action 공급망 위험을 최소화한다.
- PR마다 테스트와 보안 판단의 재현 가능한 증거를 남긴다.
- 무료 플랜 제한과 우회 가능성을 보안 문서에 계속 노출한다.

## 3. 비목표

- 로컬 훅이나 CI를 서버 측 브랜치 보호의 완전한 대체로 설명하지 않는다.
- 유출된 비밀정보를 자동 폐기하거나 회전하지 않는다.
- 이미 발생한 `main` 직접 푸시를 CI가 자동으로 되돌리지 않는다.
- 애플리케이션 인증, 데이터베이스, 거래 원장 또는 관리자 기능을 구현하지 않는다.
- 저장소를 공개로 전환하지 않는다.

## 4. 브랜치와 적용 순서

1. 이 설계 문서는 `feature/free-plan-security-gates`에 먼저 커밋한다.
2. 보완 통제 구현을 시작하기 전에 현재 `main`과 같은 커밋에서 `maintenance-branch`를 생성하고 원격에 푸시한다.
3. 다시 `feature/free-plan-security-gates`로 돌아와 보완 통제를 구현한다. 이 브랜치의 기준점은 같은 `main` 커밋으로 유지한다.
4. 기능 브랜치를 원격에 푸시하고 PR을 생성한다.
5. CI 전체 통과와 수동 보안 검토가 끝난 경우에만 GitHub PR 병합 기능으로 `main`에 반영한다.
6. 후속 기능은 최신 `main`에서 `feature/{kebab-case}`로 분기한다.
7. 긴급 수정도 `hotfix/{kebab-case}`와 PR을 사용한다.

현재 플랜은 `main` 직접 푸시를 기술적으로 막지 못한다. `git push --no-verify`로 로컬 훅을 우회할 수 있고 저장소 관리자는 CI 실패를 무시할 수 있다. 이 위험은 문서와 PR 체크리스트에서 숨기지 않는다.

## 5. 구성 요소

### 5.1 공통 보안 게이트

`scripts/security-gate.mjs`는 Node 내장 모듈만 사용하는 단일 진입점이다. 로컬 훅과 CI가 같은 검사 규칙을 호출해 환경별 규칙 차이를 줄인다.

책임:

- 실행 모드와 입력값 검증
- 금지된 `main` 직접 푸시 감지
- 저장소 구조 테스트와 구조 계약 검증 실행
- 검사 대상 Git 변경 범위 계산
- 토큰과 개인키 패턴 검사
- 비밀값을 출력하지 않는 오류 요약
- 하위 명령 실행 실패를 성공으로 오인하지 않는 종료 코드 전파

CLI는 최소한 `--mode pre-push`와 `--mode ci`를 제공한다. pre-push 모드는 Git이 표준 입력으로 전달하는 ref 업데이트를 분석하고, CI 모드는 이벤트 환경에서 base/head 범위를 명시적으로 받는다. 잘못되거나 불완전한 입력은 fail-closed로 종료 코드 1을 반환한다.

### 5.2 로컬 pre-push 훅

`.githooks/pre-push`는 Git이 제공하는 remote 이름, URL, ref 업데이트를 공통 보안 게이트로 전달한다. `pnpm setup:hooks`는 현재 저장소의 `core.hooksPath`를 `.githooks`로 설정하고 설정 결과를 확인한다.

훅은 다음을 수행한다.

- `refs/heads/main` 대상 직접 푸시를 차단한다.
- 허용 브랜치에서도 공통 구조·테스트·비밀정보 검사를 실행한다.
- 검사가 실행되지 않았거나 실패하면 푸시를 차단한다.
- 실패 시 안전한 브랜치와 PR 흐름을 안내한다.

훅은 개발자 로컬 설정이므로 복제 후 `pnpm setup:hooks` 실행이 필요하다. 훅이 설치되었다는 사실은 `git config --get core.hooksPath`로 검증한다.

### 5.3 GitHub Actions

`.github/workflows/security-gate.yml`은 `pull_request`와 모든 브랜치의 `push`에서 실행한다.

보안 기준:

- 워크플로와 job의 권한은 `contents: read`만 허용한다.
- 운영 secret, OAuth 자격증명, 배포 키를 주입하지 않는다.
- 외부 Action은 floating tag가 아니라 검증한 전체 commit SHA로 고정한다.
- 구현 시점의 공식 Action 릴리스와 commit SHA를 공식 저장소에서 확인하고 근거를 구현 계획에 기록한다.
- Node 내장 기능만 사용하므로 의존성 설치 스크립트를 실행하지 않는다.
- PR 코드가 권한 상승이나 비밀값 접근을 얻지 않도록 `pull_request_target`을 사용하지 않는다.
- push 동시 실행은 실행마다 고유한 `github.run_id`로 그룹화하고 취소하지 않아 같은 SHA를 다시 가리키는 ref push도 pending 실행을 대체하지 않게 한다. PR 실행만 PR 번호로 그룹화해 취소 가능하게 구성하고 오래된 결과를 승인 근거로 사용하지 않는다.

`main` 직접 push 이벤트를 발견하면 워크플로는 실패하고 사고 대응 문서 경로를 출력한다. CI는 이미 올라간 커밋을 자동 revert하지 않는다.

### 5.4 검토 책임과 PR 증거

`.github/CODEOWNERS`는 보안 정책, 워크플로, 훅, 보안 스크립트의 소유자를 `@jawon0407`로 지정한다. 무료 플랜에서는 CODEOWNERS 승인을 강제하지 못하므로 이는 책임 표시와 알림 보조 수단이다.

`.github/pull_request_template.md`는 다음 증거를 요구한다.

- 변경 목적과 범위
- 실행한 테스트 명령과 결과
- 보안 영향과 데이터 경계 변화
- 위협 모델과 보안 문서 변경 여부
- 데이터베이스 마이그레이션과 롤백 여부
- 알려진 잔여 위험
- 비밀정보가 diff, 로그, fixture에 포함되지 않았다는 확인

## 6. 데이터 흐름

### 6.1 로컬 푸시

1. 개발자가 허용된 작업 브랜치에서 `git push`를 실행한다.
2. Git이 `.githooks/pre-push`에 remote 정보와 ref 업데이트를 전달한다.
3. 훅이 `security-gate.mjs --mode pre-push`를 실행한다.
4. 게이트가 대상 브랜치, 변경 범위, 구조, 테스트, 비밀정보를 검사한다.
5. 모든 검사가 성공하면 종료 코드 0으로 푸시를 허용한다.
6. 하나라도 실패하면 종료 코드 1과 마스킹된 설명을 반환한다.

### 6.2 PR과 원격 푸시

1. GitHub가 PR 또는 push 이벤트로 워크플로를 실행한다.
2. 읽기 전용 권한으로 저장소를 checkout한다.
3. 이벤트에서 base/head 범위를 계산하고 CI 모드 게이트를 실행한다.
4. 결과를 해당 commit SHA의 Check로 남긴다.
5. 사용자는 동일 SHA에서 모든 Check가 성공했는지 수동 확인한 뒤 병합한다.

## 7. 실패 처리

다음 조건은 모두 실패로 처리한다.

- `main` 직접 푸시 입력
- 알 수 없는 실행 모드 또는 누락된 ref 범위
- 구조 테스트나 구조 계약 실패
- Git 명령, Node 프로세스 또는 하위 검사의 비정상 종료
- 변경 범위에서 금지된 비밀정보 패턴 발견
- CI 구성 정적 검증 실패

비밀정보 검사 결과에는 전체 일치 문자열을 출력하지 않는다. 파일 경로, 규칙 식별자, 수정 안내만 제공한다. 실제 비밀정보가 유출된 경우 단순 삭제 커밋으로 끝내지 않고 즉시 폐기·회전하고 `docs/security/incident-response.md`를 따른다.

직접 `main` 푸시가 원격에 도달한 경우:

1. 후속 작업을 중단한다.
2. 커밋과 CI 결과를 보존한다.
3. 보안 영향을 검토한다.
4. 되돌림이 필요하면 별도 `hotfix/*` 브랜치와 PR로 복구한다.
5. 원인과 재발 방지 조치를 보안 기록에 남긴다.

## 8. 테스트 전략

구현은 TDD의 RED, GREEN, REFACTOR 순서를 따른다. 테스트 러너는 Node 내장 `node:test`를 사용한다.

필수 테스트:

- `main` 대상 pre-push 입력은 차단된다.
- `feature/*`, `maintenance-branch`, `hotfix/*` 입력은 다른 검사가 성공할 때 허용된다.
- 누락되거나 잘못된 ref 입력은 fail-closed된다.
- 합성된 가짜 토큰과 개인키 표식은 실제 값을 출력하지 않고 차단된다.
- 정상 코드와 문서의 유사 문자열은 불필요하게 노출되지 않는다.
- 구조 검사 실패와 하위 프로세스 실패가 종료 코드 1로 전파된다.
- 훅 설치 후 `core.hooksPath`가 `.githooks`인지 확인된다.
- 워크플로가 `pull_request`와 `push`를 포함하는지 정적 검사한다.
- 워크플로 권한이 `contents: read`를 넘지 않는지 검사한다.
- 외부 Action 참조가 전체 commit SHA로 고정되었는지 검사한다.
- `pull_request_target`과 비밀값 주입이 없는지 검사한다.

RED는 테스트가 정상 로드된 뒤 assertion으로 실패해야 한다. import, 구문, fixture 로드 오류는 유효한 RED가 아니다. GREEN 후에는 실제 훅 입력과 CI 정적 검사를 포함한 통합 검증을 수행한다.

## 9. 문서 변경

구현은 다음 문서를 실제 상태와 일치하도록 갱신한다.

- `SECURITY.md`: 무료 플랜 위험 수용과 직접 `main` 푸시 금지
- `docs/security/README.md`: 보완 통제 문서 연결과 적용 우선순위
- `docs/security/security-architecture.md`: 서버 보호 부재와 로컬·CI 보완 계층
- `docs/security/verification-checklist.md`: 훅, CI, PR 수동 확인 증거
- `docs/guides/testing.md`: 보안 게이트 테스트와 훅 설치·검증 명령
- `docs/security/free-plan-compensating-controls.md`: 운영 절차, 우회 가능성, 업그레이드 조건

문서는 branch protection, secret scanning, push protection을 활성화된 것으로 표시하지 않는다.

## 10. 완료 기준

- `maintenance-branch`가 로컬과 원격에 존재하며 생성 시점의 `main`과 같은 SHA다.
- `feature/free-plan-security-gates`에서 모든 보안 게이트 테스트가 유효한 RED를 거쳐 GREEN이 된다.
- 로컬 훅이 설치되고 `main` 직접 푸시를 차단한다.
- GitHub Actions가 PR에서 읽기 전용 권한으로 통과한다.
- 비밀정보 검사 결과가 실제 값을 노출하지 않는다.
- CODEOWNERS와 PR 템플릿이 존재한다.
- 보안·테스트 문서가 무료 플랜 제한과 잔여 위험을 정확히 설명한다.
- 기능 브랜치 PR의 동일 SHA에서 CI 결과와 수동 보안 체크리스트가 확인된다.

## 11. 업그레이드 경로

향후 지원 플랜으로 전환하면 버전 관리된 `.github/settings/main-protection.json`을 적용하고 live read-back으로 확인한다. 서버 측 branch protection과 secret scanning/push protection이 활성화되면 보완 통제는 방어 심층화 계층으로 유지하되, 무료 플랜 위험 수용 문서는 종료 날짜와 검증 증거를 기록해 갱신한다.
