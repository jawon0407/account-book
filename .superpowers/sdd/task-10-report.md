# Task 10 구현 보고서 — same-origin 인증 BFF

## 결과

Next.js 16 App Router에 13개 인증/user 경계를 연결했다. 각 요청은 새 container를 만들고, 브라우저에는 hardened opaque cookie와 공개 schema 응답만 전달한다. callback과 redirect는 configured canonical origin에서만 조립하며, `/api/me`는 고정 `API_INTERNAL_URL`의 `/v1/me`와 서버가 복호화한 access JWT만 사용한다.

브라우저 경계는 ky와 TanStack Query 하나로 구성했다. mutation마다 CSRF token을 새로 받고, `AUTH_SESSION_REFRESH_REQUIRED`에만 refresh POST 한 번과 원래 GET 한 번을 허용한다. mutation 및 그 밖의 401/403/422에는 자동 retry가 없다. Zustand나 browser token storage는 추가하지 않았다.

## RED → GREEN → REFACTOR

### RED

- controller/container 최초 테스트: 모듈과 export가 없어 신규 assertion 20개가 예상대로 실패했다.
- callback·refresh·recovery 확장: 미구현 method 4개가 실패했다.
- route adapter와 13개 route wiring: adapter/module 부재로 15개가 실패했다.
- ky·CSRF·TanStack Query client: 모듈 부재로 9개가 실패했다.
- Query provider: `createQueryClient` 부재로 1개가 실패했다.
- upstream `ApiError` status 신뢰 금지 회귀 테스트: upstream 418이 그대로 반환되어, 기대한 code 기반 401과 달라 실패했다.
- internal `/v1/me` network 오류 회귀 테스트: 실제 503/retryable=true가 반환되어, 기대한 502/retryable=false와 달라 실패했다.

기존 production code를 일부러 훼손해서 RED를 만들지 않았다. 각 실패는 아직 없는 경계 또는 실제로 발견된 오류 mapping을 대상으로 했다.

### GREEN

- 모든 JSON 성공/오류/redirect 응답에 `Cache-Control: private, no-store`, `Pragma: no-cache`, `Expires: 0`를 적용했다.
- mutation은 JSON body 크기 제한, strict Zod schema, selector-bound CSRF, exact Origin/Referer와 Fetch Metadata를 use case 호출 전에 검증한다.
- sign-up, OAuth start, reset request는 CSRF 검증 뒤 server-generated fresh interaction selector를 발급한다. sign-in은 opaque session cookie를 설정하고 interaction cookie를 제거한다.
- session 조회는 refresh나 idle 연장 없이 resolve만 수행하며, access-token expiry가 60초 이하면 `AUTH_SESSION_REFRESH_REQUIRED`를 반환한다.
- logout은 resolve → local revoke → provider sign-out 순서이며 provider 실패에도 cookie를 제거하고 pending revocation을 기록한다.
- recovery callback은 일반 app session을 만들지 않고, password update 성공 시 interaction cookie를 제거한다.
- `/api/me`는 browser URL/query 및 Authorization/Cookie/Host/Forwarded 계열 header를 전달하지 않는다. upstream `CurrentUser`/`ApiError`를 strict schema로 검증하며 malformed, oversized, unexpected status와 network 오류를 고정된 비재시도 오류로 바꾼다.
- production/public origin의 fake adapter를 startup/container 단계에서 거부하고, 기본 mode를 Supabase로 고정했다.
- 최종 web suite는 22 files, 359 tests가 통과했다.

### REFACTOR

- 13개 route는 `handleAuthRoute`에만 위임하는 얇은 파일로 유지했다.
- cookie/no-store/error/body/upstream parsing을 controller helper로 모아 route별 중복을 없앴다.
- QueryClient는 provider mount당 한 번만 생성하고 query/mutation retry 기본값을 모두 false로 고정했다.
- JSX 실행 환경을 Next와 Vitest가 함께 처리하도록 `react-jsx`로 통일하고, provider test가 import 오류를 삼키지 않게 했다.

## dependency와 ky v2 계약 차이

요구된 dependency를 exact version으로 고정했다: `next@16.2.10`, `react@19.2.7`, `react-dom@19.2.7`, `ky@2.0.2`, `@tanstack/react-query@5.101.2`, `zod@4.4.3`, `@types/react@19.2.17`, `@types/react-dom@19.2.3`.

브리프 예시의 `prefixUrl`은 pinned `ky@2.0.2`에서 제거되었고 runtime이 “prefix로 rename” 오류를 발생시킨다. 사용자 승인에 따라 type cast나 compatibility shim 없이 v2의 정확한 옵션인 `prefix: "/api"`를 사용했다. `credentials: "same-origin"`, `retry: { limit: 0 }`, `timeout: 10_000`, `accept: application/json`은 요구 그대로다.

## fresh 검증

모든 명령은 Node 22.15.1, pnpm 11.9.0 shim과 `CI=true`로 실행했다.

- focused command: `pnpm --filter @account-book/web test -- src/server/http src/app/api src/lib/http src/queries` — PASS, 22 files / 359 tests.
- full web: `pnpm --filter @account-book/web test` — PASS, 22 files / 359 tests.
- TypeScript: `pnpm --filter @account-book/web typecheck` — PASS.
- production build: `pnpm --filter @account-book/web build` — PASS; 13개 BFF route 모두 dynamic route로 생성됐다.
- security gate: `pnpm test:security-gate` — PASS, 44/44 tests.
- lint: `pnpm lint` — PASS, warning 0.
- whitespace: `git diff --check` — PASS.

추가로 실행한 비필수 `pnpm --filter @account-book/web test:coverage`는 22 files / 359 tests 자체는 모두 통과했지만 exit 1이었다. 기존 Task 5-9 파일만 포함하는 instrumentation set이 branches 91.78%(670/730)를 기록해 global 100% threshold를 충족하지 못했다. Task 10의 controller, container, route, browser client/query 파일은 현재 coverage include에 들어 있지 않다. threshold를 낮추거나 신규 파일을 임의로 제외하지 않았으며 후속 coverage 정비가 필요하다.

## 변경 범위

- Next/runtime 설정: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/next-env.d.ts`, lockfile/workspace allow-build 설정.
- server boundary: `apps/web/src/server/container.ts`, `apps/web/src/server/http/auth-controller.ts`, `apps/web/src/server/http/route-adapter.ts`와 테스트.
- routes: `apps/web/src/app/api/auth/**/route.ts`, `apps/web/src/app/api/me/route.ts`와 wiring 테스트.
- browser boundary: `apps/web/src/lib/http/*`, `apps/web/src/queries/auth.ts`, `apps/web/src/app/providers.tsx`와 테스트.
- tooling: Next build output을 lint 대상에서 제외하는 generated-output ignore만 추가했다.

`auth_rate_limits`는 schema-only 상태를 유지했다. in-memory limiter나 구현 완료 표기를 추가하지 않았다.

## live integration과 잔여 위험

실제 Supabase와 disposable PostgreSQL integration은 실행하지 않았다. 필요한 credential과 폐기 가능한 DB가 제공되지 않았기 때문이다. 따라서 배포 전 staging에서 email/OAuth/recovery callback, Secure cookie, token refresh CAS, local-first logout pending 처리, 내부 `/v1/me` 연결을 실제 provider/DB와 검증해야 한다. 이 live 검증은 release blocker다.

또한 coverage 100% gate 복구와 Task 10 신규 경계의 instrumentation 편입이 남아 있다. request마다 조립되는 DB/provider graph의 실제 connection 자원 사용량도 staging 부하에서 확인해야 한다. push는 수행하지 않았다.

## 독립 리뷰 수정 — BFF 경계 강화

기준 commit `fc7462c`에 대한 독립 리뷰의 Needs changes 항목을 별도 RED → GREEN으로 수정했다.

### 추가 RED 증거

- chunked body: Content-Length가 없는 request 16 KiB 초과와 upstream 64 KiB 초과 stream이 모두 끝까지 소비되고 cancel되지 않아 controller 15 tests 중 2개가 실패했다.
- DB infrastructure: 동일 환경의 두 request가 `createDatabaseClient`를 두 번 호출해 container 13 tests 중 1개가 실패했다.
- OAuth handoff: POST가 즉시 `oauth.start`를 호출해 provider URL/state를 JSON으로 반환하여 controller 15 tests 중 1개가 실패했다. client도 state-free `authorizationPath`를 거부하여 query 7 tests 중 1개가 실패했다.
- route methods/adapter: 새 continue route 부재, 명시 method export 부재, factory/params/controller throw 전파, unsupported handler 부재로 route focused 21 tests 중 20개가 실패했다. params rejection을 test collection 시점에 만들던 최초 fixture는 즉시 수정하고, unhandled rejection 없이 실제 adapter 호출에서 실패하는 RED를 다시 확인했다.
- recovery/refresh/cookie: dual-cookie interaction CSRF, dual-cookie password update, refresh operation failure, controller Secure=false, cookie Secure=false 총 5개가 40 tests 중 실패했다. CSRF token은 nonce 때문에 equality 비교할 수 있어 selector-bound verifier assertion으로 교정한 뒤, session 선택 mutant에서 정확히 실패하고 복구 후 통과하는 것도 확인했다.
- password-update client: `auth/csrf`를 호출해 기대한 `auth/csrf?context=interaction`과 달라 3 tests 중 1개가 실패했다.
- loopback container: Secure 설정을 origin protocol에 다시 의존시키는 mutant에서 loopback container 생성/Set-Cookie 검증이 실패했고, literal Secure 정책 복구 후 통과했다.
- adapter retryability 자체 review: config/params/unexpected controller 503이 `retryable:true`인 계약 위반을 발견해 기대값을 false로 바꾸자 6 tests 중 4개가 실패했다. adapter 경계만 명시 false로 고정하고 provider 일시 장애의 기존 true semantics는 유지했다.

### 추가 GREEN과 설계

- request와 upstream JSON은 `ReadableStream.getReader()`로 chunk마다 실제 byte 수를 누적한다. 한도를 넘는 순간 reader를 cancel하고 각각 고정 422/502로 종료한다. Content-Length는 조기 거절용 보조 신호일 뿐이며 absent/chunked body도 동일한 실제 한도를 적용한다.
- module에는 user/session이 없는 database client와 connection-string SHA-256 fingerprint만 lazy 보관한다. 동일 URL의 request는 client/pool 하나를 재사용하지만 repository, provider, session service, use case, controller는 매번 새로 만든다. URL fingerprint 변경은 새 pool을 만들거나 값을 로그에 남기지 않고 `AUTH_CONFIGURATION_INVALID`로 fail closed한다.
- CSRF POST `/api/auth/oauth/:provider/start`는 fresh interaction cookie와 `/api/auth/oauth/:provider/continue?returnPath=...` 형식의 exact same-origin path만 JSON으로 반환한다. transaction/state/provider URL은 `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`, interaction cookie, provider/returnPath allowlist를 통과한 continue GET에서만 생성하고 303 Location으로 전달한다. TanStack mutation은 input에서 계산한 exact literal authorizationPath만 받는다.
- 14개 route 모두 지원하지 않는 GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS를 공통 handler로 명시 export한다. handler는 safe `ApiError` 405와 no-store 3종을 반환한다. route adapter는 container factory, params Promise, controller throw를 모두 고정 503 envelope로 바꾸며 원래 token/selector/error text를 버린다.
- `GET /api/auth/csrf?context=interaction`은 strict context enum과 interaction cookie를 사용한다. password update client만 이 context를 요청하고 controller도 interaction selector만 사용하므로 session cookie가 함께 있어도 recovery binding이 유지된다.
- refresh의 `AUTH_SESSION_OPERATION_FAILED`는 401 `AUTH_SESSION_EXPIRED`, `retryable:false`로 변환한다.
- `__Host-ab_session`과 `__Host-ab_interaction`은 loopback을 포함해 항상 Secure다. cookie builder와 controller는 false를 거부하고 container는 literal true만 전달한다.

### 독립 리뷰 후 fresh 검증

- review focused matrix: 7 files / 84 tests PASS.
- required focused command: 22 files / 373 tests PASS.
- full web suite: 22 files / 373 tests PASS.
- web typecheck PASS.
- Next 16.2.10 production build PASS; OAuth continue를 포함한 14개 dynamic BFF route가 생성됐다.
- final build의 첫 재실행은 이전 local harness 직후 `.next/static` unlink EPERM으로 종료됐지만 worktree-specific Next process 조회 결과는 비어 있었다. 동일 명령의 즉시 재실행은 exit 0이었으므로 코드/build 실패가 아닌 일시적 filesystem lock으로 기록한다.
- 실제 local Next server HTTP 검증: POST route의 HEAD/OPTIONS/GET과 GET route의 HEAD/POST 5건 모두 405와 no-store 3종 PASS; child process는 종료했고 잔류 프로세스/로그가 없다.
- security gate 44/44 PASS, root lint warning 0 PASS.
- optional coverage: 373 tests 자체는 PASS지만 기존 Task 5-9 include set이 branches 91.78%(670/730)라 threshold 100%로 exit 1. 새 controller/container/route/client는 계속 include 밖이다.

실제 Supabase/disposable PostgreSQL integration은 credential과 폐기 가능한 DB가 없어 여전히 실행하지 않았다. callback/redirect, refresh CAS, pool lifecycle, pending logout, Secure cookie를 staging에서 확인하는 release blocker는 유지한다.

## Second independent review: redirect and session-failure boundaries

### RED evidence

- Provider redirect policy: three exact loopback HTTP authorization URLs (`localhost`, `127.0.0.1`, `[::1]`) returned 400 instead of the required 303. The companion public-HTTP, credential-bearing HTTPS, and fragment-bearing HTTPS cases already failed closed.
- Typed session classification: the focused service/controller run failed 19 of 56 cases. Thirteen service cases exposed a reasonless fixed error for missing or invalid state and provider/repository failures; six controller cases incorrectly returned 401 for operational failures or raw errors that merely copied the fixed message.

### GREEN design

- Redirects now allow HTTPS or HTTP only when `URL.hostname` is exactly `localhost`, `127.0.0.1`, or `[::1]`; credentials and fragments remain forbidden for every protocol.
- `SessionOperationError` keeps the fixed non-secret `AUTH_SESSION_OPERATION_FAILED` message and adds only a typed `expired | unavailable` reason. Missing, revoked, malformed, invariant-invalid, or undecryptable session state is `expired`; repository/provider/rotation operational failures are `unavailable`. Refresh still returns `superseded` for a lost compare-and-swap.
- `session`, `me`, and `refresh` use `instanceof SessionOperationError` plus its typed reason. Expired state returns 401/non-retryable; unavailable state returns 503/retryable. Raw errors with the same message receive no special treatment and fail as generic 503 responses.
- The container TSDoc now states the real lifecycle: one process-scoped infrastructure database client, with fresh request-scoped repository, provider, session, use-case, and controller objects.

### Fresh second-review verification

All commands used the repository Node 22.15.1 and pnpm 11.9.0 shims with `CI=true`.

- focused session/controller: 2 files / 56 tests PASS.
- full web suite: 22 files / 389 tests PASS.
- web typecheck PASS.
- Next 16.2.10 production build PASS; all 14 BFF routes were generated.
- security gate: 44/44 PASS.
- root lint: PASS with zero warnings.
- `git diff --check`: PASS.

## Controller 최종 workspace 검증

Task 10 및 한국어 문서 갱신 뒤 root `pnpm test`를 새로 실행하자 workspace 정책 테스트가 RED가 됐다. `pnpm-workspace.yaml`에는 Next production image 처리를 위한 승인 항목 `sharp: true`가 추가됐지만, `scripts/workspace-policy.test.mjs`의 exact allowlist가 여전히 `{ esbuild: true }`만 기대했기 때문이다. 정책 테스트의 allowlist를 `{ esbuild: true, sharp: true }`로 동기화한 뒤 focused policy test와 root 전체 test를 다시 실행해 GREEN을 확인했다.

최종 controller 검증은 Node 22.15.1, pnpm 11.9.0, `CI=true`에서 다음과 같이 통과했다.

- root `pnpm test`: PASS. legacy 49 tests와 workspace suites(최종 web 401 tests 포함)가 모두 통과했다.
- root `pnpm typecheck`: PASS.
- root `pnpm build`: PASS. OAuth continue를 포함한 14개 BFF dynamic route가 생성됐다.
- root `pnpm lint`: PASS, warning 0.
- `pnpm test:security-gate`: PASS, 44/44.
- `git diff --check`: PASS.

마지막 session semantics, workspace policy, Task 10 한국어 문서 변경은 검증과 독립 리뷰를 마친 뒤 Codex 사용 한도로 Git mutation 승인이 한 차례 거절되어 worktree에 보존했다. 2026-07-22 사용 한도 해제 후 Node 22.15.1과 pnpm 11.9.0으로 root `pnpm verify`를 다시 실행해 lint, typecheck, legacy 49 tests, contracts 15 tests, database 8 tests, web 401 tests와 14-route production build가 모두 통과한 것을 확인한 다음 staging과 commit을 재개했다. push는 수행하지 않는다.

## Final re-review: provider refresh failure semantics

### RED evidence

- The primary focused run failed 10 of 67 cases: four provider invalid/rate classifications, three malformed or cross-user replacement classifications, and three controller `rate_limited` mappings.
- A second runtime-shape RED proved that a non-object replacement escaped field validation and became retryable 503 instead of fail-closed session expiry.
- Existing characterization cases for explicit provider unavailability, repository/clock failures, generic throws, and refresh CAS losers remained green and protected their established semantics.

### GREEN design

- The session layer remains independent of the provider adapter type. Only the refresher rejection's exact allowlisted `code` property is inspected at that boundary; error messages are never classified.
- Invalid credential, verification, or transaction codes become `expired`; rate limiting becomes `rate_limited`; provider-unavailable and unknown operational failures become `unavailable`.
- Non-object, malformed, expired, or cross-user replacement pairs become non-retryable session expiry before any database rotation. Invalid clock, encryption, lookup, and rotation failures remain operationally unavailable, while a lost compare-and-swap still returns `superseded`.
- The shared controller mapping returns 401 `AUTH_SESSION_EXPIRED`/non-retryable, 429 `AUTH_RATE_LIMITED`/non-retryable, or 503 `AUTH_PROVIDER_UNAVAILABLE`/retryable for `session`, `me`, and `refresh`.

### Fresh final verification

All commands used Node 22.15.1 and pnpm 11.9.0 with `CI=true`.

- focused session/controller: 2 files / 68 tests PASS.
- full web suite: 22 files / 401 tests PASS.
- web typecheck PASS.
- Next 16.2.10 production build PASS; all 14 BFF routes were generated.
- security gate: 44/44 PASS.
- root lint: PASS with zero warnings.
- `git diff --check`: PASS.
