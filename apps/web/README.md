# Web Application

This directory will contain the Next.js responsive PWA and same-origin BFF. Browser code must not access financial tables, refresh tokens, or service credentials directly.

## Authentication runtime

The BFF stores only a SHA-256 digest of the browser's opaque selector and encrypted provider credentials in PostgreSQL. Browser-visible responses omit provider tokens, and `/api/me` resolves the cookie before calling the internal API with a server-held JWT.

Production uses `AUTH_ADAPTER_MODE=supabase`. Fake mode is rejected in production and on public hosts. Optional `AUTH_FAKE_PROVIDER_URL=http://127.0.0.1:4510/token` is accepted only by the disposable loopback E2E harness. See [the environment guide](../../docs/guides/auth-environment.md).
