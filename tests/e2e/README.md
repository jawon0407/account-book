# End-to-End Tests

Browser-level desktop, tablet, mobile, authentication, authorization, offline sync, accessibility, and security smoke scenarios belong here. Tests use synthetic accounts and isolated data.

## 안전한 인증 UI 확장 규칙

- 인증 UI spec은 canonical `tests/e2e/support/safe-ui-test.ts`가 소유하는
  `import { authTest } from "../support/safe-ui-test.js";`만 exact 형태로 import한다.
  이 support module과 그 directory는 symlink나 대체 경로가 아닌 ordinary
  canonical file/directory여야 한다.
- HTTP 응답, status, body, route, `APIRequestContext` 검증의 소유권은
  `auth-response.spec.ts`에 있다. UI spec이나 `AuthUi`는 이를 가져오지 않는다.
- 새 `AuthUi` method는 고정된 안전 오류 code, 먼저 실패하는 RED Gate mutation,
  Transport Tripwire 호환성, 실제 desktop/mobile Chromium 검증, 독립 보안 리뷰를
  모두 거친 뒤에만 추가한다.
- trace, screenshot, video 같은 Playwright artifact는 계속 꺼 둔다.
- 예외를 만들어 raw Playwright 객체나 Page, BrowserContext, Locator, Request,
  Response, Route, `APIRequestContext` 또는 network 객체를 노출해서는 안 된다.
