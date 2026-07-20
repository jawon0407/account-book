# 인증 데이터베이스 스키마 레퍼런스

> **English Summary:** Six authentication tables live in the private `app_private` schema. The `app_session_bff` role receives explicit CRUD grants only on those tables, while browser-facing roles and default future-table grants are revoked. Drizzle models the final state after migrations 001 through 003.

이 문서는 현재 [`Drizzle auth schema`](../../packages/database/src/schema/auth.ts), 세 SQL migration, [`AuthRepository`](../../apps/web/src/server/persistence/auth-repository.ts), [`PostgresAuthRepository`](../../apps/web/src/server/persistence/postgres-auth-repository.ts)를 기준으로 한다. PostgreSQL 식별자는 `snake_case`, TypeScript 필드는 대응하는 `camelCase`다.

## 최종 객체 지도

| 객체 | 현재 용도 | 구현 상태 |
| --- | --- | --- |
| `app_private.auth_user_security_state` | 사용자별 최소 허용 provider JWT `iat`와 recovery/session 생성 직렬화 | 사용 중 |
| `app_private.auth_sessions` | opaque session과 encrypted provider token pair | 사용 중 |
| `app_private.oauth_transactions` | OAuth state·interaction digest와 encrypted PKCE verifier | 사용 중 |
| `app_private.auth_recovery_transactions` | password recovery의 pending/exchanged/update-claimed/consumed 상태 | 사용 중 |
| `app_private.email_confirmation_transactions` | email confirmation의 interaction-bound PKCE transaction | 사용 중 |
| `app_private.auth_rate_limits` | 인증 rate-limit bucket | **스키마만 존재**. repository operation과 use case는 아직 없다. |

Drizzle export 이름은 각각 `authUserSecurityState`, `authSessions`, `oauthTransactions`, `authRecoveryTransactions`, `emailConfirmationTransactions`, `authRateLimits`다.

## constraint와 index 이름

Drizzle의 명시적 metadata 이름과 migration이 실제 PostgreSQL catalog에 만드는 이름은 같은 개념이 아니다. [`auth.ts`](../../packages/database/src/schema/auth.ts)의 `check(...)` 이름은 애플리케이션 모델 이름이다. 반면 SQL migration 001의 inline `PRIMARY KEY`, `UNIQUE`, 이름 없는 `CHECK`는 PostgreSQL이 이름을 자동 생성한다. 운영 판단에는 migration 적용 후 catalog 조회 결과를 사용한다.

### Drizzle 명시 metadata 이름

| table | check/index 이름 |
| --- | --- |
| `auth_user_security_state` | `auth_user_security_state_minimum_iat_nonnegative` |
| `auth_sessions` | `auth_sessions_selector_hash_length`, `auth_sessions_rotation_version_nonnegative`, `auth_sessions_absolute_expiry`, `auth_sessions_provider_session_unique` |
| `oauth_transactions` | `oauth_transactions_state_hash_length`, `oauth_transactions_interaction_hash_length`, `oauth_transactions_provider`, `oauth_transactions_return_path`, `oauth_transactions_expiry` |
| `auth_recovery_transactions` | `auth_recovery_transactions_interaction_hash_length`, `auth_recovery_transactions_expiry`, `auth_recovery_transactions_stage`, `auth_recovery_transactions_stage_order` |
| `email_confirmation_transactions` | `email_confirmation_transactions_interaction_hash_length`, `email_confirmation_transactions_expiry` |
| `auth_rate_limits` | `auth_rate_limits_fingerprint_length`, `auth_rate_limits_kind`, `auth_rate_limits_window_seconds_positive`, `auth_rate_limits_count_nonnegative` |

`.primaryKey()`, `.unique()`, 복합 `primaryKey(...)`에는 이 source가 별도 이름을 지정하지 않는다. 위 목록에서 `auth_sessions_provider_session_unique`만 Drizzle과 migration 양쪽에 명시된 standalone partial unique index다.

### migration 001→003 이후 PostgreSQL catalog

아래에서 “자동”은 migration SQL에 이름을 고정하지 않아 PostgreSQL naming convention으로 생성되는 이름이다. 괄호의 이름은 현재 SQL chain에서 기대되는 catalog 이름이며, 복원본·수동 변경·다른 PostgreSQL 동작을 단정하는 근거로 사용하지 않는다.

| table | 종류 | migration/live catalog 이름 |
| --- | --- | --- |
| `auth_user_security_state` | primary key / check | 자동 `auth_user_security_state_pkey`; 명시 `auth_user_security_state_minimum_iat_nonnegative` |
| `auth_sessions` | primary key / unique / checks | 자동 `auth_sessions_pkey`, `auth_sessions_selector_hash_key`, `auth_sessions_selector_hash_check`, `auth_sessions_rotation_version_check`, `auth_sessions_check` |
| `auth_sessions` | standalone partial unique index | 명시 `auth_sessions_provider_session_unique` |
| `oauth_transactions` | primary key / unique / checks | 자동 `oauth_transactions_pkey`, `oauth_transactions_state_hash_key`, `oauth_transactions_interaction_hash_key`, `oauth_transactions_state_hash_check`, `oauth_transactions_interaction_hash_check`, `oauth_transactions_provider_check`, `oauth_transactions_check` |
| `oauth_transactions` | final return-path check | 001의 자동 `oauth_transactions_return_path_check`를 002가 drop하고 명시 `oauth_transactions_return_path`를 추가 |
| `auth_recovery_transactions` | primary key / unique / checks | 자동 `auth_recovery_transactions_pkey`, `auth_recovery_transactions_interaction_hash_key`, `auth_recovery_transactions_interaction_hash_check`, `auth_recovery_transactions_check`; 002 명시 `auth_recovery_transactions_stage`, `auth_recovery_transactions_stage_order` |
| `email_confirmation_transactions` | primary key / unique / checks | 자동 `email_confirmation_transactions_pkey`, `email_confirmation_transactions_interaction_hash_key`, `email_confirmation_transactions_interaction_hash_check`, `email_confirmation_transactions_check` |
| `auth_rate_limits` | primary key / checks | 자동 `auth_rate_limits_pkey`, `auth_rate_limits_fingerprint_check`, `auth_rate_limits_kind_check`, `auth_rate_limits_window_seconds_check`, `auth_rate_limits_count_check` |

`PRIMARY KEY`와 `UNIQUE` constraint는 같은 이름의 backing index를 만든다. standalone partial index는 `pg_constraint`가 아니라 `pg_indexes`에서 확인한다. 적용 환경의 권위 있는 목록은 다음 read-only query로 확인한다.

```sql
select c.conrelid::regclass as table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_namespace n on n.oid = c.connamespace
where n.nspname = 'app_private'
order by c.conrelid::regclass::text, c.conname;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'app_private'
order by tablename, indexname;
```

## schema와 role 권한

### `app_private`

[`202607200001_security_auth_foundation.sql`](../../supabase/migrations/202607200001_security_auth_foundation.sql)은 `app_private` schema를 만들고 `PUBLIC`, `anon`, `authenticated`, `service_role`, `app_session_bff`의 schema 권한을 모두 revoke한다. 그 뒤 `app_session_bff`에만 schema `USAGE`를 명시적으로 grant한다. 이 schema의 인증 테이블에는 RLS policy가 없다. 격리는 schema/table ACL과 좁은 server repository 경계가 담당한다.

### `app_session_bff`

role 속성은 다음과 같다.

- `NOLOGIN`
- `NOSUPERUSER`
- `NOCREATEDB`
- `NOCREATEROLE`
- `NOINHERIT`
- `NOREPLICATION`
- `NOBYPASSRLS`

001은 당시 네 테이블에, 002는 `email_confirmation_transactions`에, 003은 `auth_user_security_state`에 `SELECT, INSERT, UPDATE, DELETE`를 명시적으로 grant한다. `TRUNCATE`, `REFERENCES`, `TRIGGER`, schema `CREATE`는 grant하지 않는다.

001은 migration owner인 `postgres`가 앞으로 만드는 `app_private` 테이블의 default privileges에서도 `PUBLIC`, browser-facing roles, `service_role`, `app_session_bff` 권한을 revoke한다. 따라서 새 테이블은 별도 migration의 명시적 grant 없이는 BFF가 접근할 수 없다.

`NOLOGIN` role 자체로 연결할 수 없으므로 실제 배포 연결 role과 `SET ROLE` 정책은 별도 운영 구성이다. 현재 저장소에는 그 연결 구성이 없다.

## `auth_user_security_state`

| 열 | PostgreSQL 타입 | null/default | 제약·의미 |
| --- | --- | --- | --- |
| `user_id` | `uuid` | NOT NULL | primary key. 사용자별 공유 row lock의 기준 |
| `minimum_accepted_iat` | `bigint` | NOT NULL, default `0` | `>= 0`. 이 값보다 작은 provider JWT `iat`의 새 session 생성을 거부 |

foreign key는 없다. `PostgresAuthRepository.createSession`과 `consumeRecoveryAndRevokeSessions`가 `INSERT ... ON CONFLICT DO NOTHING` 뒤 같은 행을 update해 lock을 공유한다.

recovery 완료 시 값은 `greatest(current, floor(extract(epoch from clock_timestamp()))::bigint + 1)`로 전진한다. 애플리케이션이 전달한 request time이 아니라 provider 비밀번호 변경 뒤 DB 시각의 다음 정수 초를 사용한다.

## `auth_sessions`

| 열 | PostgreSQL 타입 | null/default | 제약·수명 의미 |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | primary key, AES-GCM AAD의 record ID |
| `selector_hash` | `bytea` | NOT NULL | unique, `octet_length = 32`; browser selector 원문은 저장하지 않음 |
| `user_id` | `uuid` | NOT NULL | Supabase 사용자 UUID; FK는 없음 |
| `supabase_session_id` | `uuid` | NOT NULL | provider JWT `session_id` |
| `encrypted_access_token` | `jsonb` | NOT NULL | versioned AES-GCM envelope |
| `encrypted_refresh_token` | `jsonb` | NOT NULL | versioned AES-GCM envelope |
| `access_token_expires_at` | `timestamptz` | NOT NULL | provider access token 만료 |
| `created_at` | `timestamptz` | NOT NULL | local session 생성 시각 |
| `last_seen_at` | `timestamptz` | NOT NULL | idle timeout 기준. 성공한 refresh에서 갱신 |
| `absolute_expires_at` | `timestamptz` | NOT NULL | `> created_at`; 서비스 생성값은 정확히 30일 뒤 |
| `revoked_at` | `timestamptz` | nullable | non-null이면 local session 비활성 |
| `revocation_pending_at` | `timestamptz` | nullable | local revoke 뒤 외부 revoke 재시도 필요 표시 |
| `rotation_version` | `integer` | NOT NULL, default `0` | `>= 0`; refresh compare-and-swap version |

### 인덱스와 활성 조건

- `selector_hash` unique constraint/index
- primary key `id`
- partial unique index `auth_sessions_provider_session_unique` on `supabase_session_id WHERE revoked_at IS NULL`

한 provider session ID는 동시에 하나의 active local session에만 대응한다. revoke된 과거 행은 같은 provider session ID를 막지 않는다.

DB에는 7일 idle TTL이나 30일 최대 TTL을 자동 계산하는 default가 없다. 서비스가 30일 값을 쓰고 repository 조회·rotation이 다음 조건을 모두 적용한다.

```text
revoked_at IS NULL
AND absolute_expires_at > now
AND last_seen_at > now - 7 days
```

경계 시각은 만료로 취급한다. `SessionService`는 저장 row의 `absolute_expires_at - created_at`이 0보다 크고 30일 이하인지도 다시 확인한다.

## `oauth_transactions`

| 열 | PostgreSQL 타입 | null/default | 제약·수명 의미 |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | primary key, PKCE envelope AAD record ID |
| `state_hash` | `bytea` | NOT NULL | unique, 정확히 32바이트 SHA-256 digest |
| `interaction_hash` | `bytea` | NOT NULL | unique, 정확히 32바이트 SHA-256 digest |
| `provider` | `text` | NOT NULL | 정확히 `google`, `kakao`, `naver` 중 하나 |
| `encrypted_pkce_verifier` | `jsonb` | NOT NULL | `tokenKind: "pkce"` envelope |
| `return_path` | `text` | NOT NULL | 정확히 `/app` 또는 `/settings/security` |
| `created_at` | `timestamptz` | NOT NULL | transaction 시작 |
| `expires_at` | `timestamptz` | NOT NULL | `> created_at`; 서비스는 정확히 10분 뒤로 설정 |
| `consumed_at` | `timestamptz` | nullable | claim winner가 설정 |

`state`와 interaction selector 원문은 저장하지 않는다. repository claim은 provider, 두 digest, `consumed_at IS NULL`, `expires_at > now`를 한 conditional update에 넣는다. row가 정확히 하나 갱신될 때만 성공한다.

서비스가 provider에 전달하는 ID mapping은 Google `google`, Kakao `kakao`, Naver `custom:naver`다. DB에는 public provider enum인 `naver`를 저장한다.

## `auth_recovery_transactions`

| 열 | PostgreSQL 타입 | null/default | 제약·단계 의미 |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | primary key, PKCE/recovery envelope AAD record ID |
| `interaction_hash` | `bytea` | NOT NULL | unique, 정확히 32바이트 |
| `encrypted_pkce_verifier` | `jsonb` | nullable | pending 단계에 존재, promotion에서 null로 바꿈 |
| `user_id` | `uuid` | nullable | verified exchange 뒤 설정 |
| `encrypted_recovery_token` | `jsonb` | nullable | access/refresh pair의 canonical encrypted JSON |
| `created_at` | `timestamptz` | NOT NULL | transaction 시작 |
| `expires_at` | `timestamptz` | NOT NULL | `> created_at`; 서비스는 정확히 15분 뒤로 설정 |
| `exchange_claimed_at` | `timestamptz` | nullable | provider code 교환 전 claim |
| `exchanged_at` | `timestamptz` | nullable | verifier를 recovery credential로 promotion한 시각 |
| `password_update_claimed_at` | `timestamptz` | nullable | provider password 변경 전 claim |
| `consumed_at` | `timestamptz` | nullable | provider 성공 뒤 최종 consume 시각 |

### `auth_recovery_transactions_stage`

허용되는 row shape는 두 계열뿐이다.

1. **pending 계열**: PKCE verifier non-null, user/recovery token null, `exchanged_at`, `password_update_claimed_at`, `consumed_at` null. `exchange_claimed_at`은 claim 전 null 또는 claim 후 non-null일 수 있다.
2. **exchanged 계열**: PKCE verifier null, user/recovery token non-null, `exchange_claimed_at`과 `exchanged_at` non-null. update claim 전에는 `password_update_claimed_at`과 `consumed_at`이 둘 다 null이고, update claim 뒤에는 `password_update_claimed_at`이 non-null이다.

### `auth_recovery_transactions_stage_order`

non-null 시각은 다음 순서를 지켜야 한다.

```text
created_at
<= exchange_claimed_at
<= exchanged_at
<= password_update_claimed_at
<= consumed_at
```

`consumed_at`이 있으면 `password_update_claimed_at`도 반드시 있어야 한다. repository row mapper는 DB check보다 더 엄격하게 각 claim 시각이 `expires_at`보다 이른지도 검사하고 malformed row를 `null`로 처리한다.

## `email_confirmation_transactions`

| 열 | PostgreSQL 타입 | null/default | 제약·수명 의미 |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | primary key, PKCE envelope AAD record ID |
| `interaction_hash` | `bytea` | NOT NULL | unique, 정확히 32바이트 |
| `encrypted_pkce_verifier` | `jsonb` | NOT NULL | `tokenKind: "pkce"` envelope |
| `created_at` | `timestamptz` | NOT NULL | signup 시작 |
| `expires_at` | `timestamptz` | NOT NULL | `> created_at`; 서비스는 정확히 15분 뒤로 설정 |
| `consumed_at` | `timestamptz` | nullable | confirmation claim 시각 |

claim은 interaction digest, `consumed_at IS NULL`, `expires_at > now`를 한 update에 적용한다. service는 반환 row의 전체 수명이 정확히 15분인지 다시 검사한다.

## `auth_rate_limits`

| 열 | PostgreSQL 타입 | null/default | 제약·의미 |
| --- | --- | --- | --- |
| `fingerprint` | `bytea` | NOT NULL | 정확히 32바이트 |
| `kind` | `text` | NOT NULL | `sign_in | sign_up | password_reset | oauth_start` |
| `window_started_at` | `timestamptz` | NOT NULL | rate window 시작 |
| `window_seconds` | `integer` | NOT NULL | `> 0` |
| `count` | `integer` | NOT NULL | `>= 0` |
| `blocked_until` | `timestamptz` | nullable | 차단 종료 시각 |

primary key는 `(fingerprint, kind, window_started_at)` 복합 키다. 현재 `AuthRepository`에는 이 테이블을 읽거나 갱신하는 operation이 없다. 따라서 rate limiting이 동작한다고 간주하면 안 된다.

## `AuthRepository` public operation

| operation | 입력 | 결과 | 원자성·조건 |
| --- | --- | --- | --- |
| `createSession(input, providerIssuedAtSeconds)` | encrypted session 전체와 safe-integer `iat` | 생성 여부 `boolean` | 사용자 security row lock과 session insert를 한 transaction에서 수행. `iat < minimum`이면 insert 없음 |
| `findActiveBySelectorHash(hash, now)` | 32바이트 digest, 시각 | active row 또는 `null` | revoke, absolute, 7일 idle 조건을 모두 만족하는 최대 1행 |
| `rotate(input)` | session ID, expected version/session ID, encrypted replacement pair, 시각 | CAS 성공 여부 | 두 token, provider session ID, expiry, `last_seen_at`, version을 한 conditional update로 교체 |
| `revokeBySelectorHash(hash, now)` | selector digest | 한 행 revoke 여부 | active row의 `revoked_at`을 한 번만 설정 |
| `revokeAllForUser(userId, now)` | 사용자 UUID | 영향 행 수 | 해당 사용자의 모든 active local session revoke |
| `markRevocationPending(sessionId, now)` | session UUID | `void` | 이미 local-revoked인 행만 표시 |
| `createOAuthTransaction(input)` | digest, provider, encrypted verifier, return path, 시각 | `void` | insert |
| `claimOAuthTransaction(input)` | provider, state/interaction digest, 시각 | consumed row 또는 `null` | exact binding·미소비·미만료를 한 update로 claim |
| `createEmailConfirmationTransaction(input)` | interaction digest, encrypted verifier, 시각 | `void` | insert |
| `claimEmailConfirmationTransaction(hash, now)` | interaction digest, 시각 | consumed row 또는 `null` | exact interaction·미소비·미만료 claim |
| `createRecoveryTransaction(input)` | pending recovery row | `void` | insert |
| `claimRecoveryExchange(hash, now)` | interaction digest, 시각 | exchange-claimed row 또는 `null` | pending shape 전체와 미만료 조건을 한 update로 검사 |
| `promoteRecoveryExchange(input)` | transaction/user UUID, expected claim 시각, encrypted credential, 시각 | CAS 성공 여부 | verifier를 제거하고 user/credential/`exchanged_at`을 함께 설정 |
| `claimRecoveryPasswordUpdate(hash, now)` | interaction digest, 시각 | update-claimed row 또는 `null` | exchanged shape 전체와 미만료 조건을 한 update로 검사 |
| `consumeRecoveryAndRevokeSessions(input)` | transaction/user UUID, expected update claim, 시각 | 성공 여부 | recovery consume, user gate 전진, 모든 active session revoke를 한 transaction에서 수행 |

TypeScript record와 input의 전체 필드 정의는 [`auth-repository.ts`](../../apps/web/src/server/persistence/auth-repository.ts)에 있다.

## 원자성 패턴

### shared user row lock

`createSession`은 security row를 no-op update한 뒤 minimum을 읽고 session을 insert한다. recovery consume은 recovery row를 먼저 조건부 consume하고 같은 user security row의 minimum을 DB 시각 기준으로 올린 뒤 session을 revoke한다. 두 transaction이 같은 사용자 security row에서 직렬화되므로 다음 둘 중 하나다.

- session이 먼저 commit되면 recovery revoke에 포함된다.
- recovery가 먼저 commit되면 이전 `iat` session insert가 거부된다.

### claim-before-exchange

OAuth, email confirmation, recovery exchange, recovery password update는 provider 호출 전에 DB claim을 획득한다. provider 실패도 claim을 되돌리지 않는다. replay가 provider까지 다시 도달하지 않는 대신 사용자는 새 flow를 시작해야 한다.

### malformed row fail-closed

검증 책임은 record 종류와 계층에 따라 나뉜다.

- session mapper `toRecord`는 row/object shape, 32바이트 selector digest, token envelope가 배열이 아닌 object인지, timestamp 타입, nullable revoke 시각, nonnegative rotation version을 검사한다. 여기서는 session·user·provider session ID가 **문자열인지**만 확인하며 UUID 형식이나 시간 순서는 검사하지 않는다.
- `SessionService.validRecord`가 세 session ID의 UUID 형식, selector digest, revoke 상태, `created_at <= last_seen_at <= absolute_expires_at`, idle 7일, absolute 최대 30일과 현재 만료 경계를 검증한다. 이어지는 token 복호화가 envelope version·key ID·nonce/tag 길이와 record ID/token kind AAD를 검증한다.
- OAuth, email confirmation, recovery transaction mapper는 각 transaction ID UUID, digest, 허용 provider/return path, 필요한 timestamp와 row stage를 직접 검사한다. email/recovery mapper는 chronology도 검사하고, recovery의 nullable `user_id`가 있으면 UUID인지 확인한다. 각 use-case service는 exact 10분/15분 수명, 현재 만료, binding과 복호화된 envelope를 추가 검증한다.

어느 계층에서든 실패하면 malformed row를 성공 경로로 전달하지 않는다. 다만 repository가 모든 session UUID와 service-level 수명 규칙까지 검사한다고 해석하면 안 된다.

## migration 순서

### 001: private auth foundation

[`202607200001_security_auth_foundation.sql`](../../supabase/migrations/202607200001_security_auth_foundation.sql)은 다음을 만든다.

- hardened `app_session_bff` role과 `app_private` schema
- `auth_sessions`, `oauth_transactions`, 초기 `auth_recovery_transactions`, `auth_rate_limits`
- active provider session partial unique index
- explicit revoke/default revoke와 네 테이블 CRUD grant

001 당시 OAuth return path는 일반 상대 경로 형식만 검사했고, recovery의 `user_id`와 `encrypted_recovery_token`은 NOT NULL이었다.

### 002: server-owned PKCE transaction

[`202607200002_server_pkce_transactions.sql`](../../supabase/migrations/202607200002_server_pkce_transactions.sql)은 다음을 바꾼다.

- OAuth return path를 `/app`, `/settings/security` 두 값으로 축소
- recovery에 encrypted PKCE verifier와 세 claim/stage 시각 추가
- 기존 recovery row를 `created_at` 기준 exchanged 단계로 backfill
- recovery user/token의 NOT NULL 제거
- recovery stage와 order check 추가
- `email_confirmation_transactions` 생성과 권한 부여

### 003: user issuance gate

[`202607200003_user_security_state.sql`](../../supabase/migrations/202607200003_user_security_state.sql)은 `auth_user_security_state`를 만들고 nonnegative minimum constraint와 explicit revoke/grant를 적용한다.

## rollback 한계

세 migration은 destructive down migration을 제공하지 않는다.

- 003을 제거하면 사용자별 minimum이 사라져 recovery와 늦게 도착한 로그인 사이의 race 차단 상태를 잃는다.
- 002 적용 뒤 confirmation row 또는 pending recovery row가 생기면 table/column 삭제로 transaction을 잃는다.
- 002 이전 NOT NULL 제약을 복원하려면 pending recovery row의 `user_id`와 `encrypted_recovery_token`을 먼저 해결하거나 삭제해야 한다.
- 002의 exact return path를 넓히는 rollback은 기존 보안 allowlist를 약화한다.
- 001의 schema/table 삭제는 session, encrypted token, OAuth/recovery transaction, rate bucket을 모두 잃는다.

운영 rollback은 migration SQL을 역으로 추정해 실행하는 작업이 아니다. 적용 전 backup, 인증 흐름 drain, pending row 검사와 복원 리허설이 필요하다. 자세한 순서는 [인증 백엔드 운영 가이드](../guides/backend-auth-operations.ko.md)를 따른다.

## 검증 범위의 한계

- Drizzle schema test는 최종 6개 테이블과 주요 constraint 이름을 정적으로 검사한다.
- migration source test는 002와 003의 SQL shape를 정적으로 검사한다.
- 현재 disposable PostgreSQL test는 **001만 읽어 실행**하며 001 당시 네 테이블과 권한을 검사한다.
- 이 작업 공간에서는 `TEST_DATABASE_URL`과 disposable opt-in이 없어 live DB test가 실행되지 않았다.
- 따라서 001→002→003 전체를 실제 PostgreSQL에 적용한 live 증거는 아직 없다.

## 관련 문서

- [인증 백엔드 아키텍처](../architecture/backend-authentication.ko.md)
- [인증 백엔드 운영 가이드](../guides/backend-auth-operations.ko.md)
- [DB migration test](../../tests/database/auth-migration.test.ts)
- [DB schema tests](../../packages/database/src/schema/auth.test.ts)
- [PostgreSQL repository tests](../../apps/web/src/server/persistence/postgres-auth-repository.test.ts)
