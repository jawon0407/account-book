# API Application

NestJS와 Fastify로 구성한 내부 API다. 현재 공개 `GET /health`와 JWT로 보호된 `GET /v1/me`를 제공하며, 향후 소유권·입력 스키마·버전·멱등성·금융 데이터 변경의 최종 권한 경계가 된다.

## 인증 경계

- 브라우저가 아니라 same-origin BFF만 API에 Bearer access JWT를 전달한다.
- production verifier는 remote JWKS와 정확한 issuer, scalar audience, `ES256 | RS256` 중 설정된 단일 알고리즘을 사용한다. 지원하지 않는 protected `crit` 확장은 key resolver 호출 전에 invalid credential로 거부한다.
- 서명·등록 claim 검증 뒤 canonical `sub`와 `session_id` UUID만 `AuthPrincipal`로 보존한다. 이메일이나 역할 같은 임의 claim은 복사하지 않는다.
- `Authorization`은 canonical `Bearer <JWT>` 한 개만 허용한다. 중복·병합·제어 문자·공백·빈 token·8192바이트 초과 입력은 암호 검증 전에 거부한다.
- 요청 ID는 서버가 UUID로 생성하고 inbound ID를 무시한다. 인증/사용자 응답과 오류는 `private, no-store`이며 오류 본문에는 token, 공급자 메시지, 환경값을 포함하지 않는다.
- Helmet을 사용하고 browser CORS는 등록하지 않는다.

## 서버 환경 변수

| 이름 | 의미 |
| --- | --- |
| `API_HOST` | 기본 `127.0.0.1`; private container에서만 `0.0.0.0` 허용 |
| `API_PORT` | 기본 `3001`; canonical 정수 `1..65535` |
| `AUTH_JWKS_URL` | remote JWKS URL |
| `AUTH_JWT_ISSUER` | 허용할 정확한 JWT issuer URL |
| `AUTH_JWT_AUDIENCE` | 허용할 정확한 scalar audience |
| `AUTH_JWT_ALGORITHM` | `ES256` 또는 `RS256` |

JWKS와 issuer는 HTTPS를 사용한다. Task 13 로컬 IDP를 위해 정확한 `localhost`, `127.0.0.1`, `[::1]`만 HTTP 예외로 허용하며 credentials, fragment와 우회 loopback 표기는 거부한다.

## 검증

```powershell
$env:CI='true'
pnpm --filter @account-book/api test
pnpm --filter @account-book/api typecheck
pnpm --filter @account-book/api build
```

동일 Node 22 계열의 `@types/node`를 TypeScript 6.0.3 호환 선언이 포함된 22.20.1로 갱신해 과거 `skipLibCheck: true` 예외를 제거했다. API와 외부 선언은 모두 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck: false` 정책으로 검사된다.

---

This internal NestJS/Fastify API currently exposes public `GET /health` and JWT-protected `GET /v1/me`. It is the final authority for JWT validation and will own resource authorization, input schemas, versions, idempotency, and financial data changes. Production verification uses remote JWKS and fails closed; browser CORS and token storage are intentionally absent.

## End-to-end authentication smoke

Task 13 starts the real API on `127.0.0.1:4511` and points its verifier at a process-local ES256 IDP on `127.0.0.1:4510`. A successful `/api/me` requires remote JWKS signature verification plus exact issuer, audience, algorithm, expiry, `sub`, and `session_id` validation. A 401/503 is never successful smoke evidence. Hosted JWKS and issuer remain HTTPS-only.
