# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

인증 기반 Task 13의 로컬 구현까지 완료되었습니다. server-side 인증 도메인, PostgreSQL opaque session 저장소, server-owned PKCE·password recovery, 14개 same-origin Next.js BFF route, 반응형 인증 UI, NestJS/Fastify JWT 신뢰 경계에 더해 process-local ES256 IDP와 두 viewport의 Playwright·axe 인증 E2E가 추가되었습니다. 로컬 단위·정책 검증은 security/legacy 52개, contracts 15개, database 8개, API 54개, web 434개, disposable DB preparation 8개, production fake startup 1개와 모든 strict TypeScript 검사·프로덕션 빌드를 통과했습니다. 실제 disposable PostgreSQL을 사용하는 전체 브라우저 체인, hosted DB 최소 권한, Google·Kakao·Naver live OAuth와 동일 SHA CI 증거는 아직 출시 차단 항목입니다.

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
- [Approved application specification](docs/superpowers/specs/2026-07-16-account-book-app-design.md)
- [Testing guide](docs/guides/testing.md)

## Verify the Repository Structure

```powershell
pnpm test:structure
pnpm verify:structure
```

Do not commit `.env` files, tokens, OAuth secrets, Supabase service-role keys, or production data.

## Authentication verification

Task 13 adds a disposable browser chain on fixed loopback ports: process-local ES256 IDP `4510`, real remote-JWKS API `4511`, and HTTPS Next.js BFF `4512`. The browser receives only `__Host-ab_session`; provider credentials remain encrypted in PostgreSQL and move server-to-server only.

- [Opaque session ADR](docs/architecture/adr/0001-opaque-auth-sessions.md)
- [Authentication environment guide](docs/guides/auth-environment.md)
- [Authentication security testing](docs/guides/security-auth-testing.md)

`pnpm test:db` and `pnpm --filter @account-book/e2e test` require an explicitly disposable PostgreSQL. Live provider OAuth is not local release evidence.
