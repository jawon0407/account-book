# Android 단일 수집 기기 DB 경계 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 동일 세션 TDD 실행과 한 번의 독립 리뷰.

**Goal:** 기기 교체·철회와 늦은 자동 수집 저장을 동일 DB transaction에서 직렬화한다.
**Architecture:** 사용자당 단일 collector_state, 제한된 owner 함수, 기존 세션 sid와 API 사용자 문맥을 결합한다. API에 인증 테이블 읽기 권한은 주지 않는다.
**Tech Stack:** PostgreSQL 17, Drizzle, TypeScript, Vitest, 기존 NestJS UserDatabase.
**Spec:** [단일 수집 경계 설계](../specs/2026-10-16-collector-lease-design.md).

## Global Constraints

- Android 우선, 사용자당 자동 수집 1대, 복수 로그인/수기 작성 유지.
- 실제 Supabase·배포·커밋/푸시 변경 없음. 기존 혼합 미커밋 변경 보존.
- 앱/알림 수집/HTTP 공개는 후속. 이번 10~15개 파일의 DB·내부 API 기반을 전체 앱 완료로 표시하지 않는다.
- 일반 작업 추가 승인 생략 지시에 따라 계획을 먼저 공개하고 진행한다. Autoplan 참조 파일 누락은 직접 설계·TDD·독립 리뷰로 보완한다.

## Review Focus

1. SECURITY DEFINER 경로/실행 권한과 API의 세션 비밀 접근 차단: Task1 ACL 검사.
2. 기기 교체와 진행 중 원장 저장의 TOCTOU: Task1 실제 두 연결 잠금 검사.
3. 로그아웃/세션 삭제/만료/재로그인의 권한 부활: Task1 경계 검사.
4. 동시 최초 활성과 오래된 버전/NULL 입력: Task1 CAS 검사.
5. runCollector와 수기 run의 분리 및 트랜잭션 실패 은폐: Task2 통합/단위 검사.

### Task 1: 저장·최소 권한·직렬화 함수

**Files:** 새 `packages/database/src/schema/collector.ts`, index export, CLI 생성 `supabase/migrations/*_collector_lease.sql`, `tests/database/support/collector-fixtures.ts`, `tests/database/collector-lease.test.ts`, `tests/database/collector-concurrency.test.ts`. 기존 core fixture는 수정하지 않고 전용 fixture에서 추가 migration/owner 권한을 설정한다.
**Interfaces:** spec의 collector_status/collector_change/lock_active_collector. error는 고정 SQLSTATE 28000(세션), 22023(입력), P0001(message COLLECTOR_VERSION_CONFLICT/REPLACE_REQUIRED/VERSION_EXHAUSTED).

- [x] 합성 세션 fixture와 최초 상태/교체/CAS/ACL/소유자·만료 테스트 작성. 없는 함수/테이블 때문에 RED10 확인.
- [x] Supabase CLI help 확인 후 migration new로 이름 생성. Drizzle schema와 SQL 함수/ACL 작성.
- [x] `pnpm --filter @account-book/database-tests test collector-lease.test.ts` → PASS10.
- [x] 실제 두 연결 동시 최초 활성·수집 저장/교체·수집 저장/로그아웃 양방향 회귀5 PASS. pg_blocking_pids로 실제 대기 확인. 이 추가 시험을 구현 전 RED로 표시하지 않는다.
- [x] 전용 DB suite15 PASS. 결과 ledger 기록, 커밋은 혼합 변경 검토 후 별도.

### Task 2: 동일 트랜잭션 수집 실행자·검증·문서

**Files:** `apps/api/src/core/user-database.ts`, `.test.ts`, 신규 `tests/database/collector-runner.test.ts`, `docs/status/2026-10-16-collector-lease.ko.md`, 통합 설계 현황 및 Notion04/07.
**Interfaces:** `runCollector<T>(userId:string,sessionId:string,version:number,operation:(client:DbClient)=>Promise<T>):Promise<T>`. invalid session UUID/version 또는 lease=false는 AUTH_SESSION_EXPIRED401, SQL 실패는 기존 LEDGER_SERVICE_UNAVAILABLE503. 공개 수집 전용 오류 코드는 후속 HTTP 단위에서 확정한다.

- [x] 잘못된 버전/세션, lease=false/누락, 콜백 실패/commit 실패 시험 RED7.
- [x] 기존 run 안에서 lock_active_collector 확인 뒤 operation 호출. 별도 transaction helper 없음.
- [x] 실제 DB runner2 PASS: 원장 쓰기·이전 sid/version 거절·수기 허용·롤백/격리.
- [x] `pnpm verify`1906, `pnpm test:db`353, core Playwright17, audit0, diff 검사 성공. 최종 task-done은 `pnpm --filter @account-book/api test src/core/user-database.test.ts`12개 재통과로 기록; 전체 verify 결과는 별도 로그 보존.
- [x] 독립 리뷰1회 Critical0/Important0/Minor2. 수정 pass 불필요, 추가 시험은 후속 기록.
- [x] 설계·현황·Notion04/07에 증거와 HTTP/앱/수집기 미완료 갱신·재조회 확인.

최종 결과: [구현 보고](../../status/2026-10-16-collector-lease.ko.md). 실제 운영 적용·앱 구현 완료가 아니다. 후속 Minor2건은 보고서에서 추적한다.

## 사전 자체 점검

Task1 세션 ID/버전/boolean 반환 → Task2 동일 연결 사용 계약 일치. 함수가 반환하는 상태만으로 별도 transaction 쓰기를 승인하지 않는다. API runtime에는 원장 접근이 원래 있으므로 이 기반은 미래 접수 경로가 반드시 사용해야 한다. 현재 외부 알림 접수 경로는 없다.
