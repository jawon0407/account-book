# API Application

이 NestJS/Fastify API는 공개 `GET /health`와 delegated-JWT로 보호되는 `GET /v1/me`를 제공한다. API는 resource authorization, input schema, version, idempotency, 금융 데이터 변경의 최종 권한 경계다.

## 인증 경계

- 브라우저는 API에 직접 연결하지 않고 same-origin BFF만 사용한다.
- API는 static P-256 SPKI DER public-key keyring과 accepted `kid` allowlist만 신뢰한다. BFF signing private key와 remote key resolver는 API에 배포하지 않는다.
- delegated JWT는 exact issuer/audience, ES256, 30초 TTL, route scope, request binding, `jti`를 요구한다. PostgreSQL replay store가 `jti`를 원자적으로 한 번만 consume한다.
- `BFF_AUTH_DISABLED=true`는 key lookup과 replay consume보다 먼저 API를 fail-closed 한다. 이 kill switch와 accepted-key allowlist는 BFF에서 수정할 수 없는 API 운영 경계다.
- `Authorization`은 canonical `Bearer <JWT>` 한 개만 허용한다. malformed input, unsupported protected `crit`, 허용되지 않은 `kid`, keyring 불일치는 credential detail 없이 거부한다.
- API는 browser CORS를 등록하지 않으며 response와 diagnostic에 token, key material, cookie, selector, DB connection value를 포함하지 않는다.

## API 환경 변수

| 변수 | 형식과 경계 |
| --- | --- |
| `API_HOST` | 기본 `127.0.0.1`; private container에서만 `0.0.0.0` 허용 |
| `API_PORT` | 기본 `3001`; canonical 정수 `1..65535` |
| `API_DATABASE_URL` | API 전용 `app_api` role의 server-only PostgreSQL connection |
| `BFF_AUTH_DISABLED` | 정확한 `true` 또는 `false`; API 독립 kill switch |
| `BFF_JWT_ACCEPTED_KIDS` | static keyring에서 허용할 safe key ID JSON 배열 |
| `BFF_JWT_PUBLIC_KEYS` | `kid`별 P-256 SPKI DER base64url public key JSON object |

`app_api` database credential은 BFF session credential과 migration credential에서 분리한다. API는 BFF private key, BFF session DB role, cookie/CSRF secret을 받지 않는다. BFF는 API database URL, public-keyring, accepted key ID, kill switch를 받지 않는다. Key rotation은 public key overlap과 제거 drill로 검증하고 private signing key는 BFF에만 배포한다.

## 검증

```powershell
$env:CI='true'
pnpm --filter @account-book/api test
pnpm --filter @account-book/api typecheck
pnpm --filter @account-book/api build
```

Task 7 E2E는 API에 process-local delegated ES256 public key와 disposable API database role만 전달한다. `/api/me` 성공에는 static-key signature, exact issuer/audience, scope, request binding, expiry, `jti`, replay consume 검증이 모두 필요하다. 브라우저는 API credential을 보거나 직접 제출하지 않는다. 401/503은 smoke 성공 증거가 아니다.

로컬 Node 22.15.1 pin, live disposable PostgreSQL privilege/replay, key rotation removal, kill-switch drill, same-SHA CI는 별도 release evidence가 필요하다.
