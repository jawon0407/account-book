# Bank Limits and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** 공유 abuse 제한과 만료 인증자료 정리의 DB 계약을 구현한다.
**Architecture:** bounded timestamp 배열 슬라이딩 윈도, 잠금 이후 clock, 별도 maintenance 최소 EXECUTE.
**Tech Stack:** PostgreSQL17, TypeScript, Drizzle, pg, Vitest. 새 의존성 없음.
**Spec:** docs/superpowers/specs/2026-10-02-bank-limits-cleanup-design.md

## Global Constraints

- 시작 최근300초5회, Callback 최근60초60회. p_batch1..500(default100), 종류별 p_batch.
- 기존 dirty 작업 보존, 별도 운영 연결/비밀값/키/실계좌 호출/커밋·푸시 없음.
- 한국어 함수 목적·매개변수 설명; API 제한 호출은 A3에서 별도 commit으로 연결한다.
- 순차 구현+마지막 독립 리뷰. 반복 승인 대기만 기존 사용자 지시에 따라 생략한다.

## Review Focus

- quota 마지막 한 슬롯을 두 서버가 소비하는 경쟁(Task1).
- 잠금 대기 동안 quota가 만료될 때 오래된 transaction 시각 사용(Task1).
- 만료 코드가 남아 있는데 요청300초는 아직 지나지 않은 정리(Task2).
- 정리 작업이 연결 성공/저장 토큰을 건드리거나 잠긴 요청을 기다리는 문제(Task2).
- app_api가 내부 helper/정리를 호출하거나 테이블을 직접 조작하는 권한(Task3).

### Task 1: 공유 요청 제한

**Files:** create supabase/migrations/202610020001_bank_request_limits.sql; tests/database/bank-limits.test.ts. Modify tests/database/support/bank-database.ts, bank-flow-races.test.ts(기존6개 함수의 명시적 대상 유지).
**Interfaces:** consume_start_limit(), consume_callback_limit(bytea)→table(allowed boolean,retry_after_seconds integer), 내부 consume_limit(text,bytea). Table bank_request_limits(scope,key_digest,accepted_at,expires_at).
- [x] 한도5/60, 사용자/지문 격리, NULL/길이, 오래된 시각 제거·거부 미연장, 두 연결 마지막슬롯 및 잠금뒤시간 테스트 작성.
- [x] pnpm --filter @account-book/database-tests test -- bank-limits.test.ts; RED10개 함수 부재 확인.
- [x] 신규 SQL table/RLS/최소 함수 및 migration fixture 연결. 동일10개 GREEN.

### Task 2: 제한된 정리 권한과 batch

**Files:** create supabase/migrations/202610020002_bank_request_cleanup.sql; tests/database/bank-cleanup.test.ts. Modify tests/database/support/bank-database.ts.
**Interfaces:** cleanup_requests(integer default100)→table(expired_requests integer,removed_limits integer), app_bank_maintenance EXECUTE만.
- [x] 요청/코드만료·미만료·교환중·terminal/credentials보존·batch오류/상한·반복안전·quota정리·잠긴행생략 테스트 작성.
- [x] pnpm --filter @account-book/database-tests test -- bank-cleanup.test.ts; RED9개 함수 부재 확인.
- [x] 정리 SQL·role·pending expiry index 구현. cleanup9+limits10 GREEN.

### Task 3: 선언·권한·문서·회귀

**Files:** create packages/database/src/schema/bank-limits.ts; tests/database/bank-limits-access.test.ts; docs/status/2026-10-02-bank-limits-cleanup.ko.md. Modify packages/database/src/index.ts, schema/bank-requests.ts(index), tests/database/bank-parity.test.ts(expression/composite PK support), docs/database/bank-connections.ko.md, docs/README.md.
**Interfaces:** export bankRequestLimits, 기존 request 선언에 pending deadline 표현 index. SQL가 함수/권한 원본.
- [x] 새로운 quota table 카탈로그와 TS 일치/권한 실행 검사 먼저 작성. RED2개는 누락된 선언/index, 기존 권한5개는 통과.
- [x] 선언·테스트의 composite PK/표현 index 대조를 추가한다. focused7개 GREEN.
- [x] pnpm test:db294개, pnpm test1,598개, pnpm lint, pnpm typecheck 모두 exit0, PC 로그인→비밀번호 찾기 Playwright smoke 오류0/경고0.
- [x] Notion10/A2와 한국어 문서에 결과·메일 사용자 예약 완료·공식테스트 미실행 구분; 독립 리뷰 Critical0/Important0/Minor1 문서 표현 수정.

회귀 보완 파일 추가: tests/database/bank-storage.test.ts와 bank-access.test.ts의 기존3개 테이블 단정을 신규 제한 테이블까지 포함한4개로 갱신했다. 최종 문서 포함18파일이며 이전 인증/거래/A2.2 미커밋 변경은 보존했다.

최종 통과해도 로컬 DB 기반 완료이며 API/화면 활성화나 공식 테스트 성공이 아니다.
