# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

인증·보안 기반의 로컬 구현과 disposable CI 검증까지 완료되었습니다. server-side 인증 도메인, PostgreSQL opaque session 저장소, server-owned PKCE·password recovery, 14개 same-origin Next.js BFF route, 반응형 인증 UI, BFF가 요청마다 발급하는 30초 ES256 delegated JWT, NestJS/Fastify의 static public-key 검증·request binding·PostgreSQL one-time replay 방어가 포함됩니다.

현재 구현 SHA `51a9667511058395c4f72e4af42e2e4c25b243dc`는 동일 SHA의 GitHub `security-gate` [push run](https://github.com/jawon0407/account-book/actions/runs/32158792436)과 [PR run](https://github.com/jawon0407/account-book/actions/runs/32158800903)에서 disposable PostgreSQL과 실제 Chromium 인증 E2E를 포함해 통과했습니다. 로컬 `pnpm verify`도 829/829 tests, 6/6 typecheck와 production build를 통과했고 `pnpm audit --prod`는 알려진 production vulnerability 0건을 보고했습니다.

전체 `pnpm audit`에는 개발 의존성 경로의 7건(High 3, Moderate 4)이 남아 있습니다. GitHub Dependabot은 기본 브랜치에서 9건(High 4, Moderate 5)을 보고하므로, 개발 도구 공급망 patch는 병합 전 보안 차단 조건입니다.

현재 제품 전체로는 5개 milestone 중 1단계의 로컬 코드·CI가 완료됐고 hosted 운영 gate는 미완료입니다. 금융 변경 요청의 보안 계약과 검증 경계는 구현됐지만 거래·계정·분류·대시보드 같은 운영 장부 기능과 별도 모바일 앱은 아직 구현 전입니다. 실제 Vercel·Heroku·Supabase 배포, 최소 권한 role의 hosted 검증, persistent rate limit, Google·Kakao·Naver live OAuth, backup·복구·key rotation·kill-switch 훈련은 베타 출시 전 차단 조건으로 남아 있습니다.

## Approved Product Direction

- PC Web: Next.js responsive web with a same-origin BFF
- Mobile: separate React Native + Expo application for Android and iOS
- API: Node.js, NestJS, Fastify
- Data: Supabase PostgreSQL, Drizzle ORM, Supabase Storage
- Auth: Supabase Auth with email, Google, Kakao, Naver
- Synchronization: one server-side PostgreSQL ledger shared through the same API

The approved target is a separate PC web and native mobile app, not an installable PWA. Complex offline write synchronization remains outside the initial ledger scope.

## Documentation

- [Development progress snapshot (한국어, 2026-08-24)](docs/status/2026-08-24-development-progress.ko.md)
- [Product principles](PRODUCT.md)
- [Design system](DESIGN.md)
- [Security policy](SECURITY.md)
- [Security architecture](docs/security/security-architecture.md)
- [Authentication backend architecture (한국어)](docs/architecture/backend-authentication.ko.md)
- [Authentication database schema (한국어)](docs/database/auth-schema.ko.md)
- [Authentication backend operations (한국어)](docs/guides/backend-auth-operations.ko.md)
- [Platform and OAuth onboarding (한국어)](docs/guides/platform-and-oauth-onboarding.ko.md)
- [Full-stack development flow (한국어)](docs/guides/full-stack-development-flow.ko.md)
- [M2.1 public ledger contract design (한국어)](docs/superpowers/specs/2026-08-26-ledger-public-contracts-design.md)
- [M2.1 public ledger contract implementation plan](docs/superpowers/plans/2026-08-26-ledger-public-contracts.md)
- [Public API contract inventory (한국어)](docs/api/README.md)
- [Contracts package boundary (한국어)](packages/contracts/README.md)
- [Approved application specification](docs/superpowers/specs/2026-07-16-account-book-app-design.md)
- [Testing guide](docs/guides/testing.md)
- [Changelog](CHANGELOG.md)

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
