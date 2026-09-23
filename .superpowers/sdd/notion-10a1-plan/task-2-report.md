# Task 2 구현 보고

## 검증

- RED — `pnpm --filter @account-book/api test -- src/bank-connections/security/connection-secret.test.ts`: 구현이 없는 상태에서 `./connection-secret.js`를 찾지 못해 실패했다. 기대한 누락 모듈 경계의 실패이며, 테스트 0개 실행.
- GREEN — 같은 집중 테스트: 1개 파일, 13개 테스트 통과.
- 타입 검사 — `pnpm --filter @account-book/api typecheck`: 통과.
- 전체 검사 — `pnpm test`: 마지막 캡처 실행 종료 코드 0. legacy 54, contracts 74, database 15, API 161, web 569, e2e preflight 85 테스트 통과(총 958).

전체 검사 첫 실행의 출력 스트림은 중간에 끝나 최종 종료 코드를 잃었다. 완료된 것으로 추정하지 않았고, 프로세스가 종료된 뒤 출력과 종료 코드를 캡처하는 실행을 한 차례 더 했다. 확인 가능한 최종 실행은 모두 통과했다.

## 변경 파일

- `apps/api/src/bank-connections/security/connection-secret.ts`
- `apps/api/src/bank-connections/security/connection-secret.test.ts`
- `docs/guides/bank-connection-foundation.ko.md`
- `docs/status/2026-09-23-bank-connection-foundation.ko.md`
- `.superpowers/sdd/notion-10a1-plan/task-2-report.md`

## 자체 검토

- 독립 테스트 벡터는 `A` 43개가 32개의 0바이트로 디코딩된다는 점에 기반한다. 기대 해시는 `66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925`로 고정했다.
- 길이·문자·디코딩 후 재인코딩을 모두 검사해 공백, 패딩, 비정규 마지막 문자를 거부한다. 유효 난수의 마지막 유효 비트를 바꾸면 지문이 달라지는 테스트도 있다.
- 만료 시각과 같거나 이후, invalid Date, 음수 timestamp는 거부된다.
- state와 브라우저 확인값은 독립 호출로 발급하도록 가이드에 적었고, 원자적 일회용 처리·세션 결속은 A2/A3 범위임을 명시했다. endpoint·DB·실제 자격 증명·의존성 변경은 없다.
- Task 1 문서는 보존하고 후속 내용을 덧붙였다. 사용자 소유 `.gitignore` 변경은 스테이징하지 않았다.

## 커밋

커밋: `feat: add bank connection secret primitives` (로컬 커밋, 푸시하지 않음).

우려 사항: 전체 테스트는 첫 실행의 최종 상태를 캡처하지 못해 전체 명령을 한 번 재실행했다. 캡처된 최종 실행은 종료 코드 0으로 통과했다.
