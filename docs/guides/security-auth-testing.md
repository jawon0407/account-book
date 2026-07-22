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

Next.js 16.2.10이 선택적으로 설치하던 `sharp@0.34.5`는 현재 앱에서 `next/image`를 사용하지 않으므로 pnpm override로 제거했다. GHSA-f88m-g3jw-g9cj의 high-severity 경로를 없앤 뒤 웹 프로덕션 빌드와 `pnpm audit --prod --audit-level high`를 다시 통과시켰다. 추후 이미지 최적화를 도입할 때는 패치된 `sharp`와 Next.js의 호환성을 별도 검토해야 한다.

감사에는 Next.js가 정확히 고정한 `postcss@8.4.31` 경로의 moderate GHSA-qx2v-qp2m-jg93 한 건이 남는다. 이 취약점은 신뢰할 수 없는 CSS를 파싱·문자열화해 HTML `<style>`에 넣을 때 문제가 되며 현재 앱에는 해당 입력 경로가 없다. 다만 Next.js 선언 범위를 벗어난 강제 override는 호환성 검증 없이 적용하지 않고, 패치된 PostCSS를 허용하는 Next.js 릴리스로 갱신하거나 별도 호환성 테스트를 통과할 때까지 출시 위험 검토 항목으로 유지한다.

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
