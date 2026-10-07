# 금융 원장 스키마 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 개인 계좌·분류·거래·이체·멱등성 5개 테이블을 검증하고 승인된 개발 Supabase에 회원 기반과 함께 적용한다.
**Architecture:** 소유자 복합 FK, 활성 회원 RLS, 이체 deferred constraint, 멱등성 복합 PK로 데이터 기반을 만든다. repository/API/UI·은행 수집은 별도다.
**Tech Stack:** PostgreSQL 17, Drizzle 0.45.2, TypeScript, Vitest, Node.js 22.
**Spec:** `docs/superpowers/specs/2026-09-29-core-database-schema-design.md`

## Global Constraints

- 개인 user_id 소유 모델, KRW 정수 1~9,007,199,254,740,991. 날짜 0001-01-01~9999-12-31. memo nullable 1~500자.
- account name 1~80자, category name 1~50자, category sort_order 0~10,000.
- 계좌/분류 kind·ID·user_id·created_at 불변. version 자동 증가, update 열 권한 제한.
- 이체 header 1 + 출금/입금 2는 동일 DB transaction. runtime 이체 수정/삭제 금지.
- 멱등성 PK(user_id,operation,idempotency_key); UUIDv4 key, SHA256 32bytes, object snapshot 최대16KiB. runtime UPDATE/DELETE 금지.
- 금융 사용자 FK RESTRICT, 신규 스키마 API 비노출, ENABLE+FORCE RLS, 공개 역할과 BFF 접근 금지.
- 실제 secret 출력·Notion 저장 금지. 원격 대상은 기존 승인 개발 프로젝트 tjtamaazsilaegvvovhg만. 기존 데이터 보존. 파괴적 테스트는 고정 로컬 DB에서만.

## Review Focus

- 동시 이체/수정 잠금 순서: UUID 순서로 계좌 행 잠금 → Task 2.
- archive와 새 거래 경쟁: 참조 계좌/분류 잠금으로 직렬화 → Task 2.
- 같은 소유자이나 종류가 다른 분류: 복합 FK로 거부 → Task 1.
- 이체 한쪽/세 번째 행·상이한 메모·중복 시작 잔액: commit까지 거부 → Task 2.
- 원격 부분 적용·기존 객체 충돌: 원자적 적용 및 preflight, 체크섬 기록, 재적용 거부 → Task 3.

### Task 1: 금융 저장 구조·타입

**Files:** Create `supabase/migrations/202609290003_ledger_storage.sql`; `packages/database/src/schema/ledger-shared.ts`, `ledger-accounts.ts`, `ledger-categories.ts`, `ledger-transfers.ts`, `ledger-transactions.ts`, `ledger-idempotency.ts`; `tests/database/ledger-storage.test.ts`; modify `packages/database/src/index.ts`, `tests/database/core-parity.test.ts`.
**Interfaces:** exported `ledgerAccounts`, `ledgerCategories`, `ledgerTransfers`, `ledgerTransactions`, `ledgerIdempotencyRequests`; identity's `is_active_user()`; same core DB test helpers as identity plan.

- [x] Write real PostgreSQL tests for 5 tables, kind/amount/date/memo constraints, owner FKs, category kinds, one active opening balance, idempotency uniqueness/fingerprint/JSON boundaries.
- [x] Run `pnpm --filter @account-book/database-tests exec vitest run ledger-storage.test.ts`. Expected absent-table RED.
- [x] Implement SQL and matching typed declarations; no service-level idempotency or balance API claims.
- [x] Run storage/parity tests and package build. Expected PASS.

### Task 2: 금융 정합성·최소 권한

**Files:** Create `supabase/migrations/202609290004_ledger_integrity.sql`, `202609290005_ledger_access.sql`, `tests/database/ledger-access.test.ts`, `tests/database/ledger-integrity.test.ts`.
**Interfaces:** ledger update guard increments version and updated_at; deferred transfer constraint validates exact 2 rows; owner context read via app.user_id and identity active status.

- [x] Write failing tests for own/other/unset/deleted owner; runtime immutable columns, hard-delete refusal; version bump/expectedVersion SQL; transfer 0/1/3-row commit rejection, matching pair accepted, one-side edit rejected; archive/new-reference concurrency; pool context reset.
- [x] Run the two test files. Expected new behavior RED.
- [x] Implement triggers, column grants and USING/WITH CHECK policies. Transaction kinds may change only income↔expense with a matching category. Ignore archive only when not adding/changing that reference.
- [x] Run full local `pnpm test:db`, then `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Expected PASS; all results recorded, failures diagnosed rather than hidden.

### Task 3: Reviewed development migration and Korean documentation

**Files:** Create `scripts/local-auth/core-migration.mjs`, `scripts/local-auth/core-migration.test.mjs`, `scripts/local-auth/apply-core-schema.mjs`, `docs/database/core-schema.ko.md`, `docs/status/2026-09-29-core-schema-application.ko.md`; modify `docs/database/README.md`, design state, plans; update Notion 02/12.
**Interfaces:** pure migration/preflight guards tested in node:test; CLI `--inspect`, `--check`, `--apply` uses existing approved private setup URL/CA without logging them; 5 pinned SQL files, no nested BEGIN/COMMIT in payload; metadata-only report.

- [x] Write guard RED cases: wrong project/role/TLS, existing schemas, missing Auth table/runtime roles, mismatched SQL hash, unsupported command.
- [x] Implement fail-closed migration runner. `--inspect` is read-only. `--check` applies and rolls back in one transaction. `--apply` rechecks and commits once. Verify pre/post user IDs in memory and report only preserved boolean/count; no user rows printed.
- [x] Run fresh independent security/code review (executing-plans final gate); fix important findings with RED→GREEN.
- [x] Run local guard tests and full regression, then approved development read-only preflight → rollback dry-run → apply → metadata and actual role verification. Stop on conflicts; do not force/drop/retry blindly.
- [x] Write actual completion, Table Editor navigation, ER relations, functions/parameters, tests, remaining API/UI/deletion integration; Notion must separate schema complete vs feature complete.
- [ ] Commit deferred: the runner and managed-role tests depend on pre-existing uncommitted auth changes. Preserve files; settle the dependency/commit boundary separately. No push/merge.

## Self-review / Progress

Spec §6–§12 covered. Existing Auth and bank SQL preserved; bank tables are not silently applied as part of this work. The application runner uses existing local-auth configuration helpers but does not change their behavior. Portable local PostgreSQL may be used without installing a system service.

- [x] Task 1
- [x] Task 2
- [x] Task 3

2026-09-29 실행 결과: 실제 DB 테스트 193개, 전체 회귀 1,203개, lint/typecheck/build 통과. 개발 DB rollback 검증 후 16:00:58 KST에 8개 테이블 적용, 기존 회원 1명 보존, 실제 BFF/API 역할 검사 13개 통과. 독립 리뷰 중요 항목 수정 완료. parity 전체 표현식 비교 확대와 커밋은 후속으로 남긴다.
