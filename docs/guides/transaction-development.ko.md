# 거래 조회·입력·수정·삭제 개발 흐름

기준: 2026-10-01. PC 웹의 거래 조회/생성에 일반 수입·지출 수정/삭제를 연결했다. 은행 자동 수집, 시작 잔액·이체 입력, 별도 모바일 앱은 후속이다. 원격 Supabase에 테스트 금융 행을 쓰거나 새 migration을 실행하지 않는다. 검증 결과는 날짜별 진행 기록과 구분해 읽는다.

## 사용자가 보는 흐름

1. 로그인 후 `거래 내역` 탭을 연다. 최초 목록은 최신 거래일부터 50개다.
2. `거래 추가`에서 수입 또는 지출, 본인의 활성 계좌, 같은 종류의 활성 카테고리, 금액, 거래일, 선택 메모를 입력한다.
3. 서버가 실제 저장을 확인한 뒤 성공을 알린다. 목록과 계좌 잔액은 다시 조회한다. 현재 필터에 맞지 않는 새 거래는 목록에 보이지 않을 수 있다.
4. 날짜·계좌·분류·종류로 조회하고 `더 보기`로 다음 페이지를 읽는다. 보관 계좌의 과거 거래는 계속 조회한다.
5. 저장 결과를 받지 못하면 폼을 잠그고 `같은 내용으로 재시도`를 제공한다. 닫거나 새로고침했다면 새로운 거래를 입력하기 전에 목록을 확인한다.
6. 기존 수입·지출 행의 `수정`으로 금액·날짜·계좌·카테고리·메모를 고친다. `삭제`는 대상 금액/계좌를 확인한 후 목록과 잔액에서 제외한다. 서버 기록은 보존되며 현재 복구 UI는 없다.

## 데이터가 이동하는 순서

| 단계 | 파일/역할 | 핵심 입력과 결과 |
| --- | --- | --- |
| PC 폼 | `apps/web/src/features/ledger/transactions/transaction-form.tsx` | 문자열 입력을 공유 Zod 계약으로 검사하고 한 생성 의도에 UUIDv4 키를 부여 |
| PC 전송 | 같은 폴더 `api.ts` | ky로 같은 출처 `/api/transactions` 호출, 생성 전 CSRF 조회, 현재 사용자 assertion, 자동 재시도 없음 |
| 목록 캐시 | `query-options.ts` | 사용자 ID+정규화 필터로 Query 키 분리, 각 페이지 커서는 `pageParams`, 브라우저 메모리만 사용 |
| BFF | `apps/web/src/server/core/operations.ts`, `transaction-target.ts` | 세션·origin·CSRF·입력 확인, 고정 scope와 실제 query 경로를 서버 JWT에 결속 |
| Nest HTTP | `apps/api/src/transactions/transactions.controller.ts` | `transaction:read/write` 가드, strict query/body, principal에서만 사용자 식별 |
| 저장소 | `transactions.repository.ts` | 본인 RLS transaction 안에서 고정 SQL과 파라미터로 읽고 저장 |
| 공개 응답 | `transaction-mapping.ts` | DB 내부 사용자/열 제거, bigint 안전 정수 변환, 날짜 문자열 및 종류별 union 검사 |

DB는 기존 `finance.transaction_history`, `finance.transaction_categories`, `finance.accounts`, `finance.request_deduplication`을 재사용한다. `finance.categories`라는 테이블은 없다. 유저 정보는 `"user".users`에서 활성 상태를 확인한다.

## GET /v1/transactions와 GET /api/transactions

선택 query: `accountId`, `categoryId`, `from`, `to`, `type`, `limit`, `cursor`.

- `from/to`: 실제 달력 날짜 `YYYY-MM-DD`, 시작일≤종료일. 시간대로 변환하지 않는다.
- `limit`: 기본50, 최소1·최대100. HTTP에서는 1~100의 정수 문자열만 받아 숫자로 변환한다. `01`, 소수, 배열, 중복 query, 미지원 필드는400이다.
- `type`: income, expense, transfer_in, transfer_out, opening_balance. 생성은 첫 두 종류만 허용한다.
- 결과: `{ items, nextCursor }`. 삭제 행은 제외하고 `occurred_on DESC,id DESC`로 정렬한다.

`OFFSET`으로 앞 행을 건너뛰는 대신 마지막 날짜와 UUID보다 작은 행을 읽는 **keyset pagination**을 쓴다. 같은 날짜의 거래가 여러 개 있어도 UUID가 보조 정렬 기준이 된다. 한 행을 더 조회해 다음 페이지 존재 여부를 확인한다.

커서는 `{v:1,date,id,binding}` JSON을 canonical base64url로 표현한다. binding은 인증 사용자와 필터의 SHA-256이며 메모·사용자 ID 원문은 들어가지 않는다. 페이지 크기는 데이터 집합 자체를 바꾸지 않으므로 결속에서 제외했다. **커서는 인증 토큰이 아니다.** 내용을 변조해도 SQL의 본인 `user_id` 조건과 DB RLS가 독립적으로 적용된다. 다른 사용자/필터의 커서는400이다. 동시 수정 중 목록을 고정된 snapshot으로 유지하는 기능은 없으며 최신 상태는 새로고침한다.

## POST 생성과 멱등성

입력: `accountId`, `categoryId`, `type`, `amountKrw`, `occurredOn`, 선택 `memo`, `idempotencyKey`. `userId`, 생성 시각, 서버 ID 등 추가 필드는 거부한다.

금액은 1~9,007,199,254,740,991원의 안전 정수다. 메모는 trim 후1~500자 또는 생략한다. 빈 메모 입력은 클라이언트에서 생략하며 저장된 값은 null이다.

서버 처리 순서:

1. 로그인 사용자 활성 여부를 확인하고 DB transaction을 시작한다.
2. 사용자+`create_transaction`+키에 advisory transaction lock을 잡는다.
3. 이전 요청이 있으면 전체 의미 입력의 fingerprint를 비교한다. 같으면 최초 응답 snapshot, 다르면409다. 재시도 때 계좌가 보관되었더라도 이미 성공한 요청의 최초 결과는 재사용한다.
4. 처음 요청이면 계좌 → 카테고리 순서로 `FOR UPDATE` 잠금을 잡는다. 둘 다 본인 소유·활성이어야 하며 카테고리 종류가 입력 종류와 같아야 한다. DB trigger도 같은 순서로 무결성을 확인한다.
5. 거래와 최초 응답을 같은 transaction에 저장한다. 중간 실패는 모두 rollback되어 요청 기록만 남거나 거래만 남지 않는다.

같은 거래를 두 번 클릭하거나 응답을 잃어버려도 **같은 키+같은 내용**으로 재시도하면 추가 행을 만들지 않는다. 새 JWT의 jti는 매 HTTP 요청을 보호하며, 거래의 멱등 키와 역할이 다르다.

한 번 결과가 미확정이 된 요청은 다음 재시도가 CSRF/요청 제한으로 거부돼도 기존 키·본문을 유지한다. 두 번째 요청의 거부는 첫 번째 요청이 저장되지 않았다는 증거가 아니기 때문이다. 최초 요청부터 확정 거부인 경우에만 입력을 고칠 수 있다.

## 실패·개인정보 보호

| 상황 | 처리 |
| --- | --- |
| 인증 없음/다른 계정 assertion |401, 이전 사용자 폼·캐시 숨김/제거 |
| 잘못된 입력/커서 |400 고정 공개 코드 |
| 타인/존재하지 않는 계좌·분류 |모두404, 존재 여부 구분 금지 |
| 보관 부모/종류 불일치 |409, 입력 보존, 최신 목록 확인 안내 |
| 같은 멱등 키의 다른 내용 |409, 강제 재시도 차단 |
| DB 장애·변환 오류 |503, SQL/원문 응답 비노출 |
| 응답 유실/알 수 없는 실패 |폼·키·본문 동결, 사용자가 명시한 동일 요청만 재시도 |

HTTP는 `private, no-store`, 금융 데이터는 localStorage·IndexedDB·오프라인 큐에 저장하지 않는다. 브라우저의 사용자 ID 헤더는 인증 수단이 아니라 화면/쿠키 계정 불일치를 막는 추가 검사다. 주체는 항상 서버에서 검증한 세션이다.

## 테스트를 읽는 방법

- `apps/api/src/transactions/*.test.ts`: 잘못된 query/cursor, 종류별 응답, 숫자·날짜 정확성.
- `apps/api/src/core/core-http.test.ts`: 실제 Nest/Fastify HTTP에서 scope, principal, 입력, no-store 확인.
- `tests/database/transactions-api.test.ts`: 폐기용 PostgreSQL에서 실제 RLS, 동일 날짜 페이지, 삭제/탈퇴/보관, 동시 같은 키, rollback, 잔액 확인.
- `apps/web/src/server/core/*test.ts`: query를 포함한 실제 위임 target, CSRF/origin, 안전한 응답, 허용 메서드.
- `apps/web/src/features/ledger/transactions/*test.ts(x)`: ky 계약, 미확정 입력 잠금, 같은 키 재시도, 확정 거부 후 입력 보존.
- `tests/e2e/core/core-web.spec.ts`: 합성 IdP지만 실제 브라우저→BFF→Nest→폐기용 DB. 실제 저장 후 응답만 한 번 유실시키고 중복 생성이 없는지 확인한다.

RED는 아직 없는 경로/함수 때문에 기대한 테스트가 실패한 기록이고, GREEN은 구현 후 같은 검사가 통과한 기록이다. 당일 실행 결과와 미검증 항목은 `docs/status/2026-10-01-transactions.ko.md`를 참고한다. 실서비스 금융 데이터·실제 소셜 공급자 검증을 대체하지 않는다.

## 다음 독립 작업

시작 잔액·원자적 이체 → 은행 동의/조회/수집 → 별도 모바일 앱 순서다. 이체 양쪽을 함께 변경해야 하는 규칙을 일반 거래 수정 API에 섞지 않는다.

## PATCH 수정과 DELETE 삭제를 따라가기

웹 주소는 `/api/transactions/:id`, Nest 주소는 `/v1/transactions/:id`다. `:id`는 거래 UUID이고 로그인 사용자는 본문으로 받지 않는다.

| 요청 | 입력 | 결과 |
| --- | --- | --- |
| PATCH | `expectedVersion`과 변경 필드 1개 이상: accountId, categoryId, type, amountKrw, occurredOn, memo | 수정 후 전체 공개 거래 |
| DELETE | `{ expectedVersion }` | `{ id, version, deletedAt }`만 있는 삭제 확인표(tombstone) |

`expectedVersion`은 “내가 편집을 시작할 때 읽었던 버전”이다. 예를 들어 버전3을 읽은 PC와 모바일이 동시에 저장하면 먼저 저장한 요청만 버전4가 된다. 뒤의 요청은409로 거부되어 다른 기기의 변경을 덮어쓰지 않는다. 새로운 생성 행의 중복을 막는 **멱등성 키와는 다르다**.

1. `transaction-page.tsx`는 행 snapshot을 보관하여 편집 도중 백그라운드 재조회가 폼의 원본 버전을 바꾸지 않게 한다.
2. `transaction-edit-form.tsx`는 숫자/날짜/선택지를 검사한다. 메모 생략은 기존 값 유지, `null`은 비우기다. UI의 빈 메모는 null로 보낸다.
3. `api.ts`의 `update(id,input)`/`remove(id,input)`는 CSRF 토큰과 화면 사용자 assertion을 붙인다. React Query mutation을 통과해 인증 만료 시 장부/입력/캐시를 숨긴다. 자동 재시도는0회다.
4. BFF 닫힌 작업표가 메서드·UUID·JSON·세션·출처를 검증하고 `transaction:write` JWT를 정확한 요청에 결속한다. 금융 CSRF는 POST/PATCH/DELETE, 기존 인증 CSRF는 POST만 허용한다.
5. Nest 저장소는 공용 계약을 다시 확인하고 `UserDatabase.run`으로 본인 RLS transaction을 시작한다.
6. `transaction-changes.ts`의 `locked`는 본인 미삭제 행을 `FOR UPDATE`로 잠그고 일반 수입/지출·기대 버전을 검사한다. 타인/없는/이미 삭제된 거래는 모두404다.
7. 수정은 새로 선택한 계좌→카테고리를 잠가 활성/종류를 확인한다. 이미 보관된 기존 참조는 유지할 수 있다. 메모/날짜만 정정하려고 과거 분류를 억지로 바꿀 필요가 없다.
8. DB trigger가 version/updated_at을 올린다. 삭제는 `deleted_at`만 기록한다. 물리 DELETE 권한은 추가하지 않는다. 기존 잔액 조회는 미삭제 거래를 합산하므로 별도의 잔액 수치 갱신은 필요 없다.

## 수정·삭제 실패 시 사용자에게 보여 주는 것

`use-transaction-change.ts`는 두 폼에서 공통으로 실행 중 중복 클릭을 막는다. 입력 오류·CSRF·요청 제한처럼 명확한 거부 외에는 폼을 잠그고 `닫고 목록 확인`을 제공한다. 409 충돌도 원본 버전을 자동으로 올려 재전송하지 않는다.

생성은 동일 멱등 키 재시도가 가능하지만 **수정/삭제 응답 유실은 자동·수동 즉시 재전송을 제공하지 않는다**. 먼저 최신 목록을 읽고 필요하면 새 편집을 시작한다. 성공했다고 추측하거나 화면에서 먼저 행을 지우지 않는다. DELETE 재호출은 이미 삭제된 행에404를 반환하며 부활시키지 않는다.

이체/시작 잔액은 `별도 관리`로 표시한다. 현재 API로 해당 행을 수정·삭제할 수 없다. 이 제한은 서버에서도 적용된다.

추가 테스트: `transaction-changes.test.tsx`(폼/실패), `transaction-changes.spec.ts`(실제 PC 수정·삭제·충돌·응답 유실·세션 만료), `transactions-api.test.ts`(실제 RLS/행 잠금/잔액). [수정·삭제 진행 기록](../status/2026-10-01-transaction-edit-delete.ko.md)에서 최신 결과를 확인한다.
