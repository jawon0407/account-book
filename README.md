# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

인증·보안 기반의 로컬 구현과 disposable CI 검증까지 완료되었습니다. server-side 인증 도메인, PostgreSQL opaque session 저장소, server-owned PKCE·password recovery, 14개 same-origin Next.js BFF route, 반응형 인증 UI, BFF가 요청마다 발급하는 30초 ES256 delegated JWT, NestJS/Fastify의 static public-key 검증·request binding·PostgreSQL one-time replay 방어가 포함됩니다.

2026-09-08에 확인한 기준 SHA `5cc94601c74a1e08f848a0cbc0bde191e7a47f81`의 [push CI](https://github.com/jawon0407/account-book/actions/runs/34194021876)와 [PR CI](https://github.com/jawon0407/account-book/actions/runs/34194024929)는 성공했습니다. 테스트 증거는 일반·workspace·preflight 867개, disposable PostgreSQL 22개, Chromium 10개로 총 899개입니다. 이는 해당 SHA의 기록이며 이후 로컬 변경을 자동으로 검증한 것으로 간주하지 않습니다.

같은 날 전체·production 의존성 audit는 알려진 취약점 0건이었습니다. 별도로 Impeccable live 개발 도구에서 발견된 보안 문제는 미해결이므로 해당 도구를 실행하지 않습니다. 공개 장부 UUID 대소문자 정규화 수정은 로컬 contracts 66개·typecheck·lint로 검증했으며 아직 위 SHA에 포함되지 않은 작업입니다.

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

- [문서 전체 지도와 최신 상태](docs/README.md)
- [초급 개발자용 코드 읽기: 역할·매개변수·실제 호출 흐름](docs/guides/code-reading.ko.md)
- [프론트엔드 구현 설명](docs/architecture/frontend.ko.md)
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
- [최신 승인 제품 설계: 웹 + 별도 네이티브 앱](docs/superpowers/specs/2026-07-27-web-native-mobile-shared-ledger-design.md)
- [초기 제품 설계 — PWA 방향을 포함한 과거 기록](docs/superpowers/specs/2026-07-16-account-book-app-design.md)
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
