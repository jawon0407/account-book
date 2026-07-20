# How to: 인증 백엔드와 DB 경계를 검증하는 방법

> **English Summary:** Use the pinned Node and pnpm versions, run deterministic workspace and security gates locally, and opt in explicitly before pointing the database test at a disposable PostgreSQL instance. No live Supabase smoke harness or Next.js BFF endpoint exists yet.

이 가이드는 현재 구현된 server auth domain, persistence adapter, migration source를 재현 가능하게 검증하는 절차다. 실제 로그인 endpoint를 호출하는 가이드가 아니다.

## 전제 조건

- Node.js `22.15.1`
- pnpm `11.9.0`
- 저장소 root에서 실행
- 의존성 설치를 위한 network access
- live DB 검증 시에만 폐기 가능한 PostgreSQL과 owner `postgres` 연결

버전의 근거는 [`.nvmrc`](../../.nvmrc)와 [root package manifest](../../package.json)다.

## 1. 고정 runtime 설치와 확인

1. 사용하는 Node version manager로 `.nvmrc`의 version을 설치하고 선택한다.

2. Corepack을 활성화하고 manifest에 고정된 pnpm을 준비한다.

   ```powershell
   corepack enable
   corepack prepare pnpm@11.9.0 --activate
   ```

3. version을 확인한다.

   ```powershell
   node --version
   pnpm --version
   ```

   각각 `v22.15.1`, `11.9.0`이어야 한다.

4. lockfile을 변경하지 않고 설치한다.

   ```powershell
   pnpm install --frozen-lockfile
   ```

## 2. 환경 변수 경계 확인

현재 production source는 `process.env`를 직접 읽지 않는다. `SupabaseAuthAdapter`는 `{ url, anonKey }`, `createDatabaseClient`는 connection string, 암호화/CSRF 모듈은 key를 constructor 또는 함수 인자로 받는다. 따라서 존재하지 않는 runtime 변수 이름을 임의로 추가하지 않는다.

| 이름 | 현재 코드에서의 상태 | 역할 |
| --- | --- | --- |
| `TEST_DATABASE_URL` | [`tests/database/auth-migration.test.ts`](../../tests/database/auth-migration.test.ts)가 직접 읽음 | 폐기 가능한 PostgreSQL owner 연결. 로그·문서에 값을 복사하지 않음 |
| `TEST_DATABASE_DISPOSABLE` | 같은 test가 직접 읽음 | 정확히 `true`일 때만 destructive migration test 허용 |
| `DATABASE_URL` | Task 9 report의 미실행 통합 조건에만 언급, 현재 자동 wiring 없음 | 향후 server DB connection input |
| `SUPABASE_URL` | Task 9 report의 미실행 통합 조건에만 언급, 현재 자동 wiring 없음 | 향후 `SupabaseAuthAdapter` public base URL input |
| `SUPABASE_ANON_KEY` | Task 9 report의 미실행 통합 조건에만 언급, 현재 자동 wiring 없음 | 향후 server-side public anon/publishable key input |
| `AUTH_ADAPTER_MODE` | Task 10 계획에만 존재, 현재 미구현 | 향후 local fake와 Supabase adapter 선택 |
| `API_INTERNAL_URL` | Task 10 계획에만 존재, 현재 미구현 | 향후 BFF에서 NestJS로 가는 고정 server URL |

session encryption keyring, CSRF HMAC key, canonical application origin의 최종 환경 변수 이름과 parser는 아직 구현되지 않았다. 이름·인코딩·rotation 계약이 코드에 생기기 전에는 운영 변수로 간주하지 않는다.

실제 key, token, cookie, OAuth code, DB URL을 shell history, 문서, test output에 넣지 않는다. 이 문서는 실제 형식의 secret 예시를 제공하지 않는다.

## 3. deterministic unit test 실행

### 인증·세션·보안 모듈

```powershell
pnpm --filter @account-book/web test
```

이 명령은 다음을 포함한다.

- server-owned PKCE 생성·검증
- AES-GCM envelope round trip, tamper, AAD와 key failure
- cookie shape, CSRF, exact Origin/Referer, Fetch Metadata
- email/OAuth/recovery state machine의 replay·binding·만료
- Supabase adapter의 provider mapping과 malformed token fail-closed
- opaque session 7일 idle·30일 absolute 수명과 refresh CAS
- PostgreSQL repository가 만드는 SQL predicate와 transaction 순서

### 계약과 최종 Drizzle schema

```powershell
pnpm --filter @account-book/contracts test
pnpm --filter @account-book/database test
```

database package test는 최종 6개 table의 Drizzle metadata와 002·003 migration source의 핵심 SQL을 정적으로 검사한다.

### 전체 deterministic test

```powershell
pnpm test
```

root `test`는 repository/security policy test 뒤 contracts, database, web workspace test를 실행한다. 현재 존재하지 않는 `@account-book/api` filter는 pnpm에서 informational message를 낼 수 있다.

테스트 개수는 코드와 함께 변하므로 성공 기준을 고정 숫자로 두지 않는다. 종료 코드 `0`과 실행한 commit SHA를 기록한다.

## 4. typecheck와 lint 실행

```powershell
pnpm typecheck
pnpm lint
```

두 명령 모두 종료 코드 `0`이어야 한다. `typecheck`는 contracts, database, web의 TypeScript 검사를 실행한다. `lint`는 repository 전체를 warning 0 기준으로 검사한다.

현재 `apps/web/package.json`에는 `dev`와 `build` script가 없다. 따라서 Next.js dev server나 production build를 인증 백엔드 검증 단계로 실행할 수 없다. root `build`가 manifest에 있더라도 Task 10 이전의 web package는 Next build 대상이 아니다.

## 5. security gate 실행

```powershell
pnpm test:security-gate
git diff --check
```

`test:security-gate`는 repository/history secret scan, workflow policy, hook policy와 구조 검사를 포함한다. `git diff --check`는 trailing whitespace와 conflict marker 같은 diff 오류가 없어야 한다.

새 clone 또는 worktree에서 hook까지 설치·확인하려면 다음을 실행한다.

```powershell
pnpm setup:hooks
git config --local --get core.hooksPath
```

두 번째 명령은 `.githooks`를 출력해야 한다. 자세한 정책은 [테스트 가이드](testing.md)와 [무료 플랜 보완 통제](../security/free-plan-compensating-controls.md)를 참고한다.

## 6. disposable PostgreSQL migration test 실행

### 이 test가 파괴적인 이유

[`auth-migration.test.ts`](../../tests/database/auth-migration.test.ts)는 대상 DB에서 `app_private` schema를 cascade drop하고 role/table을 다시 만든다. 개발 공유 DB, staging, production에는 절대 실행하지 않는다.

### 실행 조건

1. 별도 PostgreSQL instance 또는 test database를 준비한다.
2. 연결 사용자가 정확히 `postgres` owner인지 확인한다.
3. `anon`, `authenticated`, `service_role`, `app_session_bff` role을 만들고 지울 수 있는 격리 환경인지 확인한다.
4. backup이 아니라 언제든 버릴 수 있는 DB인지 다시 확인한다.
5. 조직이 승인한 secret manager가 있으면 그 도구로 `pnpm test:db` 자식 process에만 `TEST_DATABASE_URL`을 주입한다. secret manager를 사용할 수 없는 로컬 PowerShell 7 환경에서는 command line이나 PSReadLine history에 연결값을 쓰지 않고, masked prompt로 받은 값을 현재 process에 필요한 동안만 설정한다. `Read-Host -AsSecureString` 결과를 다시 plain string으로 변환하는 우회는 사용하지 않는다.

   ```powershell
   $testDatabaseUrl = Read-Host -MaskInput -Prompt "Disposable PostgreSQL URL"
   try {
     [Environment]::SetEnvironmentVariable("TEST_DATABASE_URL", $testDatabaseUrl, "Process")
     [Environment]::SetEnvironmentVariable("TEST_DATABASE_DISPOSABLE", "true", "Process")

     pnpm test:db
     if ($LASTEXITCODE -ne 0) { throw "Database test failed with exit code $LASTEXITCODE" }
   }
   finally {
     [Environment]::SetEnvironmentVariable("TEST_DATABASE_URL", $null, "Process")
     [Environment]::SetEnvironmentVariable("TEST_DATABASE_DISPOSABLE", $null, "Process")
     $testDatabaseUrl = $null
   }
   ```

   `Read-Host -MaskInput`은 입력을 화면에서 가리고 PSReadLine command history에 넣지 않지만, 반환값과 process 환경 변수는 test 실행 중 평문 메모리에 존재한다. 따라서 shared terminal에서는 실행하지 않고, test가 끝나면 `finally`가 성공·실패 모두에서 두 환경 변수를 제거하게 둔다. transcript나 shell session recording이 켜져 있다면 먼저 끈다.

### 현재 test coverage

이 명령은 migration **001만** 읽어 실행한다. 다음을 실제 PostgreSQL에서 검사한다.

- 초기 네 table과 column
- browser-facing role과 `PUBLIC` 권한 거부
- `app_session_bff`의 schema usage와 네 table CRUD
- default privilege가 미래 table 권한을 자동 부여하지 않음
- 초기 session/OAuth/recovery/rate-limit constraint

002의 final exact return path, staged recovery, confirmation table과 003의 issuance gate는 package의 정적 source test만 있다. 001→002→003 전체 live migration 검증으로 오해하지 않는다.

### 환경 변수가 없을 때

`TEST_DATABASE_URL`이 없거나 `TEST_DATABASE_DISPOSABLE`이 정확히 `true`가 아니면 test는 의도적으로 즉시 실패한다. skip이나 통과가 아니다. 이 작업 공간에서는 두 조건이 없어 live DB test를 실행하지 않았다.

## 7. live Supabase smoke 상태 확인

현재 저장소에는 live Supabase smoke script, Next.js BFF route, callback endpoint가 없다. 따라서 지금 실행할 수 있는 정확한 smoke command도 없다. deterministic adapter test가 실제 provider 통합 성공을 대신하지 않는다.

향후 smoke에는 최소한 다음이 필요하다.

- 개발 전용 Supabase project와 승인된 server configuration
- email confirmation과 recovery redirect 설정
- Google, Kakao, Naver `custom:naver` provider 설정
- Task 10의 canonical configured application origin과 실제 callback route
- 시작마다 새 `__Host-ab_interaction` cookie를 발급하는 BFF
- browser history, network response, application storage, server log를 검사할 안전한 test account

공급자별로 정상 로그인, 사용자 취소, 잘못된 state, callback replay, email 누락을 확인해야 한다. provider token, PKCE verifier, recovery credential, code, selector 원문이 browser storage·response body·history·로그에 남지 않아야 한다.

현재 결과는 **미실행**이며 운영 출시와 인증 기능 완료의 증거로 사용할 수 없다.

## 8. migration 적용 전 운영 체크리스트

저장소에는 현재 migration 적용 script가 없다. 운영 도구의 명령을 추정해 문서에 넣지 말고, 승인된 Supabase/PostgreSQL migration runner가 파일명 순서대로 001→002→003을 적용하게 한다.

### 적용 전

- [ ] 대상 project, database, schema owner와 현재 migration version을 read-back했다.
- [ ] 암호화된 backup을 만들고 격리 환경 복원에 성공했다.
- [ ] 신규 signup, OAuth start/callback, email confirmation, password recovery를 drain하거나 maintenance 상태로 전환했다.
- [ ] active session과 pending OAuth/recovery/confirmation row 수를 기록했다. 값 원문은 기록하지 않았다.
- [ ] `app_session_bff`가 `NOLOGIN`, `NOSUPERUSER`, `NOINHERIT`, `NOBYPASSRLS`여야 한다는 목표를 검토했다.
- [ ] browser-facing roles와 `PUBLIC`에 `app_private` 접근이 없어야 한다는 rollback 기준을 확인했다.
- [ ] 002 backfill 후 old recovery row가 exchanged shape를 만족하는지 staging copy에서 검사했다.
- [ ] 002 rollback 시 pending transaction 손실과 old NOT NULL 복원 불가 조건을 승인했다.
- [ ] 003 제거 시 password change/login race protection을 잃는다는 점을 승인했다.

### 적용 후

- [ ] `app_private`에 최종 6개 table이 존재한다.
- [ ] 32바이트 digest check, exact provider/return path, recovery stage/order, nonnegative minimum/version/count constraint가 존재한다.
- [ ] active provider session partial unique index가 존재한다.
- [ ] `app_session_bff`는 schema usage와 여섯 table CRUD만 가지며 schema create, truncate, references, trigger 권한은 없다.
- [ ] `PUBLIC`, `anon`, `authenticated`, `service_role`은 schema/table 접근이 거부된다.
- [ ] default privileges가 새 table 접근을 자동 부여하지 않는다.
- [ ] 새 session 생성, refresh CAS, OAuth/confirmation claim, recovery consume transaction을 staging에서 검증했다.
- [ ] error와 log에 token, code, selector, provider 원문이 없는지 확인했다.
- [ ] 실패 시 traffic을 계속 열어 두지 않고 backup 복원 또는 승인된 forward fix를 선택했다.

## 9. 실패 시 점검 순서

### unit test가 module import 전에 실패함

1. `node --version`과 `pnpm --version`을 확인한다.
2. `pnpm install --frozen-lockfile`이 성공했는지 확인한다.
3. root가 아닌 다른 directory에서 실행하지 않았는지 확인한다.
4. package build artifact 문제라면 먼저 `pnpm --filter @account-book/database build` 후 focused test를 다시 실행한다.

### PostgreSQL test가 opt-in 오류로 실패함

1. 두 환경 변수 이름과 `TEST_DATABASE_DISPOSABLE=true` exact 값을 확인한다.
2. 대상이 정말 폐기 가능한지 다시 확인한다.
3. `select current_user` 결과가 `postgres`인지 확인한다.
4. role 생성·drop, schema drop 권한을 확인한다.

### 권한 assertion이 실패함

1. `app_session_bff`에 migration 전 과도한 grant가 남았는지 확인한다.
2. schema ACL, table ACL, owner default ACL을 각각 분리해 조회한다.
3. migration 파일 순서와 적용 owner가 기대와 같은지 확인한다.
4. 권한을 임시 확대해 test를 통과시키지 않는다.

### Supabase adapter test가 실패함

1. provider mapping이 `google`, `kakao`, `custom:naver`인지 확인한다.
2. direct PKCE 응답의 lowercase `bearer`, safe-integer `expires_in`, JWT `iat`·`exp` 일관성을 확인한다.
3. SDK client가 매 호출 새로 생성되고 `persistSession: false`인지 확인한다.
4. provider 원문 오류를 assertion이나 로그에 복사하지 않는다.

## 검증 완료 기준

현재 구현에 대해 다음이 모두 종료 코드 `0`이면 deterministic 검증을 완료한 것이다.

```powershell
pnpm --filter @account-book/web test
pnpm --filter @account-book/contracts test
pnpm --filter @account-book/database test
pnpm typecheck
pnpm lint
pnpm test:security-gate
git diff --check
git diff --cached --check
$base = git merge-base HEAD origin/main
git diff --check "$base..HEAD"
git show --check --oneline --stat HEAD
```

인자 없는 `git diff --check`는 **index 대비 unstaged worktree 변경**만 검사한다. `git diff --cached --check`는 **HEAD 대비 staged index 변경**을 검사한다. base-to-HEAD 검사는 clean checkout에서도 **base와 현재 HEAD 사이에 commit된 branch 전체 변경**을 검사한다. 이 저장소의 기본 base는 `origin/main`이며, 다른 PR target을 사용한다면 그 remote branch로 바꾼다. 마지막 `git show --check HEAD`는 **최신 commit 한 개의 patch**를 별도로 검사한다.

`pnpm test:db`와 live Supabase smoke는 별도 상태로 기록한다. 실행 조건이 없으면 “통과”가 아니라 “미실행”이다.

## 관련 문서

- [인증 백엔드 아키텍처](../architecture/backend-authentication.ko.md)
- [인증 DB 스키마](../database/auth-schema.ko.md)
- [보안 검증 체크리스트](../security/verification-checklist.md)
- [SQL migration 001](../../supabase/migrations/202607200001_security_auth_foundation.sql), [002](../../supabase/migrations/202607200002_server_pkce_transactions.sql), [003](../../supabase/migrations/202607200003_user_security_state.sql)
