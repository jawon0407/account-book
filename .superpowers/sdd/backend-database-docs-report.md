# 인증 백엔드·데이터베이스 문서화 보고서

## 상태

- 결과: 완료
- 기준 commit: `c37d5797e7a4e6787c2259a5ba4d937594d3c41b`
- 대상 branch: `feature/security-auth-foundation`
- 산출물: Korean-first Diataxis 문서 3개, root/index README 4개 갱신
- production/test/config 변경: 없음
- live Supabase 검증: 미실행
- disposable PostgreSQL 검증: 미실행

## 조사 규율과 범위

문서를 쓰기 전에 요구사항, production source, 인접 test, SQL migration, package manifest, 기존 security/design/testing 문서와 Task 9 evidence를 읽었다. 구현 보고서와 계획이 코드와 충돌할 때는 source와 test를 기준으로 삼았다.

조사한 파일은 총 **70개**다.

| 분류 | 수 | 내용 |
| --- | ---: | --- |
| production TypeScript와 SQL | 24 | web auth/security/session/persistence 15, contracts/database source 6, migration 3 |
| tests | 19 | web auth/security/session/persistence 14, contracts/database package 4, disposable DB 1 |
| runtime/package manifests | 7 | `.nvmrc`, root/workspace와 auth 관련 package manifest |
| 기존 entry/security/design/testing 문서 | 17 | root/index/package README, security 문서, testing guide, 설계·구현 계획 |
| 요구사항·구현 증거 | 3 | 이 작업 brief, Task 9 report, progress ledger |

### production source와 migration 24개

- `apps/web/src/server/auth/auth-provider-port.ts`
- `apps/web/src/server/auth/email-auth-service.ts`
- `apps/web/src/server/auth/fake-auth-provider.ts`
- `apps/web/src/server/auth/oauth-service.ts`
- `apps/web/src/server/auth/password-recovery-service.ts`
- `apps/web/src/server/auth/supabase-auth-adapter.ts`
- `apps/web/src/server/security/auth-cookie.ts`
- `apps/web/src/server/security/csrf.ts`
- `apps/web/src/server/security/pkce.ts`
- `apps/web/src/server/security/request-origin.ts`
- `apps/web/src/server/security/session-selector.ts`
- `apps/web/src/server/security/token-envelope.ts`
- `apps/web/src/server/session/session-service.ts`
- `apps/web/src/server/persistence/auth-repository.ts`
- `apps/web/src/server/persistence/postgres-auth-repository.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/errors.ts`
- `packages/contracts/src/index.ts`
- `packages/database/src/client.ts`
- `packages/database/src/index.ts`
- `packages/database/src/schema/auth.ts`
- `supabase/migrations/202607200001_security_auth_foundation.sql`
- `supabase/migrations/202607200002_server_pkce_transactions.sql`
- `supabase/migrations/202607200003_user_security_state.sql`

### tests 19개

- `apps/web/src/server/auth/auth-provider-port.test.ts`
- `apps/web/src/server/auth/email-auth-service.test.ts`
- `apps/web/src/server/auth/fake-auth-provider.test.ts`
- `apps/web/src/server/auth/oauth-service.test.ts`
- `apps/web/src/server/auth/password-recovery-service.test.ts`
- `apps/web/src/server/auth/supabase-auth-adapter.test.ts`
- `apps/web/src/server/security/auth-cookie.test.ts`
- `apps/web/src/server/security/csrf.test.ts`
- `apps/web/src/server/security/pkce.test.ts`
- `apps/web/src/server/security/request-origin.test.ts`
- `apps/web/src/server/security/session-selector.test.ts`
- `apps/web/src/server/security/token-envelope.test.ts`
- `apps/web/src/server/session/session-service.test.ts`
- `apps/web/src/server/persistence/postgres-auth-repository.test.ts`
- `packages/contracts/src/auth.test.ts`
- `packages/contracts/src/errors.test.ts`
- `packages/database/src/schema/auth.test.ts`
- `packages/database/src/schema/server-pkce-migration.test.ts`
- `tests/database/auth-migration.test.ts`

### manifests 7개

- `.nvmrc`
- `package.json`
- `pnpm-workspace.yaml`
- `apps/web/package.json`
- `packages/contracts/package.json`
- `packages/database/package.json`
- `tests/database/package.json`

### 기존 문서 17개

- `README.md`
- `apps/web/README.md`
- `apps/api/README.md`
- `packages/contracts/README.md`
- `packages/database/README.md`
- `supabase/migrations/README.md`
- `docs/architecture/README.md`
- `docs/database/README.md`
- `docs/guides/README.md`
- `docs/guides/testing.md`
- `docs/security/README.md`
- `docs/security/security-architecture.md`
- `docs/security/free-plan-compensating-controls.md`
- `docs/security/verification-checklist.md`
- `docs/security/incident-response.md`
- `docs/superpowers/specs/2026-07-20-security-auth-foundation-design.md`
- `docs/superpowers/plans/2026-07-20-security-auth-foundation.md`

### 요구사항·증거 3개

- `.superpowers/sdd/backend-database-docs-brief.md`
- `.superpowers/sdd/task-9-report.md`
- `.superpowers/sdd/progress.md`

## 내부 concept map

### Target

Task 9까지 구현된 server authentication backend와 migration 001→002→003 이후의 PostgreSQL auth schema.

### Purpose

브라우저에 provider token을 노출하지 않고, callback replay·동시 refresh·비밀번호 변경과 진행 중 로그인 race를 DB transaction과 server-owned secret으로 차단한다.

### 핵심 concept 12개

1. 구현됨/스키마만/Task 10/미실행 상태 경계
2. browser와 향후 same-origin BFF 사이의 신뢰 경계
3. server-only Supabase provider boundary
4. opaque selector와 SHA-256 digest
5. AES-256-GCM versioned envelope와 AAD
6. server-owned PKCE verifier
7. pre-auth interaction binding
8. claim-before-exchange one-shot transaction
9. session idle/absolute 수명과 refresh CAS
10. staged password recovery state machine
11. per-user `minimum_accepted_iat` shared row lock
12. `app_private`와 explicit least-privilege grant

### public surface 69개

중복 implementation method가 아니라 reader가 호출·구성·조회해야 하는 공개 경계를 세었다.

| 경계 | 수 | 산정 |
| --- | ---: | --- |
| shared runtime schemas/parser | 8 | auth schema 6, `ApiErrorSchema`, `parseApiError` |
| security functions/constants | 15 | cookie 5, CSRF 2, PKCE 3, request 1, selector 2, envelope 2 |
| `AuthProviderPort` operations | 10 | signup부터 password update까지 |
| `AuthRepository` operations | 15 | session 6, OAuth 2, confirmation 2, recovery 5 |
| use-case/session service operations | 14 | email 3, OAuth 2, recovery 3, session 6 |
| database exports | 7 | client factory 1, auth table 6 |
| 합계 | **69** | error class와 type-only export는 제외 |

### 설계 결정 12개

1. 브라우저 token 대신 DB-backed opaque session
2. 향후 browser auth 진입점을 same-origin BFF로 제한
3. PKCE verifier를 SDK/browser가 아닌 서버가 소유
4. token을 record ID·kind AAD가 있는 AES-GCM envelope로 저장
5. selector와 OAuth state 원문 대신 digest 저장
6. provider와 return path를 exact allowlist로 제한
7. provider 호출 전에 transaction claim
8. SDK-normalized 응답과 direct PKCE 응답을 별도 strict parser로 검증
9. refresh token pair를 `rotation_version` CAS로 함께 교체
10. recovery와 session 생성을 user security row에서 직렬화하고 DB 다음 정수 초를 cutoff로 사용
11. private schema, hardened NOLOGIN role, explicit table grant와 default revoke
12. fixed error와 enumeration-resistant acknowledgement

### edge case

- 만료 경계는 inactive다.
- provider 실패도 이미 얻은 claim을 되돌리지 않는다.
- concurrent callback/update 중 한 요청만 provider에 도달한다.
- concurrent refresh는 `refreshed` 한 건과 `superseded` 패자로 나뉜다.
- malformed JWT, envelope, row chronology, provider user mismatch는 fail closed다.
- session-first recovery race는 session revoke, recovery-first race는 stale `iat` insert 거부로 끝난다.
- `auth_rate_limits`는 table만 있고 use case가 없다.

## Diataxis 분할

| 파일 | quadrant | 독자 질문 |
| --- | --- | --- |
| `docs/architecture/backend-authentication.ko.md` | Explanation | 왜 opaque session, server PKCE, interaction binding과 공유 lock을 택했는가? |
| `docs/database/auth-schema.ko.md` | Reference | 최종 6개 table, constraint, index, role grant와 repository operation은 정확히 무엇인가? |
| `docs/guides/backend-auth-operations.ko.md` | How-to | 고정 runtime에서 어떻게 검증하고 disposable DB/migration을 안전하게 운영하는가? |

Tutorial은 만들지 않았다. 현재 실제 BFF endpoint/UI가 없어 사용자가 처음부터 작동하는 browser flow를 완성할 수 없기 때문이다.

## 생성·수정 파일

### 생성 3개

- `docs/architecture/backend-authentication.ko.md`
- `docs/database/auth-schema.ko.md`
- `docs/guides/backend-auth-operations.ko.md`

### 수정 4개

- `README.md`
- `docs/architecture/README.md`
- `docs/database/README.md`
- `docs/guides/README.md`

### 조사 보고서 1개

- `.superpowers/sdd/backend-database-docs-report.md`

## 정확성 판단

- 세션 idle 7일, absolute 최대 30일을 source constant와 repository predicate에 대조했다.
- OAuth 10분, confirmation/recovery 15분을 각 service constant와 대조했다.
- CSRF 5분을 `csrf.ts`와 대조했다.
- cookie 이름 `__Host-ab_session`, `__Host-ab_interaction`과 builder 속성을 대조했다.
- return path `/app`, `/settings/security`를 service, repository row mapper, Drizzle check, migration 002에 대조했다.
- provider는 public `google | kakao | naver`, Supabase ID는 Naver만 `custom:naver`임을 adapter test까지 확인했다.
- 6개 table의 모든 column/type/null/default와 named constraint/index를 Drizzle과 최종 migration chain에 대조했다.
- `AuthRepository` 15개 operation을 모두 문서화했다.
- recovery stage/order, OAuth·confirmation claim-before-exchange, refresh CAS와 shared user lock을 source와 test에서 각각 확인했다.
- 현재 DB live test가 001만 실행한다는 사실과 002·003은 static migration source test만 있다는 한계를 분리했다.

## 검증 결과

### UTF-8와 link

- 7개 사용자 문서/README를 strict UTF-8 decoder로 읽음: PASS
- 새 문서와 README의 상대 Markdown link 대상 존재 검사: PASS
- 깨진 replacement character 없음: PASS

### identifier·TTL·return path

- source/document consistency script: PASS
- 문서화된 table: 6/6
- 문서화된 `AuthRepository` operation: 15/15
- Node `22.15.1`, pnpm `11.9.0`: 현재 shell에서 확인

### secret pattern

브리프가 지정한 미완료 표식, AWS 키 표식, 개인 키 표식, 권한 역할 패턴을 변경 문서에서 검색했다.

- 미완료 표식과 자격 증명 표식: 0건
- `service_role`: 4건. 모두 schema/table 권한 revoke와 disposable-role 검증 문맥이며 credential 값은 없다.
- 실제 또는 실제 형식의 token/key/connection 예시: 없음

추가 `gstack-redact` 실행은 설치된 script가 참조하는 `../lib/redact-engine` module이 없어 실행할 수 없었다. 요구된 pattern scan과 repository security gate를 대체 증거로 사용했다.

### security gate

- 첫 실행: 환경 중단. 비대화형 worktree에서 pnpm modules purge 확인을 받을 수 없어 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 발생
- 재실행: Task 9에 기록된 ignored Node 22 shim과 `CI=true` 사용
- runtime: Node `v22.15.1`, pnpm `11.9.0`
- 결과: PASS, 44/44 tests, exit 0

### diff

- `git diff --check`: PASS
- 명시한 7개 문서/README만 첫 staging: PASS
- `git diff --cached --check`: PASS

### live integration

- `pnpm test:db`: 미실행. `TEST_DATABASE_URL`과 `TEST_DATABASE_DISPOSABLE=true`가 제공되지 않음
- live Supabase smoke: 미실행. 환경 변수·provider credential뿐 아니라 Task 10 BFF callback route/harness도 아직 없음
- 이 두 항목을 통과로 보고하지 않는다.

## 남은 우려와 후속 작업

1. 현재 disposable test는 migration 001만 실행한다. 001→002→003 전체를 PostgreSQL service에 적용하는 integration test가 필요하다.
2. live Supabase email/Google/Kakao/Naver smoke는 미실행이며 운영 출시 blocker다.
3. Task 10은 callback URL을 canonical configured origin에서만 만들고, 시작마다 새 interaction cookie를 발급하며, selector를 cookie에서만 읽어야 한다.
4. Task 10 route가 실제 `Set-Cookie`, CSRF/origin enforcement, no-store header와 local-first logout orchestration을 조립해야 한다.
5. `auth_rate_limits` use case는 아직 구현되지 않았다.
6. 설치된 `gstack-redact` package가 필요한 engine module 없이 배치되어 별도 redaction scan을 실행하지 못했다.
