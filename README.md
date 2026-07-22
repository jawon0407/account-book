# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

인증 기반 Task 12까지 완료되어 server-side 인증 도메인, PostgreSQL opaque session 저장소, server-owned PKCE·password recovery, 14개 same-origin Next.js BFF route, 반응형 인증 UI와 NestJS/Fastify JWT 신뢰 경계가 구현되었습니다. API는 remote JWKS로 서명·알고리즘·issuer·audience·시간·사용자/세션 UUID를 검증한 뒤에만 `/v1/me` principal을 만들며, 브라우저 token state나 CORS 경로를 만들지 않습니다. 전체 검증은 API test 54개와 web test 426개를 포함해 통과했습니다. 실제 Supabase/disposable PostgreSQL 통합 검증과 optional branch coverage `91.78%`의 100% gate 충족은 후속 작업입니다.

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
