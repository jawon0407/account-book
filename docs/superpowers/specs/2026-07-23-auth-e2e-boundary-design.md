# TASK 14 인증 E2E 경계 안정화 설계

작성일: 2026-07-23

상태: 구현 완료, 동일 SHA CI 검증 완료

대상 브랜치: `feature/security-auth-foundation`

## 1. 목적

TASK 14는 인증 기반의 기능 범위를 늘리는 작업이 아니라, 이미 구현된 인증 체인의 보안 증거를 재현 가능하게 만드는 안정화 작업이다. 브라우저 화면 이동과 Playwright 응답 본문 읽기 사이의 경합을 제거하고, UI·HTTP 응답·세션 폐기라는 서로 다른 책임을 독립적으로 검증한다.

배포 단계에는 별도 호스팅 staging 환경에서 프로덕션 런타임을 검증하는 D2 게이트를 추가한다. D2는 일상적인 로컬·PR 검증에는 포함하지 않지만 실제 운영 출시 전에는 필수다. 테스트 편의를 위해 프로덕션 환경에서 fake 인증 어댑터를 허용하지 않는다.

## 2. 현재 문제와 판단 근거

현재 CI는 저장소 검증, 일회용 PostgreSQL 준비, Chromium 설치까지 통과한다. 남은 실패는 다음 두 가지다.

1. 로그인 성공 직후 `/app`으로 이동하면서 Playwright의 `response.text()`가 `Network.getResponseBody: No resource with given identifier found`로 실패한다.
2. 일반 선택자 `[role="alert"]`가 애플리케이션 오류 상태와 Next.js 개발 서버의 route announcer를 함께 선택한다.

이는 인증 도메인 로직의 실패 증거가 아니라 하나의 브라우저 테스트가 사용자 여정, 응답 계약, 브라우저 저장소, 세션 폐기까지 동시에 소유한 데서 생긴 테스트 경계 문제다. 운영 코드의 성공 후 이동을 억제하거나 브라우저 `fetch`를 계측하는 대신 테스트 책임을 분리한다.

## 3. 결정

### 3.1 지금 적용할 A안

동일한 실제 Next.js BFF, NestJS API, test IDP, 일회용 PostgreSQL을 사용하되 테스트 클라이언트를 두 개로 나눈다.

- Browser UI client: Playwright `Page`와 `BrowserContext`
- HTTP contract client: Playwright `APIRequestContext`

Browser UI client는 사용자가 관찰할 수 있는 로그인 여정과 실제 브라우저 보안 상태를 검증한다. HTTP contract client는 화면 전환 없이 로그인 응답 본문과 cookie jar를 안정적으로 검증한다.

### 3.2 배포 단계에 추가할 D2안

D2는 운영 데이터와 분리된 별도 호스팅 staging 환경에 실제 프로덕션 빌드를 배포한 뒤 HTTPS 경계에서 실행한다.

- staging 전용 Supabase 프로젝트와 최소 권한 DB login
- staging 전용 Google·Kakao·Naver OAuth application
- GitHub protected environment 또는 동등한 암호화 secret 저장소
- 실제 TLS, reverse proxy, `Secure`/`__Host-` cookie, redirect URI 검증
- 합성 테스트 계정과 테스트 데이터만 사용

D2는 TASK 14의 로컬·CI A안을 대체하지 않는다. A안은 모든 변경에서 실행하는 결정적 회귀 게이트이고, D2는 배포 후보에 대해 실행하는 환경 통합 게이트다.

## 4. 고려한 대안

| 대안 | 장점 | 단점 | 결정 |
|---|---|---|---|
| 브라우저 UI + `APIRequestContext` | 운영 코드 변경 없음, 응답 본문 안정성, 실패 책임 분리 | 인증 세션이 둘 생기므로 정리 필요 | 채택 |
| 브라우저 E2E + route 통합 테스트 | 가장 단순하고 빠름 | 실제 HTTP 직렬화와 cookie 전달 증거가 약함 | 보조 단위·통합 테스트로 유지 |
| 브라우저 `fetch` 계측 | 하나의 실제 브라우저 흐름에서 본문 확인 | 런타임 개입, 민감 응답 접근, 업그레이드 취약성 | 기각 |
| 테스트 전용 navigation 억제 | 구현량이 적음 | 운영 동작과 테스트 동작이 달라지고 production seam이 생김 | 기각 |
| 로컬 production + fake adapter | 자동화가 쉬움 | production fake 차단 정책을 우회해야 함 | 금지 |
| 별도 호스팅 staging D2 | 실제 TLS·프록시·OAuth 충실도 | 인프라와 secret 관리 필요 | 배포 단계 채택 |

## 5. 컴포넌트와 책임

### 5.1 `auth-ui.spec.ts`

브라우저에서 다음 동작만 소유한다.

- 390x844와 1440x900 viewport에서 로그인 화면 표시 및 overflow 부재
- label, keyboard focus, WCAG 2 A/AA axe 검사
- 실패한 로그인에서 `.auth-status[role="alert"]`만 정확히 선택
- 성공한 로그인 뒤 `/app` 이동
- 브라우저에 `Authorization` header가 생성되지 않음
- `localStorage`는 비어 있고 `sessionStorage`는 정확한 Next.js debug prefix 외 항목이 없음
- provider token sentinel, access/refresh token 이름, JWT 형태가 브라우저 저장소에 없음
- `__Host-ab_session` 한 개만 존재하고 `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` 속성을 가짐
- `/api/me`가 인증 사용자를 반환
- logout 뒤 cookie 제거, `/api/me` 401, 이전 selector 재사용 401

이 파일은 로그인 응답 본문을 읽지 않는다. 화면 이동이 완료되면 사용자 여정이 성공한 것으로 판단하고 브라우저가 실제로 유지한 상태를 검사한다.

### 5.2 `auth-response.spec.ts`

`APIRequestContext`의 독립 cookie jar로 다음 계약을 검증한다.

1. CSRF endpoint에서 test 전용 token을 얻는다.
2. 고정된 staging이 아닌 로컬 E2E origin을 `Origin`으로 사용한다.
3. `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`, `Sec-Fetch-Dest: empty`와 CSRF header를 명시한다.
4. `POST /api/auth/sign-in`을 호출한다.
5. status 200과 응답 key `absoluteExpiresAt`, `expiresAt`, `user`만 허용한다.
6. 응답에 provider sentinel, access/refresh token 이름, JWT 형태가 없음을 검사한다.
7. cookie jar에 hardened opaque session cookie만 있는지 검사한다.
8. `/api/me`와 logout을 호출하고, 폐기된 selector의 재사용이 401인지 검사한다.

이 테스트는 보안 header를 수동으로 구성하므로 실제 Chromium header의 완전한 대체 증거로 사용하지 않는다. 실제 브라우저의 로그인 성공은 `auth-ui.spec.ts`가 별도로 증명하고, Fetch Metadata의 허용·거부 조합은 기존 request-origin 단위 테스트가 계속 증명한다.

### 5.3 공통 helper

공통 helper는 다음 고정 기능만 제공한다.

- base origin 계산
- CSRF token 획득
- 허용된 same-origin mutation header 생성
- cookie 이름과 공개 응답 field 검사
- 세션 폐기와 request context 정리

사용자 자격 증명, token, cookie 값 또는 전체 응답 본문을 로그로 출력하는 helper는 만들지 않는다. 추상화가 한 파일에서만 사용되면 helper로 분리하지 않는다.

### 5.4 Playwright 실행 정책

- `fullyParallel: false`, `workers: 1`, `retries: 0`을 유지한다.
- `ui-mobile-390x844`와 `ui-desktop-1440x900` project는 `auth-ui.spec.ts`만 실행한다.
- `http-contract` project는 `auth-response.spec.ts`를 한 번만 실행한다. viewport별로 같은 계약 테스트를 중복하지 않는다.
- 기존 실제 BFF·API·test IDP·일회용 PostgreSQL 경계를 유지한다.
- CI에서 기존 서버를 재사용하지 않는다.
- trace는 실패 시에만 보존하되 민감 request/response가 포함될 수 있으므로 CI artifact로 자동 공개하지 않는다.

## 6. 데이터 흐름

### 6.1 Browser UI client

```text
Chromium -> Next.js login UI -> ky same-origin BFF -> auth service
         -> PostgreSQL opaque session -> __Host-ab_session
         -> /app -> /api/me -> NestJS JWT verification
         -> logout -> local session revoke -> selector replay 401
```

브라우저는 불투명 session selector 이외의 provider credential을 받거나 저장하지 않는다.

### 6.2 HTTP contract client

```text
APIRequestContext -> CSRF 발급 -> same-origin sign-in POST
                  -> 공개 응답 schema 검사
                  -> 독립 cookie jar 검사
                  -> /api/me -> logout -> selector replay 401
```

두 흐름은 같은 일회용 데이터베이스를 사용하지만 각자 생성한 세션만 정리한다. 테스트 순서는 직렬화하고 한 테스트의 selector를 다른 테스트가 공유하지 않는다.

### 6.3 Hosted staging D2

```text
배포 후보 artifact -> staging HTTPS host -> production Next.js/NestJS
                   -> staging Supabase/DB -> 실제 OAuth provider
                   -> 합성 계정 smoke -> 증거와 blocker 기록
```

운영 사용자, 운영 DB, 운영 OAuth application과 staging 자원을 공유하지 않는다.

## 7. 오류 처리와 안전한 증거

- 실패 메시지는 test 이름, HTTP status, 허용된 공개 field 이름, request ID처럼 비밀이 아닌 정보만 포함한다.
- JSON parsing이 실패해도 raw body를 출력하지 않는다.
- email, password, CSRF token, OAuth code, provider token, cookie와 database connection string을 assertion message나 attachment에 넣지 않는다.
- request context와 browser context는 `finally`에서 정리한다.
- 로그아웃 호출이 실패하면 원래 assertion 실패를 숨기지 않으면서 별도의 정리 실패 상태만 안전하게 기록한다.
- 세션 폐기가 검증되지 않으면 테스트를 성공 처리하지 않는다.
- PostgreSQL이나 Chromium이 없다는 이유로 skip하지 않는다. 같은 commit SHA의 CI 성공만 로컬 증거를 대체할 수 있다.
- D2에서 provider 또는 staging 장애가 발생하면 자동으로 통과시키지 않고 `환경 장애로 미검증` 상태와 출시 blocker를 기록한다.

## 8. 보안 경계

### 8.1 유지해야 하는 보장

- production에서 `AUTH_ADAPTER_MODE=fake`는 계속 startup 실패한다.
- 운영 코드에 테스트 전용 분기, navigation 억제 flag 또는 response capture hook을 추가하지 않는다.
- 브라우저가 API bearer token을 만들거나 보관하지 않는다.
- 서버는 exact Origin, CSRF token, Fetch Metadata를 계속 검증한다.
- DB에는 session selector 원문이 아니라 digest만 저장한다.
- logout은 provider sign-out 성공 여부보다 local revocation을 우선한다.
- trace, screenshot, video와 CI log를 secret 저장소로 취급하지 않는다.

### 8.2 D2 secret 원칙

- secret은 source, `.env` 예제, fixture, client bundle, workflow YAML과 일반 CI log에 넣지 않는다.
- staging DB login은 owner, superuser, migration principal 또는 `BYPASSRLS`가 아니어야 한다.
- OAuth secret과 DB credential은 환경별로 분리하고 정기적으로 회전한다.
- fork PR과 신뢰되지 않은 코드에는 protected environment secret을 제공하지 않는다.
- D2 workflow를 자동화할 때 environment approval과 최소 `contents: read` 권한을 사용한다.

## 9. 테스트 매트릭스

| 보안 주장 | Browser UI | HTTP contract | 단위·통합 | D2 staging |
|---|---:|---:|---:|---:|
| 실제 화면 로그인과 `/app` 이동 | 필수 | 해당 없음 | 보조 | 필수 |
| 공개 응답 schema와 token 미노출 | 저장소 관찰 | 필수 | 필수 | network smoke |
| 브라우저 cookie 속성 | 필수 | 보조 | 필수 | 필수 |
| CSRF·Origin·Fetch Metadata | 실제 성공 경로 | 허용 경로 | 허용·거부 matrix | 실제 HTTPS 경로 |
| `/api/me` JWT 재검증 | 필수 | 필수 | 필수 | 필수 |
| logout과 selector replay 차단 | 필수 | 필수 | 필수 | 필수 |
| Google·Kakao·Naver redirect | fake 경로 | 해당 없음 | transaction matrix | 실제 provider 필수 |
| production fake adapter 거부 | startup test | 해당 없음 | 필수 | 배포 설정 확인 |

## 10. TASK 14 완료 기준

- UI 테스트가 응답 본문을 읽지 않고 두 viewport에서 통과한다.
- 오류 상태는 `.auth-status[role="alert"]`로 애플리케이션 요소 하나만 선택한다.
- HTTP contract 테스트가 로그인 공개 응답과 hardened cookie를 검증한다.
- 두 테스트 모두 token 비노출, `/api/me`, logout과 selector replay 차단을 증명한다.
- 기존 request-origin, controller, session repository 테스트가 회귀 없이 통과한다.
- 전체 `pnpm run verify`, DB test, E2E, production dependency audit와 `git diff --check`가 통과한다.
- GitHub Actions의 같은 commit SHA `security-gate`가 성공한다.
- RED/GREEN 명령, 실패 원인, 최종 test 수와 commit SHA를 한국어 테스트 문서에 기록한다.
- 실제 OAuth credential이 없으면 D2는 `미실행—출시 차단`으로 남기며 TASK 14 자동 테스트 성공과 혼동하지 않는다.

## 10.1 TASK 14 실제 검증 기록

- RED는 commit `835dbc9`의 GitHub Actions [run 29970158952](https://github.com/jawon0407/account-book/actions/runs/29970158952)에서 확인했다. 원인은 navigation과 응답 본문 처리의 경합 및 broad alert selector 충돌이며, 민감한 응답 원문은 이 문서에 기록하지 않는다.
- GREEN 최종 검증 코드 SHA는 `0d996fe726debaa8a2eec10865f63418635d06d8`이다. 같은 SHA의 [push run](https://github.com/jawon0407/account-book/actions/runs/30252139895)과 [PR run](https://github.com/jawon0407/account-book/actions/runs/30252146533)은 성공했다.
- 로컬 Node 24의 `pnpm test`는 legacy/security 53개, contracts 22개, database package 12개, API 113개, web 479개, E2E preflight 2개를 통과했다. PostgreSQL-backed Playwright는 로컬에서 실행하지 않았고, 동일 SHA Node 22 CI가 disposable PostgreSQL DB 22개, browser-stage Node 정책·preflight 7개, Playwright HTTP·UI 8개 통과(단일 worker)로 보완했다.
- UI 프로젝트는 trace를 끄고 visible/browser state와 status만 검증한다. HTTP 프로젝트는 response body·CSRF·logout·selector replay를 단독 소유하며, AST 정책은 DOM Response body 접근을 제한한다.
- D2 hosted staging/live Google·Kakao·Naver 및 TLS 증거는 미실행이다. 이 항목은 자동 테스트 성공과 별개인 운영 출시 차단 조건이다.

## 11. D2 도입 조건과 완료 기준

D2는 다음 준비가 완료된 배포 단계에서 별도 계획으로 구현한다.

1. 운영과 분리된 staging host, Supabase project, DB login이 존재한다.
2. Google·Kakao·Naver staging OAuth application과 exact redirect URI가 준비된다.
3. protected environment, 승인자, secret rotation과 폐기 절차가 정의된다.
4. 합성 계정 생성·초기화·삭제 절차와 로그 마스킹이 검증된다.
5. 배포 artifact SHA와 smoke 결과를 연결할 수 있다.

D2 완료는 정상 로그인만 의미하지 않는다. 공급자별 사용자 취소, 잘못된 state, callback 재사용, email 누락, logout과 폐기된 session 재사용을 검사하고 브라우저 storage·history·network·server log에서 token, authorization code와 email 원문이 노출되지 않아야 한다.

## 12. 롤백과 실패 대응

- A안 분리 후 회귀가 생기면 운영 코드는 되돌리지 않고 새 테스트 파일과 helper 변경만 이전 단일 E2E로 되돌릴 수 있다.
- 단일 E2E로 롤백하더라도 응답 본문 경합을 성공으로 무시하거나 retry로 숨기지 않는다.
- D2 실패 시 직전 검증 artifact를 유지하고 신규 배포 승인을 중단한다.
- D2 자동화가 secret을 노출하면 workflow를 즉시 중지하고 관련 OAuth·DB·배포 credential을 폐기·회전하며 사고 대응 문서를 따른다.
- staging 장애와 애플리케이션 결함을 구분하되 어느 경우도 검증 성공으로 기록하지 않는다.

## 13. 범위 제외

- 거래, 예산, 자산, 동기화와 관리자 페이지 구현
- 테스트 편의를 위한 인증 운영 코드 변경
- production fake adapter 허용
- 운영 사용자 또는 운영 데이터에 대한 E2E 실행
- D2 인프라와 OAuth application의 즉시 생성
- E2E retry로 비결정적 실패를 숨기는 작업

## 14. 후속 작업

문서 승인 후 별도 구현 계획에서 다음 순서를 구체화한다.

1. RED: 정확한 application alert 선택자와 분리된 HTTP contract acceptance test 작성
2. GREEN: `auth-ui.spec.ts`, `auth-response.spec.ts`와 최소 helper로 책임 분리
3. REFACTOR: 중복이 실제로 확인된 부분만 공통화
4. 전체 로컬 검증과 같은 SHA의 GitHub `security-gate` 확인
5. 한국어 RED/GREEN 증거 문서 갱신
6. TASK 14 완료 후 TASK 15로 전환
7. 배포 준비 시 D2 전용 설계·위협 검토·구현 계획 수립

### M1.1 대체 기록

이 문서의 기존 UI-status 소유 및 DOM `Response` provenance 결정은 역사적 RED/GREEN SHA와 run 기록을 보존하되, M1.1 UI response non-observation boundary로 대체되었다. 현재 UI는 화면·접근성·keyboard·URL·cookie metadata/opaque boolean·token-free storage·Authorization 존재 boolean만 소유하고, HTTP 계약은 status/body·CSRF·logout/replay·raw/nested credential scan을 소유한다.

M1.1 SHA `da0b0f1c2712d56dca8ce231b48a16637e1ac809`와 same-SHA [push run 30278565453](https://github.com/jawon0407/account-book/actions/runs/30278565453)·[PR run 30278569950](https://github.com/jawon0407/account-book/actions/runs/30278569950)은 당시 성공했지만 최종 리뷰가 import alias, authorization 원문 보존, 일반 Playwright request/route capability 우회를 발견했으므로 중간·대체된 증거다.

최종 code SHA `d1a71a24a5b24d5330d525c77d5eabe97f034a2a`는 external import를 exact no-alias named import로 제한하고 `Page`·`BrowserContext`·`Request`·`Route`·`APIRequestContext`·`Locator`에 폐쇄형 capability allowlist를 적용한다. 별칭·구조 분해·computed/optional member·pass/return·fixture/factory·`.call/.apply/.bind`, `fetch`·XHR·Request/Response factory와 trusted consumer shadow를 거부한다. authorization recorder는 exact callback에서 strict null 비교로 즉시 boolean만 남기며 raw return·연결·wrapper·대입을 허용하지 않는다.

Local Node 24.14.0 GREEN은 focused 44/44, preflight 46/46, typecheck·lint와 전체 53/22/12/113/479였다. 정확히 최종 code SHA의 [push run 30326538341](https://github.com/jawon0407/account-book/actions/runs/30326538341)과 [PR run 30326540058](https://github.com/jawon0407/account-book/actions/runs/30326540058)은 모두 `completed/success`였고 Node 22/disposable PostgreSQL/Chromium/audit의 권위 있는 증거다. D2 hosted provider/TLS와 beta-before penetration test는 계속 독립 release blocker다.
