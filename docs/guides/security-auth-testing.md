# 인증 보안 테스트 가이드

## Supabase 어댑터 역할 분리: 2026-09-10 R1

기준 `66a2319`, 기능 브랜치 `feature/auth-adapter-role-split`. 사용자 승인 범위는 인증 동작을 유지한 파일 분리이며 timeout·인증 정책·DB·UI 변경은 포함하지 않는다. [실행 계획](../superpowers/plans/2026-09-10-auth-adapter-role-split.md)

이번에는 기존 동작이 이미 구현돼 있으므로 GREEN(기존 테스트 통과) → 코드 이동 → GREEN(같은 동작 유지) 순서로 검사한다. 실패를 만들기 위해 정상 코드를 일부러 망가뜨리거나, 이동한 함수를 새로운 기능처럼 RED/GREEN으로 표시하지 않는다. 새 기능/결함 수정에는 기존 TDD 원칙을 그대로 적용한다.

- 변경 전: Node 22.15.1/pnpm 11.9.0, web **26파일·510개 테스트 통과**.
- 선택적 coverage 기준값: branches **733/799 = 91.73%**, 기존 100% threshold 미달로 명령 종료 코드 1. 이는 테스트 실패와 구분되는 기존 품질 격차다.
- 기록: `output/r1-baseline.log`, `output/r1-baseline-tests.json`, `output/r1-baseline-coverage/coverage-final.json`(Git 제외).
- 변경 후 최종 focused: 공개 어댑터/파서/오류/포트 4파일 **68/68 통과**, 웹 `tsc --noEmit` 종료 코드 0.
- 변경 후 최종 web/coverage: **28파일·510/510 통과**. branches **734/799 = 91.86%**, statements 760/809, functions 163/169, lines 631/645. coverage 명령은 여전히 100% threshold 미달로 종료 코드 1이다. 기준값보다 branch 비율이 높아졌지만 테스트를 추가한 결과가 아니므로 보안 향상으로 해석하지 않는다.
- 기존 어댑터의 24개 최상위 테스트 블록을 최종 TypeScript AST 프린터로 비교해 실행 구문이 모두 동일함을 확인했다. 확장된 64개 테스트 제목도 이동 전후 일치하며, 9개 연결 계약 + 34개 세션 검증 + 21개 오류 정책으로 나뉜다.
- 공개 생성자/10메서드 시그니처와 이동한 기존 함수 21개의 본문이 구문상 동일하다. 모든 제품 6모듈의 server-only 및 모듈 사이 runtime 순환 참조 없음도 확인했다.
- 최종 전체 `pnpm verify` 종료 코드0: **878 tests**(legacy54 + contracts66 + database15 + API148 + web510 + E2E preflight85), lint·6 workspace 타입 검사·API/웹 build 통과. 독립 리뷰 결과는 실행 계획에 기록한다. `output/r1-final-verify.log`, `output/r1-final-coverage.log`, `output/r1-final-tests.json`, `output/r1-final-coverage/coverage-final.json`은 Git 제외 로컬 증거다.

기본 SDK 팩토리의 실호출 등 기존 테스트가 실행하지 않던 경로와 나머지 인증/저장소의 미검증 분기는 남아 있다. 파일이 분리됐다고 이 격차가 사라진 것은 아니다. 다음 품질 작업에서는 실제 SDK 전송 경계와 누락 분기를 별도 테스트 계획으로 다룬다. 이번에는 측정 대상을 삭제하거나 threshold를 낮춰 통과시키지 않았다.

독립 task review와 최종 전체 review에서 Critical/Important는 없었다. 최종 리뷰의 Minor 1건은 fixture의 한계·입력/반환 주석이 축약된 부분이다. 한국어 JSDoc 11블록을 복원했고, 주석 제거 후 생성한 실행 코드가 동일하며 focused68/68이 다시 통과했다. 독립 재리뷰에서 해당 지적 해결과 새 결함 없음을 확인했다. 이는 실제 침투 테스트 통과나 보안 결함이 전혀 없다는 보증이 아니다.

주석 복원까지 포함한 인계 대상 전체 `pnpm verify`도878tests·lint·타입·API/웹build 종료코드0을 확인했다. 최종 인계 로그는 `output/r1-handoff-verify.log`다. coverage 수치는 실행 코드가 같은 주석 복원 직전 측정이며, 주석 복원 후 전체 테스트도 그대로 통과했다. R1의 커밋·새 CI·배포 증거는 아직 없다.

테스트의 읽기 순서는 다음과 같다.

1. `supabase-auth-adapter.test.ts`: 공개 메서드의 URL·HTTP 본문/헤더·SDK 생성 옵션·입력 거부와 성공 흐름.
2. `supabase/session-parser.test.ts`: 잘못된 JWT/사용자/만료값을 어댑터와 실제 이메일 서비스 경로에서 거부하고, 잘못된 응답에 앱 세션을 만들지 않는지 검사.
3. `supabase/error-mapper.test.ts`: 제공자 오류 비노출, HTTP 상태 우선, 계정 존재 여부 은폐.
4. `supabase/test-fixtures.ts`: 외부 네트워크 대신 정해진 SDK/HTTP 응답을 공급하는 준비물. JWT 모양 문자열은 실제 서명된 자격 증명이 아니다.

각 테스트의 이름과 단언을 이동 전후 대조한다. 같은 개수라는 사실만으로 의미 보존을 단정하지 않는다. 커버리지에는 새 제품 모듈 5개도 포함하며 fixture만 제외한다. 파일 분리와 함수 추출은 계측 분모를 바꿀 수 있으므로 퍼센트뿐 아니라 빠진 조건과 테스트 시나리오를 함께 본다.

로컬 모의 응답 검증은 실제 Google·Kakao·Naver 로그인, Supabase role/pooler/TLS, 폐기용 PostgreSQL 전체 인증 E2E 또는 침투 테스트의 대체물이 아니다. 이번 작업에서 해당 외부 환경 검증을 새로 수행했다고 표시하지 않는다.

## DB 유휴 연결 오류 경계: 2026-09-09

사용자 승인 A안으로 BFF의 Drizzle 풀과 API의 Nest DI 풀에 유휴 `error` 이벤트 수신을 추가했다. 기준 HEAD는 `afacc4c0f50cd6214bf7231065fa039240e6df9b`이며 검증 대상은 기존 리전 이전도 포함한 **미커밋 작업 트리**다. [상세 계획과 완료 상태](../superpowers/plans/2026-09-09-database-pool-error-boundary.md)

- Baseline: database 12/12, API controller/replay-store 23/23 통과.
- RED: 새 DB 테스트 3/3이 처리되지 않은 오류 이벤트로 실패했다. API는 테스트 생성자 대역의 비구성 가능 함수 오류를 먼저 수정한 후, 제품 누락에 의해 2개 실패·7개 통과를 확인했다. 대역 작성 오류는 제품 결함으로 계산하지 않는다.
- GREEN: database 전체 15/15, API controller/replay-store 24/24, 종료 코드 0. 실제 lazy pg.Pool을 사용하되 쿼리·connect를 호출하지 않고 이벤트를 발생시켰다. 실제 네트워크 단절 실험은 아니다.
- 검사 내용: 최초·반복·중첩 오류 수신, 풀별 독립 진단, 오류/client의 가짜 비밀값 비출력, console.error의 동기 실패 비전파, 기존 API 풀 설정·종료 1회 계약. 테스트 환경변수·spy·module/pool은 정리한다.
- 전체 `pnpm verify` 종료 코드 0: **878 tests**(legacy/security 54 + contracts 66 + database 15 + API 148 + web 510 + E2E preflight 85), lint·6 workspace 타입 검사·API/웹 build 통과. Node 22.15.1/pnpm 11.9.0 사용.
- 이번 작업의 DB 스키마·의존성·lockfile·UI 변경 없음. audit 재실행, 실제 DB 재시작/단절, 전체 DB-backed 인증 E2E, 브라우저/FCP, hosted OAuth, 새 CI·배포는 미실행이다. preflight는 실제 E2E의 대체 증거가 아니다.
- 원시 출력: Git 제외 `output/database-pool-error-verify.log`. 커밋·푸시·PR·병합은 수행하지 않았다.
- 독립 코드·최종 통합 리뷰에서 Critical·Important 없음. API 테스트 종료 자체가 reject할 경우 뒤의 spy/env 복구가 건너뛰어질 수 있다는 Minor 개선은 후속으로 남겼다. 연결 없는 lazy Pool 테스트에서 재현된 실패는 아니다.

진단은 `DB_POOL_IDLE_ERROR source=bff` 또는 `DB_POOL_IDLE_ERROR source=api`만 풀마다 최초 1회 출력한다. 장애 원문과 client 인수는 읽지 않으며, 반복 로그를 세지 않으므로 장애 횟수 측정 수단으로 사용할 수 없다. 쿼리 실패 차단은 유지하고 자동 재시도·DB 복구 성공을 보장하지 않는다.

## 리전 설정 이전: 2026-09-09

사용자 A안 승인 및 Vercel 프로젝트 미생성 확인 후 향후 Root Directory를 `apps/web`으로 정했다. `feature/vercel-region-policy`에서 단일 `iad1`을 `apps/web/vercel.json`으로 옮기며 Node/dynamic/10초 route 정책과 HTTP·인증 계약은 유지한다. [상세 실행 계획](../superpowers/plans/2026-09-09-vercel-region-policy.md)

이전 보안 업데이트 커밋 `afacc4c0f50cd6214bf7231065fa039240e6df9b`의 [security-gate](https://github.com/jawon0407/account-book/actions/runs/34307677601)는 성공했다. 이 결과는 해당 SHA의 폐기용 DB·인증 E2E·audit 증거이며 이번 미커밋 리전 변경의 CI 증거가 아니다. 아래 보안 업데이트 절에서 CI 확인을 남겨 둔 기록은 이 결과로 보충한다.

리전 이전의 로컬 검증 결과:

- RED: 새 JSON 설정 존재 검증 1개 실패, 기존 focused 테스트 15개 통과. 설정 추가 뒤에도 계획의 상대 경로 오류로 한 차례 실패했으며 실제 웹 루트를 가리키도록 정정했다. 이 중간 실패는 제품 결함으로 계산하지 않는다.
- GREEN: focused 16/16, `pnpm verify` 종료 코드 0. 전체 874 tests(54 + 66 + 12 + 147 + 510 + 85), lint·6 workspace 타입 검사·API/웹 build 통과. `preferredRegion` deprecated 경고 없음.
- 14 routes의 Node/dynamic/10초 정책과 기존 지원하지 않는 메서드의 405·no-store 응답 테스트를 유지했다. 신규 검사는 Vercel에 전달할 JSON 정책을 확인하며 hosted 실행을 모의하지 않는다.
- 패키지·DB·UI 변경 없음. 이번 작업의 브라우저 UI/FCP·DB/전체 인증 E2E·audit 재실행은 하지 않았다. 실제 Vercel 배치, 실제 공급자 OAuth 및 한국망 응답 시간은 아직 검증하지 않았다.
- 로컬 출력: Git 제외 `output/vercel-region-verify.log`. 새 변경의 커밋·푸시·CI·배포는 하지 않았다.

## 최신 보안 의존성 검증: 2026-09-09

이 절은 아래 과거 SHA별 기록보다 최신이다. 기준 `a36f719`에서 분기한 `hotfix/next-security-20260909`의 미커밋 작업 트리를 검사했다. 사용자 승인에 따라 Next 16.2.11 → 16.3.3, baseline-browser-mapping 2.10.43 → 2.11.0을 적용했다. 실제 운영 배포 증거는 아니다.

- 기존 보안 정책: sharp optional 의존성 제외, PostCSS 8.5.23 및 다른 override 유지. React/Nest/Fastify·인증/DB 로직·디자인은 변경하지 않았다.
- RED: 정책 테스트 수정 후 4개 중 2개 실패. 기존 Next 버전과 새 lock resolution 누락을 탐지했다. Next만 갱신한 중간 단계에는 baseline 취약 버전 잔존으로 1개가 실패했다.
- GREEN: scoped baseline override 적용 후 정책 테스트 4/4 통과. 실패 로그에는 신규 테스트가 잠금파일 전체 대신 고정 안내와 boolean 결과를 출력한다.
- 설치: Node 22.15.1/pnpm 11.9.0, `pnpm install --lockfile-only` 및 `pnpm install --frozen-lockfile` 종료 코드 0. 새 install script 허용은 추가하지 않았다.
- Next build는 추적 중인 `apps/web/next-env.d.ts`에 생성 타입 `root-params.d.ts` import 1줄을 추가했다. 자동 생성 변경으로 파일 지도에 추가했으며 수동 인증 로직 변경은 없다.
- `pnpm verify` 종료 코드 0: lint, 6 workspace 타입 검사, API/웹 production build, 테스트 873개(legacy/security 54 + contracts 66 + database unit 12 + API 147 + web 509 + E2E preflight 85).
- `pnpm audit --prod --json` 종료 코드 0: 알려진 취약점 0건. 업데이트 전 Critical 2·Moderate 1건과 구분한다. 개발 의존성 전체 audit이나 모든 보안 결함 부재를 뜻하지 않는다.
- `pnpm why`: Next 16.3.3, baseline-browser-mapping 2.11.0 확인. sharp 연결 없음.
- 독립 변경분 리뷰: 차단 결함·무관한 의존성 변경 없음. 정책 테스트의 peer-qualified snapshot 개별 검사 강화는 선택적 개선으로 남겼다. frozen-lockfile 설치와 전체 검증이 실제 일치 여부를 추가 확인했다.
- 공개 화면: 루프백 production 서버에서 5페이지/15개 화면 조합 HTTP 200, 가로 넘침 0·axe 위반 0·pageerror 0. 로그인 빈 입력 오류와 이메일 포커스, 공개 링크 이동 4회·콘솔 오류 0을 확인했다. UI 캡처에는 실제 계정·인증정보를 넣지 않았다.
- FCP: 데스크톱 Chromium 149 화면 폭별 7회. 390px 중앙값/p75 32/32ms, 1440px 52/56ms. 이전 p75 36/40ms와 단순 비교할 수 있으나 warm loopback·CPU/네트워크 무제한 소수 표본이므로 회귀/개선을 단정하지 않는다. 실제 한국망·모바일 측정은 아니다.
- 로컬 원시 결과: Git 제외 `output/playwright/next-security-20260909/browser-results.json` 및 같은 폴더 캡처. 이전 검사 소스를 재사용했고 별도 검사 의존성이나 테스트 파일은 추가하지 않았다.
- 폐기용 PostgreSQL 5432 listener가 없어 `test:db`, `prepare:e2e`, 전체 인증 E2E는 미실행. preflight 통과를 그 대체 증거로 사용하지 않는다. 후속 요청으로 커밋/푸시가 승인됐으며 동일 SHA CI 결과를 별도로 확인해야 한다.
- 전송 전 재검증: `pnpm verify` 및 `pnpm audit --prod --json`을 다시 실행해 종료 코드 0을 확인했다. 독립 전송 준비 리뷰에서 차단 결함은 발견되지 않았다. PR 생성·병합·배포와 리전 이전 구현은 이번 전송 승인에 포함하지 않는다.

### 업데이트에서 새로 확인한 배포 전 검토 항목

Next build가 `preferredRegion` route segment config deprecated 경고를 냈다. 공식 문서는 route export 제거를 안내하지만, 현재 `iad1` 지역 배치 정책의 대체 위치·실제 Vercel 동작을 검증하지 않았으므로 이번 작업에서 설정을 제거하지 않았다. 리전 설정 변경은 별도 계획·승인 후 수행하고, 이 경고와 hosted 검증 미완료 상태를 배포 전에 해소해야 한다. [공식 안내](https://nextjs.org/docs/messages/preferred-region-deprecated)

검증과 잔여 작업의 상세 순서는 [승인된 실행 계획](../superpowers/plans/2026-09-09-next-security-update.md)에 기록했다.

최종 인증·delegated-JWT 구현 SHA는 `93737d3c8278f92242670b403c30cb3beb05b0e2`다. 최종 evidence와 CI check는 `git rev-parse HEAD`의 동일 SHA여야 한다.

GitHub `security-gate` [run 15](https://github.com/jawon0407/account-book/actions/runs/30214338261)는 이 SHA에서 disposable PostgreSQL migration·privilege·replay 검증, Chromium 인증 E2E, pinned Node 22, 전체 verify와 production audit를 통과했다. 같은 tree의 로컬 `pnpm test`도 legacy 53, contracts 22, database 12, API 113, web 479, E2E preflight 2 tests로 종료 코드 `0`이었다.

## RED/GREEN

```powershell
pnpm --filter @account-book/e2e test
node --test scripts/security/workflow-policy.test.mjs
```

- Workflow RED: exit 1, 15 tests 중 12 pass/3 fail. PostgreSQL service, gate order, disposable DB/E2E env가 없어 실패했다.
- Browser RED: 두 viewport의 responsive/label/keyboard/axe cases는 실행됐고, 최초 HTTP harness에서 hardened Secure cookie가 mutation에 전달되지 않아 auth cases가 403이었다. Harness는 HTTPS로 교정했다. Local PostgreSQL 부재로 DB-backed GREEN은 실행하지 않았다.

Focused GREEN: workflow policy exit 0 (15/15), web exit 0 (24 files, 435/435), E2E TypeScript exit 0. 동일 Node 22 계열의 `@types/node@22.20.1`로 외부 선언 충돌을 해결했고, 새 `skipLibCheck`나 compiler strictness 완화 없이 기존 API 예외도 제거했다.

Task 14의 첫 clean-checkout CI는 공유 package의 `dist`가 만들어지기 전에 API typecheck가 실행되는 로컬 산출물 의존성을 발견했다. 루트 `typecheck`가 contracts/database를 먼저 빌드하도록 정책 테스트와 script 순서를 함께 고정했다. 다음 CI는 실제 Chromium `fetch()`가 보내는 표준 `Sec-Fetch-Dest: empty`를 CSRF 경계가 거부하는 문제를 발견했다. [W3C Fetch Metadata](https://www.w3.org/TR/fetch-metadata/#sec-fetch-dest-header)는 빈 Fetch destination을 `empty` token으로 전송하도록 정의하므로, exact Origin·`same-origin` Site·허용 Mode·CSRF token 검사를 유지하면서 destination `empty`만 추가로 허용하고 회귀 테스트를 남겼다.

E2E는 오류 feedback의 실제 접근성 role인 `alert`를 검사한다. Next 개발 서버가 자체 `__next_debug_channel:` 항목을 session storage에 둘 수 있으므로, 이 exact framework prefix 외의 session key와 모든 local-storage 항목을 거부하고 전체 key/value에서 provider sentinel, access/refresh token 이름, JWT 형태가 없는지 검사한다. Task 14 RED 당시에는 로그인 성공 직후 `/app` 이동과 응답 본문 읽기의 경합을 피하려고 Playwright response event에서 본문을 즉시 복사했지만, 이는 역사적 실패 맥락이며 현재 UI 계약이 아니다. [Task 14 기록](#task-14-인증-e2e-경계-검증-근거)의 UI status 소유도 역사적 결정이며, [현재 M1.1 경계](#m11-ui-response-non-observation-evidence)는 UI에서 visible/browser state만, HTTP 프로젝트에서 status·body·logout·selector replay만 검증한다.

Next.js 16.2.11이 선택적으로 설치하던 `sharp@0.34.5`는 현재 앱에서 `next/image`를 사용하지 않으므로 pnpm override로 제거했다. GHSA-f88m-g3jw-g9cj의 high-severity 경로를 없앤 뒤 웹 프로덕션 빌드와 `pnpm audit --prod --audit-level high`를 다시 통과시켰다. 추후 이미지 최적화를 도입할 때는 패치된 `sharp`와 Next.js의 호환성을 별도 검토해야 한다.

GitHub `security-gate` run 30211236719는 PostCSS 파일 읽기·경로 순회 2건과 `find-my-way` HTTP/2 DoS 1건의 high advisory 때문에 실패했다. `next@16.2.11>postcss`는 `8.5.19`, `find-my-way@9.6.0`은 같은 메이저의 공개 패치 버전 `9.7.0`으로 고정했다. 잠금파일 재생성 후 취약 resolution이 제거됐고, 전체 테스트·Next.js 프로덕션 빌드와 `pnpm audit --prod --audit-level high` exit 0으로 호환성과 advisory 제거를 확인했다.

최종 순서:

```powershell
pnpm setup:hooks
$env:CI='true'; pnpm run verify
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/account_book_test'
$env:TEST_DATABASE_DISPOSABLE='true'
pnpm test:db
pnpm --filter @account-book/database-tests prepare:e2e
pnpm --filter @account-book/e2e test
pnpm audit --prod --audit-level high
git diff --check
git status --short --branch
```

DB/E2E는 환경 변수가 없으면 skip하지 않고 실패한다. `prepare:e2e`는 위의 정확한 disposable flag와 `127.0.0.1/account_book_test` 관리자 URL만 허용하고, `current_user=postgres`와 DB 이름을 확인한 뒤 인증 schema/role을 정리하고 migration 001→002→003을 적용한다. Local DB/browser 부재의 대체 evidence는 같은 commit SHA의 GitHub `security-gate` 성공뿐이다. Dependency audit exit 0이 필수이며 registry/network 실패는 출시 승인으로 바꾸지 않는다. Log에는 token, cookie, credential, connection string을 출력하지 않는다.

현재 `test:e2e-preflight`는 DB나 브라우저 없이 production fake-adapter 시작 차단, Playwright child-process 환경의 case-insensitive secret sanitization, 세 프로젝트 config/trace 정책, UI import graph의 response-body ownership, HTTP body 계약의 boolean-safe leak/shape 정책을 함께 검사한다. 루트 `pnpm run verify`가 이 preflight를 실행하고, `@account-book/e2e`의 전체 `test`도 Playwright보다 먼저 같은 preflight를 실행한다. workspace policy test는 두 script 연결을 고정하므로 로컬 검증 또는 GitHub security gate에서 config·sanitization·response-policy 회귀 테스트가 조용히 빠질 수 없다.

Task 14 이전의 단일 브라우저 성공 테스트는 응답·storage·cookie leak 검사와 selector replay를 한 흐름에서 수행했다. 현재 M1.1 UI 프로젝트는 `__Host-ab_session`의 공개 metadata·opaque 형식, token-free storage와 browser Authorization 부재만 확인하고 HTTP status는 읽지 않는다. HTTP 프로젝트가 `/api/me` status·response body·CSRF·logout과 이전 selector 재전송 401을 소유하므로 브라우저 cookie 삭제뿐 아니라 서버의 DB session 폐기도 검증한다. Production fake adapter는 `pnpm start`의 사전 guard와 Next config의 이중 방어로 readiness 전에 고정 오류와 함께 종료되며, 별도 process test가 이를 확인한다.

## Hosted OAuth checklist

실제 provider credential이 없는 현재 상태는 모두 `미실행—운영 출시 차단`이다.

| Provider | 정상 | 취소 | bad state | callback 재사용 | email 누락 | history/network/storage/server-log 누출 |
|---|---|---|---|---|---|---|
| Google | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 |
| Kakao | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 |
| `custom:naver` | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 | 미실행—운영 출시 차단 |

각 provider에서 exact callback, fixed cancellation error, state mismatch/replay 거부, missing-email 비연결, browser/server 누출 부재를 hosted HTTPS에서 확인한다.

## English summary

Run RED, focused GREEN, then the full ordered gate. Database and browser E2E never skip silently. Only same-commit CI can replace unavailable local PostgreSQL evidence. Live Google, Kakao, and custom Naver OAuth remain release blockers until every path is exercised without credential leakage.

## TASK 14 인증 E2E 경계 검증 근거

- RED: commit `835dbc9`, GitHub Actions [run 29970158952](https://github.com/jawon0407/account-book/actions/runs/29970158952)에서 확인했다. 로그인 뒤 navigation과 응답 본문 읽기 사이의 경합, 그리고 너무 넓은 alert 선택자의 충돌이 원인이었다. 민감한 응답 원문은 기록하지 않는다.
- GREEN: 최종 검증 코드 SHA는 `0d996fe726debaa8a2eec10865f63418635d06d8`이다. 같은 SHA의 [push run](https://github.com/jawon0407/account-book/actions/runs/30252139895)과 [PR run](https://github.com/jawon0407/account-book/actions/runs/30252146533)은 모두 성공했다.
- 로컬(Node 24)에서는 `pnpm test`가 legacy/security 53개, contracts 22개, database package 12개, API 113개, web 479개, E2E preflight 2개를 통과했다. 이 로컬 실행에서는 PostgreSQL-backed Playwright를 실행하지 않았으며, 같은 SHA의 Node 22 CI가 disposable PostgreSQL DB 22개, browser-stage Node 정책·preflight 7개, Playwright HTTP·UI 8개 통과(단일 worker)로 그 공백을 보완했다.
- 당시 책임 분리: UI 프로젝트는 trace를 끄고 실제 화면에서 보이는 browser state와 status를, HTTP 프로젝트는 공개 응답 계약·CSRF·로그아웃·selector 재사용 차단을 확인했다. 이 역사적 TypeScript provenance 정책은 아래 M1.1 폐쇄형 capability 경계로 대체되었다.
- D2: hosted staging 또는 live Google·Kakao·Naver, 실제 TLS에 대한 증거는 아직 미실행이다. 이는 자동 테스트 성공과 별개의 운영 출시 차단 조건이며, 운영용 fake adapter는 계속 금지한다.

### Short English counterpart

The final code SHA is `0d996fe726debaa8a2eec10865f63418635d06d8`; both same-SHA push and PR Node 22 CI runs passed. Local Node 24 covered the unit and preflight suites, while same-SHA CI covered disposable PostgreSQL and one-worker Playwright. Hosted staging/live provider and TLS evidence remains an unreleased D2 blocker.

## M1.1 UI response non-observation evidence

- 최종 리뷰는 `1586ee5`가 `Pick<Response, "text">`와 매개변수·대입 구조 분해를 막지 못한 것을 확인했다. 승인된 대체 설계는 `3047b08`, 계획 commit은 `0a25ecf`, Task 1 commit은 `bc93404`, `64dd01c`, `8145645`다.
- `da0b0f1c2712d56dca8ce231b48a16637e1ac809`와 같은 SHA의 [push run 30278565453](https://github.com/jawon0407/account-book/actions/runs/30278565453)·[PR run 30278569950](https://github.com/jawon0407/account-book/actions/runs/30278569950)은 당시 성공했지만 **중간 증거이며 현재 완료 증거가 아니다**. 후속 최종 리뷰에서 승인 package import alias가 `request as expect`를 허용하고, authorization recorder가 원문 header를 반환·대입할 수 있으며, `waitForRequest`·`route`·`route.fetch`와 별칭·computed member가 경계를 우회하는 Critical 결함을 확인했기 때문이다.
- 이전 폐쇄형 allowlist 구현 SHA는 `d1a71a24a5b24d5330d525c77d5eabe97f034a2a`다. 정확히 이 SHA의 Node 22/PostgreSQL/Chromium `security-gate` [push run 30326538341](https://github.com/jawon0407/account-book/actions/runs/30326538341)과 [PR run 30326540058](https://github.com/jawon0407/account-book/actions/runs/30326540058)은 모두 `completed/success`였다. 이 gate가 disposable PostgreSQL, 단일 worker Chromium E2E와 production audit를 포함하는 권위 있는 CI 증거다.
- 이 구현 정책은 외부 import를 exported name과 local name이 같은 승인 named import로만 제한한다. `Page`·`BrowserContext`·`Request`·`Route`·`APIRequestContext`·`Locator` 각각에 폐쇄형 capability allowlist를 적용하며, 선언·대입·구조 분해 별칭, pass/return, fixture·factory, optional/computed member, `.call/.apply/.bind`, `fetch`·`XMLHttpRequest`·`Request`·`Response` factory를 fail-closed 한다. trusted consumer의 shadow/local alias도 허용하지 않는다.
- 승인된 request recorder는 정확한 `page.on("request", authorizationRecorder)`와 header lookup 직후의 strict `value === null` 또는 `value !== null` boolean 축약만 허용한다. 원문 반환, 문자열 연결, object wrapper, 대입, async·annotation 변형은 모두 거부하고 진단에는 고정 category/capability만 남긴다.
- Local Node 24.14.0에서는 기존 fail-closed fixture를 약화하지 않은 채 RED focused 35개 중 17개 실패와 별도 Locator mutation 1/1 실패를 먼저 확인했다. GREEN은 focused 44/44, E2E preflight 46/46, typecheck와 lint를 통과했고 전체 `pnpm test`는 legacy/security 53, contracts 22, database package 12, API 113, web 479를 통과했다. 이 로컬 Node 버전은 repository Node 22.15.1 범위 밖이므로 당시 해당 code SHA의 exact-SHA CI가 권위 있는 증거였다.
- 문서 SHA `57c3776fe2adbdb6e630fef2e326314f14b2970b` 뒤의 scoped re-review는 `const response = await globalThis[key](...)`가 capability 획득과 응답 관찰을 모두 우회하는 Critical 결함을 확인해 당시의 M1.1 완료 판단을 차단 verdict로 대체했다. 새로 승인된 bounded computed-global fix cycle은 이 한 결함만 다뤘다.
- 새 code SHA `5cda5422e114f872ceb031f34180f9f346cb3088`은 `globalThis`·Node `global`·`window`·`self` 및 선언·대입으로 보존한 root alias의 nonliteral computed member를 고정 `network/unapproved-browser-capability`로 획득 전에 거부한다. optional invocation, `.call/.apply/.bind`, 동적으로 선택한 `fetch`·`XMLHttpRequest`·`Request`·`Response`도 같은 규칙을 받으며 기존 정적 allowlist는 변경하지 않는다.
- 이 cycle의 RED/GREEN은 exact bypass 39/40→40/40, alternate roots 0/3→3/3, alias·adapter·factory 43/51→51/51이었다. Repository Node 22.15.1의 최종 focused 51/51, E2E subset 57/57, typecheck·lint·diff check와 전체 53/22/12/113/479가 통과했다. 로컬 full preflight의 package-spawn 1건은 untracked `node_modules`의 `.modules.yaml` 부재로 fallback `pnpm`이 install retry에 들어가 확인하지 못했지만, 동일 production/fake startup guard는 직접 실행에서 고정 `AUTH_CONFIGURATION_INVALID`로 즉시 실패했다.
- 정확히 `5cda5422e114f872ceb031f34180f9f346cb3088`의 `security-gate` [push run 30330701053](https://github.com/jawon0407/account-book/actions/runs/30330701053)과 [PR run 30330704817](https://github.com/jawon0407/account-book/actions/runs/30330704817)은 모두 `completed/success`였다. 이는 `57c3776` 차단 finding을 **구현 증거 수준에서만** 대체한다. 독립 scoped re-review와 이 문서 변경의 최종 SHA push/PR gate가 끝나기 전에는 M1.1/M1 완료를 주장하지 않으며 M2를 시작하지 않는다.
- 현재 책임: UI는 visible screen, 접근성, keyboard, URL, cookie metadata/opaque boolean, token-free storage, Authorization-presence boolean만 검사한다. HTTP는 status/body, CSRF, logout/replay, raw/nested credential scan만 검사한다. 정책은 canonical UI root, closed capability allowlist, fixed capability diagnostics, trace off를 사용한다.
- Hosted D2 provider/TLS 증거와 beta-before penetration test는 계속 독립 release blocker다.

## Safe Auth UI Facade 최종 코드 근거

현재 경계는 문자열 provenance 분석기가 아니라 `authTest`가 전달하는 고정
`AuthUi` facade, 폐쇄형 UI 문법 Gate, callback 실행 중의 Transport Tripwire로
구성된다. `auth-ui-driver.ts`만 raw Playwright와 Axe를 소유하며 cookie,
storage, request header와 접근성 결과를 boolean 또는 고정 판정으로 즉시
축약한다. UI spec은 응답 객체·status·body·CSRF·logout·selector replay를
받지 않으며, 이 HTTP 계약은 변경되지 않은 `auth-response.spec.ts`가 계속
독점한다. UI project의 screenshot, video, trace는 모두 정확히 `off`다.

TDD와 검토 기록은 다음 순서로 누적됐다.

- 정적 Gate는 callback/import/직접 호출 mutation을 RED로 확인한 뒤
  19/19 GREEN이 됐다.
- 고정 안전 오류와 Tripwire는 safe-error 6건, Tripwire 10건,
  subclass/newTarget 2건과 상태기계 guard 4건의 RED를 거쳐 combined
  36/36 GREEN이 됐다.
- facade driver와 실제 UI spec은 필수 RED 4종 및 비동기 race RED 4종을
  거쳐 focused 35/35 GREEN이 됐다. artifact 정책도
  screenshot/video/trace가 `off`가 아닐 때 RED가 되고 1/1 GREEN이 됐다.
- legacy analyzer 제거 전 parity 129/129를 확인했고, 최종 shadow/semantic
  mutation은 targeted 6/6, Gate 29/29, 전체 preflight 85/85로 통과했다.

`d1a71a2`, `5cda542`, `5729d98`, `ef0d1bc`는 문자열 provenance/allowlist
계열을 강화했던 **역사적 중간 증거**이며 현재 완료 근거가 아니다.
`24b4dd14576b5901618aa7d22af0e0d4c3e38483`도 로컬 targeted 6/6,
Gate 29/29, preflight 85/85를 통과한 중간 SHA지만 첫 exact-SHA CI에서
workspace policy가 제거된 `ui-network-boundary.test.ts`를 계속 기대해
실패했다. 정책 테스트 RED 2/3→GREEN 3/3으로 해당 정합성을 고친 최종 코드
SHA는 `61a0ea334761fc48394bae515edfeb440aed052a`다.

이 SHA의 GitHub `security-gate` [push run
30460467954](https://github.com/jawon0407/account-book/actions/runs/30460467954)와
[pull request run
30460473476](https://github.com/jawon0407/account-book/actions/runs/30460473476)은
모두 `completed/success`다. 두 실행은 legacy/security 53, contracts 22,
database package 12, API 113, web 479, E2E preflight 85, disposable DB
test 2 files, 단일 worker Playwright 8을 통과했고 production audit는
`No known vulnerabilities found`, commit-range 검사는 346 changed blobs
통과를 기록했다.

로컬에서는 정책 3/3, legacy/security 53/53, security Gate 47/47과
Safe Auth 관련 E2E 84개가 통과했다. 다만 Codex의 Node 24 런타임에서
`node_modules/.bin` 실행 wrapper가 누락돼 production startup process
test 1건은 동일한 방식으로 완료하지 못했다. 이를 성공으로 추정하지 않고,
repository-pinned Node 22.15.1의 위 두 exact-SHA CI가 preflight 85/85와
실제 PostgreSQL/Chromium 8/8을 완료한 결과를 권위 있는 근거로 사용한다.

Task 1~4의 독립 보안·프론트엔드·백엔드·프로젝트 리드 리뷰는 최종적으로
Critical/Important 0건이었다. 다만 M1.1과 M1은 이 문서 변경의 최종 SHA가
push/PR gate를 모두 통과하고 최종 branch review가 승인되기 전까지 닫지
않는다. 그 뒤에도 D2 hosted provider/TLS와 지인 베타 전 전문 침투 테스트는
별도의 production release blocker로 남는다.

### Short English counterpart

The authoritative code SHA is
`61a0ea334761fc48394bae515edfeb440aed052a`. Its push run
`30460467954` and pull-request run `30460473476` both completed successfully
with the full Node 22, disposable PostgreSQL, Chromium, audit, and secret-scan
gate. The UI now receives only the fixed `AuthUi` facade; the unchanged HTTP
spec owns status, body, CSRF, logout, and replay. M1 remains open until the
final documentation SHA and independent branch reviews pass, while hosted
provider/TLS evidence and a pre-beta penetration test remain separate release
blockers.

## Task 7 delegated JWT 로컬 증거

로컬 증거의 code commit은 `357f8412dcb19b004a0a0e45f08449682fc23f75`이며, 이 작업 트리에서 BFF route 정책, E2E key 분리와 production dependency remediation을 검증했다. 모든 browser-facing BFF route는 Node.js runtime, `iad1`, `force-dynamic`, 10초 `maxDuration`을 명시한다. route는 여전히 thin adapter이고 Edge runtime, 직접 환경변수·DB·provider 접근을 포함하지 않는다.

Playwright config 프로세스는 실행마다 P-256 key pair를 메모리에서 만들고 종료 시 함께 소멸한다. BFF에는 private PKCS8 DER base64url과 key ID만, API에는 static public SPKI DER base64url keyring·accepted key-ID allowlist·독립 `BFF_AUTH_DISABLED=false`만 전달한다. API로 private key를 전달하거나 BFF에 public keyring을 전달하지 않으며, 이전 API-IDP JWT 설정은 이 경로에서 제거했다.

E2E actual IDP/API/BFF environment builder는 inherited OS/toolchain 변수만 유지하고, Windows casing까지 정규화해 `API_`, `AUTH_`, `BFF_`, `SUPABASE_`, `DATABASE_URL`·`*_DATABASE_URL`, `TEST_DATABASE_`, `MIGRATION_DATABASE_`, `APP_ORIGIN`을 먼저 삭제한 뒤 각 process의 explicit allowlist만 추가한다. 따라서 API는 BFF private/key-ID나 session·cookie·CSRF secret을, BFF는 API database/public-keyring/accepted-key/kill-switch 값을 상속하지 않는다.

브라우저 E2E의 계약은 opaque `__Host-ab_session` cookie 하나, browser Authorization header 부재, BFF를 통한 `/api/me` 200, logout 뒤 selector replay 401, local/session storage credential 부재다. 내부 delegated JWT, `jti`, request-binding hash, selector, key material, DB 연결 문자열은 assertion 출력·trace·report에 남기지 않는다. delegated JWT의 one-time replay는 browser가 token을 추출하지 않고 API 통합 및 DB test에서 별도로 증명한다.

관측된 명령 결과는 다음과 같다.

```powershell
pnpm --filter @account-book/web test -- route-wiring.test.ts # RED: 14 route policy failures
pnpm --filter @account-book/web test -- route-wiring.test.ts # GREEN: 25 files, 479 tests passed
pnpm --filter @account-book/e2e typecheck                 # exit 0
pnpm run verify                                            # exit 0; legacy 53, contracts 22, database 12, API 113, web 479 tests passed
```

로컬 PostgreSQL listener가 없어 개발 PC에서는 `pnpm test:db`, guarded `prepare:e2e`, Playwright browser journey를 실행하지 않았다. Chromium cache가 있어도 DB guard를 약화하지 않았다. 이 로컬 공백은 같은 SHA의 GitHub run 15가 disposable PostgreSQL과 Chromium으로 대체했다. `pnpm audit --prod --audit-level high`는 exit 0이며 알려진 production dependency 취약점이 없었다. Hosted Supabase의 실제 role·pooler·`cron.job`, Google·Kakao·Naver provider, key rotation overlap/removal, kill-switch, backup·restore는 disposable CI가 대신할 수 없는 출시 차단 증거로 남아 있다.

## M2 delegated mutation 경계: 로컬 RED/GREEN 증거

이 절은 2026-08-05 작업 트리에서 확인한 로컬 구현 증거다. hosted Heroku/Vercel secret 주입, 실제 public-key rotation, 운영 replay store·rate-limit 관측은 실행하지 않았으므로 완료나 출시 승인으로 해석하지 않는다. 담당자는 Platform owner(공개 키·secret 배치와 rotation)와 Security owner(BFF 침해 대응 훈련)이며, 기한은 **최초 hosted delegated mutation release 전**이다. 재검토 조건은 Vercel/Heroku secret·keyset 배치 또는 BFF delegation scope 변경이고, 변경 rollout 전에 다시 검토한다.

| 단계 | RED | GREEN과 커밋 |
| --- | --- | --- |
| shared contract | `pnpm --filter @account-book/contracts test -- internal-api.test.ts`: 2 tests failed (`DELEGATED_JSON_BODY_MAX_BYTES` 부재와 필요한 scope 거부). | 같은 명령과 `pnpm --filter @account-book/contracts typecheck`: 3 files/24 tests passed, typecheck 0. `22b5163f7f641210cca38be9ff734c99d996211b` |
| Fastify raw JSON | `pnpm --filter @account-book/api test -- raw-json-body.test.ts`: `raw-json-body.js` 부재로 새 suite가 실패했고 기존 API 113 tests passed. lifecycle/form parser RED도 각각 기존 parser 충돌과 415를 재현했다. | focused final: 8 files/118 tests passed, typecheck·`git diff --check` 0. `5e122c618f584078c0a59145308a76dd367ef2af`, `e81d1179089e21b2eb36b6c27c294276d37d789a`, `15baaf2b376fb7a1ee745f4109e32fe6e6eb8d46` |
| API framing | `pnpm --filter @account-book/api test -- auth.guard.test.ts`: POST/PATCH/DELETE exact-body cases 3건이 기존 GET-only guard 때문에 실패, 나머지 125 tests passed. | guard·JWT verifier focused commands: 8 files/128 tests passed; API typecheck·diff check 0. `a6d62f6c24aacc78681c6718367bd24e1ce96d9f` |
| BFF client | `pnpm --filter @account-book/web test -- delegated-api-client.test.ts`: module 부재로 exit 1. URL hardening round RED는 25 passed/3 failed였다. Task 7 signer-await mutation RED는 505/508 통과·3 실패로 caller-owned body가 바뀔 수 있음을 재현했다. | 기존 final focused 28/28, 관련 3 files/97/97, web typecheck·diff checks 0. Task 7 clone-on-entry 뒤 동일 명령은 web 26 files/508 tests를 모두 통과했다. 기존 구현 커밋은 `9fd29e1`, `a91f0b3`이며 Task 7 검증 commit은 Task 7 report에 기록한다. |
| 실제 Nest/Fastify matrix | `pnpm --filter @account-book/api test -- mutation-boundary.integration.test.ts`: default POST 201과 required 200 불일치로 새 matrix 8개가 실패, 기존 134 tests passed. oversized-filter RED는 13/14, filter RED는 6/7이었다. | matrix focused 14/14, filter+matrix 23/23, API 전체 9 files/147 tests, lint·typecheck·diff check 모두 0. `4fbdcbb`, `5c3461f` |

matrix는 BFF signer와 API verifier의 real classes, deterministic P-256 key/clock, atomic 의미의 in-memory replay store를 사용했다. exact body만 통과하고 JSON으로 유효한 한 byte 변경·target query mismatch·read scope·재사용 `jti`는 거부한다. 32 KiB보다 1 byte 큰 body는 verifier 전에 413이며, replay store error는 503으로 fail closed한다. raw duplicate header는 loopback HTTP/1.1 raw header pair로 보냈다. JWT·원문 body·internal replay detail은 response와 captured log에 없는지 검사했다.

운영 로그는 `requestId`와 `jti`를 구조화 필드로만 남기고 JWT·원문 body·body digest의 원문 복원 재료를 넣지 않는다. BFF private signing key `BFF_JWT_PRIVATE_KEY`는 Vercel의 server-only secret에만 두고, API의 public-key set은 Heroku secret에만 둔다. API는 current public key와 직전 public key만 검증하는 제한된 overlap을 사용하며, overlap 종료 후 이전 `kid` 제거·거부를 rotation drill로 검증한다. replay store를 읽거나 쓰지 못하면 요청을 허용하지 않는다.

rate limit은 browser IP만을 principal로 쓰지 않는다. 인증 principal + route를 기본 key로 하고, 신뢰 가능한 platform-provided IP는 보조 신호로만 사용한다. 이 persistent rate-limit use case는 아직 구현되지 않았다. 담당자는 API owner이고, 기한은 **최초 hosted delegated mutation release 전** abuse test와 운영 관측을 추가하는 것이다. 재검토 조건은 rate-limit backend, route/scope, 또는 trusted platform IP 의미 변경이며 배포 전에 다시 검토한다. BFF 침해 시에도 이미 허용된 scope로 30초 이내 요청이 가능하다는 잔여 위험은 least-privilege scope, one-time replay, key rotation/kill switch, 이 rate-limit 설계로 줄일 뿐 제거하지 못한다.

Fastify body-too-large 413 복구 allowlist는 Fastify `5.10.0`의 고정 message와 Nest `11.1.28` wrapper 동작에 결합돼 있다. 담당자는 API owner이며, 두 dependency 중 하나를 업그레이드하거나 parser/filter 동작을 바꾸기 **전** matrix의 oversized 413·forged 413 fail-closed regression을 다시 실행하고 allowlist를 재검토해야 한다. 이 조건이 충족되기 전 dependency upgrade를 배포하지 않는다.
