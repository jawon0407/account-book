# 은행 연결 기반 진행 기록

이 기록은 은행 연결 기반 작업의 완료 범위를 구분한다. 공개 계약이 존재한다고 해서
서버·DB 저장 또는 금융기관 연결이 동작한다는 뜻은 아니다.

## 작업 기록

- Task 1 — 공개 상태 계약: 완료. 요청 ID UUID, 공개 상태 enum, 엄격한 요청 상태
  object와 package root export를 추가했다. 민감 필드와 알 수 없는 상태/ID를 검사한다.
- Task 2 — 연결 비밀값 기반: 완료. API 내부에 정규 32바이트 base64url 비밀값 생성,
  비교용 SHA-256 지문, 엄격한 만료 경계 판정과 5분/60초 TTL 상수를 추가했다.
  원자적 한 번 사용과 세션 결속은 아직 구현하지 않았으며, 이를 제공하는 endpoint,
  DB 또는 provider 연동도 없다.
- DB와 HTTP endpoint: 미구현.
- 인가 코드·토큰·provider 연동: 미구현.
- 잔액·거래 수집: 미구현.

## 검증 기록

- Task 1 RED — `pnpm --filter @account-book/contracts test -- src/bank-connections.test.ts`: 새 테스트는 발견됐고 구현 모듈 부재로 실패했다. GREEN — 같은 명령, 1개 파일·8개 테스트 통과. 계약 패키지 typecheck 통과.
- Task 1 전체 검사 — `pnpm test` 통과: legacy 54, contracts 74, database 15, API 148, web 569, e2e preflight 85 (총 945).
- Task 2 RED — `pnpm --filter @account-book/api test -- src/bank-connections/security/connection-secret.test.ts`: 구현 부재로 모듈 import 실패. GREEN — 같은 명령, 1개 파일·13개 테스트 통과. API typecheck 통과.
- Task 2 전체 검사 — `pnpm test` 통과: legacy 54, contracts 74, database 15, API 161, web 569, e2e preflight 85 (총 958). 첫 실행의 최종 출력/종료 상태를 잃어 재실행했으며, 기록한 수치는 종료 코드 0으로 캡처된 실행 결과다.

후속 작업은 완료한 항목만 갱신하고, 공개 계약·연결 인증·잔액 및 거래 수집 상태를
서로 혼동하지 않도록 유지한다.
