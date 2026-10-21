# 회원 기본 스키마 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 Auth 사용자를 보존하며 profiles/user_roles/role_change_events를 생성한다.
**Architecture:** Auth가 인증 원본, app_identity가 앱 프로필·역할 원본이다. 비공개 스키마·최소 권한·RLS·가입 초기화 트리거를 실제 폐기용 PostgreSQL에서 검증한다.
**Tech Stack:** PostgreSQL 17, Drizzle 0.45.2, TypeScript, Vitest, Node.js 22.
**Spec:** `docs/superpowers/specs/2026-09-29-core-database-schema-design.md`

## Global Constraints

- 기존 계정·인증 7개 테이블·은행 스키마는 삭제/reset/덮어쓰지 않는다.
- profiles: nickname 1~50자 nullable, avatar 본인 UUID 경로 최대 512자, signup_provider email/google/kakao/naver/unknown, version 1~9,007,199,254,740,991, deleted_at nullable.
- 일반 역할은 member. metadata·첫 회원을 admin으로 자동 승격하지 않는다.
- API는 본인 프로필 조회 및 nickname/avatar 수정만 가능. BFF·공개 역할·service_role은 신규 스키마 접근 금지.
- user_id·created_at·확인된 최초 가입 경로는 불변. 탈퇴 복구·삭제 워크플로는 별도 후속 구현이다.
- 사용자 요청에 따라 한국어 주석(역할·매개변수·작동 원리)과 기능별 Notion 기록을 남긴다.
- 사용자의 테이블 생성 승인 및 반복 승인 생략 요청에 따라 계획 작성 후 이 세션에서 직접 실행하고 마지막에 독립 리뷰한다. 공유 브랜치 push/병합은 하지 않는다.

## Review Focus

- Auth INSERT 시 provider 누락: unknown, 가입은 실패하지 않아야 한다 → Task 1.
- 악성 user_metadata의 role/provider/deleted_at: 무시하고 member·NULL 생성 → Task 1.
- 과거 member/admin/profile backfill: 기존 행 덮어쓰기 금지 → Task 1.
- 탈퇴 후 기존 principal 재사용: 신규 프로필/역할/금융 조회 거부 → Task 1 및 금융 Task 2.
- 비슈퍼유저 migration 및 보안 함수 PUBLIC 실행: 로컬 managed-owner 모사 + 실제 개발 DB rollback 검증 → Task 1 및 금융 Task 3.

### Task 1: 회원 SQL·권한·초기화

**Files:** Create `tests/database/support/core-database.ts`, `tests/database/support/core-fixtures.ts`, `tests/database/identity-schema.test.ts`, `supabase/migrations/202609290001_identity_storage.sql`, `supabase/migrations/202609290002_identity_access.sql`.
**Interfaces:** `openCoreDatabase(): Promise<{admin: Client; close(): Promise<void>}>`; `asCoreRole(admin, role, userId, operation)` runs rolled-back role-scoped transaction. Fixed disposable DB URL only. `app_identity.is_active_user()` returns boolean for current app.user_id; no caller-supplied UUID.

- [x] Write tests: exact 3-table list; bootstrap 4 providers plus unknown; malicious metadata; existing user backfill; member default and role audit; profile boundaries; runtime isolation and immutable columns; soft deletion denial; function execute revocation.
- [x] Run `pnpm --filter @account-book/database-tests exec vitest run identity-schema.test.ts`. Expected RED on absent tables, not connection failure.
- [x] Implement the two SQL files. Auth INSERT trigger reads only id and raw_app_meta_data.provider; security-definer functions fix search_path and revoke PUBLIC execution. Defaults are explicit; triggers version profile updates and audit role changes.
- [x] Run the same command. Expected all PASS, including actual SQLSTATE checks. Run full `pnpm test:db` on the guarded local disposable database.

### Task 2: TypeScript declarations and parity

**Files:** Create `packages/database/src/schema/identity.ts`, `tests/database/core-parity.test.ts`; modify `packages/database/src/index.ts`.
**Interfaces:** export `profiles`, `userRoles`, `roleChangeEvents` table declarations; bigint version uses bigint mode to avoid silent coercion.

- [x] Write database-vs-Drizzle parity assertions for columns/nullability/PK/defaults/check/index names and RLS, initially missing exports RED.
- [x] Implement SQL-corresponding declarations, with SQL remaining canonical for policies/triggers/grants.
- [x] Run `pnpm build:packages`, parity tests, `pnpm typecheck` and `pnpm lint`. Expected PASS.
- [x] Record exact verification and hand off verified tables to the ledger plan. Commit deferred: dependencies include pre-existing uncommitted auth work; preserve all changes without mixing them.

## Self-review / Progress

Spec §5 and identity portions of §7/§10 are covered. Soft-delete login/session/bank integration is explicitly not claimed complete by schema creation. Identity writes are kept out of ordinary runtime privileges. Remote application belongs to the final ledger plan gate so all 8 tables are validated together.

- [x] Task 1
- [x] Task 2

2026-09-29 실행 결과: 실제 DB 테스트 193개, 전체 회귀 1,203개, lint/typecheck/build 통과. 개발 DB rollback 검증 후 16:00:58 KST에 8개 테이블 적용, 기존 회원 1명 보존, 실제 BFF/API 역할 검사 13개 통과. 독립 리뷰 중요 항목 수정 완료. parity 전체 표현식 비교 확대와 커밋은 후속으로 남긴다.
