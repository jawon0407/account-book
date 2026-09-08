# Web Application

This directory contains the Next.js PC web application and same-origin BFF. The UI adapts to narrow screens, but the mobile product is planned as a separate React Native/Expo app and is not implemented yet. PWA installation, a web manifest, service workers, persistent financial caches, and offline writes are out of scope. Browser code must not access financial tables, refresh tokens, or service credentials directly.

## 현재 구현과 읽는 순서

로그인, 가입, 이메일 확인 안내, 재설정 메일 요청, 새 비밀번호 설정의 인증 화면 5개와 BFF 라우트 모듈 14개가 구현되어 있습니다. 로그인 성공 시 이동하는 `/app`은 아직 구현되지 않아 현재 404입니다. 금융 계약이 존재해도 가계부 화면 전체가 구현된 것은 아닙니다.

브라우저 HTTP 요청은 ky, 서버 상태는 TanStack Query, 폼 진행·오류 상태는 React 로컬 state/ref를 사용합니다. Zustand나 영구 금융 캐시 연결은 없습니다.

처음 읽는다면 [프론트엔드 구조와 인증 요청 따라가기](../../docs/architecture/frontend.ko.md)에서 `LoginPage → SignInForm → mutation → ky → BFF` 흐름과 각 함수의 입력·결과를 확인하세요. 플랫폼 방향은 [PC 웹·네이티브 모바일 공용 설계](../../docs/superpowers/specs/2026-07-27-web-native-mobile-shared-ledger-design.md)에 따릅니다.

## Authentication runtime

The BFF stores only a SHA-256 digest of the browser's opaque selector and encrypted provider credentials in PostgreSQL. Browser-visible responses omit provider tokens, and `/api/me` resolves the cookie before calling the internal API with a server-held JWT.

Production uses `AUTH_ADAPTER_MODE=supabase`. Fake mode is rejected in production and on public hosts. Optional `AUTH_FAKE_PROVIDER_URL=http://127.0.0.1:4510/token` is accepted only by the disposable loopback E2E harness. See [the environment guide](../../docs/guides/auth-environment.md).
