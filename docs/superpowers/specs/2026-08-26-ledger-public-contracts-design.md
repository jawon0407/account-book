# M2.1 공용 원장 공개 계약 설계

- 작성일: 2026-08-26
- 상태: 사용자 승인 완료
- 대상 브랜치: feature/ledger-public-contracts
- 적용 범위: packages/contracts의 계좌·카테고리·거래 공개 계약
- 선행 조건: PR #5가 main에 병합된 commit 1da877e

## 1. 목적

PC 웹, NestJS API, 향후 React Native·Expo 앱이 같은 금융 입력과 응답을 해석하도록 프레임워크 독립적인 Zod 스키마와 TypeScript 타입을 먼저 고정한다. 데이터베이스, API route, BFF route와 UI를 만들기 전에 사용자 입력 경계, 금액·날짜·버전 규칙, 멱등성 및 공개 오류를 하나의 권위 있는 패키지에서 검증한다.

보안은 편의보다 우선한다. 요청 본문의 userId와 소유자 필드는 허용하지 않고, 모든 객체는 알 수 없는 필드를 거부한다. DB 오류, SQL detail, stack, token, cookie와 거래 메모 원문을 공개 오류에 포함하지 않는다.

## 2. 승인된 결정

1. M2는 contracts → PostgreSQL/RLS → repository → API → BFF/PC 웹 → Expo 모바일 → 교차 클라이언트 E2E 순서로 진행한다.
2. 이번 M2.1은 public contracts만 구현하며 DB, API route, BFF, 웹 화면과 모바일 프로젝트를 만들지 않는다.
3. 일반 수입·지출, 계좌 간 이체, 시작 잔액은 서로 다른 명령 계약을 사용한다.
4. 사용자가 입력하는 금액은 양의 KRW 정수다. 거래 종류와 방향을 별도 필드로 표현하고 음수 입력을 허용하지 않는다.
5. 실제 accountId, categoryId, transactionId와 transferId는 서버가 생성한다.
6. 클라이언트는 생성 작업마다 UUID v4 형식의 idempotencyKey를 만들고 JSON 요청 본문에 포함한다.
7. 같은 멱등성 키와 같은 요청은 기존 결과를 반환하고, 같은 키와 다른 요청은 충돌로 거부한다.
8. 수정·삭제는 expectedVersion을 요구하고 stale version을 조용히 덮어쓰지 않는다.
9. 사용 중인 계좌·카테고리는 hard delete하지 않고 archive한다. 거래 삭제는 tombstone을 남긴다.
10. delegated JWT 내부 계약은 기존 package subpath인 ./internal-api에 유지하고 금융 공개 계약은 package root에서만 export한다.

## 3. 범위

### 3.1 포함

- 공통 금융 ID, 금액, 날짜, 시각, 버전, 멱등성 키, 커서와 페이지 크기 스키마
- 현금·은행·카드 계정의 생성·수정·archive·조회 응답
- 계정 시작 잔액 명령
- 수입·지출 카테고리의 생성·수정·정렬·archive·조회 응답
- 일반 수입·지출 생성·수정·삭제와 상세·목록 응답
- 원자적 계좌 간 이체 생성 계약과 결과
- 안전한 금융 공개 오류 코드
- strict schema, 경계값, 권한 우회 필드와 민감 오류 필드를 검증하는 테스트
- 계약 사용법과 RED/GREEN 흐름을 설명하는 한국어 문서 갱신

### 3.2 제외

- PostgreSQL migration, role, grant, RLS, index와 repository
- NestJS controller, service, route와 실제 멱등성 저장소
- Next.js BFF route, ky client와 TanStack Query binding
- PC 장부 UI, 대시보드와 Expo 앱
- 예산, 반복 거래, 자산, CSV, 금융기관 자동 연동과 관리자 기능
- 이체 수정·삭제 공개 계약
- 오프라인 mutation queue와 클라이언트 생성 영구 리소스 ID
- 다중 통화와 소수 금액

이체 수정·삭제는 두 원장 행의 버전과 원자성을 함께 다뤄야 하므로 PostgreSQL/repository 설계에서 별도 명령으로 확정한다. 일반 거래 수정 계약을 이체 행에 재사용하지 않는다.

## 4. 패키지 구조

예상 파일 구조는 다음과 같다.

| 파일 | 책임 |
| --- | --- |
| packages/contracts/src/ledger-common.ts | 공통 금융 primitive와 페이지 입력 |
| packages/contracts/src/accounts.ts | 계정과 시작 잔액 계약 |
| packages/contracts/src/categories.ts | 카테고리 계약 |
| packages/contracts/src/transactions.ts | 일반 거래·이체 생성·목록 계약 |
| packages/contracts/src/ledger-common.test.ts | 공통 경계값 테스트 |
| packages/contracts/src/accounts.test.ts | 계정 계약 테스트 |
| packages/contracts/src/categories.test.ts | 카테고리 계약 테스트 |
| packages/contracts/src/transactions.test.ts | 거래·이체 계약 테스트 |
| packages/contracts/src/errors.ts | 기존 공개 오류에 금융 오류 추가 |
| packages/contracts/src/errors.test.ts | 안전한 금융 오류 테스트 |
| packages/contracts/src/index.ts | 공개 schema와 inferred type export |

작은 파일은 각 도메인의 요청과 응답을 함께 소유한다. 사용 사례가 하나뿐인 helper나 범용 repository 타입을 선제적으로 만들지 않는다.

## 5. 공통 primitive

### 5.1 식별자

- LedgerIdSchema: 서버가 반환하는 UUID 형식의 영구 리소스 ID
- IdempotencyKeySchema: 클라이언트가 생성하는 UUID v4
- 요청 body의 userId, ownerId, actorId, createdBy는 strict schema에서 거부
- UUID는 식별자일 뿐 인증·인가 증명이 아니며 모든 사용은 principal과 소유권 검사를 전제로 한다.

거래 ID와 멱등성 키는 역할이 다르다. transactionId는 저장된 거래를 식별하고, idempotencyKey는 그 거래를 생성하려는 한 번의 작업을 식별한다.

### 5.2 금액

- PositiveKrwAmountSchema: 1 이상 Number.MAX_SAFE_INTEGER 이하의 정수
- SignedKrwBalanceSchema: Number.MIN_SAFE_INTEGER 이상 Number.MAX_SAFE_INTEGER 이하의 정수
- NaN, Infinity, 문자열, 0, 음수, 소수와 안전 정수 범위 밖의 값은 입력 금액에서 거부
- PostgreSQL은 BIGINT를 사용하더라도 공개 JSON 계약은 JavaScript가 정확히 표현할 수 있는 범위로 좁힌다.
- 일반 거래와 이체는 양의 amountKrw를 받고 type 또는 방향으로 원장 부호를 결정한다.

### 5.3 날짜와 시각

- LocalDateSchema: YYYY-MM-DD 형식이며 실제 달력에 존재하는 날짜
- TimestampSchema: UTC offset이 포함된 ISO 8601 시각
- 사용자가 입력한 거래일은 날짜로 유지하고 클라이언트 timezone 변환으로 날짜가 바뀌지 않게 한다.

### 5.4 버전과 페이지

- VersionSchema: 1 이상 Number.MAX_SAFE_INTEGER 이하의 정수
- ExpectedVersionSchema: 수정·삭제 시 필수인 사용자가 마지막으로 조회한 버전
- PageSizeSchema: 1~100, 기본값 적용은 API 계층이 담당
- CursorSchema: 최대 512자의 불투명 문자열. 클라이언트는 내부 정렬 값을 해석하거나 생성하지 않는다.

## 6. 계정 계약

AccountKind는 cash, bank, card로 제한한다.

CreateAccountInput은 다음 필드를 가진다.

- idempotencyKey
- name: trim 후 1~80자
- kind

UpdateAccountInput은 expectedVersion과 변경할 name을 가진다. 변경 필드가 하나도 없는 요청은 거부한다. ArchiveAccountInput은 expectedVersion을 요구한다.

SetOpeningBalanceInput은 다음 필드를 가진다.

- accountId
- direction: asset 또는 liability
- amountKrw: 양의 정수
- occurredOn
- idempotencyKey

0원은 시작 잔액 명령을 만들 필요가 없으므로 거부한다. liability는 신용카드 미결제액처럼 음수 잔액 의미를 표현하지만 클라이언트가 음수를 직접 보내지 않게 한다.

Account 응답은 id, name, kind, currentBalanceKrw, version, archivedAt, createdAt과 updatedAt을 가진다. 모든 응답도 strict schema다.

## 7. 카테고리 계약

CategoryKind는 income과 expense로 제한한다.

CreateCategoryInput은 idempotencyKey, name, kind와 sortOrder를 가진다.

- name: trim 후 1~50자
- sortOrder: 0 이상 10,000 이하의 정수

UpdateCategoryInput은 expectedVersion과 선택적인 name·sortOrder를 가진다. 빈 수정 요청은 거부한다. ArchiveCategoryInput은 expectedVersion을 요구한다.

Category 응답은 id, name, kind, sortOrder, version, archivedAt, createdAt과 updatedAt을 가진다. archive된 카테고리는 과거 거래 응답에는 남지만 새 거래 생성에는 사용할 수 없다. 카테고리 종류와 거래 종류의 일치 여부는 ID만 보는 Zod 계약이 아니라 API service와 복합 소유권 조회에서 검증한다.

## 8. 일반 거래 계약

CreateTransactionInput은 다음 필드를 가진다.

- idempotencyKey
- type: income 또는 expense
- accountId
- categoryId
- amountKrw
- occurredOn
- memo: 선택값, trim 후 최대 500자

빈 문자열 메모는 허용하지 않는다. UI는 비어 있는 입력을 생성 시 undefined, 수정 시 null로 변환한다.

UpdateTransactionInput은 expectedVersion과 변경 가능한 type, accountId, categoryId, amountKrw, occurredOn, memo를 가진다. 최소 한 필드를 변경해야 한다. memo를 지우는 동작은 null로 명시하고 undefined는 변경하지 않음을 뜻한다. 이 계약은 income·expense 거래만 대상으로 하며 transfer와 opening balance에는 사용할 수 없다.

DeleteTransactionInput은 expectedVersion을 요구한다. 삭제 결과는 id, 마지막 version과 deletedAt을 가진 tombstone 응답이다.

Transaction 응답은 kind를 판별자로 사용하는 다음 다섯 strict variant의 union이다. 시작 잔액(opening_balance)은 direction으로 asset/liability를 표현한다.

| variant | kind | categoryId | transferId | direction |
| --- | --- | --- | --- | --- |
| 일반 거래 | income 또는 expense | UUID | null | kind로 해석 |
| 이체 행 | transfer_out 또는 transfer_in | null | UUID | kind로 해석 |
| 시작 잔액 | opening_balance | null | null | asset 또는 liability |

모든 variant는 id, accountId, 양의 amountKrw, occurredOn, memo, version, deletedAt, createdAt과 updatedAt을 공통으로 가진다. 목록과 화면은 일반 거래·이체 행의 방향을 kind로 해석하고, opening_balance의 방향은 direction(asset/liability)으로 해석하며 amountKrw 자체의 부호에 의존하지 않는다. 삭제되지 않은 기본 목록에서는 deletedAt이 null인 항목만 반환하지만 계약은 동기화 확장을 위해 tombstone 값을 표현할 수 있다.

## 9. 이체 생성 계약

이체 응답의 debit·credit 행은 서로 다른 id와 accountId를 가지며 amountKrw, occurredOn, memo와 top-level transferId를 서로 일치시킨다. memo는 양쪽 행에 같은 nullable 값으로 저장되는 명령 메타데이터다.

CreateTransferInput은 다음 필드를 가진다.

- idempotencyKey
- fromAccountId
- toAccountId
- amountKrw
- occurredOn
- memo

Zod refine 단계에서 출발·도착 ID가 같은 요청을 거부한다. 두 계정의 동일 사용자 소유 여부, archive 여부와 동시성은 API service와 PostgreSQL transaction에서 다시 검증한다.

CreateTransferResult는 transferId와 출금·입금 transaction 두 개를 반환한다. 서버는 두 행을 같은 transfer group으로 묶고 하나의 DB transaction에서 생성한다. 한 행만 성공한 결과는 계약상 존재하지 않는다. 대시보드 수입·지출 집계에서는 두 행 모두 제외한다.

## 10. 목록과 커서

TransactionListQuery는 선택적인 accountId, categoryId, type, from, to, cursor와 limit을 허용한다. 알 수 없는 query key와 빈 문자열 ID는 거부한다.

TransactionListResponse는 items와 nextCursor를 가진다. nextCursor는 다음 페이지가 없으면 null이다. 서버의 기본 정렬은 occurredOn 내림차순과 id 내림차순이며, 클라이언트는 cursor 내용을 파싱하지 않는다.

계정과 카테고리 목록은 초기 데이터량이 작으므로 커서 없이 전체 활성 목록과 선택적인 archived 포함 여부만 계약으로 제공한다. 실제 데이터 규모 측정 없이 복잡한 페이지네이션을 추가하지 않는다.

## 11. 멱등성

idempotencyKey는 CreateAccountInput, SetOpeningBalanceInput, CreateCategoryInput, CreateTransactionInput과 CreateTransferInput의 JSON body에 포함한다.

이 선택은 다음 이유로 현재 구조에 적합하다.

- BFF가 exact JSON body hash를 delegated JWT에 결속하므로 키 변경도 검증 실패로 이어진다.
- 웹·API·모바일이 같은 Zod 계약과 TypeScript 타입으로 키 누락을 발견할 수 있다.
- 향후 일괄 입력은 항목별 키를 표현할 수 있다.
- 새 custom header의 중복·정규화·proxy 전달과 JWT binding 규칙을 추가하지 않는다.

후속 repository는 사용자, 작업 종류, idempotencyKey에 고유 제약을 적용하고 canonical request fingerprint와 생성된 resource 결과를 같은 DB transaction에서 기록한다.

- 같은 사용자·작업·키·fingerprint: 기존 성공 결과 반환
- 같은 사용자·작업·키와 다른 fingerprint: LEDGER_IDEMPOTENCY_CONFLICT
- 다른 사용자: 같은 UUID여도 독립된 namespace
- 키 원문은 인증 수단이 아니며 구조화 로그에는 원문 대신 hash 또는 축약값만 기록

## 12. 낙관적 동시성과 삭제

수정·archive·삭제는 expectedVersion을 요구한다. API는 사용자 ID, resource ID와 expectedVersion을 하나의 원자적 조건으로 비교한다.

- 일치: 변경 적용 후 version 증가
- 불일치: LEDGER_VERSION_CONFLICT
- 다른 사용자 소유 또는 존재하지 않음: LEDGER_NOT_FOUND

계정·카테고리는 참조 기록을 보존하기 위해 archive한다. 일반 거래 삭제는 deletedAt과 증가한 version을 가진 tombstone으로 처리한다. 실제 사용자 계정 삭제와 보존 기간에 따른 물리 삭제는 M5 운영·개인정보 계획에서 별도로 정의한다.

## 13. 공개 오류

기존 ApiErrorSchema의 code enum에 다음 안전한 코드를 추가한다.

- LEDGER_VALIDATION_FAILED
- LEDGER_NOT_FOUND
- LEDGER_VERSION_CONFLICT
- LEDGER_IDEMPOTENCY_CONFLICT
- LEDGER_ACCOUNT_UNAVAILABLE
- LEDGER_CATEGORY_UNAVAILABLE
- LEDGER_TRANSFER_INVALID

다른 사용자의 ID를 입력해도 존재 여부를 노출하지 않고 LEDGER_NOT_FOUND로 통일한다. 공개 오류는 기존 message, requestId, retryable과 fieldErrors 구조를 유지한다.

오류 object의 unknown key를 거부하므로 stack, sql, detail, query, table, token, cookie, authorization과 memo 같은 필드는 전달할 수 없다. 충돌 응답에 최신 금융 record 전체를 포함할지는 API/BFF 설계에서 별도 승인하며 이번 계약에는 포함하지 않는다.

## 14. 주석과 학습 문서 원칙

export된 schema와 helper에는 문법을 반복하는 주석 대신 다음을 설명한다.

- 값이 필요한 행동 원리
- 매개변수를 신뢰하지 않는 이유
- 보호하는 보안·금융 불변식
- 생성 주체와 검증 주체
- 허용 범위와 반환 의미

예를 들어 IdempotencyKeySchema 주석은 재시도 식별자이며 인증 수단이 아니라는 점, 사용자·작업·본문 fingerprint와 함께 검증해야 한다는 점을 설명한다.

구현 PR은 다음 한국어 문서를 갱신한다.

- packages/contracts/README.md
- docs/guides/full-stack-development-flow.ko.md
- docs/status/2026-08-24-development-progress.ko.md
- docs/api/README.md

기존 full-stack guide의 amountKrw: string 예시는 이번 승인에 따라 안전 정수 number로 정정한다. 2026-07-16 PWA 설계의 클라이언트 생성 영구 리소스 ID와 오프라인 queue는 2026-07-27 웹·네이티브 모바일 공유 원장 설계가 대체했음을 문서에 명시한다.

## 15. TDD와 검증

구현은 RED → GREEN → 리팩터링 → 집중 검증 → 전체 검증 순서다.

### 15.1 RED

각 도메인 test file에서 아직 존재하지 않는 schema import와 다음 실패 기대를 먼저 추가한다.

- 금액 0, 음수, 소수, 문자열, 안전 정수 초과
- 잘못된 UUID와 UUID v4가 아닌 idempotencyKey
- 존재하지 않는 날짜와 잘못된 ISO 날짜
- userId, ownerId, createdAt 같은 권한 우회·서버 소유 필드
- 빈 이름, 길이 초과, 잘못된 sortOrder
- 같은 출발·도착 계정의 이체와 이체의 categoryId 추가
- expectedVersion 누락, 0, 소수와 빈 PATCH
- 허용되지 않은 transaction type과 category kind
- 과도한 memo와 응답의 unknown key
- 안전하지 않은 공개 오류 코드와 민감 필드

카테고리 소유권이나 종류 일치처럼 DB 조회가 필요한 규칙을 Zod만으로 통과했다고 주장하지 않는다. 이번 테스트는 해당 규칙의 안전한 오류 code만 고정하고 실제 검증은 API/DB 계획에서 추가한다.

### 15.2 GREEN과 리팩터링

테스트를 통과하는 최소 schema와 inferred type을 구현한다. 두 도메인 이상에서 실제로 반복되는 primitive만 ledger-common.ts로 이동한다.

### 15.3 최종 검증

- contracts 집중 Vitest
- contracts TypeScript typecheck와 build
- 전체 workspace test, lint, typecheck와 build
- git diff --check
- production dependency audit와 repository security gate
- 실제 secret, 금융정보, env, private key와 생성 artifact가 diff에 없는지 검사

약 40~60개의 계약 테스트를 예상한다. 테스트 개수는 완료 주장이 아니라 승인된 경계와 negative case를 모두 증명하는지를 기준으로 확정한다.

## 16. 예상 변경 규모

- 신규 파일: 8개
- 기존 코드 수정: errors.ts, errors.test.ts, index.ts
- 문서 수정: README와 한국어 개발·진행·API 문서 4개
- 총 변경: 약 12~16개 파일, 테스트와 문서를 포함해 700~1,200줄

실제 구현 중 DB나 API 코드를 수정해야 한다면 숨은 복잡도로 판단하고 작업을 중단한 뒤 별도 설계 승인으로 승격한다.

## 17. 완료 조건

- 모든 입력과 응답 object가 strict schema다.
- TypeScript 타입은 Zod schema에서 추론하며 별도 수동 타입과 불일치하지 않는다.
- 공개 body에 userId, owner, audit actor와 서버 생성 필드를 받을 수 없다.
- 생성 명령은 UUID v4 idempotencyKey를 요구한다.
- 수정·삭제는 expectedVersion을 요구한다.
- 이체는 일반 거래 생성과 분리되고 같은 계정 이체를 거부한다.
- 금액·날짜·메모·이름·페이지·커서 경계값이 테스트로 고정된다.
- 공개 오류에 내부 정보와 다른 사용자의 resource 존재 여부가 노출되지 않는다.
- 내부 delegated JWT 계약과 인증 계약이 회귀하지 않는다.
- 전체 검증과 보안 게이트가 통과하고 한국어 문서가 실제 코드와 일치한다.

## 18. 후속 순서

1. M2.1 공용 계약 구현
2. PostgreSQL 금융 schema, role, grant, RLS와 index 설계
3. repository transaction, 멱등성과 version 구현
4. NestJS controller/service/repository
5. Next.js BFF route와 PC React Query 화면
6. Expo 모바일 session과 React Query 화면
7. PC↔모바일 동일 사용자 데이터 일관성 E2E

이번 설계는 1번만 승인하며 뒤 단계는 각자 별도 설계·위협 검토·계획·PR을 사용한다.
