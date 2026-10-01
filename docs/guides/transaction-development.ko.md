# 거래 조회·수입·지출 입력 개발 흐름

기준: 2026-10-01. PC 웹의 첫 거래 조회/생성 연결이다. 은행 자동 수집, 거래 수정/삭제, 시작 잔액·이체 입력, 별도 모바일 앱은 이번 범위가 아니다. 원격 Supabase에 테스트 금융 행을 쓰거나 새 migration을 실행하지 않는다.

## 사용자가 보는 흐름

1. 로그인 후 `거래 내역` 탭을 연다. 최초 목록은 최신 거래일부터 50개다.
2. `거래 추가`에서 수입 또는 지출, 본인의 활성 계좌, 같은 종류의 활성 카테고리, 금액, 거래일, 선택 메모를 입력한다.
3. 서버가 실제 저장을 확인한 뒤 성공을 알린다. 목록과 계좌 잔액은 다시 조회한다. 현재 필터에 맞지 않는 새 거래는 목록에 보이지 않을 수 있다.
4. 날짜·계좌·분류·종류로 조회하고 `더 보기`로 다음 페이지를 읽는다. 보관 계좌의 과거 거래는 계속 조회한다.
5. 저장 결과를 받지 못하면 폼을 잠그고 `같은 내용으로 재시도`를 제공한다. 닫거나 새로고침했다면 새로운 거래를 입력하기 전에 목록을 확인한다.

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

일반 거래 수정·soft delete와 `expectedVersion` 충돌 방지 → 시작 잔액·원자적 이체 → 은행 동의/조회/수집 → 별도 모바일 앱 순서다. 거래 정정 권한과 이체 양쪽 원자의 검증을 이번 생성 API에 섞지 않는다.
