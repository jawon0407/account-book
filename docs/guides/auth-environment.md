# 인증 환경 변수 가이드

모든 값은 server-only다. `.env`, source, fixture, client bundle, browser storage, CI log에 실제 secret을 넣지 않는다. Hosted 값은 배포 플랫폼 encrypted settings에 입력한다.

## Web/BFF variables

| 변수 | 형식과 경계 |
|---|---|
| `NODE_ENV` | `production`이면 fake adapter를 항상 거부 |
| `APP_ORIGIN` | canonical origin; production HTTPS, user-info/path/query/fragment 금지; non-production exact loopback만 HTTP |
| `AUTH_ADAPTER_MODE` | 기본 `supabase`; `fake`는 non-production exact loopback만 |
| `DATABASE_URL` | server-only `postgres:`/`postgresql:` URL |
| `API_INTERNAL_URL` | root-only HTTP(S) origin |
| `AUTH_TOKEN_KEY_ID` | `[A-Za-z0-9._-]`, 1..128자 |
| `AUTH_TOKEN_KEY` | 32 bytes canonical base64url, padding 없는 43자 |
| `AUTH_TOKEN_PREVIOUS_KEYS` | JSON object: key ID → 43자/32-byte key; 현재 ID 중복 금지 |
| `AUTH_CSRF_HMAC_KEY` | 별도로 생성한 32 bytes canonical base64url, 43자 |
| `SUPABASE_URL` | root-only HTTP(S) provider origin; hosted HTTPS |
| `SUPABASE_ANON_KEY` | 공백/control 없는 non-empty server credential; browser 전달 금지 |
| `AUTH_FAKE_PROVIDER_URL` | test-only exact `http://127.0.0.1:4510/token`; query/fragment/user-info 금지 |

Key는 각각 다음 명령으로 생성한다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Hosted DB login은 owner, superuser, `BYPASSRLS`, migration principal이 아니어야 하며 `app_session_bff` role만 부여받는다. CI owner URL은 동일 job에서 폐기하는 schema에만 허용한다. Secret rotation은 새 값 배포 → smoke → 이전 값 폐기 순서로 하고 담당자와 rollback window를 기록한다.

## API variables

| 변수 | 형식과 경계 |
|---|---|
| `API_HOST` | `127.0.0.1` 또는 private-container `0.0.0.0` |
| `API_PORT` | decimal `1..65535`; 기본 `3001` |
| `API_DATABASE_URL` | API 전용 `app_api` role의 server-only PostgreSQL URL |
| `BFF_AUTH_DISABLED` | 정확히 `true` 또는 `false`; API 운영자가 독립적으로 fail-closed 하는 kill switch |
| `BFF_JWT_ACCEPTED_KIDS` | static public keyring의 허용 key ID JSON 배열; 1..3개의 safe ID |
| `BFF_JWT_PUBLIC_KEYS` | static P-256 SPKI DER base64url public key JSON object; private key 금지 |

API는 BFF signing private key, BFF session database role, cookie/CSRF secret을 받지 않는다. BFF는 API database URL, accepted-key allowlist, public-keyring, kill switch를 받지 않는다. Heroku API의 `app_api` role과 Vercel BFF의 `app_session_bff` role은 별도 credential·최소 권한으로 운영하며, signing private key는 BFF에만 둔다.

필수 값이 없거나 unsafe하면 API는 `API_CONFIGURATION_INVALID`, BFF는 `AUTH_CONFIGURATION_INVALID`로 fail closed한다. Production fake mode는 authentication traffic을 제공하지 않는다.

## Callback and environment boundaries

- Email: `${APP_ORIGIN}/api/auth/email/callback`
- Recovery: `${APP_ORIGIN}/api/auth/password/callback`
- OAuth: `${APP_ORIGIN}/api/auth/callback`
- Local E2E: IDP `127.0.0.1:4510`, API `:4511`, HTTPS web `:4512`, disposable DB 필수
- Hosted: `supabase` mode, HTTPS, dedicated DB login, provider console의 exact callback/secret 필수

## English summary

All authentication configuration is server-only. Encryption and CSRF keys are independent 32-byte canonical base64url values. Production rejects the fake adapter and uses a static P-256 delegated-JWT public-key allowlist, an API-owned database role, and an independent API kill switch. The loopback bridge exists solely for disposable E2E.
