# Readable schema names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 승인한 사용자 3개·금융 5개 테이블 이름을 데이터 손실 없이 변경한다.
**Architecture:** 이미 적용한 SQL은 보존하고 증분 ALTER RENAME을 사용한다. 함수 본문의 문자열 참조와 TG_TABLE_NAME 분기를 명시적으로 갱신하며 기존 OID·RLS·GRANT·FK를 유지한다.
**Tech Stack:** PostgreSQL, Drizzle, NestJS, pg, Vitest, Node.js.
**Spec:** 2026-09-30 사용자 승인: user.users / user.roles / user.role_history 및 앞서 제안한 finance 5개 이름. 아래 표가 정확한 계약이다.

| 기존 | 변경 |
| --- | --- |
| app_identity.profiles | user.users |
| app_identity.user_roles | user.roles |
| app_identity.role_change_events | user.role_history |
| app_ledger.accounts | finance.accounts |
| app_ledger.categories | finance.transaction_categories |
| app_ledger.transactions | finance.transaction_history |
| app_ledger.transfers | finance.account_transfers |
| app_ledger.idempotency_requests | finance.request_deduplication |

## Global Constraints

- SQL에서는 스키마 식별자를 항상 `"user"`로 인용한다. 화면 표시명은 user다.
- auth.users, app_private, app_bank, API 경로·JSON·TypeScript 공개 export 이름은 바꾸지 않는다.
- 테이블 재생성·데이터 복사/삭제·권한 확대·Data API 노출은 금지한다.
- 기존 20260929 migration과 적용 영수증은 불변 이력이다. constraint/index 이름은 보존한다.
- 기존 dirty worktree 변경을 보존한다. 이번 요청에 없는 커밋/푸시는 하지 않는다.
- 실제 데이터 행이나 비밀값을 로그·문서·Notion에 기록하지 않는다.

## Review Focus

1. 가입 bootstrap와 권한 감사 함수의 옛 이름 참조 → 변경 후 합성 가입/역할 변경 검증.
2. TG_TABLE_NAME 분기와 deferred 이체 제약 → 기존 금융 정합성 suite 전체 실행.
3. 데이터·보안 ACL 유실 → 업그레이드 전후 OID/행/권한 비교, 무문맥·타인 접근 거부.
4. 신규 설치와 기존 DB 업그레이드 차이 → 전체 migration 적용 및 기존 행이 있는 업그레이드 각각 검사.
5. 잘못된 대상/중복 실행 → 대상 존재 충돌과 재실행 실패 시 rollback, 실제 DB TLS/대상/체크섬 검사.

### Task 1: 증분 rename와 소비자 갱신

**Files:** Create `supabase/migrations/202609300001_readable_schema_names.sql`, `tests/database/schema-rename.test.ts`; modify `tests/database/support/core-database.ts`, `tests/database/{identity-schema,ledger-storage,ledger-access,ledger-integrity,core-api}.test.ts`, `tests/database/support/core-fixtures.ts`, `packages/database/src/schema/{identity,ledger-shared,ledger-categories,ledger-transactions,ledger-transfers,ledger-idempotency}.ts`, `apps/api/src/{profiles/profiles.repository,accounts/accounts.repository,categories/categories.repository,core/user-database,core/idempotency}.ts`.
**Interfaces:** SQL 변경 후 8개 새 이름. 공개 API 계약은 동일.
- [x] 기존 DB205 baseline 및 새 이름/보존 업그레이드 테스트 RED3 확인.
- [x] 새 SQL 및 API/Drizzle/기존 동작 테스트 쿼리 갱신.
- [x] `pnpm test:db`: 새 설치, 업그레이드, 최소 권한, 이체 검증209 GREEN.

### Task 2: 안전한 개발 DB 적용·문서화

**Files:** Create `scripts/local-auth/rename-core-schema.mjs`, `docs/status/2026-09-30-readable-schema-names.ko.md`; update `docs/database/core-schema.ko.md`, `docs/database/README.md`, `docs/README.md`, 최신 스키마 설계. 과거 날짜별 결과는 당시 이름을 유지하고 후속 링크만 추가한다.
**Interfaces:** `--inspect`는 읽기 전용, `--check`는 적용 후 rollback, `--apply`만 commit. 대상은 승인된 개발 Supabase 하나다.
- [x] 전체 lint/typecheck/test1380/build와 독립 리뷰.
- [x] SQL 체크섬·TLS·OID/행 fingerprint·ACL·RLS 검사 후 dry run.
- [x] 실제 적용 및 API/BFF 최소 권한 로그인19·HTTP18 읽기 검증.
- [x] 한국어 가이드와 Notion 기능 12 현황 갱신·재조회 확인. 기존 listener가 없어 최신 API를 임시 실행해 검사했다.

## Execution ledger

- Ruling: 반복 승인 없이 진행하라는 기존 사용자 지침과 이번 정확한 이름 승인을 따라 직접 실행한다. 새 권한 확대는 하지 않는다.
- Ruling: 기존 feature/bank-state-transitions 격리 작업 공간을 재사용한다. 기존 미커밋 작업과 함께 보존하며 별도 커밋은 만들지 않는다.
- Task 1: complete — PostgreSQL209 pass. 신규4개 포함, 원본 SQL·공개 타입 export는 유지.
- Task 2: complete — verify1380 pass, dry-run rollback, 2026-09-30 02:25:39 KST COMMIT, 새 연결 검사19/API HTTP18 pass. 문서·Notion 최종 갱신과 재조회 확인.
- Final review: 중대한 지적 없음. 이체 fixture·대상 스키마 충돌 테스트 보완 완료. 외부 환경 판정은 실행자가 실제 연결 증거로 보완했고 무관한 dirty 변경은 범위 밖이다.
- Ruling: 예전 제약/인덱스·TypeScript export 이름은 유지한다. 물리 테이블 이름만 바꾸는 요청이므로 계약 파급을 줄이며 비용은 내부 코드에 일부 기존 용어가 남는 것이다.
- Ruling: 무중단 구/신 이름 공존 계층은 추가하지 않는다. 승인된 개발 DB이고 적용 당시 서비스 listener가 없었다. 운영 배포에는 별도 중지/전환 절차가 필요하다.
