# ADR 0001: PostgreSQL opaque authentication sessions

- Status: Accepted
- Date: 2026-07-22

## Context and decision

Browser가 provider access/refresh token을 보유하면 XSS, 확장 프로그램, 공유 기기, storage 검사에 장기 자격 증명이 노출된다. 따라서 browser에는 32 random bytes의 base64url opaque selector만 `__Host-ab_session` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only)로 발급한다.

PostgreSQL은 selector 원문 대신 SHA-256 digest와 provider credential의 authenticated-encryption envelope를 저장한다. 현재 key ID/key로 쓰고 이전 key set은 읽기에만 사용한다. 새 key 배포 후 refresh되는 session을 재암호화하고 30-day absolute lifetime과 여유 기간 뒤 이전 key를 제거한다. Session은 7일 idle, 30일 absolute lifetime이며 logout은 local revocation을 provider sign-out보다 먼저 수행한다.

## Rejected alternatives

- Stateless browser JWT: 즉시 server-side revocation과 encrypted provider credential custody가 없다.
- Provider token을 SSR cookie에 직접 저장: cookie 탈취가 즉시 bearer credential 탈취가 된다.
- `localStorage`, `sessionStorage`, IndexedDB: JavaScript-readable token state를 만들므로 거부한다.

## Consequences and residual risks

BFF와 PostgreSQL은 session request의 availability dependency다. Hosted runtime은 owner/superuser가 아니라 `app_session_bff` role만 부여받은 전용 login을 사용한다. DB와 encryption key의 동시 침해 또는 BFF process compromise 위험은 남는다.

Session lookup이 측정된 SLO를 지속적으로 위반하거나, provider가 token-bound credential을 제공하거나, multi-region consistency가 PostgreSQL revocation 의미를 깨뜨리거나, 안전한 browser-bound key를 모든 지원 환경에서 사용할 수 있을 때 재검토한다.

## English summary

The browser receives only a hardened opaque selector cookie. PostgreSQL stores its SHA-256 digest and encrypted provider credentials. Sessions expire after seven idle days or thirty absolute days and support key rotation. Stateless JWT and provider-token cookies were rejected because they weaken revocation and credential containment.
