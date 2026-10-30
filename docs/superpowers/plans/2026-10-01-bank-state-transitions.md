# Bank State Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 은행 연결의 시작·콜백·일회성 교환·종료를 최소 권한 DB 함수로 구현한다.
**Architecture:** 기존 A2.1 테이블을 유지하고 NOLOGIN 함수 역할로 쓰기 범위를 제한한다. 인증 문맥과 세션/proof를 확인하고 행 잠금 이후 실제 시각으로 만료를 판정한다.
**Tech Stack:** PostgreSQL17, TypeScript, pg, Vitest. 새 의존성 없음.
**Spec:** docs/superpowers/specs/2026-10-01-bank-state-transitions-design.md

## Global Constraints

- 운영 DB·실계좌·외부 비밀값 사용 금지. 고정 폐기용 DB만 사용.
- 기존 dirty 인증/거래 작업을 보존하며 이 계획은 별도 파일 위주로 진행.
- 요청300초, 보관 코드 최대60초; 만료 경계는 >=; 외부 HTTP는 DB 잠금 밖.
- 한국어 함수/매개변수 주석. PUBLIC 실행, runtime DML, 역할 membership 금지.
- 사용자의 일반 개발 재승인 생략 지시와 기존 순차 구현+마지막 독립 리뷰 방식을 유지한다.
- 커밋/푸시는 이번 요청에 명시되지 않아 하지 않는다. 결과와 검증을 남긴다.

## Review Focus

- 잠금 대기 중 만료: transaction 시작 시각 대신 lock 이후 시각 검사(Task3).
- NULL proof/다른 세션으로 종료·완료 가능한지(Task2/3).
- malformed 토큰 때문에 연결 행만 남는 부분 성공(Task2).
- callback_context가 임시코드/proof/완료자료를 노출하는지(Task1).
- 두 DB 연결의 start/claim/cancel 경쟁이 하나의 처리만 허용하는지(Task3).

### Task 1: 시작과 Callback

**Files:** create supabase/migrations/202610010003_bank_request_intake.sql; tests/database/bank-intake.test.ts; tests/database/support/bank-flow.ts. Modify tests/database/support/bank-database.ts.
**Interfaces:** spec의 start_request(uuid,uuid,text,bytea,bytea)→uuid, callback_context(bytea)→table(id,user_id,environment), receive_callback(bytea,jsonb,boolean)→uuid.
- [x] 테스트 fixture에 독립 연결/commit helper와 새 migration 순서를 연결한다.
- [x] start 생성/재시작 취소/문맥 거부, callback context 최소 필드/중복 방지/거부/만료/형식 검사 테스트 작성.
- [x] Run: pnpm --filter @account-book/database-tests test -- bank-intake.test.ts. Expected RED: 함수 부재.
- [x] 최소 권한 함수 역할 및 세 함수를 구현한다.
- [x] 같은 명령 GREEN, 기존 bank 4파일 회귀.

### Task 2: 단 한 번의 교환과 원자적 완료·종료

**Files:** create supabase/migrations/202610010004_bank_request_exchange.sql; 202610010005_bank_request_end.sql; tests/database/bank-exchange.test.ts.
**Interfaces:** claim_exchange(uuid,uuid,bytea)→jsonb; finish_exchange(uuid,uuid,bytea,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz)→boolean; end_request(uuid,uuid,bytea,text)→text.
- [x] 정상 claim/code삭제/재시도거부, user/session/proof, 시작 전 완료 거부, 완료 원자 rollback, 토큰 수명 오류, 실패/취소/만료 테스트 작성.
- [x] Run: pnpm --filter @account-book/database-tests test -- bank-exchange.test.ts. Expected RED: 함수 부재.
- [x] claim·finish·end를 구현한다. 기존 연결 덮어쓰기·예외 무시 금지.
- [x] 같은 명령 GREEN과 bank-intake 회귀.

### Task 3: 경쟁 요청·권한 강화와 최종 검증

**Files:** create tests/database/bank-flow-races.test.ts; docs/status/2026-10-01-bank-state-transitions.ko.md. Modify docs/database/bank-connections.ko.md; docs/guides/bank-connection-foundation.ko.md; docs/README.md.
**Interfaces:** Task1/2 함수 + 테스트용 독립 연결을 사용한다.
- [x] start 두 연결, callback 두 연결, claim 두 연결, cancel/claim 경쟁, 잠금 대기 중 만료 및 모든 함수 ACL/role membership 검사.
- [x] Run focused tests; 문제를 발견하면 RED→GREEN 보완.
- [x] Run pnpm test:db, pnpm test, pnpm lint, pnpm typecheck. Expected 모두 exit0.
- [x] 새 문서·문의문·Notion 체크를 갱신하고 최종 독립 리뷰를 수행한다.
- [x] PC 로컬 login 브라우저 smoke. 신규 은행 UI·공식 금융결제원 테스트·운영 확인은 미실행으로 기록한다.

결과: 실제 DB271개·일반1,598개·lint·타입 통과. 독립 리뷰 비차단1건(일부 경쟁 테스트의 강제 겹침/순서 강화)은 후속 기록. [검증 내역](../../status/2026-10-01-bank-state-transitions.ko.md).
