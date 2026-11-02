# A5·A6 실행 계획

> 실행: superpowers:executing-plans. 승인된 은행 연결 설계를 유지하며 직접 구현하고 마지막에 독립 리뷰한다.

**Spec:** docs/superpowers/specs/2026-10-02-bank-integration-design.md

**Goal:** 실제 내부 계층을 통과하는 가짜 은행 연결 E2E와 공식 TEST 전환 게이트를 남긴다.

**Global Constraints:** 운영·사용자 데이터 미변경, 비밀 비출력, 일반 런타임 비활성, 최소권한, Playwright 검증.

## Task 1: E2E 활성화·환경 격리

Files: tests/e2e/playwright-environment.ts 및 테스트, apps/web/src/server/bank-connections/e2e-runtime.ts 및 테스트,
apps/web/src/server/container.ts, apps/web/src/app/app/bank-connections/page.tsx.

Interfaces: 정확한 폐기용 설정에서만 https://bank.invalid/authorize 를 반환하며 기본 null.

1. 은행 설정 누출과 비안전 fake 활성화를 거부하는 테스트 작성.
2. `pnpm --filter @account-book/e2e test:preflight`, web targeted vitest 실행. Expected: 새 조건에서 RED.
3. 최소 구현 후 동일 테스트. Expected: GREEN.
4. 전체 `pnpm test` 확인 후 변경 기록.

## Task 2: 실제 내부 계층 은행 E2E

Files: apps/api/src/bank-connections/testing/e2e-*.ts, tests/e2e/bank/*, tests/e2e/core/setup.ts,
tests/e2e/package.json. 필요 시 기존 테스트 DB 도우미를 재사용한다.

Interfaces: Task 1 활성화 flag 및 origin/DB/API 고정값, 실제 BankRepository/인증 가드, Playwright core 준비 절차.

1. API 테스트 진입점은 별도 파일·엄격한 로컬 설정 gate로 제한한다.
2. 은행 migration을 폐기용 DB에만 적용하고 BFF/API 최소 권한으로 서버를 시작한다.
3. 실제 browser 시나리오를 작성·실행한다. 기존 A4 기능 검증이며 제품 코드 변경이 필요한 버그는 재현 RED 후 수정한다.
4. `pnpm --filter @account-book/e2e test:bank` 실행. Expected: 내부 HTTP/DB 흐름 통과, 민감정보 비노출.
5. lint/typecheck/전체 테스트 실행. Expected: 통과.

## Task 3: A6 공식 TEST 게이트·문서

Files: docs/guides/bank-integration-testing.ko.md, docs/status/2026-10-02-bank-integration.ko.md 및 Notion 기능 10.

Interfaces: Task 2 검증 결과와 공식 10-A 테스트 공급자 계약. 추정 endpoint 금지.

1. 공식 문서와 로컬 설정 존재 여부(값 제외)를 확인한다.
2. 확인된 항목/미확인 항목/사용자 조치/재개 순서를 문서화한다.
3. 공식 명세와 Callback 등록이 확보되면 adapter를 TDD로 구현하고 공식 TEST 흐름을 실행한다.
   미확보 시 A6를 명세 대기로 남기고 성공으로 표시하지 않는다.
4. Notion에 실제 결과 반영, fresh-context 리뷰와 최종 검증.

## Review Focus

fake 런타임의 운영 유입, 부모 secret 상속, 테스트 DB 삭제 범위, 실제 JWT/CSRF/RLS 우회,
토큰 브라우저·로그 유출, fake와 공식 TEST 성공 혼동, 기존 dev 서버 복원 여부를 확인한다.
