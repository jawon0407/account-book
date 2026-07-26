# 인증 보안 테스트 가이드

Task 13 base SHA는 `10a8493`이다. 최종 evidence와 CI check는 `git rev-parse HEAD`의 동일 SHA여야 한다.

## RED/GREEN

```powershell
pnpm --filter @account-book/e2e test
node --test scripts/security/workflow-policy.test.mjs
```

- Workflow RED: exit 1, 15 tests 중 12 pass/3 fail. PostgreSQL service, gate order, disposable DB/E2E env가 없어 실패했다.
- Browser RED: 두 viewport의 responsive/label/keyboard/axe cases는 실행됐고, 최초 HTTP harness에서 hardened Secure cookie가 mutation에 전달되지 않아 auth cases가 403이었다. Harness는 HTTPS로 교정했다. Local PostgreSQL 부재로 DB-backed GREEN은 실행하지 않았다.

Focused GREEN: workflow policy exit 0 (15/15), web exit 0 (24 files, 435/435), E2E TypeScript exit 0. 동일 Node 22 계열의 `@types/node@22.20.1`로 외부 선언 충돌을 해결했고, 새 `skipLibCheck`나 compiler strictness 완화 없이 기존 API 예외도 제거했다.

Task 14의 첫 clean-checkout CI는 공유 package의 `dist`가 만들어지기 전에 API typecheck가 실행되는 로컬 산출물 의존성을 발견했다. 루트 `typecheck`가 contracts/database를 먼저 빌드하도록 정책 테스트와 script 순서를 함께 고정했다. 다음 CI는 실제 Chromium `fetch()`가 보내는 표준 `Sec-Fetch-Dest: empty`를 CSRF 경계가 거부하는 문제를 발견했다. [W3C Fetch Metadata](https://www.w3.org/TR/fetch-metadata/#sec-fetch-dest-header)는 빈 Fetch destination을 `empty` token으로 전송하도록 정의하므로, exact Origin·`same-origin` Site·허용 Mode·CSRF token 검사를 유지하면서 destination `empty`만 추가로 허용하고 회귀 테스트를 남겼다.

E2E는 오류 feedback의 실제 접근성 role인 `alert`를 검사한다. Next 개발 서버가 자체 `__next_debug_channel:` 항목을 session storage에 둘 수 있으므로, 이 exact framework prefix 외의 session key와 모든 local-storage 항목을 거부하고 전체 key/value에서 provider sentinel, access/refresh token 이름, JWT 형태가 없는지 검사한다. 로그인 성공 직후 `/app` 이동과 응답 본문 읽기의 경합을 피하기 위해 Playwright response event에서 본문을 즉시 복사하되 브라우저 storage에는 저장하지 않는다.

Next.js 16.2.11이 선택적으로 설치하던 `sharp@0.34.5`는 현재 앱에서 `next/image`를 사용하지 않으므로 pnpm override로 제거했다. GHSA-f88m-g3jw-g9cj의 high-severity 경로를 없앤 뒤 웹 프로덕션 빌드와 `pnpm audit --prod --audit-level high`를 다시 통과시켰다. 추후 이미지 최적화를 도입할 때는 패치된 `sharp`와 Next.js의 호환성을 별도 검토해야 한다.

GitHub `security-gate` run 30211236719는 PostCSS 파일 읽기·경로 순회 2건과 `find-my-way` HTTP/2 DoS 1건의 high advisory 때문에 실패했다. `next@16.2.11>postcss`는 `8.5.19`, `find-my-way@9.6.0`은 같은 메이저의 공개 패치 버전 `9.7.0`으로 고정했다. 잠금파일 재생성 후 취약 resolution이 제거됐고, 전체 테스트·Next.js 프로덕션 빌드와 `pnpm audit --prod --audit-level high` exit 0으로 호환성과 advisory 제거를 확인했다.

최종 순서:

```powershell
pnpm setup:hooks
$env:CI='true'; pnpm run verify
pnpm test:e2e-preflight
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

`test:e2e-preflight`는 DB나 브라우저 없이 production fake-adapter 시작 차단과 Playwright child-process 환경의 case-insensitive secret sanitization을 함께 검사한다. 루트 `pnpm run verify`가 이 preflight를 실행하고, `@account-book/e2e`의 전체 `test`도 Playwright보다 먼저 같은 preflight를 실행한다. workspace policy test는 두 script 연결을 고정하므로 로컬 검증 또는 GitHub security gate에서 sanitization 회귀 테스트가 조용히 빠질 수 없다.

브라우저 성공 테스트는 test IDP의 고정 refresh-token sentinel이 응답·storage·모든 cookie에 없음을 확인하고, cookie는 `__Host-ab_session` 하나만 허용한다. 로그아웃 전 selector를 별도 HTTP context에서 재전송해 401을 확인하므로 브라우저 cookie 삭제만이 아니라 서버의 DB session 폐기도 검증한다. Production fake adapter는 `pnpm start`의 사전 guard와 Next config의 이중 방어로 readiness 전에 고정 오류와 함께 종료되며, 별도 process test가 이를 확인한다.

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

로컬 PostgreSQL listener가 없어 `pnpm test:db`, guarded `prepare:e2e`, 그리고 Playwright browser journey는 실행하지 않았다. Chromium cache는 있었지만 DB guard를 약화하지 않았다. `pnpm audit --prod --audit-level high`는 exit 0이며 알려진 production dependency 취약점이 없었다. 로컬 Node는 24이고 pinned Node 22.15.1 증거는 아직 없다. 패치 후 같은 SHA의 GitHub security gate 성공 URL, live disposable PostgreSQL migration/catalog/privilege/replay, Supabase `cron.job` cleanup, key rotation overlap/removal, kill-switch drill은 출시 차단 증거로 남아 있다.
