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
