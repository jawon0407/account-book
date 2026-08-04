# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

인증·보안 기반의 로컬 구현과 disposable CI 검증까지 완료되었습니다. server-side 인증 도메인, PostgreSQL opaque session 저장소, server-owned PKCE·password recovery, 14개 same-origin Next.js BFF route, 반응형 인증 UI, BFF가 요청마다 발급하는 30초 ES256 delegated JWT, NestJS/Fastify의 static public-key 검증·request binding·PostgreSQL one-time replay 방어가 포함됩니다.

최종 구현 SHA `93737d3c8278f92242670b403c30cb3beb05b0e2`는 GitHub `security-gate` [run 15](https://github.com/jawon0407/account-book/actions/runs/30214338261)에서 disposable PostgreSQL과 실제 Chromium 인증 E2E를 포함해 통과했습니다. 같은 tree의 로컬 `pnpm test`도 legacy 53개, contracts 22개, database 12개, API 113개, web 479개, E2E preflight 2개를 통과했습니다.

현재 제품 전체로는 5개 milestone 중 1단계인 저장소·보안·인증 기반이 완료된 상태입니다. 거래·계정·분류·대시보드 같은 금융 핵심 기능은 아직 구현 전입니다. 실제 Vercel·Heroku·Supabase 배포, 최소 권한 role의 hosted 검증, persistent rate limit, Google·Kakao·Naver live OAuth, backup·복구·key rotation·kill-switch 훈련은 베타 출시 전 차단 조건으로 남아 있습니다.

## Planned Stack

- Web: Next.js responsive PWA with a same-origin BFF
- API: Node.js, NestJS, Fastify
- Data: Supabase PostgreSQL, Drizzle ORM, Supabase Storage
- Auth: Supabase Auth with email, Google, Kakao, Naver
- Offline: IndexedDB queue with server-side ownership and version validation

## Documentation

- [Product principles](PRODUCT.md)
- [Design system](DESIGN.md)
- [Security policy](SECURITY.md)
- [Security architecture](docs/security/security-architecture.md)
- [Authentication backend architecture (한국어)](docs/architecture/backend-authentication.ko.md)
- [Authentication database schema (한국어)](docs/database/auth-schema.ko.md)
- [Authentication backend operations (한국어)](docs/guides/backend-auth-operations.ko.md)
- [Platform and OAuth onboarding (한국어)](docs/guides/platform-and-oauth-onboarding.ko.md)
- [Approved application specification](docs/superpowers/specs/2026-07-16-account-book-app-design.md)
- [Testing guide](docs/guides/testing.md)

## Verify the Repository Structure

```powershell
pnpm test:structure
pnpm verify:structure
```

Do not commit `.env` files, tokens, OAuth secrets, Supabase service-role keys, or production data.

## Authentication verification

The disposable browser chain uses a process-local test IdP on `4510`, a static delegated-keyring API on `4511`, and an HTTPS Next.js BFF on `4512`. The browser receives only `__Host-ab_session`; provider credentials remain encrypted in PostgreSQL and move server-to-server only.

- [Opaque session ADR](docs/architecture/adr/0001-opaque-auth-sessions.md)
- [Authentication environment guide](docs/guides/auth-environment.md)
- [Authentication security testing](docs/guides/security-auth-testing.md)

`pnpm test:db` and `pnpm --filter @account-book/e2e test` require an explicitly disposable PostgreSQL. Disposable CI evidence does not replace hosted provider OAuth, production role, backup, or incident-drill evidence.
