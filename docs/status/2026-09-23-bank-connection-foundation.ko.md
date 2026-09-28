# 은행 연결 기반 진행 기록

이 기록은 은행 연결 기반 작업의 완료 범위를 구분한다. 공개 계약이 존재한다고 해서
서버·DB 저장 또는 금융기관 연결이 동작한다는 뜻은 아니다.

## 최신 통합 진행 — 2026-09-28

- 아래2026-09-23 기록은 당시 상태다. A1은 원격 PR #13으로 이미 제출됐으며, 최신main e43260d를 기능 브랜치에 충돌 없이 반영했다(후보1d3c558). main 대비 A1 기능 변경은 기존9파일 +567줄 그대로다.
- 최신 후보 `pnpm verify` exit0: lint·타입·API/웹 빌드와1,187개(legacy195/contracts74/DB단위15/API174/web643/preflight86) 통과. 과거 EPERM 실패 기록은 그대로 보존한다.
- 공개 저장소 main 보호와 CI 보완은 PR #14/#17로 통합됐고 main 실행36400707374가 실제 병합 근거·품질 검사에 성공했다. 이를 A1의 실제 DB/은행 연결 검증으로 대신하지 않는다.
- 최신 독립 리뷰 Critical/Important/Minor0. 리뷰어는 기존 집중34개와 추가 공격 입력11개를 별도로 통과시켰다. 추가 검사는 전체 자동 테스트1,187개에 합산하지 않는다.
- A1의 최신 원격 CI·정상 main 통합은 별도 추적한다. DB/RLS·API/BFF·은행 공급자·모바일은 아직 미구현이며 다음은A2 저장소 상세 설계/실제 DB 검증이다.
- 사용자 `.gitignore` 변경은 보존하고 커밋에서 제외한다. 원시 증거는 복구를 위해 Git 제외 경로에 보존한다.

## 작업 기록

- Task 1 — 공개 상태 계약: 완료. 요청 ID UUID, 공개 상태 enum, 엄격한 요청 상태
  object와 package root export를 추가했다. 민감 필드와 알 수 없는 상태/ID를 검사한다.
- Task 2 — 연결 비밀값 기반: 완료. API 내부에 정규 32바이트 base64url 비밀값 생성,
  비교용 SHA-256 지문, 엄격한 만료 경계 판정과 5분/60초 TTL 상수를 추가했다.
  원자적 한 번 사용과 세션 결속은 아직 구현하지 않았으며, 이를 제공하는 endpoint,
  DB 또는 provider 연동도 없다.
- Task 3 — API 전용 토큰 암호화 봉투: 완료. AES-256-GCM으로 비어 있지 않은 최대
  64KiB 문자열을 암호화하고 사용자·자원·공급자·환경·용도를 AAD에 묶는다. 난수
  nonce, 인증 태그, 키 식별자를 포함하며 구키 보유·제거에 따른 복호화 차이를
  검증했다. 잘못된 UTF-16 문자열의 무음 치환을 거부하고 정상 유니코드 왕복을
  유지한다. 키 주입·폐기 운영과 토큰 저장은 아직 구현하지 않았다.
- DB와 HTTP endpoint: 미구현.
- 인가 코드·토큰 저장 및 provider 연동: 미구현.
- 잔액·거래 수집: 미구현.

## 검증 기록

- Task 1 RED — `pnpm --filter @account-book/contracts test -- src/bank-connections.test.ts`: 새 테스트는 발견됐고 구현 모듈 부재로 실패했다. GREEN — 같은 명령, 1개 파일·8개 테스트 통과. 계약 패키지 typecheck 통과.
- Task 1 전체 검사 — `pnpm test` 통과: legacy 54, contracts 74, database 15, API 148, web 569, e2e preflight 85 (총 945).
- Task 2 RED — `pnpm --filter @account-book/api test -- src/bank-connections/security/connection-secret.test.ts`: 구현 부재로 모듈 import 실패. GREEN — 같은 명령, 1개 파일·13개 테스트 통과. API typecheck 통과.
- Task 2 전체 검사 — `pnpm test` 통과: legacy 54, contracts 74, database 15, API 161, web 569, e2e preflight 85 (총 958). 첫 실행의 최종 출력/종료 상태를 잃어 재실행했으며, 기록한 수치는 종료 코드 0으로 캡처된 실행 결과다.
- Task 3 첫 RED — `pnpm --filter @account-book/api test -- src/bank-connections/security/token-envelope.test.ts`: 구현 모듈 부재로 실패했다. 첫 GREEN — 같은 명령, 1개 파일·11개 테스트 통과. 추가 RED — 잘못된 UTF-16 원문의 무음 치환을 거부하는 테스트 1개 실패. 최종 GREEN — 같은 명령, 1개 파일·12개 테스트 통과. API typecheck 통과.
- Task 3 첫 구현(`969e22f`) 전체 검사 — 당시 코드에서 `pnpm test` 종료 코드 0: legacy 54, contracts 74, database 15, API 173, web 569, e2e preflight 85 (총 970). 출력과 종료 상태는 무시되는 로컬 로그에 보존했다.
- 전체 브랜치 수정 전 검사 — `969e22f` 시점의 `pnpm verify` 종료 코드 0: 테스트 970개, lint·타입 검사·빌드 통과. 아래 후속 수정의 최종 검사 결과로 혼동하지 않는다.
- 후속 수정 RED — 64KiB 초과 값을 UTF-8 Buffer로 변환하기 전에 거부하는 테스트에서 1개 실패·12개 통과. GREEN — 같은 집중 명령에서 1개 파일·13개 테스트 통과, API typecheck 통과. 이 수정에 대한 전체 `pnpm verify`는 상위 작업에서 재실행한다.

현재 `feature/bank-connection-foundation`의 변경은 로컬 커밋에만 있다. 다음 단계는
A2 DB 실행 계획과 소유자 격리 검증이다. DB·브라우저·공급자 연동 테스트나
푸시·PR·배포를 이 단위 검증의 성과로 주장하지 않는다.

후속 작업은 완료한 항목만 갱신하고, 공개 계약·연결 인증·잔액 및 거래 수집 상태를
서로 혼동하지 않도록 유지한다.

## 최종 확인 — 2026-09-23

- 코드 기준: `11f2fb6`, `feature/bank-connection-foundation`. 기능·테스트·주석·문서 9개 파일 변경이며, 기준 937개에서 신규 테스트 34개가 추가됐다.
- 최종 `pnpm verify`에서 lint·타입 검사·971개 테스트는 통과했다. 웹 빌드는 기존 `.next` 생성 폴더 삭제 중 Windows `EPERM`으로 실패했다. 소스 수정이나 파일 강제 삭제 없이 동일 코드의 `pnpm build`를 재실행해 종료 코드 0으로 통과했다. 따라서 마지막 `pnpm verify` 자체를 성공으로 기록하지 않는다. 파일 잠금·동기화 등 구체적 원인은 확정하지 못했다.
- 테스트 합계: legacy 54, contracts 74, database 15, API 174, web 569, E2E 사전 검사 85 = 971. 실제 DB 접속·브라우저 E2E·금융결제원 호출을 실행한 결과는 아니다.
- 세 작업의 독립 검토와 전체 코드 검토 완료. 전체 검토의 경미한 지적 2건(크기 검사 순서, 확인값 발급 주체 설명)을 `11f2fb6`에서 수정했고 재검토에서 모두 해결됐다. 남은 중대·중요 지적은 없다.
- 로컬 커밋: `c7be6cd`, `17160eb`, `62ddc0c`, `969e22f`, `11f2fb6`. 푸시·PR·병합·배포는 하지 않았다. 기존 사용자 `.gitignore` 수정은 스테이징하지 않았다.
- 실행 중 원시 로그는 임시 검토 공간에 수집했다. 마무리 시 임시 공간은 정리하며, 재개에 필요한 명령·결과·실패 이력은 이 문서와 Notion에 유지한다.
- 다음 작업은 A2 DB 실행 계획 작성·검토다. 사용자별 RLS, 최소 권한, 일회성 원자 처리, 만료 정리, 공유 요청 제한을 설계·검증한 뒤 API/BFF와 연결한다.
