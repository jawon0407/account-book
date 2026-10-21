# Android 선행 원장 정합성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 사용자에게 매번 제품 선택을 다시 묻지 않되, 실제 외부 DB 적용·배포는 별도 실행 대상을 확인한다.

**Goal:** 일반 입출금의 계좌·카테고리를 미지정으로 저장하고 거래 상대명을 별도로 관리할 수 있도록 기존 원장·API·PC 편집 경계를 일치시킨다.

**Architecture:** 공용 계약, 기존 finance.transaction_history의 추가형 이관, NestJS 저장/수정/조회와 PC 표시를 한 배포 단위로 맞춘다. Android 앱과 알림 수집기는 다음 과제이며 이번에는 새 인증 채널을 열거나 금융 알림을 읽지 않는다.

**Tech Stack:** 기존 TypeScript, Zod, PostgreSQL/Drizzle, NestJS, Next.js, Vitest, Playwright. 이번 단계에서는 새 제품 의존성을 설치하지 않는다.

**Spec:** [통합 설계](../specs/2026-10-13-notification-ledger-data-flow-design.md), [Notion 04](https://app.notion.com/p/3e2323168ba6810bb34cec8227a85a78), [Notion 07](https://app.notion.com/p/3e2323168ba681b59204c2342edb27b3).

**Status:** 2026-10-16 원장 선행 단위 구현·로컬 검증 완료. 아래 결과는 기능 작업 트리의 미커밋 변경 기준이며 실제 Supabase 적용·배포·Android 앱 완료가 아니다. Android 우선 / Android 구현·검증 후 iOS 순서를 유지한다.

## Global Constraints

- 기존 작업 트리 `ledger-public-contracts`, 기능 브랜치 `feature/bank-state-transitions` 기준. 은행 A5 관련 미커밋 변경은 보존하고 섞어 커밋하지 않는다.
- 일반 `income`/`expense`만 계좌·카테고리 NULL 허용. 이체·시작 잔액의 계좌 필수 조건은 유지한다.
- 명확한 입출금의 계좌·카테고리·상대명 미지정은 금액 제외 사유가 아니다. 특정 계좌 필터에는 해당 계좌에 지정된 거래만 포함한다.
- 수정 필드 생략은 유지, 명시 NULL은 지정 해제다. `expectedVersion` 검증·사용자 소유권·RLS/FORCE RLS는 유지한다.
- 소비 카테고리와 거래 상대명은 다르다. 상대명 정정이 분류 규칙 생성이나 카테고리 변경을 유발하지 않는다.
- DB에서 전체 알림 원문이나 실계좌 전체 번호를 새로 저장하지 않는다. 개발·시험 자료는 합성값만 쓴다.
- 과거 migration은 고치지 않는다. 새 migration 파일명은 설치된 CLI 도움말을 확인한 뒤 `supabase migration new ledger_unassigned_counterparty`의 실제 생성 결과를 사용한다.
- 폐기용 loopback PostgreSQL 검증과 실제 hosted DB 적용은 구분한다. 이 계획 작성이나 테스트 통과만으로 외부 DB를 변경하지 않는다.
- 거래일 DATE를 이번 단계에서 임의의 정각 timestamp로 이관하지 않는다. 정확한 시각·시간대 이력·복수 필터·환불/복구·단일 수집 기기·채널 권한은 후속 과제로 남긴다.
- PC 기존 거래 편집 흐름을 Playwright로 검증한다. UI 버튼만 숨겨 모바일 전용 권한을 구현했다고 표시하지 않는다.

## 조사 결과와 작업 규모

2026-10-15 읽기 조사 기준이다. 아래 줄 수는 비어 있지 않은 줄 수이며 전체 파일을 다시 작성한다는 뜻이 아니다.

| 기존 파일 | 줄 수 | 변경 책임 |
| --- | ---: | --- |
| `packages/contracts/src/transactions.ts` | 126 | 종류별 NULL·상대명·부분 수정 계약 |
| `packages/contracts/src/transactions.test.ts` | 120 | 입력/응답/이체 경계 회귀 |
| `packages/database/src/schema/ledger-transactions.ts` | 29 | 새 열·종류별 CHECK·FK 유지 |
| `apps/api/src/transactions/transactions.repository.ts` | 59 | 미지정 생성·조회·멱등 payload |
| `apps/api/src/transactions/transaction-changes.ts` | 40 | 생략과 NULL 구분·참조 검사 |
| `apps/api/src/transactions/transaction-mapping.ts` | 11 | 공개 응답 변환 |
| `apps/web/src/features/ledger/transactions/transaction-table.tsx` | 12 | 미지정/미분류·상대명 표시 |
| `apps/web/src/features/ledger/transactions/transaction-edit-form.tsx` | 37 | 지정·해제·상대명 편집 |
| `tests/database/ledger-storage.test.ts` | 64 | 실제 DB 값·제약 |
| `tests/database/ledger-integrity.test.ts` | 78 | 참조·archive·이체 무결성 |
| `tests/database/transactions-api.test.ts` | 148 | API 저장/수정/조회·격리 |

정적 파일 수로 공수를 확정하지 않는다. 예상 영향은 **약 15~22개 파일, 중간 규모**다. 추가 migration·DB/화면 테스트·기존 fixture 갱신을 포함한 추정이며 실제 변경량은 구현 후 diff로 보고한다. 현재 증거만으로 시간 약속은 하지 않는다.

DB의 `guard_transaction_reference()`는 INSERT마다 계좌 행을 찾으므로 NOT NULL만 제거해도 미지정 INSERT는 실패한다. API 수정은 `??`를 쓰므로 명시 NULL도 기존값 유지로 해석된다. 이 두 경계를 반드시 함께 변경한다.

## Review Focus

1. 계좌/분류를 NULL로 해제할 때 `??`로 기존값이 되살아나지 않는가 — Task 2.
2. 미지정 허용이 이체/시작 잔액이나 타인 계좌 연결까지 허용하지 않는가 — Task 1, 2.
3. 이전 멱등 결과에 새 필드가 없어도 조회가 깨지지 않고 기존 키 재시도 의미를 보존하는가 — Task 2.
4. NULL과 참조 데이터 조회 실패가 화면에서 구별되고 거래 금액이 목록에서 사라지지 않는가 — Task 3.
5. 동시 편집 409와 보관 참조 유지/새 연결 금지 정책이 사라지지 않는가 — Task 2, 3.

## Task 1: 공용 계약과 DB 추가형 이관

**Files:**
- Modify: `packages/contracts/src/transactions.ts`, `packages/contracts/src/transactions.test.ts`.
- Modify: `packages/database/src/schema/ledger-transactions.ts`.
- Create: `supabase/migrations/<CLI 생성 timestamp>_ledger_unassigned_counterparty.sql`.
- Modify: `tests/database/support/core-database.ts` — 새 이관 등록, 이름 변경 이전 업그레이드 검사 경로 보존.
- Create: `tests/database/ledger-unassigned.test.ts`.
- Modify only affected assertions: `tests/database/ledger-storage.test.ts`, `tests/database/ledger-integrity.test.ts`.

**Interfaces:**
- 일반 거래 입력/응답의 `accountId`, `categoryId`: `string | null`. 신규 생성에서 생략한 관계는 NULL로 정규화한다.
- `counterpartyName`: 신규 생성은 선택, 응답은 `string | null`, 부분 수정은 생략/NULL/문자열을 구분한다. 문자열은 trim 후 1~200 UTF-16 code unit으로 검사한다. DB는 NULL 또는 비어 있지 않은 최대 200문자 text를 허용하며 앱 검증보다 넓은 Unicode 범위를 허용할 수 있음을 문서화한다.
- `TransactionSchema`의 이체/시작 잔액 응답은 accountId 필수를 유지한다. 일반 입출금에만 nullable 관계를 적용한다.
- DB `counterparty_name` nullable text 추가. 기존 행은 NULL로 유지한다. memo·카테고리명에서 추정해 채우지 않는다.

- [x] 기존 계약 테스트에 일반 입출금 NULL/생략 성공, 특수 거래 accountId NULL 거부, 상대명 길이/공백/NULL, expectedVersion-only 거부를 추가하고 의도한 실패를 확인했다.
- [x] 폐기용 DB의 기존 행 → 새 migration → 기존 ID/금액/날짜/참조 보존 검사를 추가했다. 계좌/카테고리 네 조합, 타인 참조 거부, 이체/시작 잔액 NULL 거부와 이관 전 미지정 INSERT 실패를 확인했다. 최초 DB RED 실행의 환경 제약은 아래에 기록했다.
- [x] CLI로 `20261015165313_ledger_unassigned_counterparty.sql`을 생성했다. NOT NULL 제거·종류별 CHECK·상대명·NULL 참조 trigger를 단일 transaction으로 검사하고 RLS·FK·함수 owner/ACL 보존을 확인했다.
- [x] Drizzle 선언과 공용 계약을 SQL의 종류별 조건·실제 열 순서와 일치시켰다. 과거 migration은 수정하지 않았다.
- [x] 계약 테스트와 폐기용 DB 테스트에서 NULL 허용과 권한/이체 제한을 함께 확인했다.

## Task 2: API 생성·수정·조회와 호환성

**Files:**
- Modify: `apps/api/src/transactions/transactions.repository.ts`.
- Modify: `apps/api/src/transactions/transaction-changes.ts`.
- Modify: `apps/api/src/transactions/transaction-mapping.ts`, `transaction-mapping.test.ts`.
- Modify: `tests/database/transactions-api.test.ts`.
- Inspect and update only if needed: `apps/api/src/core/idempotency.ts` and its existing tests.

**Interfaces:**
- 기존 `create(userId, raw)`, `update(userId, id, raw)`, `list(userId, query)` signature 유지. `userId`는 인증 결과다.
- 부분 수정의 관계/상대명은 `value === undefined ? stored : value` 의미다. NULL은 SQL NULL로 전달한다.
- 계좌·카테고리가 non-NULL인 경우만 기존 소유권·보관 상태·종류 검사를 수행한다. 입력 문자열을 SQL에 연결하지 않는다.
- 저장 결과 변환은 counterparty_name을 공개 counterpartyName으로 옮긴다. 기존 멱등 snapshot에 필드가 없으면 응답에서 NULL로 보완한다.
- 이전 요청과 동일한 payload로 재시도한 기존 멱등 키는 성공 재현이 가능해야 한다. 새 필드의 무조건적인 NULL 삽입으로 기존 hash를 바꾸지 않도록 기존 정규화/버전 처리를 확인한다. 실제 다른 상대명·관계 요청은 기존 충돌 정책을 유지한다.

- [x] API DB 테스트에 NULL 생성·동일 ID 뒤늦은 지정·명시 NULL 해제·생략 유지·상대명 편집·409·타인 참조 404를 추가해 검증했다. 매핑 단위 테스트는 새 상대명 누락의 RED → GREEN을 확인했다.
- [x] 보관된 기존 참조의 메모/상대명 편집 허용과 보관된 새 참조 연결 거부를 검증했다.
- [x] 생성/수정/매핑을 구현했다. 상대명 수정은 카테고리 변경이나 분류 규칙 생성을 유발하지 않는다.
- [x] 구버전 멱등 snapshot/hash 재시도와 새 상대명 충돌을 검증했다. 기존 날짜순·커서·계좌별 조회 조건을 유지했다.
- [x] API 단위·DB 통합·전체 타입 검사를 통과했다. 미지정 거래는 전체 목록에 있고 특정 계좌 조회에서는 제외됨을 확인했다.

## Task 3: PC 표시·편집과 통합 검증

**Files:**
- Modify: `apps/web/src/features/ledger/transactions/transaction-table.tsx`, `transaction-edit-form.tsx`.
- Modify: `apps/web/src/features/ledger/transactions/transaction-changes.test.tsx`, `api.test.ts`와 영향받는 fixture.
- Create: `apps/web/src/features/ledger/transactions/transaction-table.test.tsx`.
- Add to existing core E2E harness after inspection: `tests/e2e/core/`의 거래 조회/편집 시나리오. 기존 은행 E2E 파일과 섞지 않는다.

**Interfaces:**
- NULL accountId는 `계좌 미지정`, 일반 거래 NULL categoryId는 `미분류`, NULL 상대명은 `상대 미확인`으로 표시한다.
- non-NULL 참조를 조회하지 못한 상태는 `계좌 정보 확인 필요`/`분류 정보 확인 필요`로 구별한다. 이체/시작 잔액에 카테고리가 없는 것은 미분류 경고가 아니다.
- 편집 select의 빈 값은 NULL로 직렬화한다. 일반 입출금 방향을 바꾸면 기존 분류의 종류가 맞는지 확인하고, 다른 분류를 임의로 자동 선택하지 않는다.
- 상대명 입력은 일반 text로 렌더링한다. HTML을 실행하지 않는다. 원래 거래의 expectedVersion으로 저장한다.

- [x] 컴포넌트 시험에 상태 문구·NULL 해제·상대명·충돌·긴 이름을 추가하고 RED → GREEN을 확인했다.
- [x] 기존 행/입력과 삭제 확인창 문구만 변경했다. Bookify 전체 재디자인·복수 필터·모바일 권한은 이번 단계에 포함하지 않았다.
- [x] 웹을 포함한 전체 회귀·타입·린트·빌드를 통과했다. 도중 발생한 실패와 수정은 아래 검증 기록에 남겼다.
- [x] 합성 사용자·폐기용 DB로 실제 BFF/API를 거치는 PC Playwright를 통과했다. 미지정 조회 → 지정/해제 → 재조회 → 삭제창 취소 → 409 → 두 번째 계정 실제 로그인 후 데이터/draft 격리를 확인했다.
- [x] 독립 코드 리뷰와 수정 파일 diff·비밀정보·권한 경계 검토를 수행했다. 기존 은행 변경은 보존했고 stage/commit하지 않았다.
- [x] Notion 07에 최종 결과를 반영하고 다시 읽어 확인했다. 아래 인수인계 기록과 hosted DB/Android 미실행 범위가 일치한다.

## 구현 흐름 — 처음 읽는 개발자를 위한 설명

사용자가 아직 계좌와 소비 분류를 정하지 않았더라도, 금액과 입출금 방향을 아는 거래는 일반 거래로 저장할 수 있다. 여기서 `NULL`은 “알 수 없거나 아직 지정하지 않음”이지 0원이나 삭제를 뜻하지 않는다. 이번 작업은 그 저장·수정 기반이며 알림 판독 자체는 아직 없다.

1. **공용 계약:** `packages/contracts/src/transactions.ts`가 웹/API가 주고받는 JSON을 검사한다. 생성 시 계좌/분류를 생략하면 NULL로 만든다. 상대명은 앞뒤 공백을 제거한 1~200 UTF-16 단위 문자열 또는 NULL이다. `CreateTransactionInput`은 호출 시 생략 가능한 입력 타입이고, 검증 후 결과와 구분한다.
2. **저장:** `transactions.repository.ts`의 `create(userId, raw)`는 인증에서 확인한 사용자 ID와 입력을 받는다. 계좌/분류가 있을 때만 본인 소유·보관 여부를 검사한다. 같은 멱등 키의 재시도가 거래를 하나 더 만들지 않도록 기존 요청 hash와 응답을 확인한다.
3. **수정:** `transaction-changes.ts`는 거래 ID·인증 사용자·수정 내용을 사용한다. 필드 생략은 기존값 유지, 명시적 NULL은 연결 해제다. `expectedVersion`이 현재 DB 버전과 다르면 409로 거절해 다른 기기의 변경을 덮어쓰지 않는다.
4. **DB 방어:** `finance.transaction_history.counterparty_name`에 상대명을 저장한다. 일반 입출금만 계좌/분류가 없어도 되고 이체·시작 잔액의 계좌 필수 조건은 유지한다. 앱 검사와 별개로 DB FK·trigger·RLS가 타인 데이터 연결/조회를 막는다. 새 열 쓰기 권한도 `app_api`에만 추가했다.
5. **응답과 화면:** `transaction-mapping.ts`가 SQL 이름 `counterparty_name`을 JSON의 `counterpartyName`으로 변환한다. 목록은 `계좌 미지정`, `미분류`, `상대 미확인`으로 표시하고 금액을 숨기지 않는다. 편집 폼의 빈 선택은 NULL로 전송한다. 상대명 입력은 HTML이 아닌 일반 글자로 표시한다.
6. **이전 데이터 호환:** 과거 거래의 상대명은 추측해서 채우지 않고 NULL로 둔다. 과거 멱등 응답에 새 필드가 없으면 읽을 때 NULL을 보완한다. 상대명 미입력 재시도는 기존 hash를 바꾸지 않지만, 다른 상대명을 같은 키로 보내면 충돌이다.

예: `지출 20,000원 / 상대명 합성 상점 / 계좌 NULL / 분류 NULL`로 먼저 저장하고, 나중에 사용자가 계좌와 `배드민턴 용품` 분류를 지정하면 **같은 거래 ID**의 참조와 버전만 갱신한다. 계좌 미지정 거래는 전체 목록에 남고 특정 계좌 조회에는 포함되지 않는다. 집계 화면·시각·복수 필터는 별도 후속 구현이다.

## 실행 결과와 인수인계 (2026-10-16)

제품/시험 파일 **23개(기존 19개 수정, 신규 4개)**와 이 계획 문서를 다뤘다. 사전 예상 15~22개보다 fixture·입력 타입·삭제창 검증 때문에 조금 늘었다. 기존 은행 A5 변경 및 도구가 갱신한 파일은 이 수에 넣지 않았다. `tests/e2e/core/setup.ts`에는 기존 은행 변경을 보존하면서 두 번째 합성 사용자를 추가한 한 줄만 이번 범위다.

제품/시험 변경량은 **약 358줄 추가·51줄 제거**다(신규 4개 파일 141줄과 setup의 이번 추가 1줄 포함, 기존 은행 변경 및 본 문서 제외). 기존 파일을 통째로 다시 쓰지 않고 책임별 파일 분리를 유지했다.

신규 파일은 SQL migration, `tests/database/ledger-unassigned.test.ts`, `tests/database/ledger-unassigned-upgrade.test.ts`, `apps/web/src/features/ledger/transactions/transaction-table.test.tsx`다. 추가 변경에는 공개 오류 필드 목록, 이전 응답 fixture, E2E 테스트 IdP의 두 번째 사용자 지원이 포함된다. 제품 패키지 의존성은 추가하지 않았다.

| 검증 | 최종 결과 |
| --- | --- |
| `pnpm test` | 1,724 통과: legacy 207, contracts 96, database 단위 19, API 279, web 1,037, E2E preflight 86 |
| `pnpm test:db` | 실제 폐기용 PostgreSQL 통합 306 통과 |
| `pnpm --filter @account-book/e2e test:core` | Chromium PC 14 통과; 실제 BFF/API/DB 사용, 인증 공급자는 합성 테스트 IdP |
| `pnpm typecheck` / 최종 `pnpm typecheck:workspace` | 6개 workspace 타입 검사 통과 |
| `pnpm lint` | 경고 허용 0 기준 통과 |
| `pnpm build` | 공용 패키지·NestJS·Next.js production build 통과 |
| `git diff --check` | 공백 오류 없음 |
| 독립 코드 리뷰 | 초기 3건 수정 후 추가 Critical/Important 없음; 은행 A5/배포 제외 |

검사 중 발견한 문제를 숨기지 않는다: 새 열의 SQL/Drizzle 순서 불일치 1건, 웹의 구 응답 fixture 3건, 삭제 확인창의 NULL 문구 1건을 수정하고 해당 전체 검사를 다시 통과했다. 리뷰에서 확인한 입력 타입의 불필요한 필수값과 실제 다른 계정 재로그인 검증 누락도 보완했다.

실행 환경은 Node 22.15.1/pnpm 11.9.0을 사용했다. 처음에는 기본 런타임 버전 불일치와 폐기용 DB 미실행으로 실행이 막혔으므로 이 실패는 제품 RED 증거로 계산하지 않았다. DB는 공식 PostgreSQL 17.11 바이너리로 별도 loopback 테스트 인스턴스를 마련했다. 일부 DB 시험의 최초 구현 전 RED는 얻지 못했고, 업그레이드 시험 안에서 **구 스키마의 미지정 INSERT 거부 → 이관 → 동일 종류 INSERT 성공**을 재현했다. 계약·매핑·화면 및 삭제창은 실제 RED → GREEN을 확인했다.

`autoplan` 설치본에 필수 참조 파일이 없어 전체 자동 리뷰 파이프라인은 실행 완료로 표시하지 않는다. 기존 파일별 계획·직접 점검·독립 코드 리뷰·위 테스트로 이번 단위를 검증했다.

### 적용 전 주의점과 미완료 범위

- **실제 Supabase DB에는 아직 적용하지 않았다.** 배포할 때 대상 프로젝트·기존 migration 상태·백업·승인 SHA를 확인하고, migration/owner 실행 주체가 새 파일을 먼저 단일 transaction으로 적용한 뒤 API/웹을 배포한다. 런타임 계정으로 DDL을 실행하거나 앱 시작 때 자동 이관하지 않는다.
- 구버전 API로 단순 롤백하면 새 NULL 거래 응답을 처리하지 못할 수 있다. 새 거래가 생긴 뒤 NOT NULL을 되돌리는 파괴적 down migration을 자동 실행하지 않는다. 호환 API를 유지하는 전진 수정과 검증된 복구 절차가 필요하다.
- Android 프로젝트·알림 수집·모바일 인증·실기기 시험은 아직 없다. iOS는 Android 완료 뒤다. 실제 OAuth 제공자·운영 DB·원격 CI·커버리지 비율·성능/부하 수치도 이번 결과로 보증하지 않는다.
- PC는 기존 입력 기능을 유지한다. 모바일 전용 생성 권한을 서버에서 구현하기 전 버튼만 숨기지 않았다. 새 다중 필터·정확한 거래 시각·규칙·환불·30일 복구·완성 집계는 후속이다.
- 테스트는 합성 금융 자료만 사용했다. 원본 금융 알림·비밀번호·키를 새로 저장하거나 Notion에 전송하지 않았다. 커밋·푸시·PR·배포는 수행하지 않았다.
- Notion 07 기록을 갱신하고 읽기 확인했다. 이번에 시작한 loopback 폐기용 PostgreSQL 서버는 검증 종료 후 정상 종료했다. 사용자의 로컬 앱/다른 DB 서버를 종료하지 않았다.

## Android 앱의 다음 단계와 완료 조건

이 계획을 마친 뒤 모바일 인증/기기·채널 계약을 구체화하고 `apps/mobile`을 추가한다. Bookify 노드의 실제 토큰 추출, React Native/Expo 버전 호환 확인, Android 개발 빌드를 거쳐 로그인·장부 계좌·수기 입력·조회부터 연결한다.

다음은 검증 가능한 알림 한 형식의 종단 흐름이다. 허용 앱의 새 알림 → 메모리 판독 → 서버의 미분류 거래 → 사용자 분류 → PC 조회까지 실제 Android 기기에서 확인한다. KB 한 형식으로 시작하는 것은 다른 은행 사용자를 제외한다는 뜻이 아니다. 형식 지원은 실제 필드·기기/앱 버전 증거별로 확장한다.

Android 승인 기능과 실기기/PC/보안 검증이 완료된 후 iOS 단계로 이동한다. iOS에서 Android 수집 모듈을 그대로 사용할 수 있다고 가정하지 않으며, 현재 Apple 전용 기능·배포 비용을 선행 조건으로 요구하지 않는다.
