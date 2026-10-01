# 거래 조회·입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 일반 후속 작업은 사용자 연속 진행 지침을 따르며 반복 승인을 요청하지 않는다. 외부 DB·비용·권한 확대는 별도다.

**Goal:** PC 웹에서 본인의 수입·지출을 저장하고 날짜순 목록과 계좌 잔액에 반영한다.

**Architecture:** 기존 Next BFF → Nest/Fastify → 사용자별 PostgreSQL transaction을 재사용한다. 공용 거래 계약과 `finance.transaction_history`, `finance.request_deduplication`은 이미 있으나 거래 API/화면은 아직 없다. 먼저 조회·생성만 완성하고 수정·삭제, 시작 잔액, 원자적 이체는 독립 후속으로 나눈다.

**Tech Stack:** Node 22.15.1, TypeScript, NestJS/Fastify, pg, Next.js, ky, TanStack Query, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-ledger-public-contracts-design.md`의 거래·커서·멱등성 규칙, `docs/superpowers/specs/2026-09-29-core-api-design.md`의 권한/transaction 경계, `docs/superpowers/specs/2026-09-30-core-web-design.md`의 사용자별 캐시/PC 화면 기준. 옛 계약 전용 작업의 제외 항목은 당시 범위이며 이 문서는 후속 구현 범위를 정한다.

## Global Constraints

- 사용자 입력 금액은 양의 KRW 안전 정수, 날짜는 `YYYY-MM-DD`, 생성 메모는 trim 후 1~500자 또는 생략이다.
- 입력 `userId`/owner/서버 생성 필드 금지. principal에서만 소유자를 얻는다.
- 사용자+작업+UUIDv4 멱등 키, 같은 내용은 최초 응답, 다른 내용은 409다. 인증 JWT의 jti와 혼동하지 않는다.
- 기본 목록은 삭제 행을 제외하고 `occurredOn DESC, id DESC`, 기본 50개·최대100개다.
- 활성 계좌·같은 종류의 활성 카테고리만 새 거래에서 선택한다. 다른 사용자 ID는 부재와 동일404다.
- 실제 Supabase에 테스트 금융 행을 넣지 않는다. 기존 DB schema/권한을 재사용하며 변경 필요 시 별도 migration 계획을 기록한다.
- 일반 API로 이체·시작 잔액을 생성하지 않는다. 목록은 기존 공개 union의 다섯 종류를 올바르게 읽는다.
- 실제 은행 연결·이메일/소셜 설정과 독립적으로 개발한다. 오프라인 queue·추가 상태관리/ORM 패키지 도입 없음.
- PC Playwright를 필수로 실행하고 원문 금융 메모/응답·토큰·SQL을 로그/Notion에 남기지 않는다.

## Review Focus

1. 같은 거래일의 페이지 경계: ID를 보조 정렬키로 써 중복·누락 없이 페이지 이동한다(Task 1).
2. 다른 사용자/필터의 커서 재사용: cursor를 인증수단으로 쓰지 않고 소유자·필터 결속을 확인한다(Task 1).
3. 응답 유실 후 재시도: 사용자가 명시적으로 재시도할 때 기존 키/본문을 유지하고 이중 저장을 막는다(Task 2/3).
4. 계좌/분류가 폼을 연 후 보관됨: 서버가 거부하고 입력은 보존한다(Task 2/3).
5. 로그인 사용자가 바뀜/세션 재확인: 이전 거래·폼·캐시를 즉시 숨기고 다른 사용자에게 노출하지 않는다(Task 3).

## 파일 지도·규모

중규모, 예상 20~28개 파일·테스트/문서 포함 약 900~1,500줄. 새 기능은 `transactions/`에 두고 기존 계좌 저장소나 공통 화면 하나에 모든 로직을 합치지 않는다. 새 핵심 파일은 가능한 한 200줄 안팎으로 유지한다. 실제 수치는 착수 diff 기준으로 다시 기록한다.

| 영역 | 추가/수정 파일 | 역할 |
| --- | --- | --- |
| API | `apps/api/src/transactions/transactions.repository.ts`, `transactions.controller.ts`, `transaction-mapping.ts`, `transaction-cursor.ts`, `transaction-query.ts` | DB 조회·생성, HTTP, 응답, 커서, HTTP query 변환을 분리 |
| API 연결 | `apps/api/src/core/core.module.ts` | 기존 풀/가드로 repository/controller 주입 |
| 테스트 | `apps/api/src/transactions/transactions.test.ts`, `transaction-cursor.test.ts`, `tests/database/transactions-api.test.ts` | 경계·실제 RLS/멱등 경쟁 |
| BFF | `apps/web/src/server/core/operations.ts`, `transaction-target.ts`, 관련 controller/route 테스트, `apps/web/src/app/api/transactions/route.ts` | 고정 scope·경로·query·응답, 안전한 같은 출처 중계 |
| PC | `apps/web/src/features/ledger/transactions/{api,query-options,transaction-page,transaction-form}.ts(x)`, 각 테스트 | ky 입력/응답 검사, 사용자별 조회, 목록/폼 |
| 화면 연결 | `apps/web/src/app/app/transactions/page.tsx`, `features/ledger/shell.tsx`, `ledger.module.css` | 기존 장부 탭·표·대화상자 디자인 재사용 |
| 기록 | `docs/guides/transaction-development.ko.md`, 날짜별 status, Notion 13번 카드 | 초급 개발자 흐름·검증·남은 작업 |

`.ts(x)`는 역할에 따라 api/query-options는 `.ts`, page/form은 `.tsx`를 뜻한다. 목록과 생성 이외의 상세 route·수정/삭제 파일은 이번 세부 단계에 만들지 않는다.

### Task 1: 본인 거래 목록 API

**Interfaces:** `TransactionsRepository.list(userId: string, query: TransactionListQuery): Promise<TransactionListResponse>`; `GET /v1/transactions`, scope `transaction:read`, 200/no-store. `parseTransactionQuery(raw: unknown): TransactionListQuery`는 HTTP limit만 숫자로 변환하며 중복/배열/알 수 없는 query를 거부한다.

- [ ] RED: `transaction-cursor.test.ts`에 같은 날짜·잘못된 base64url·과도 길이·다른 필터/사용자 커서 거부를 작성한다. 커서는 `{v:1, date, id, binding}` canonical JSON의 base64url; binding은 서버 소유자와 정규화 필터의 SHA-256이며 권한 증명이 아니다.
- [ ] RED: API 입력 테스트에 limit의 `0`, `101`, `1.5`, 중복 query, 날짜 역전, unknown field와 권한 없는 요청을 작성한다.
- [ ] `pnpm --filter @account-book/api test`로 아직 없는 구현 때문에 실패함을 확인한다.
- [ ] 고정 SQL·파라미터로 사용자 WHERE/RLS, 날짜/계좌/분류/종류 필터, `(occurred_on,id)<cursor`, `limit+1`을 구현한다. 커서·응답에 메모·사용자 ID 원문을 넣지 않는다.
- [ ] 공용 `TransactionSchema`로 DB bigint/시각/날짜/variant를 매핑한다. SQL DATE는 문자열 cast로 받아 타임존 변환하지 않는다. opening balance에만 direction을 넣는다.
- [ ] 실제 폐기용 DB에서 타인·탈퇴자·삭제행 제외, 보관 계좌의 과거행 조회, 동일일자 페이지, 경계금액을 검증한다. 실패면 고정400/401/404/503 정책을 유지한다.
- [ ] API·DB 테스트 GREEN, 변경 파일 diff 검토. 커밋/푸시는 별도 사용자 요청 시에만 수행한다.

### Task 2: 수입·지출 생성 API

**Interfaces:** `TransactionsRepository.create(userId: string, input: CreateTransactionInput): Promise<Transaction>`; `POST /v1/transactions`, scope `transaction:write`, 201/no-store. `input.type`을 DB `kind`로 매핑한다.

- [ ] RED: 실제 DB 테스트에 성공1행·같은 키/내용 재시도1행·같은 키/다른 내용409·다른 사용자 독립키·동시 동일키1행을 작성한다.
- [ ] RED: 타인 계좌/분류404, 보관/종류 불일치409, 금액/날짜/메모 계약, 오류 rollback 후 dedup 행 미생성을 작성한다.
- [ ] API/DB 명령을 실행해 새 실패를 확인한다.
- [ ] 기존 `idempotentCreate`와 `UserDatabase.run`을 사용해 정규화한 전체 의미 입력을 fingerprint한다. 같은 사용자 부모 계좌/분류 확인과 보관 경쟁 잠금을 고정 순서로 잡고 기존 DB trigger와 함께 보호한다. DB 내부 오류를 복사하지 않는다.
- [ ] 원장 생성과 최초 응답 snapshot을 같은 transaction으로 저장한다. 재시도는 새 JWT/기존 멱등 키다.
- [ ] 실제 잔액이 수입 +/지출 -로 반영되고 안전정수 overflow가 0원으로 숨겨지지 않는지 확인한다.
- [ ] 집중 API·DB GREEN 후 readonly 리뷰. 수정/삭제·transfer/opening 명령으로 확장하지 않는다.

### Task 3: BFF와 PC 거래 화면

**Interfaces:** `createTransactionsApi(http: KyInstance, expectedUserId: string)` → `list(query: TransactionListQuery, signal?: AbortSignal): Promise<TransactionListResponse>`, `create(input: CreateTransactionInput): Promise<Transaction>`. `GET/POST /api/transactions`만 고정 허용한다. 목록 query key는 사용자ID+정규화 필터+cursor를 포함한다.

- [ ] RED: BFF의 request-target query 보존/서명·CSRF·origin·사용자 assertion·안전한 응답과 status 계약을 작성한다.
- [ ] RED: 프론트 입력/응답 검사, 기존 키의 명시 재시도, 결과 미확정 상태에서 본문 변경 방지, 사용자 변경 시 캐시/폼 폐기를 작성한다.
- [ ] 기존 boundary를 재사용하고 `transaction-target.ts`에 query만 분리한다. 범용 임의 URL 프록시를 만들지 않는다.
- [ ] `/app/transactions`에 날짜/계좌/분류/종류 필터·더 보기·수입/지출 입력을 연결한다. 계좌/분류 미등록 시 해당 관리 화면으로 안내한다. 이체/시작 잔액 입력 버튼은 만들지 않는다.
- [ ] 성공 후 거래 목록과 계좌 잔액을 재조회한다. 오류 시 입력을 보존하고 다른 사용자의 캐시·localStorage/IndexedDB에는 저장하지 않는다. 자동 변경 재시도는 하지 않는다.
- [ ] 실제 Playwright로 PC 로그인→계좌/분류 준비→수입/지출 생성→새로고침/필터/페이지→잔액 반영→로그아웃을 폐기용 DB에서 검증한다. 응답 유실/보관 경쟁/사용자 교체도 확인한다.
- [ ] `pnpm verify`, 관련 실제 DB 검사, `git diff --check`, README/Notion 갱신 후 구현과 운영 미검증을 구분해 보고한다.

## 뒤에 오는 독립 단계

1. 일반 거래 수정·soft delete: expectedVersion, stale409, 잔액 재계산, tombstone.
2. 시작 잔액 및 이체: 두 계좌 잠금 순서, 양쪽 원장 원자성, 이체를 수입/지출 집계에서 제외.
3. 은행 연결 상태·동의·조회/수집, 그 다음 별도 모바일 앱.

소셜 실연동은 사용자의 내일 설정 이후 별도 검증 선으로 진행하며, 위 장부 개발을 막지 않는다. 계획 작성 완료는 거래 기능 구현 완료가 아니다.

## 자체 검토

기존 strict 입력·공개 응답·정렬·멱등성 계약을 유지한다. 커서/HTTP query의 세부 구현을 위에서 고정했고 읽기·쓰기·PC 연결의 독립 검증 경계를 나눴다. 실제 공급자·원격 DB·새 secret·결제·모바일 도입은 이 계획에서 제외한다. 추가 인덱스/권한이 필요하면 실행 전에 영향과 별도 migration을 기록한다.
