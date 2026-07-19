# Testing Guide

## 1. 기본 원칙

행동을 구현하거나 수정할 때는 RED → GREEN → REFACTOR 순서를 사용한다. 테스트 실행기가 정상적으로 시작되고, 요구한 행동이 아직 없기 때문에 assertion이 실패한 경우만 유효한 RED로 기록한다. import 경로 오타, 문법 오류, 테스트 설정 실패처럼 assertion에 도달하지 못한 결과는 RED가 아니라 실행 오류다.

## 2. RED

1. 원하는 공개 행동과 결과를 테스트로 먼저 작성한다.
2. 해당 테스트만 실행한다.
3. 테스트 러너가 assertion에 도달했는지 확인한다.
4. 실패 메시지가 아직 구현하지 않은 행동을 가리키는지 확인한다.
5. 실행 명령, 종료 코드, 핵심 실패 출력을 작업 보고서에 기록한다.

프로젝트 기반 작업의 첫 RED 명령은 다음과 같다.

```powershell
pnpm test:structure
```

구조 검사 CLI가 아직 없을 때 테스트는 성공 종료 코드와 누락 경로 메시지를 받지 못해 assertion 단계에서 실패해야 한다.

## 3. GREEN

테스트를 통과시키는 최소 구현만 작성하고 같은 명령을 다시 실행한다. 프로젝트 기반 검사기는 다음 두 행동을 제공한다.

- 누락 경로가 있으면 해당 경로만 출력하고 종료 코드 `1`을 반환한다.
- 모든 경로가 있으면 성공 메시지를 출력하고 종료 코드 `0`을 반환한다.

구조 검사기의 GREEN 증거는 `pnpm test:structure`의 최신 출력과 검사한 commit SHA로 남긴다. 테스트 개수는 코드와 함께 변하므로 문서에 고정하지 않는다.

## 4. 실제 저장소 구조 검증

검사기 코드가 GREEN이어도 실제 저장소에 필수 문서가 없으면 다음 명령은 실패해야 한다.

```powershell
pnpm verify:structure
```

필수 폴더와 책임 문서를 만든 뒤 같은 명령이 `Repository structure verification passed.`를 출력하고 종료 코드 `0`을 반환해야 한다.

## 5. REFACTOR

GREEN 이후에만 중복 제거, 이름 개선, 책임 분리, JSDoc 보강을 수행한다. 리팩터링 뒤에는 집중 테스트와 전체 구조 검사를 모두 다시 실행하며 출력에 경고와 예상하지 못한 오류가 없어야 한다.

## 6. 인프라 변경 검증

GitHub 저장소, 브랜치 보호, 보안 설정은 애플리케이션 행동이 아니므로 TDD assertion 대신 변경 전후 상태 증거를 남긴다.

| 변경 | 변경 전 증거 | 변경 후 증거 |
|---|---|---|
| 비공개 저장소 | 대상 저장소가 존재하지 않음 | `isPrivate: true`, 기본 브랜치 `main` |
| 첫 푸시 | `origin/main` 없음 | 로컬·원격 `main` SHA 일치 |
| 브랜치 보호 | 보호 정책 없음 | 무료 플랜 API HTTP 403; 미지원 상태와 보완 통제를 기록 |
| 유지보수 브랜치 | 원격 브랜치 없음 | `main`과 `maintenance-branch` 최초 SHA 일치 |

## 7. 증거 보존

각 작업 보고서와 PR에는 실행 명령, 종료 코드, 통과·실패 개수, 핵심 출력, 검증한 commit SHA를 기록한다. 토큰, 쿠키, OAuth code, 전체 계좌 식별자, 실제 사용자 데이터는 테스트 출력과 증거에 포함하지 않는다.

## 8. 무료 플랜 보안 게이트

로컬과 CI는 같은 `scripts/security-gate.mjs`를 사용한다. 로컬 설치와 집중 검증은 다음 순서로 수행한다.

```powershell
pnpm setup:hooks
git config --local --get core.hooksPath
pnpm test:security-gate
pnpm verify:structure
```

hooks 경로 출력은 정확히 `.githooks`여야 한다. `main` 차단은 원격을 변경하지 않는 합성 pre-push 입력으로 테스트하고, `feature/*` 입력은 같은 방식으로 통과를 확인한다.

비밀정보 검사 테스트는 다음 실패 경계를 포함한다.

- 기존 ref에는 도입된 모든 커밋의 전체 tree blob을 검사한다.
- 신규 ref에는 head에서 도달 가능한 전체 이력을 검사한다.
- shallow 저장소는 불완전한 결과를 반환하지 않고 fail closed로 실패한다.
- 5 MiB 초과 blob은 오류로 실패하며 수동 승인만으로 우회할 수 없다. 파일 제거·검토된 별도 저장·또는 보안 검토와 회귀 테스트를 거친 검사 코드/한도 변경 전까지 push와 merge를 중단한다.
- 탐지 출력에는 실제 일치 값이나 경로 안의 지원 credential 형식이 남지 않는다. 경로는 credential을 규칙별 표기로 가리고 Unicode format control을 보이는 escape text로 렌더링한 뒤 JSON escape하며, 규칙 ID만 함께 남긴다.

CI 정책 테스트는 trigger, `contents: read`, secret 미참조, SHA-pinned Action, `fetch-depth: 0`, `persist-credentials: false`, 공통 CLI 연결을 검사한다. push concurrency group은 실행마다 고유한 `github.run_id`여야 하고 push 실행은 취소되지 않아야 하며, PR 실행에만 PR 번호 그룹과 `cancel-in-progress`를 허용한다. 이는 같은 SHA를 다시 가리키는 ref push가 같은 group의 pending 실행을 대체해 누락되는 일을 막는다. canonical workflow 테스트는 workflow 전체 digest가 검토값과 같은지 추가로 확인한다.

CI 결과는 해당 commit의 검사 증거이지 GitHub branch protection 또는 push protection의 활성 증거가 아니다. branch protection/rulesets는 API HTTP 403, secret scanning/push protection은 HTTP 422로 사용할 수 없으며, 로컬 hook은 `--no-verify`로 우회할 수 있고 CI는 이미 원격에 도달한 push를 되돌리지 못한다. 세부 운영 절차는 [GitHub 무료 플랜 보완 통제](../security/free-plan-compensating-controls.md)를 따른다.

테스트 개수는 문서에 고정하지 않는다. 실행 시점의 통과·실패 개수와 `git rev-parse HEAD` 결과를 작업 보고서와 PR에 함께 기록한다.
