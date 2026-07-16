# Account Book

PC와 모바일에서 사용할 수 있는 보안 우선 동기화형 개인 가계부입니다.

## Current Stage

프로젝트 구조와 개발·보안 기준을 확정하는 단계입니다. 애플리케이션 기능은 `feature/*` 브랜치에서 별도 계획과 테스트를 통해 구현합니다.

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
- [Approved application specification](docs/superpowers/specs/2026-07-16-account-book-app-design.md)
- [Testing guide](docs/guides/testing.md)

## Verify the Repository Structure

```powershell
pnpm test:structure
pnpm verify:structure
```

Do not commit `.env` files, tokens, OAuth secrets, Supabase service-role keys, or production data.
