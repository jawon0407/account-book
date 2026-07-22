# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

인증 기반 Task 10까지 완료되어 server-side 인증 도메인, PostgreSQL opaque session 저장소, server-owned PKCE·password recovery와 14개 same-origin Next.js BFF route가 구현되었습니다. Task 11 인증 UI, Task 12 NestJS API/JWT guard와 실제 Supabase/disposable PostgreSQL 통합 검증은 아직 완료되지 않았습니다. Web test와 production build는 통과했지만 optional branch coverage는 `91.78%`로 100% gate를 충족하지 못합니다.

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
