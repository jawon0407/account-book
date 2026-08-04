# M1.1 인증 UI 응답 비관찰 경계 설계

## 1. 배경과 결정

TASK 14의 최종 보안 리뷰에서 기존 `Response` 타입 계보 분석기가
`Pick<Response, "text">` 같은 mapped/utility type과 매개변수·대입 구조
분해를 완전하게 추적하지 못한다는 문제가 발견되었다. 이 분석기를 계속
확장하면 TypeScript 타입 시스템의 더 많은 형태를 보안 코드가 재구현해야
하고, 새 문법이나 라이브러리 타입 변화마다 우회 가능성을 다시 검토해야 한다.

M1.1은 **UI E2E 테스트가 응답 객체를 보관·전달·검사하지 못하도록
제한**한다. navigation API가 내부적으로 반환하는 응답은 즉시 폐기한다.
상태 코드·본문·CSRF·로그아웃·세션 선택자 재사용 검증은 HTTP 계약 프로젝트가
독점한다. 이 결정은 사용자가 승인한 2안이다.

## 2. 검토한 대안

### A. 기존 타입 분석기 확장

- 장점: UI 테스트에서 상태 코드 검증을 계속 사용할 수 있다.
- 단점: mapped type, conditional type, alias, 모든 구조 분해 위치와 향후
  TypeScript 타입 표현을 계속 추적해야 한다.
- 판단: 보안 경계의 정확성이 복잡한 자체 타입 분석기에 의존하므로 채택하지
  않는다.

### B. UI 응답 비관찰 경계

- 장점: 금지 대상이 단순한 네트워크 기능 집합이 되어 정책과 리뷰 범위가
  작아진다. UI와 HTTP 계약 테스트의 책임이 명확하다.
- 단점: 하나의 UI 시나리오에서 화면과 상태 코드를 동시에 단언할 수 없다.
  같은 사용자 동작을 UI와 HTTP 계약 테스트에서 각각 검증해야 한다.
- 판단: 가장 작은 보안 표면과 장기 유지보수성을 제공하므로 채택한다.

### C. 알려진 우회 위험 수용

- 장점: 추가 작업이 없다.
- 단점: 보안 경계가 자동으로 보장된다는 기존 문서와 실제 코드가 불일치한다.
- 판단: 실제 금융정보를 저장할 서비스의 보안 우선 원칙과 충돌하므로
  채택하지 않는다.

## 3. 신뢰 경계와 책임

### 3.1 UI 프로젝트가 소유하는 검증

`auth-ui.spec.ts`와 그 테스트 전용 로컬 import graph는 다음 항목만 검증한다.

- 로그인 폼의 표시, 레이블, 키보드 접근성, 반응형 레이아웃, axe 결과
- 실패 시 사용자에게 보이는 고정 오류 상태와 로그인 화면 유지
- 성공 시 인증된 화면으로의 이동과 사용자에게 보이는 인증 상태
- `__Host-ab_session` 쿠키의 이름·`HttpOnly`·`Secure`·`SameSite`·경로와
  고정 길이 형식
- `localStorage`와 `sessionStorage`에 credential material이 없는지
- 브라우저가 송신하는 요청에 `Authorization` 헤더가 존재하지 않는다는
  boolean 결과

UI 테스트는 요청 헤더 값을 저장·출력하지 않는다. `Authorization` 검사는
해당 이름의 header value를 읽은 직후 존재 여부 boolean으로 축약하고 원문
참조를 유지하지 않는다. assertion에는 이 boolean만 전달한다.

### 3.2 HTTP 계약 프로젝트가 독점하는 검증

`auth-response.spec.ts`는 다음 항목을 전담한다.

- 실패 로그인 `401`과 고정 공개 오류 계약
- 성공 로그인 `200`과 공개 세션 계약
- `/api/me`의 인증 성공 상태와 정확한 공개 응답 형태
- CSRF 토큰 발급·바인딩과 mutation header 계약
- 로그아웃 성공 상태·응답 형태·쿠키 제거
- 폐기된 opaque selector 재사용의 `401` 거부
- 원문과 파싱된 중첩 JSON 모두에서 credential material 비노출
- assertion diff와 테스트 artifact에 응답 본문·secret이 노출되지 않음

## 4. UI 프로젝트의 금지 기능

UI 파일은 `tests/e2e/ui/` 전용 root로 이동한다. 자동 정책은 이 root의
Playwright spec에서 시작해 정적 import/export graph의 모든 로컬
JavaScript·TypeScript 파일을 검사한다. 경로 소속은 문자열 prefix가 아니라
canonical realpath로 판정한다. symlink·Windows reparse point를 거친 최종
경로가 root 밖이면 즉시 실패한다.

지원 확장자는 `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`로 고정하고 모두
검사한다. 로컬 import가 root 밖으로 나가거나, 해석할 수 없는 경로·미지원
확장자·동적 `import()`·`require()`·비정적 module specifier를 사용하면
fail-closed 한다. 애플리케이션 런타임 소스는 UI 테스트가 직접 import할 수
없고, 선언 파일과 `node_modules` 구현은 검사 대상이 아니다.

외부 module import는 named import만 허용한다. `@playwright/test`의
`test`·`expect`·type `Page`와 `@axe-core/playwright`의 `AxeBuilder`만
allowlist에 둔다. namespace/default import는 금지한다. `ky`, `axios`,
`undici`, Node HTTP module 등 임의 HTTP client와 Playwright `request`
fixture/factory는 import 단계에서 차단한다.

검사 대상에서는 출처 타입을 추론하지 않고 다음 기능을 보수적으로 금지한다.

- `fetch`, `XMLHttpRequest`와 Playwright `APIRequestContext`
- Playwright의 `request` fixture/factory 및 `Response`·`APIResponse` 타입
- `page.waitForResponse`, `waitForEvent("response")`와 response listener
- 아래에서 승인한 정확한 request recorder 형태를 제외한 `on`, `once`,
  `addListener`, `prependListener`, `prependOnceListener` 등 모든 이벤트
  구독
- `Request.response()`와 navigation response를 변수·매개변수·property에
  저장하거나 다른 함수로 전달하는 형태
- `page.request`, `context.request`와 그 별칭
- 응답 본문 소비 기능인 `json`, `text`, `body`, `arrayBuffer`, `blob`,
  `bytes`, `formData`
- UI 테스트가 직접 수행하는 HTTP status 단언
- 문자열 또는 동적 코드 안에 금지 기능을 숨길 수 있는 `eval`, `Function`
- `evaluateHandle`, `waitForFunction`, `addInitScript`, `addScriptTag`,
  `setContent`와 script/HTML 주입 기능
- 위 기능을 별칭, 구조 분해, computed property, type reference 또는 로컬
  helper로 숨기는 형태

테스트 전용 UI import graph에서는 같은 이름의 사용자 정의 메서드도 허용하지
않는 fail-closed 정책을 사용한다. 해당 graph는 작고 목적이 제한되어 있으므로
오탐을 감수하는 편이 타입 계보 누락보다 안전하다.

`page.goto`, `page.reload`, `page.goBack`, `page.goForward`는 UI 탐색에
필요하지만 `Response | null`을 반환한다. 이 메서드는 직접 호출한 결과를
`await`한 expression statement로 즉시 버리는 형태만 허용한다. 별칭 생성,
구조 분해, 반환값 저장·전달·반환·chaining은 금지한다.

브라우저의 일반적인 `request` 이벤트는 응답 객체가 아니므로 정확히
`page.on("request", authorizationRecorder)` 형태만 허용한다. 다른 이벤트
이름, 동적으로 계산한 이벤트 이름, 다른 구독 메서드는 모두 금지한다.
recorder는 header value를 읽은 직후 boolean으로 축약하고 원문을
반환·저장·출력하지 않는다. `Request.response`, post data, 전체
headers/cookies를 읽는 다른 request 기능은 허용하지 않는다.

DOM 크기와 브라우저 저장소 검증에 필요한 `page.evaluate`는 첫 번째 인수가
source string이 아닌 함수 또는 arrow-function AST이고, 그 함수 AST 전체가
동일한 금지 기능 검사를 통과할 때만 허용한다. `locator.evaluate`를 포함한
다른 실행 API와 HTML/script 주입은 인증 UI 테스트에서 허용하지 않는다.

## 5. 구성 요소 변경

1. `auth-ui.spec.ts`
   - 실패 로그인에서 `waitForResponse`와 `401` 단언을 제거한다.
   - 성공 로그인에서 `page.evaluate(fetch("/api/me"))`와 `200` 단언을
     제거한다.
   - 성공 화면의 사용자 가시 상태를 단언한다.
   - `Authorization` 요청 헤더는 전용 recorder에서 존재 여부 boolean만
     보관한다.
2. UI 네트워크 소유권 정책
   - 기존 `Response` declaration provenance 분석을 제거한다.
   - `tests/e2e/ui/` 경계, 외부 import allowlist, 정적 로컬 import graph,
     navigation 반환값 폐기 규칙과 금지된 네트워크 기능을 fail-closed 방식으로
     검사한다.
   - canonical realpath confinement, reparse-point escape, 지원 확장자,
     namespace/default/dynamic import, 이벤트·브라우저 실행 allowlist를
     mutation으로 검증한다.
   - 진단에는 고정된 기능 범주만 남기고 소스 표현·값·secret은 출력하지 않는다.
3. `auth-response.spec.ts`
   - 로컬 `1586ee5`에서 강화된 원문/중첩 JSON 비밀 탐지와 고정 shape
     validator를 유지한다.
   - UI에서 제거된 실패·성공 상태 검증이 이미 HTTP 계약에 존재함을
     회귀 테스트로 고정한다.
4. 문서와 증거
   - UI가 status를 소유한다는 기존 문구를 역사적 결정으로 표시한다.
   - 최종 커밋과 동일 SHA의 Node 22/PostgreSQL/Chromium CI 결과만 GREEN
     증거로 기록한다.

## 6. TDD와 보안 검증

### RED

먼저 정책 mutation fixture를 추가한다. 다음 예제가 허용되면 테스트가
실패해야 한다.

- `page.waitForResponse(...)`
- `page.waitForEvent("response")`와 `page.on/once/addListener/
  prependListener/prependOnceListener("response", ...)`
- 승인된 exact `page.on("request", authorizationRecorder)` 외의 이벤트 구독
- `request.response()`
- `page.request`와 `context.request`
- 직접 `fetch(...)`
- `ky`, `node:http` 같은 승인되지 않은 client import
- Playwright namespace/default import와 승인되지 않은 named import
- `Pick<Response, "text">`
- 매개변수와 대입 구조 분해를 통한 `text`/`json` 획득
- 로컬 helper 안의 응답 획득 또는 본문 소비
- Playwright `request`, `APIRequestContext`, `APIResponse` 사용
- UI root 밖의 정적 helper import와 동적 `import()`/`require()`
- symlink/reparse-point root escape와 미지원 확장자
- string `page.evaluate`, 함수형 `page.evaluate` 안의 network call
- `evaluateHandle`, `waitForFunction`, `addInitScript`, `addScriptTag`,
  `setContent`, `eval`, `Function`을 통한 network/script 주입
- `page.goto()` 결과 저장·전달·별칭 생성

실제 `auth-ui.spec.ts`도 기존 `waitForResponse`와 `fetch` 때문에 RED가 되어야
한다.

### GREEN

UI 시나리오에서 금지 기능을 제거하고, 최소한의 fail-closed 정책으로 모든
mutation과 실제 UI root 검사를 통과시킨다. 이어서 다음을 검증한다.

- 정책 및 보안 단위 테스트
- E2E TypeScript typecheck
- lint와 전체 비DB 테스트
- disposable PostgreSQL 기반 HTTP/UI Playwright 프로젝트
- production dependency audit
- `git diff --check`

로컬 환경의 Node/PostgreSQL 제약으로 DB E2E를 실행할 수 없으면 성공으로
추정하지 않는다. 최종 커밋을 푸시한 뒤 동일 SHA GitHub `security-gate`의
Node 22/PostgreSQL/Chromium 결과를 권위 있는 증거로 사용한다.

## 7. 실패 처리와 예외 정책

- 새 UI 테스트에 HTTP 계약 검증이 필요해도 금지 목록에 예외를 추가하지 않는다.
  별도의 HTTP 계약 테스트를 작성한다.
- UI 정책이 애플리케이션 런타임 파일을 검사하기 시작하면 범위 오류로 간주하고
  수정한다.
- 정책 진단은 고정된 category/capability만 출력하며 실제 URL, header,
  cookie, body 또는 source expression을 출력하지 않는다.
- Playwright trace는 인증 UI와 HTTP 계약 프로젝트에서 계속 비활성화한다.
- 동일 SHA CI가 실패하면 M1을 완료로 표시하지 않고 원인을 RED로 조사한다.
- hosted Google·Kakao·Naver, 실제 TLS·redirect·cookie·로그 비노출 검증인
  D2는 이 패치와 독립된 production release blocker로 유지한다.

## 8. 완료 조건

M1.1은 다음 조건이 모두 충족될 때 완료된다.

1. `tests/e2e/ui/` root와 허용된 로컬 helper에 금지된 응답/직접 네트워크
   기능이 없다.
2. mapped type·구조 분해·별칭·computed property·imported helper·외부
   HTTP client·dynamic import·navigation 반환값 mutation이 정책을 우회하지
   못한다.
3. UI 테스트가 화면·접근성·이동·브라우저 상태만 검증한다.
4. HTTP 계약 테스트가 상태·본문·CSRF·로그아웃·replay를 모두 검증한다.
5. 응답 본문과 credential 값이 assertion diff·trace·보고서에 남지 않는다.
6. 최종 커밋과 동일 SHA의 두 GitHub security-gate 실행이 성공한다.
7. 문서가 새 책임 경계, RED/GREEN 명령, 실제 SHA와 CI URL을 기록한다.
8. D2가 완료되지 않은 동안 production release 차단 상태가 유지된다.

이 자동 정책과 AI 기반 코드 리뷰는 전문 보안감사를 대체하지 않는다. 실제
금융정보를 저장하는 지인 베타를 열기 전에 별도 침투 테스트와 운영환경 보안
검증을 완료 조건으로 추가한다.

## 9. 구현 상태와 same-SHA CI

`da0b0f1c2712d56dca8ce231b48a16637e1ac809`의 [push run 30278565453](https://github.com/jawon0407/account-book/actions/runs/30278565453)와 [pull_request run 30278569950](https://github.com/jawon0407/account-book/actions/runs/30278569950)은 당시 성공했지만 현재 완료 증거가 아닌 중간 기록이다. 최종 리뷰에서 `request as expect` 같은 external import alias, authorization recorder의 raw header 반환·대입, `waitForRequest`·`page.route`·`route.fetch`와 선언/대입/구조 분해 별칭·computed member 우회가 발견되었다.

이전 폐쇄형 allowlist 구현 SHA는 `d1a71a24a5b24d5330d525c77d5eabe97f034a2a`다. 외부 module은 exported/local name이 같은 exact named import만 허용하고, `Page`·`BrowserContext`·`Request`·`Route`·`APIRequestContext`·`Locator`별 폐쇄형 capability allowlist가 별칭·구조 분해·pass/return·fixture/factory·optional/computed member·`.call/.apply/.bind`, `fetch`·`XMLHttpRequest`·`Request`·`Response` factory와 trusted consumer shadow를 fail-closed 한다. request recorder는 exact `page.on("request", authorizationRecorder)`와 strict null 비교로 즉시 boolean만 남기는 callback만 허용하며 raw return, 문자열 연결, object wrapper, 대입, async·annotation 변형을 거부한다.

TDD RED는 focused 35개 중 17개 실패와 별도 Locator mutation 1/1 실패였고, 기존 raw-return/object-wrapper 차단 fixture는 약화하지 않았다. Local Node 24.14.0 GREEN은 focused 44/44, E2E preflight 46/46, typecheck·lint, 전체 legacy/security 53, contracts 22, database package 12, API 113, web 479였다. 정확히 해당 code SHA의 Node 22/PostgreSQL/Chromium `security-gate` [push run 30326538341](https://github.com/jawon0407/account-book/actions/runs/30326538341)과 [pull_request run 30326540058](https://github.com/jawon0407/account-book/actions/runs/30326540058)은 모두 `completed/success`였다.

문서 SHA `57c3776fe2adbdb6e630fef2e326314f14b2970b` 이후의 scoped re-review는 nonliteral `globalThis[key]`에서 `memberChain()`이 `undefined`가 되어 capability acquisition과 반환 `Response` 관찰이 누락되는 Critical 우회를 확인했다. 이 verdict는 당시 M1.1 완료 판단을 supersede해 M1.1/M1을 다시 차단했다.

새로 승인된 bounded fix cycle의 code SHA `5cda5422e114f872ceb031f34180f9f346cb3088`은 `globalThis`·Node `global`·`window`·`self`와 선언·대입 root alias의 nonliteral computed member를 고정 `network/unapproved-browser-capability`로 획득 전에 거부한다. optional invocation, `.call/.apply/.bind`, 동적 `fetch`·`XMLHttpRequest`·`Request`·`Response` 선택에도 같은 규칙을 적용하고 import, Page, Context, Request, Route, APIRequestContext, Locator, authorization recorder, `page.evaluate` 규칙은 변경하지 않았다.

이 cycle은 exact bypass RED/GREEN 39/40→40/40, alternate roots 0/3→3/3, alias·adapter·factory 43/51→51/51을 순서대로 기록했다. Repository Node 22.15.1의 최종 focused 51/51, E2E subset 57/57, typecheck·lint·diff check와 전체 53/22/12/113/479가 통과했다. 로컬 full preflight package-spawn 1건은 untracked `node_modules`의 `.modules.yaml` 부재로 fallback `pnpm`이 install retry에 들어가 검증하지 못했으나, production/fake startup guard 자체는 직접 실행에서 고정 `AUTH_CONFIGURATION_INVALID`로 즉시 실패했다.

정확히 `5cda5422e114f872ceb031f34180f9f346cb3088`의 Node 22 `security-gate` [push run 30330701053](https://github.com/jawon0407/account-book/actions/runs/30330701053)과 [pull_request run 30330704817](https://github.com/jawon0407/account-book/actions/runs/30330704817)은 모두 `completed/success`였다. 이 구현 evidence는 `57c3776` 차단 finding을 코드 수준에서 대체하지만 M1.1 완료를 의미하지 않는다. 독립 scoped re-review와 이 문서 변경/final SHA의 exact push/PR gate가 모두 성공할 때까지 M1.1/M1은 차단 상태이며 M2를 시작하지 않는다.

이 exact-SHA CI는 D2 hosted Google·Kakao·Naver, 실제 TLS 및 redirect/cookie/log 비노출 증거나 beta-before penetration test를 대체하지 않는다. 두 항목은 계속 독립 production release blocker다.

## 10. Safe Auth UI Facade 전환 결과

이 문서의 폐쇄형 Playwright capability allowlist는 최종 경계가 아니라
facade 설계로 가기 전의 역사적 중간 단계다. 최종 구현은
`auth-ui.spec.ts`에 raw `Page`, `Locator`, `BrowserContext`, `Request`,
`Response`, `APIRequestContext`를 주지 않는다. spec은 `authTest`와 고정
`AuthUi` 호출만 사용하고, driver가 원문을 고정 오류 또는 boolean-safe
판정으로 축약한다. 정적 Gate와 런타임 Transport Tripwire가 이 acquisition
경계를 서로 다른 계층에서 지킨다.

UI/HTTP 책임 분리는 유지됐다. UI는 visible state, 접근성, keyboard, URL,
cookie 정책의 내부 판정, credential-free storage와 Authorization 존재
boolean만 다룬다. `auth-response.spec.ts`는 facade 전환 동안 변경되지
않았고 status/body, CSRF, logout, selector replay, raw/nested credential
scan을 계속 독점한다. screenshot, video, trace는 모두 `off`다.

TDD는 정적 Gate 19/19, SafeError/Tripwire 36/36, facade/async
assertion 35/35, 최종 identity/threat 6/6·Gate 29/29·preflight 85/85를
기록했다. 기존 `d1a71a2`, `5cda542`, `5729d98`, `ef0d1bc`는 모두
문자열 provenance analyzer 계열의 역사적 중간 근거다. `24b4dd1`도 로컬
검증은 통과했지만 stale workspace policy 때문에 첫 exact-SHA CI가
실패했고, 해당 정책 테스트는 2/3 RED→3/3 GREEN으로 교정됐다.

최종 코드 SHA는 `61a0ea334761fc48394bae515edfeb440aed052a`다.
[push security-gate run
30460467954](https://github.com/jawon0407/account-book/actions/runs/30460467954)와
[pull-request security-gate run
30460473476](https://github.com/jawon0407/account-book/actions/runs/30460473476)은
동일 SHA에서 `completed/success`다. Node 22.15.1의 full verify는
53/22/12/113/479와 preflight 85/85를 통과했고, disposable PostgreSQL,
Playwright 8/8, production audit 및 346개 changed blob 보안 검사도
통과했다.

Task 1~4 최종 독립 리뷰에는 미해결 Critical/Important가 없다. 현재
M1.1/M1의 마지막 게이트는 이 문서 변경의 final SHA push/PR CI와 최종
branch review다. 이와 별도로 D2 hosted provider/TLS 및 지인 베타 전 전문
침투 테스트는 계속 production release blocker다.

### Short English counterpart

The string-provenance analyzer has been retired. The UI spec now receives only
the fixed `AuthUi` facade, guarded by a closed static grammar and a runtime
Transport Tripwire; the unchanged HTTP spec owns status, body, CSRF, logout,
and replay. Code SHA `61a0ea334761fc48394bae515edfeb440aed052a`
passed both exact-SHA security-gate runs. M1 remains open until the final
documentation SHA and branch reviews pass.
