# 회원·금융 기본 테이블 읽기 가이드

2026-09-30 이름 변경: 사용자 `user.users`, `user.roles`, `user.role_history`; 금융 `finance.accounts`, `finance.transaction_categories`, `finance.transaction_history`, `finance.account_transfers`, `finance.request_deduplication`. SQL에서 user 스키마는 `"user"`로 인용한다. 기존 migration 파일은 당시 이름을 유지하며 새 `202609300001_readable_schema_names.sql`을 이어서 적용한다. 실행 결과는 [이름 변경 기록](../status/2026-09-30-readable-schema-names.ko.md)을 확인한다.

기준일: 2026-09-30. 이 문서는 승인된 개인 장부 스키마의 SQL 구현을 설명한다. 실제 개발 프로젝트 적용 여부와 테스트 결과는 [적용 기록](../status/2026-09-29-core-schema-application.ko.md)을 확인한다.

## 1. Table Editor에서 어디를 볼까?

Supabase의 Authentication → Users는 로그인 계정 목록이다. Table Editor의 스키마 선택에서 `user`와 `finance`를 찾는다. 기본 `public`만 보고 있으면 새 테이블이 보이지 않을 수 있다. 관리자 Table Editor에서 보이는 것과 브라우저가 API로 읽을 수 있는 것은 다르다. 이 두 스키마는 **Data API Exposed schemas에 추가하지 않는다.**

| 위치 | 테이블 | 저장하는 내용 |
| --- | --- | --- |
| Supabase 관리 | `auth.users` | 인증 계정. 비밀번호·이메일·소셜 인증은 Supabase 책임 |
| `user` | `users` | 닉네임, 이미지 경로, 최초 가입 방식, 탈퇴 표시 |
| `user` | `roles` | 앱의 member/admin 역할 |
| `user` | `role_history` | 누가 어떤 DB 세션으로 역할을 부여/변경/회수했는지 |
| `finance` | `accounts` | 개인 장부의 현금·은행·카드 계좌 항목 |
| `finance` | `transaction_categories` | 사용자별 수입·지출 분류 |
| `finance` | `transaction_history` | 한 계좌의 수입·지출·이체 방향·시작 잔액 |
| `finance` | `account_transfers` | 내 계좌 간 이동을 묶는 공통 정보 |
| `finance` | `request_deduplication` | 중복 재시도를 막기 위한 첫 성공 요청 기록 |

기존 `app_private` 인증 7개는 그대로 둔다. 저장소에 있는 `app_bank` 3개 migration은 이번 생성 대상이 아니며 해당 개발 DB 적용 완료로 간주하지 않는다.

## 2. 회원가입 후 일어나는 일

1. Supabase가 `auth.users` 계정을 저장한다.
2. `account_book_user_bootstrap` 트리거가 앱 프로필과 기본 `member` 역할을 만든다.
3. 실제 역할 부여가 성공하면 감사 이벤트를 같은 DB transaction에 남긴다.
4. 어느 단계든 실패하면 이 가입 transaction은 취소된다. 따라서 트리거 변경은 가입 전체에 영향을 줄 수 있다.

`bootstrap_user()`는 인수를 직접 받지 않는다. PostgreSQL의 `NEW`가 방금 생성된 Auth 계정 행을 제공한다. 함수가 사용하는 것은 `NEW.id`와 인증 서버가 관리하는 `raw_app_meta_data.provider`뿐이다. 사용자가 넣을 수 있는 `raw_user_meta_data.role` 등은 읽지 않는다.

`signup_provider` 매핑: email → email, google → google, kakao → kakao, custom:naver → naver. 없거나 지원하지 않는 값은 unknown이다. 최초 가입 방식이므로 후속 계정 연결 때 덮어쓰지 않는다. 원본을 신뢰할 수 있는 경우에만 migration/관리 경로에서 unknown을 보정한다.

`deleted_at`은 NULL이면 미탈퇴, 값이 있으면 앱 탈퇴 표시다. 이 열을 바꿨다는 것만으로 Supabase 세션·은행 토큰·금융정보가 폐기되는 것은 아니다. 신규 core RLS는 탈퇴 회원의 프로필·역할·금융 접근을 차단하지만, 기존 BFF 로그인·은행 연결 API까지 통합한 탈퇴 기능은 아직 별도 구현이 필요하다.

## 3. 소유권·권한을 두 번 확인하는 이유

`user_id`는 인증 결과에서 서버가 확인한 사용자다. 클라이언트 body의 userId를 그대로 소유자 인증으로 믿으면 안 된다.

- FK(외래 키): 연결한 계좌/분류가 실제로 존재하고 **같은 사용자** 소유인지 확인한다.
- RLS(행별 접근 정책): 그 요청을 처리하는 API가 현재 사용자의 행만 읽고 쓸 수 있게 한다.
- GRANT(역할/열 권한): RLS를 통과해도 runtime이 admin 역할, 가입 경로, 직접 version 등을 바꾸지 못하게 한다.

API는 하나의 DB transaction 안에서 검증된 UUID를 `SET LOCAL app.user_id`로 설정한다. 연결 풀 재사용 시 다른 요청에 값이 남지 않도록 session-wide SET을 사용하지 않는다. `is_active_user()`는 인수 없이 이 문맥과 미탈퇴 프로필 존재 여부만 검사한다. 임의 사용자 UUID를 받는 공개 검색 함수가 아니다.

브라우저, Supabase anon/authenticated/service_role, BFF DB 역할은 새 스키마에 직접 접근할 수 없다. API만 본인 데이터에 최소 권한으로 접근한다. API 서버 자체가 침해되어 임의 UUID/GUC를 설정하는 공격까지 RLS가 해결한다고 주장하지 않는다.

## 4. 거래·이체·재시도 예시

커피 4,500원은 expense 거래 한 행이다. account_id와 category_id가 사용자와 일치해야 하며 지출에 수입 분류를 붙이면 DB에서 거부한다. 금액은 KRW 양수 정수, 방향은 kind다.

국민 장부 → 토스 장부 10,000원 이동은 account_transfers 1행, transaction_history의 transfer_out/transfer_in 각 1행을 함께 저장한다. `validate_transfer_pair()`가 COMMIT 직전에 두 계좌·소유자·금액·날짜·메모·정확한 행 수를 검사한다. 하나만 저장하면 전체 transaction이 취소된다. 실제 은행 송금은 하지 않는다. 내부 이동은 수입·지출 통계에서 제외하고 각 계좌 잔액에만 반영한다.

저장 후 네트워크가 끊겼을 때 같은 생성 요청 키로 재전송하면 원래 결과를 반환하는 것이 멱등성의 목적이다. `request_deduplication`의 PK는 사용자+작업+키이고 fingerprint는 정규화한 요청의 SHA-256 32바이트다. 성공 응답 JSON은 최대 16KiB다. 계좌·카테고리 repository에는 같은 키의 다른 payload 충돌, 동시 재시도 잠금/재조회, 응답 계약 검증을 연결했다. 거래·이체 생성은 후속이다. 테이블 자체가 그 처리 흐름을 실행하는 것은 아니다.

## 5. 수정·보관·동시성

`guard_update()`와 `guard_profile_update()`는 PostgreSQL의 OLD/NEW를 받아 ID·소유자·생성 시각을 보호하고 version을 1 증가시킨다. API는 `WHERE id = ... AND user_id = ... AND version = expectedVersion`으로 수정해야 한다. version 열만 있다고 동시 수정 충돌 응답이 자동 구현되는 것은 아니다.

계좌·분류 archive는 행을 남겨 과거 연결을 보존한다. `guard_transaction_reference()`는 새로 연결하는 계좌/분류 행을 잠그고 활성 상태인지 검사해 archive와 신규 저장의 경쟁을 줄인다. 이미 연결된 보관 계좌의 과거 메모 수정은 허용한다. `guard_transfer()`는 두 계좌를 UUID 순서로 잠근다. 이체 header 및 자식 행 수정·삭제는 현재 runtime 계약에서 지원하지 않는다.

모든 bigint 금액/version 선언은 JS bigint 모드다. 계좌 repository는 numeric 합계를 문자열로 받아 BigInt로 안전 범위를 검사한 뒤 JSON number로 변환한다. 범위를 넘으면 고정 오류로 중단하며 임의 Number 변환으로 반올림하지 않는다. 후속 거래·통계 API에서도 같은 원칙을 지켜야 한다.

## 6. 파일을 따라 읽는 순서

1. `supabase/migrations/202609290001_identity_storage.sql`: 회원 열/제약.
2. `202609290002_identity_access.sql`: 가입 초기화·감사·프로필 보호·RLS.
3. `202609290003_ledger_storage.sql`: 금융 열/FK/인덱스.
4. `202609290004_ledger_integrity.sql`: 이체 정합성·불변 값·행 잠금.
5. `202609290005_ledger_access.sql`: 금융 역할·열 권한과 사용자 정책.
6. `202609300001_readable_schema_names.sql`: 데이터·권한을 보존하는 이름 변경과 함수 본문 갱신.
7. `packages/database/src/schema/identity.ts`, `ledger-*.ts`: 대응하는 타입 선언.
8. `tests/database/identity-schema.test.ts`, `ledger-*.test.ts`, `core-parity.test.ts`: 실제 PostgreSQL 검증.

SQL이 권한/트리거의 원본이다. Drizzle 선언을 고쳤다고 이미 배포된 DB가 자동 변경되지는 않는다. 이후 변경은 새 migration으로 작성하고 적용한 migration의 내용을 덮어쓰지 않는다.

## 7. 적용과 검증 방법

폐기용 PostgreSQL은 고정 loopback URL 및 `TEST_DATABASE_DISPOSABLE=true`인 경우에만 테스트한다. 실제 Supabase URI로 `pnpm test:db`를 실행하면 안 된다. 테스트는 독립 DB를 만들고 자신이 만든 DB만 정리한다.

빈 개발 프로젝트의 **최초 기반 생성**은 `node scripts/local-auth/apply-core-schema.mjs --inspect` → `--check` → `--apply` 순서다. inspect는 읽기 전용, check는 전체 적용을 검증 후 rollback, apply만 commit이다. 스크립트는 고정 프로젝트·실제 역할·양 구간 TLS·기존 스키마 없음·SQL 체크섬을 검사한다. 같은 스키마가 있으면 덮어쓰지 않고 중단한다. 관리자 연결·런타임 비밀은 기존 Git/OneDrive 밖 설정을 재사용하며 출력하지 않는다.

최초 기반 생성 이후 이름 변경은 `node scripts/local-auth/rename-core-schema.mjs --inspect` → `--check` → `--apply`로 수행한다. 이미 적용한 DB에는 `--inspect`만 사용한다. 새 빈 DB의 재현 순서는 기존 5개 SQL 다음 rename SQL이다. 기존 적용 도구/체크섬은 과거 SQL을 재사용하므로 새 이름으로 무작정 치환하지 않는다.

이번 전용 도구는 Supabase CLI의 migration history를 갱신하는 도구가 아니다. 적용 SQL의 체크섬과 시각은 로컬 영수증에 기록한다. 이후 `supabase db push` 같은 통합 배포 경로를 도입하기 전에는 기존 인증 SQL을 포함해 실제 DB 상태·저장소 SQL·migration history를 대조해야 한다. 이미 적용한 SQL을 무조건 재실행하거나 오류를 무시하지 않는다.

로컬 회원을 보존하는 것은 계정 ID 집합의 적용 전후 동일성으로 검사하고, 문서에는 보존 여부/개수만 기록한다. 가입 계정 데이터나 금융 메모를 테스트 보고서·Notion에 복제하지 않는다.

관리형 Supabase의 `postgres`가 `app_api`로 SET ROLE 할 수 있다고 가정하지 않는다. 적용 전에는 권한 메타데이터로 최소 권한을 확인하고, 적용 후에는 **실제 API/BFF 로그인 계정**으로 각각 접속한다. API의 사용자 문맥 미설정 조회는 0행, 본인 프로필/역할 조회는 1행, BFF의 회원/금융 테이블 조회는 권한 거부인지 읽기 전용으로 확인한다. 검사를 위해 관리자에게 API 역할 멤버십을 추가하지 않는다.

`core-parity.test.ts`는 열 이름·타입·NULL 허용·기본값 존재, PK 열, 제약 이름, 인덱스 이름·고유/부분 여부, RLS 선언을 비교한다. 모든 CHECK 식·기본값 값·FK 열/삭제 동작·인덱스 열 순서까지 완전히 비교하는 검사는 아니다. 핵심 보안 규칙은 별도의 실제 SQL 동작 테스트로 검증하며, 전체 선언 비교 확대는 후속 보완 항목이다.

## 8. 아직 완성되지 않은 기능

테이블 생성 이후 프로필·계좌·카테고리 NestJS repository/API 10개, 생성 멱등성·version 검사와 계좌 잔액 조회를 구현했다. [API 흐름 안내](../guides/core-api-development.ko.md)를 함께 읽는다. 거래·이체 쓰기/통계, 프로필 이미지 업로드, 장부 웹 화면·모바일 앱, 은행 자동 수집, 전체 탈퇴 및 보존 데이터 정리, 관리자 UI는 별도 구현 단계다. 첫 가입자를 자동 관리자로 승격하지 않는다.

## English summary

Eight private identity/ledger tables separate Auth accounts from application profiles, roles and personal ledger entries. SQL constraints, forced RLS and column grants protect ownership and immutable metadata. Transfers use one header and exactly two matching entries checked at commit. Profile/account/category repositories and ten Nest routes are implemented; transaction/transfer writes, UI integration, bank ingestion and end-to-end withdrawal handling remain separate work.
