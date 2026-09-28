# 정상 PR 병합 증빙 기반 CI 정책 설계

## 1. 목적·승인 상태

사용자는 2026-09-24에 2안인 **GitHub의 실제 병합 PR 기록과 push 전후 커밋 대조**를 확정했다. 목적은 정상 PR 병합의 오탐을 없애되 무단 main 직접 push 탐지를 유지하는 것이다. 보안 우선, 역할별 작은 파일, 한국어 설명·매개변수 주석, 변경 전 범위 설명을 유지한다.

상태는 **2026-09-28 보완 목표·로컬 실행 승인 / 원격 P1 미종결**이다. [구현·리뷰 기록](../../status/2026-09-24-ci-merge-provenance.ko.md)을 함께 읽어야 한다. 아래 원설계의 직접 push 탐지 목표는 간접 병합 경계를 충분히 다루지 못했다. push/PR/병합/배포는 진행하지 않는다.

### 2026-09-28 승인된 보완 경계

- [무료·공개 기본 보호](2026-09-24-public-repository-branch-protection-design.md)의 목표는 PR·필수 검사 조건 미충족 main 변경의 서버 차단이다. UI/API 전송 경로 독점을 증명하는 목표가 아니다.
- 이 증빙 모듈은 PR·커밋의 연관성만 담당한다. 단일/두 부모 간접 병합 특성화 테스트는 한계를 고정하며 경로 보안 해결 테스트가 아니다.
- 로컬 목표 JSON은 strict security-gate와 관측 app_id=15368, PR 필수·타인 승인 0, 관리자 적용, force/delete 금지, 일반 merge 허용이다. 실제 서버 적용/정상·거부 검증은 별도다.
- 본인 확인은 H(PR head)/B(검사 base)/C(실제 checkout)/run/event에 결속한다. H=C를 강제하지 않으며 후보·검사 정의가 바뀌면 재확인한다. 같은 앱·이름·digest는 workflow 내용 신뢰를 대신하지 않는다.
- 사후 API 장애가 품질 미실행으로 이어지는 현재 순서는 유지한다. 원인 해소 후 동일 이벤트를 수동 재실행하고 자동 우회는 하지 않는다.

### 독립 리뷰에서 발견한 설계 공백

GitHub는 PR head가 직접 main push 등 다른 경로로 도달 가능해져도 PR을 merged로 기록할 수 있다. 따라서 본 설계의 상태/SHA/부모 검증은 PR 연관성은 확인하지만 허용된 병합 경로까지 증명하지 않는다. [공식 간접 병합 설명](https://docs.github.com/en/pull-requests/reference/pull-request-merges#indirect-merges). 합성 fast-forward/로컬 merge 증빙이 현재 판정기를 통과하는 것을 확인했다. 실제 원격 우회 실험은 하지 않았다.

단일 부모의 head=after를 거부하는 최소 패치만으로는 로컬 두 부모 merge 직접 push를 구분하지 못한다. 위 보완 경계를 승인받았지만 원격 통제 증거가 없는 미해결 상태를 완료로 보지 않는다. 아래 2~10절은 원설계 기록이며 현재 목표와 충돌하면 위 보완 경계를 우선한다.

## 2. 확인한 사실과 대안

- 기준 main: `9e2ff81b88c8f6290f68c9bebb1b4bb43493cac5`. PR #12의 정상 merge commit이며 부모는 기존 main `5229dc9`와 검증된 PR head `cf349d1`이다.
- 기존 `assertCiPolicy`는 push/main을 무조건 거부한다. 이 때문에 병합 후 run `35832112508`의 마지막 단계만 실패했고 기능·coverage·DB·브라우저 검사는 통과했다.
- PR #13은 main 대상 OPEN이고 새 main 기준 run `35832153212`는 성공했다. 이번 변경과 별개이며 자동 병합하지 않는다.
- 기존 운영 문서는 squash를 안내하고 최근 누적 PR은 merge commit을 사용했다. 둘 다 지원하는 판정으로 문서와 실행을 맞춘다.

| 대안 | 장점 | 단점·선택 |
| --- | --- | --- |
| main push 검사를 제외 | 가장 단순, 외부 조회 없음 | 직접 push 사후 탐지도 없어져 제외 |
| 실제 병합 기록 + 정확한 SHA·부모 검증 | 필요한 경계만 강화, 역할 분리가 쉬움 | 읽기 권한·API 실패 처리 필요, 선택 |
| 모든 병합 방식·복수 갱신 이력 추적 | 다양한 운영 방식 지원 | 검증 상태와 유지 비용 증가, 후속 확장 |

## 3. 용어와 보장 범위

SHA는 커밋을 식별하는 값이다. before는 이번 push 직전 main, after는 push 직후 main이다. 부모 커밋은 변경이 어떤 이전 상태에 연결되는지 나타낸다. GitHub의 merge_commit_sha는 PR이 실제 병합된 뒤의 결과 SHA다. 미병합 PR에도 임시 시험 병합 SHA가 있으므로 SHA만 같다고 허용하지 않는다.

이 검사는 **이번 갱신을 병합된 PR 및 정확한 Git 이력과 연결할 수 있는가**를 판정한다. 리뷰 승인 여부나 병합 전 정확한 head의 CI 성공까지 자동 보장하지 않는다. 기존 수동 병합 전 확인을 유지한다. GitHub에 도달한 변경을 검사하는 사후 통제이며 이미 반영된 push를 되돌리거나 서버에서 사전 차단하지 않는다.

커밋 메시지의 PR 번호, 작성자 이름, 서명 표시, 부모가 두 개라는 사실만으로 허용하지 않는다. 관리자 계정·workflow 자체가 손상되면 동일 저장소 안의 검사도 바뀔 수 있다. 이 잔여 위험은 branch protection과 동등하다고 표현하지 않는다.

## 4. 판정 계약

### 4.1 입력 및 이벤트 경계

- GitHub Actions의 push/main만 새 증빙 경로를 사용한다. pre-push는 여전히 main을 무조건 거부한다. PR 및 feature/hotfix/maintenance의 기존 경로는 유지한다.
- GitHub가 제공한 이벤트 파일의 저장소 ID·이름, ref, before, after를 실행 컨텍스트 및 기존 CLI 값과 대조한다. SHA는 정확한 40자리 16진수이며 0 SHA·같은 before/after를 거부한다.
- forced/created/deleted는 모두 명시적 false여야 한다. 누락·잘못된 타입도 거부한다. HEAD는 after여야 하고 shallow checkout은 허용하지 않는다.
- 저장소 이름만 아니라 숫자 ID도 일치해야 한다. 사용자 입력의 API URL이나 PR 응답 속 URL을 그대로 호출하지 않는다.

### 4.2 GitHub 증빙

고정 GitHub API 호스트의 `repos/{owner}/{repo}/commits/{after}/pulls`로 후보를 조회한 뒤 일치 후보의 PR 상세를 재확인한다. 완료되지 않은 페이지에서 임의의 첫 후보만 선택하지 않는다.

허용에는 다음이 모두 필요하다: 실제 merged=true 및 유효한 merged_at, state=closed, draft=false, 정확한 base 저장소 ID·이름, base.ref=main, merge_commit_sha=after. 일치 후보가 없거나 둘 이상이면 실패한다. PR 상세와 후보의 ID·결과 SHA가 충돌해도 실패한다. 필수 필드 타입을 엄격히 검사하되 GitHub의 관계없는 추가 필드는 무시한다.

### 4.3 Git 부모 관계

| 결과의 부모 | 추가 조건 | 결과 |
| --- | --- | --- |
| 2개 | 첫 부모=before, 둘째 부모=해당 PR head.sha | 일반 merge commit 허용 |
| 1개 | 유일한 부모=before, 실제 병합 PR의 결과 SHA=after | squash 등 단일 결과 커밋 허용 |
| 그 외 / 불일치 | 첫 부모를 따라가야만 before에 도달하는 여러 커밋 포함 | 미지원 또는 불일치로 실패 |

단일 커밋 rebase는 squash와 같은 위 증빙 조건을 만족할 수 있으며 이름만으로 구분하지 않는다. **여러 커밋 rebase는 이번 지원 범위가 아니다.** 동일 push에 여러 병합을 모으는 배치, merge queue도 지원하지 않는다. 미지원은 우회 승인이 아니라 별도 설계·테스트가 필요한 상태다.

GitHub PR의 base.sha는 오래된 이벤트의 before 대신 사용하지 않는다. push 이벤트의 before와 로컬 부모를 직접 대조해 나중에 진행된 main이나 재실행 시점의 main을 잘못 기준으로 삼지 않는다.

## 5. 실행 분리와 권한

같은 workflow 안에 main 증빙 작업과 기존 품질 검사 작업을 분리한다. 증빙 결과를 사용자 입력 boolean, CLI의 allow-main 플래그, 변경 가능한 파일 하나로 대신하지 않는다.

| 작업 | 실행 조건·역할 | 권한·토큰 |
| --- | --- | --- |
| main 증빙 작업 | push/main에만 실행. 정확한 SHA checkout 후 증빙 판정과 기존 구조·커밋 이력 secret scan 실행 | contents:read + pull-requests:read, 자동 GITHUB_TOKEN을 증빙 실행 단계에만 전달 |
| 기존 security-gate 작업 | 증빙 작업 결과를 먼저 판정한 뒤 기존 lint·타입·테스트·빌드·coverage·폐기용 DB·브라우저·감사 실행 | 기존 contents:read 유지. PR 조회 토큰을 앱 테스트에 전달하지 않음 |

증빙 작업은 외부 패키지 설치나 앱 실행 없이 Node 내장 API와 기존 Git 읽기·구조 검사만 사용한다. checkout은 전체 이력, persist-credentials:false, 승인된 Action SHA 고정을 유지한다. 새 PAT·운영 secret·쓰기 권한·pull_request_target은 추가하지 않는다.

기존 security-gate 이름을 유지한다. main에서는 증빙 작업 성공일 때만 품질 검사를 진행한다. 실패·취소·예상하지 않은 skipped는 성공으로 바꾸지 않고 체크가 실패/취소 상태로 남아야 한다. non-main에서만 증빙 작업의 의도된 skipped를 허용한다. needs로 인한 암묵적 skipped가 성공처럼 보이지 않도록 작업 시작 조건과 첫 결과 검사를 명시적으로 테스트한다.

main의 구조·이력 secret scan은 증빙 작업에서 수행하며 품질 작업에서 중복하지 않는다. non-main의 기존 마지막 gate 단계는 유지한다. 이 구분은 검사 제거가 아니라 토큰이 있는 격리 작업으로의 이동이며 workflow 정책 테스트가 이벤트별 실행 위치를 강제한다. 자동 배포·자동 병합을 연결하지 않는다.

## 6. 모듈 책임과 자원 한도

- `github-merge-evidence.mjs`: 이벤트/컨텍스트 일치 검증 및 고정 API 조회. 테스트에서는 fetch를 주입한다. 실제 계정 없이도 모든 HTTP 경로를 검사할 수 있어야 한다.
- `merge-evidence.mjs`: 정규화한 이벤트·PR 증빙·Git 부모를 받는 순수 판정. HTTP나 토큰을 다루지 않는다.
- 기존 CLI: main CI일 때만 비동기로 증빙을 구한 뒤 기존 gate에 전달한다. gate는 판정기를 통해 증빙을 검사하며 단순 truthy 값이나 외부 승인 플래그를 신뢰하지 않는다. pre-push는 네트워크 없이 기존 동작을 유지한다.
- Git 명령은 shell 문자열 결합 없이 인자 배열로 실행한다. 형식이 확인된 SHA만 사용한다. 토큰은 자식 구조 검사·Git 프로세스에 전달하지 않도록 별도 환경에서 제거한다.

조회 전체 예산은 본문 읽기까지 10초, 응답당 최대 1MiB, 후보 목록은 페이지당 100개·최대 3페이지다. 더 많은 페이지가 있으면 부분 결과로 허용하지 않고 확인 불가로 종료한다. 각 페이지 URL은 고정 경로와 page 숫자로 구성하고 외부 Link URL을 따라가지 않는다. redirect는 거부한다. 자동 재시도·오류 응답 원문 출력·응답 파일 저장은 하지 않는다. API 반영 지연은 실패를 기록한 뒤 동일 이벤트 CI를 수동 재실행할 수 있다.

## 7. 실패·로그·운영

정상 조회에서 일치 PR 없음/부모 불일치 등은 정책 거부, 401/403/429/5xx·시간 초과·JSON/페이지/크기 오류는 증빙 확인 불가로 구분한다. 둘 다 비정상 종료하며 확인 불가를 곧바로 침해 확정으로 표현하지 않는다. 구체적인 오류 코드는 실행 계획에서 기존 SecurityGateError 형식에 맞춰 고정한다.

성공 로그는 PR 번호·검증 SHA·검사 blob 수만, 실패 로그는 고정 코드·안전한 안내만 남긴다. Authorization, token, 원시 이벤트/응답, PR 본문·작성자 개인정보는 출력하지 않는다. 상위 예외도 기존 안전한 고정 오류로 변환한다.

규칙 배포 전의 실패 run을 단순 재실행한다고 새 규칙 검증이 되는 것은 아니다. 새 기능 브랜치 PR에서 정책 테스트를 통과시키고 승인된 병합의 새 main 이벤트에서 성공을 확인한다. 운영 main에 직접 푸시하는 음성 실험은 하지 않는다. 실제 GitHub API의 읽기 전용 대조와 합성 이벤트·폐기용 Git 이력 테스트를 사용한다.

## 8. 파일 지도·예상 규모

설계 단계 산출물은 이 Markdown 1개와 노션 갱신이었다. 당시 구현 예상은 다음 표의 14~16파일이다. 승인 후 실행 계획에서 공통 테스트 fixture 1개와 Git 부모 검증의 기존 모듈/독립 테스트 2개를 명시해 총 19파일로 구체화했다. 기능 범위 확대는 아니며 기존 495줄 workflow 정책 테스트에는 API 사례를 추가하지 않고 독립 테스트 파일로 둔다.

| 구분 | 대상 | 역할 |
| --- | --- | --- |
| 신규 4개 | scripts/security/{github-merge-evidence,merge-evidence}.mjs 및 각 .test.mjs | 조회/순수 판정 분리와 테스트 |
| 수정 6개 | scripts/security-gate.mjs, scripts/security/{gate,push-policy}.mjs 및 각 기존 테스트 | 증빙 연결, 기존 경로 회귀 |
| 수정 2개 | .github/workflows/security-gate.yml, scripts/security/workflow-policy.test.mjs | 작업·권한 분리 및 해시/실행 계약 |
| 문서 2~4개 | 이 설계, 구현 계획, docs/security/free-plan-compensating-controls.md, 최종 결과 기록 | 승인·운영·검증 근거 |

제품/UI·인증 런타임·금융 DB·의존성·coverage 기준은 변경하지 않는다. 기존 사용자 .gitignore 수정도 포함하지 않는다. 함수 역할·매개변수·반환값·실패 조건을 한국어 주석으로 설명한다. 특정 파일이 과도하게 커지거나 새 보안 정책이 필요해지면 구현 전에 변경 범위를 다시 설명한다.

## 9. 검증과 완료 조건

1. 정상 merge와 squash가 통과하고 같은 부모 형태의 직접 커밋·위장 메시지는 거부된다.
2. 미병합 PR의 임시 merge SHA, 다른 저장소/브랜치/SHA, 잘못된 head·부모, 중복 후보를 거부한다.
3. force/create/delete, 잘못된 이벤트 타입·필드·SHA·HEAD, 여러 커밋 rebase·오래된 증빙 재사용을 거부한다.
4. 다중 페이지·한도 초과·일시적 미반영·권한/요청 제한/서버 오류·본문 중단·시간 초과·비정상 JSON·redirect를 검사한다.
5. 토큰·오류 원문의 비노출과 자식 프로세스 환경 제거를 검사한다. 테스트 값은 합성 값만 사용한다.
6. main 증빙 실패/취소/skipped와 non-main skipped 조합, 권한·Action SHA·checkout·검사 순서·전체 YAML 기준 해시를 검사한다.
7. 기존 local main 차단, feature/hotfix/maintenance·PR 경로, 전체 secret scan 범위가 유지된다.
8. 제품 구현 전에 실패 재현 테스트를 작성하고 RED→GREEN을 기록한다. focused 검사 → 전체 pnpm verify → 인증 분기 100% coverage → 독립 리뷰 → 승인된 최신 PR CI 순서로 검증한다.
9. 완료 보고에는 실제 검사 SHA·실행 종료 코드·CI 결과와 미검증 범위를 구별한다. 합성 검사 통과를 실제 post-merge 성공이라고 표현하지 않는다.

## 10. 근거와 현재 검토 결과

- [GitHub: 커밋을 도입한 병합 PR 조회 및 pull-requests 읽기 권한](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit)
- [GitHub: 병합 상태/방식에 따른 merge_commit_sha](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [GitHub: workflow 이벤트](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
- [이전 인증 커버리지 보완 기록](../../status/2026-09-23-auth-coverage-completion.ko.md)

2026-09-24 설계 작성 전 현재 정책/gate/workflow 집중 테스트 24개 통과(exit 0). 이는 기존 코드 기준선이며 새 증빙 기능 테스트가 아니다. 서면 자체 점검에서는 미병합 시험 SHA, 단일 커밋 rebase와 squash의 구분 한계, API 페이지 누락, 작업 skipped 처리, 자식 프로세스 토큰 상속, 사후 통제의 한계를 명시했다. 서면 승인 전 구현 계획·CI 변경·push·PR 생성·병합·배포를 진행하지 않는다.
