# 관리형 배포 플랫폼 설계

> **English summary:** The private beta deploys a Node.js Next.js same-origin BFF to Vercel Hobby, the NestJS/Fastify API to an always-on Heroku Basic dyno, and Auth, PostgreSQL, and Storage to Supabase Pro. The BFF never forwards Supabase user JWTs to Heroku; it mints a request-bound, one-time, 30-second ES256 delegated JWT that Heroku can independently disable or revoke by key ID. Dynamic workloads are initially aligned through Vercel `iad1`, Heroku Common Runtime `us` (currently reported by the Platform API as AWS `us-east-1`), and a Supabase `us-east-1` project. The installable web shell never caches authentication or financial data locally. Public launch requires paid frontend hosting, provider-specific OAuth evidence, measured latency acceptance, tested backups, and all security release gates.

- 상태: 사용자 검토 반영
- 승인일: 2026-07-23
- 적용 범위: 비상업 비공개 베타부터 일반 공개 직전까지의 배포·운영 경계
- 비적용 범위: 관리자 페이지, 실제 서비스 계정 생성·결제, 프로덕션 배포 실행

## 1. 결정

이 프로젝트의 관리형 런타임은 다음 세 서비스를 기준으로 한다.

| 책임 | 플랫폼 | 비공개 베타 | 일반 공개 전 |
| --- | --- | --- | --- |
| Next.js 화면·same-origin BFF | Vercel | Hobby | Pro |
| NestJS/Fastify API | Heroku | Basic, always-on | Standard-1X 이상 또는 승인된 동등 티어 |
| Auth·PostgreSQL·Storage | Supabase | Pro | Pro, 사용량에 따라 compute·PITR 별도 승인 |

Vercel Hobby는 개인·비상업 베타에만 사용한다. 유료화나 사업 목적 사용을 시작하기 전에 Pro로 승격한다. Heroku Eco는 30분 비활성 후 휴면하므로 인증과 금융 API에는 사용하지 않는다. Supabase Free는 자동 백업이 플랜에 포함되지 않고 저활동 프로젝트가 정지될 수 있으므로 실제 금융 데이터를 받는 환경에는 사용하지 않는다.

공식 근거:

- [Vercel 플랜](https://vercel.com/docs/plans)
- [Vercel 가격과 Hobby 사용 범위](https://vercel.com/pricing)
- [Heroku Dyno 가격과 티어](https://www.heroku.com/pricing/)
- [Supabase 가격과 백업 보존](https://supabase.com/pricing)
- [Supabase 데이터베이스 백업](https://supabase.com/docs/guides/platform/backups)

## 2. 결정 동인

1. 소수 지인 단계부터 실제 수입·지출 내역을 저장한다.
2. 당분간 한 명이 개발, 배포, 보안, 장애 대응을 담당한다.
3. 보안과 데이터 복구 가능성을 월 서버 자원 가격보다 우선한다.
4. 이미 구현된 Next.js BFF, NestJS/Fastify API, Supabase Auth adapter, PostgreSQL migrations, Drizzle repository와 테스트를 유지한다.
5. 나중에 일반 사용자에게 공개하더라도 인증·DB를 다시 작성하지 않고 런타임 티어만 승격할 수 있어야 한다.
6. 플랫폼을 교체하더라도 애플리케이션 계약과 데이터 소유권 규칙은 유지한다.

## 3. 런타임 토폴로지

```mermaid
flowchart LR
  Browser["설치형 Web shell\n금융 데이터 local cache 금지"]
  Vercel["Vercel Node.js Function\nNext.js + BFF"]
  Heroku["Heroku\nNestJS/Fastify API"]
  Auth["Supabase Auth"]
  TxPool["Supavisor transaction pooler\n6543 · app_session_bff"]
  SessionPool["Supavisor session pooler\n5432 · app_api"]
  DB["Supabase PostgreSQL\nprivate schema + RLS"]
  Storage["Supabase Storage"]
  Migration["승인된 migration one-off\napp_migration · fixed SHA"]

  Browser -->|"HTTPS · same-origin\nopaque cookie + CSRF"| Vercel
  Vercel -->|"공인 HTTPS · BFF-minted ES256\n30초 · jti · request binding"| Heroku
  Vercel -->|"HTTPS · Supabase Auth broker\nGoogle · Kakao · custom:naver"| Auth
  Vercel -->|"BFF_DATABASE_URL · TLS\n인증 데이터 전용 credential"| TxPool
  TxPool -->|"transaction pooling"| DB
  Heroku -->|"API_DATABASE_URL · TLS"| SessionPool
  SessionPool -->|"session pooling"| DB
  Heroku -->|"HTTPS · authorized object operation"| Storage
  Migration -->|"MIGRATION_DATABASE_URL · TLS\ndirect 우선"| DB
```

브라우저는 Heroku 도메인, PostgreSQL, Supabase service credential을 직접 사용하지 않는다. 브라우저의 유일한 애플리케이션 API는 Vercel의 same-origin BFF다. BFF는 opaque selector cookie와 로컬 app session을 확인하고 API 요청 한 번에만 사용하는 delegated JWT를 새로 발급한다. Supabase 사용자 access JWT와 refresh token은 Vercel의 암호화된 세션 저장소 밖으로 전달하지 않는다. API는 BFF를 암묵적으로 신뢰하지 않고 JWT, 요청 바인딩, replay, 사용자 소유권과 입력을 다시 검증한다. PostgreSQL 역할과 RLS가 마지막 사용자 격리 경계다.

### 3.1 Heroku API 공개 노출면

Heroku Common Runtime의 web dyno는 Heroku Router가 전달하는 공인 HTTPS 요청을 받는다. 따라서 “브라우저가 호출하지 않는다”는 네트워크 격리가 아니며 다음 통제를 동시에 적용한다.

- 모든 보호 경로는 §3.2의 BFF delegated JWT를 요구한다. Supabase JWT, browser token, 정적 API key와 session cookie는 Heroku 인증 수단으로 허용하지 않는다.
- 인증 후에는 `route template + JWT subject`를 기준으로 rate limit을 적용한다. 초기값은 조회 120회/분·burst 20, 변경 30회/분·burst 10이다. 인증 전 실패 요청은 원시 IP를 저장하지 않는 keyed-HMAC fingerprint로 경로당 30회/분·burst 5로 제한하고 `429`와 `Retry-After`를 반환한다. 비공개 베타의 단일 dyno는 bounded in-memory token bucket을 사용하되, 일반 공개나 2개 이상 dyno로 확장하기 전에는 Heroku Key-Value Store 기반 shared limiter로 교체한다.
- 브라우저 origin에는 CORS를 허용하지 않고 `Access-Control-Allow-Origin`을 반환하지 않는다. 다만 CORS와 `Origin`은 비브라우저 클라이언트가 우회할 수 있으므로 인증 수단으로 취급하지 않는다.
- body 크기, 처리 시간, 허용 content type을 제한하고 upstream 오류 본문을 외부에 전달하지 않는다.
- Vercel Hobby와 일반 Pro의 egress IP는 고정돼 있다고 가정하지 않는다. Heroku 보호를 Vercel IP allowlist에 의존하지 않으며, 향후 Pro Static IPs add-on 또는 Enterprise Secure Compute를 별도 승인한 경우에만 네트워크 allowlist를 보조 통제로 재검토한다.

공식 근거:

- [Heroku Common Runtime 네트워킹](https://devcenter.heroku.com/articles/networking)
- [Vercel 고정 IP와 Static IPs](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address)

### 3.2 BFF delegated JWT

#### 발급자와 신뢰 기준점

Vercel BFF가 로컬 app session을 DB에서 확인한 직후 API 요청별 ES256 JWT를 발급한다. 서명 private key는 `BFF_JWT_PRIVATE_KEY`로 Vercel production runtime에만 두고, Heroku는 별도로 배포된 public-key keyring과 accepted `kid` allowlist만 가진다. Heroku는 Vercel 또는 BFF가 제공하는 JWKS URL을 런타임에 조회하지 않는다. 따라서 침해된 BFF가 API의 신뢰 keyring까지 바꿀 수 없다.

현재 코드는 승인된 구조대로 BFF가 `/v1/me` 요청마다 delegated JWT를 발급하고 API가 static public-key keyring으로 검증한다. Supabase 사용자 access JWT를 Heroku에 전달하거나 Supabase JWKS를 원격 조회하는 legacy 경로는 제거됐다. Hosted 배포에서는 아래 key 분리·회전·kill-switch와 production secret 경계를 다시 검증해야 한다.

#### JOSE header와 claim

| 항목 | 고정 규칙 |
| --- | --- |
| `alg` | 정확히 `ES256`; algorithm negotiation과 `none`, symmetric algorithm 금지 |
| `typ` | 정확히 `at+jwt` |
| `kid` | Heroku의 accepted key allowlist에 존재하는 현재 signing key ID |
| `crit` | 존재하면 거부 |
| `iss` | 정확히 `urn:account-book:bff` |
| `aud` | 문자열 하나 `urn:account-book:api`; 배열과 추가 audience 거부 |
| `sub` | canonical Supabase user UUID |
| `sid` | canonical 로컬 app session UUID; Supabase `session_id`가 아님 |
| `jti` | 요청마다 CSPRNG 128-bit base64url 값 |
| `iat`, `nbf`, `exp` | integer seconds; `nbf=iat`, `exp=iat+30`, verifier clock tolerance 최대 5초 |
| `scp` | route가 요구하는 단일 allowlisted action, 예: `me:read`, `transactions:write` |
| `rid` | 개인정보를 담지 않는 UUID request ID |
| `rbh` | 아래 canonical request의 SHA-256 base64url digest |

토큰은 4,096 bytes를 넘으면 서명 전 또는 검증 전에 거부한다. `rbh`는 BFF가 실제 Heroku로 전송하는 `UPPERCASE_METHOD + "\n" + canonical_path_and_sorted_query + "\n" + normalized_content_type + "\n" + SHA256(exact_body_bytes) + "\n" + rid`의 SHA-256이다. API는 bounded body를 읽고 같은 digest를 다시 계산해 method, resource ID, query, body 또는 request ID가 달라지면 서명이 유효해도 거부한다.

#### 검증과 replay 방지

API 검증 순서는 크기·Bearer 형식 → header `typ`·`alg`·`kid`·`crit` → signature → exact `iss`·`aud`·시간 → UUID와 scope → `rbh` → `jti` 원자 소비 → resource ownership 순서다. 실패 응답은 원인을 구분하지 않는 고정 `401` 또는 인증 후 권한 부족의 `403`만 반환한다.

`app_private.api_jwt_replays`는 raw `jti` 대신 SHA-256 digest와 `expires_at`만 저장한다. `app_api`가 `INSERT ... ON CONFLICT DO NOTHING`으로 한 번만 소비하고 충돌하면 replay로 거부한다. replay 유효 보존은 45초이며 migration이 등록한 Supabase Cron `pg_cron` job이 매분 만료 row를 제거하므로 물리 row는 최대 약 105초 남을 수 있다. runtime 역할은 cron 정의를 변경할 수 없고 job 실패는 운영 이메일로 경보한다. 유효한 signature와 request binding을 통과하기 전에는 이 테이블에 쓰지 않아 공격자가 임의 값으로 채울 수 없게 한다.

#### 회전과 긴급 무효화

정상 회전은 Heroku에 새 public key와 `kid` 추가 → smoke 검증 → Vercel signer를 새 private key로 전환 → 40초 대기 → 이전 `kid`와 public key 제거 순서다. private key는 Vercel과 Heroku 사이에 복제하지 않고, public keyring도 무결성 중요 설정으로 production 외 환경과 분리한다.

BFF 침해가 의심되면 Heroku의 독립 `BFF_AUTH_DISABLED=true` kill switch로 모든 보호 API를 fail-closed 상태로 전환하거나 compromised `kid`를 accepted allowlist에서 제거한다. 이 조치는 토큰 `exp`를 기다리지 않고 해당 key의 모든 토큰을 거부한다. 이어서 signing key, `BFF_DATABASE_URL`, provider-token 암호화 key와 Vercel 배포 credential을 회전하고 새 clean SHA로 재배포한다. 개별 app session 폐기는 BFF가 추가 토큰을 발급하지 못하게 하며, 이미 발급된 토큰의 잔여 수명은 최대 30초다.

표준·운영 근거:

- [RFC 7519 JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 9068 JWT access-token profile](https://www.rfc-editor.org/rfc/rfc9068)
- [Supabase Cron과 `pg_cron`](https://supabase.com/docs/guides/cron)

### 3.3 PostgreSQL 연결 경로

Vercel Functions는 짧은 실행 인스턴스가 수평 증가하므로 `BFF_DATABASE_URL`을 Supavisor transaction mode `:6543`에 연결한다. Heroku API는 지속형 프로세스이므로 IPv4에서 동작하는 Supavisor session mode `:5432`를 사용한다. migration, `pg_dump`, 복구는 direct endpoint `:5432`를 우선 사용하고 실행 환경에서 IPv6 연결을 검증할 수 없을 때만 사전에 DDL·rollback 시험을 통과한 session pooler를 사용한다. migration과 백업에는 transaction pooler를 사용하지 않는다.

`BFF_DATABASE_URL`, `API_DATABASE_URL`, `MIGRATION_DATABASE_URL`은 사용자명·암호·권한이 모두 다른 secret이다. 한 URL을 여러 이름으로 복제하거나 한 런타임에 다른 주체의 URL을 주입하지 않는다. 현재 구현의 일반 `DATABASE_URL`과 Drizzle/node-postgres 암묵적 pool 설정은 프로덕션 연결 전에 역할별 변수와 명시적 `pg.Pool` 설정으로 교체해야 하며, 이 변경이 완료되지 않으면 배포 게이트를 통과할 수 없다.

초기에는 Dedicated PgBouncer를 Supavisor와 함께 사용하지 않는다. 두 pooler의 동시 사용은 연결 예산과 장애 분석을 복잡하게 하며 현재 부하 요구가 전용 pooler를 정당화하지 않는다. 실제 Supavisor client/backend connection 포화 또는 pooler p95가 임계값을 넘는 증거가 생기면 Supavisor transaction 경로를 Dedicated PgBouncer로 대체하는 방식만 검토하고, 두 transaction pooler를 병행하지 않는다.

Supavisor transaction mode는 named prepared statement를 지원하지 않는다. BFF의 node-postgres query에는 `name`을 지정하지 않고 이를 정적 검사와 실제 pooler 통합 테스트로 검증한다.

공식 근거:

- [Supabase PostgreSQL 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supavisor transaction mode의 prepared statement 제한](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL)

### 3.4 Vercel 함수 런타임과 시간 예산

모든 인증·BFF Route Handler는 Next.js Node.js runtime으로 고정한다. 현재 코드가 `node:crypto`, `Buffer`, Drizzle과 node-postgres를 사용하므로 Edge runtime은 지원 대상이 아니다.

- 각 BFF route module 또는 공통 route segment에 `runtime = "nodejs"`, `preferredRegion = "iad1"`, `dynamic = "force-dynamic"`, `maxDuration = 10`을 명시한다.
- 함수 전체 처리 budget은 5초다. DB acquire·query는 합계 2초, Heroku upstream은 3초로 제한하고 남은 시간이 부족하면 새 외부 호출을 시작하지 않는다.
- timeout 후 background에서 금융 mutation이나 token rotation을 계속하지 않는다. idempotency가 필요한 mutation은 API가 idempotency key로 처리한다.
- `BFF_DATABASE_URL`, provider-token 암호화 key와 JWT signing private key는 `NEXT_PUBLIC_` 접두사를 금지하고 server-only module에서만 읽는다. client bundle과 build output에 secret 이름의 값이 없는지 검사한다.
- Edge runtime export, `globalThis.EdgeRuntime`, 지원되지 않는 runtime 또는 예상 밖의 Vercel region이 감지되면 startup·smoke를 실패시킨다.

Vercel Fluid Compute가 활성화된 현재 Hobby 기본 최대 실행 시간은 300초이고, 비활성화된 legacy 설정은 기본 10초·최대 60초다. 이 공급자 상한에 의존하지 않고 애플리케이션 자체 `maxDuration=10`과 5초 내부 budget을 유지한다.

공식 근거:

- [Vercel Functions 실행 제한](https://vercel.com/docs/functions/limitations)
- [Vercel 함수 최대 실행 시간 설정](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel Edge runtime과 Node.js 기본값](https://vercel.com/docs/functions/runtimes/edge)

### 3.5 Vercel DB 연결의 공격 표면

“브라우저가 DB에 직접 접근하지 않는다”는 client 경계를 뜻하며 Vercel이 DB credential을 갖지 않는다는 뜻이 아니다. Vercel production runtime은 `app_session_bff` DB credential, provider-token 암호화 key와 BFF JWT signing private key를 보유하므로 Heroku보다 넓은 인증 공격 표면이다.

- Vercel 침해 시 공격자는 인증 session·OAuth/email/recovery transaction을 조작하거나 복호화된 Supabase session token을 탈취하고 delegated JWT를 발급할 수 있다고 가정한다.
- `app_session_bff`는 금융 테이블, `api_jwt_replays`, DDL과 `app_api` resource에 접근하지 못하므로 Vercel DB credential 하나로 금융 원장을 직접 읽거나 변경할 수 없어야 한다.
- Heroku의 accepted public-key allowlist와 `BFF_AUTH_DISABLED`는 Vercel에서 수정할 수 없는 별도 관리자 경계로 유지한다.
- DB credential, provider-token 암호화 key, JWT signing key는 서로 다른 secret과 회전 주기를 사용한다. 하나의 master secret에서 파생하거나 같은 key를 재사용하지 않는다.
- production secret은 Preview, build log, source map, client bundle과 PR workflow에 제공하지 않는다.

## 4. 리전 전략

비공개 베타의 동적 런타임은 내부 왕복 지연을 줄이기 위해 다음처럼 맞춘다.

| 서비스 | 리전 |
| --- | --- |
| Vercel Functions | Washington D.C. `iad1` |
| Heroku Common Runtime | `us`; 현재 Platform API provider mapping `us-east-1` |
| Supabase project | East US, North Virginia `us-east-1` |

정적 자산은 Vercel CDN으로 전달하되, 인증·SSR·BFF 함수는 API와 데이터베이스 가까이 배치한다. Heroku Common Runtime은 `us`와 `eu`만 제공하고 아시아 리전은 Private Spaces 범주이므로, 현재 비용 단계에서는 미국 동부 정렬을 선택한다.

공식 근거:

- [Vercel `iad1` 리전](https://vercel.com/docs/pricing/regional-pricing/iad1)
- [Heroku 리전](https://devcenter.heroku.com/articles/regions)
- [Heroku Platform API `Region` resource의 현재 provider mapping](https://devcenter.heroku.com/articles/platform-api-reference#region)
- [Supabase 리전](https://supabase.com/docs/guides/platform/regions)

Heroku Platform API의 production 안정성 `Region` resource는 현재 `us`의 locale을 Virginia, provider를 AWS `us-east-1`로 반환한다. 이는 현재 공개 mapping이지 물리 위치에 대한 영구 계약으로 해석하지 않는다. provisioning 시 `/regions/us` 응답에서 비밀정보를 제거해 commit SHA와 함께 운영 증거로 보관하고 분기마다 재확인한다. mapping이 바뀌면 지연, 데이터 위치 고지와 장애 runbook을 다시 검토한다.

한국 사용자 체감 지연은 베타에서 측정한다. 일반 공개 전 대표 인증된 조회에 대해 한국 네트워크 기준 end-to-end p95가 1초를 지속적으로 넘거나 BFF에서 API까지의 p95가 250ms를 넘으면 Heroku의 아시아 대체 PaaS 또는 배포 토폴로지 변경을 별도 설계로 검토한다. 리전 변경은 환경변수 교체만으로 끝나지 않을 수 있으며, Supabase 리전 변경은 새 프로젝트 생성과 데이터 마이그레이션을 요구한다.

이 선택으로 한국 사용자의 거래 금액·분류·금융 메모, 인증 metadata와 일부 운영 로그가 미국 동부에서 저장 또는 처리되는 잔여 위험이 생긴다. 지인 베타 초대 전부터 저장·처리 국가, 이전되는 데이터 항목과 목적, 보유·삭제·백업 기간, 동의 거부 시 제한과 문의 경로를 쉬운 한국어로 고지하고 동의를 기록한다. 일반 공개 전에 한국 개인정보·국외 이전 요건에 대한 별도 법률·개인정보 검토를 완료한다. 이 문단은 법률 적합성을 확정하는 자문이 아니라 기술 설계상 데이터 위치와 고지 의무를 누락하지 않기 위한 release gate다.

## 5. 인증과 비밀정보

### 5.1 브라우저 경계

- 브라우저에는 provider access·refresh token, Supabase service-role key, DB URL, Heroku credential을 제공하지 않는다.
- production은 하나의 사용자 소유 custom domain을 canonical origin으로 고정하고 `APP_ORIGIN`에 path·query·fragment가 없는 exact HTTPS origin만 넣는다. Vercel 기본 도메인과 Preview URL을 production callback으로 등록하지 않는다.
- `__Host-ab_session`과 `__Host-ab_interaction`은 `Secure`, `HttpOnly`, `Path=/`, no `Domain` 조건을 유지하며 약한 이름으로 대체하지 않는다.
- OAuth·email confirmation·recovery callback URL은 검증된 canonical `APP_ORIGIN`에서만 만든다.
- Vercel Preview에는 production provider callback, production Supabase project, production DB와 production secret을 주입하지 않는다.
- 현재 Preview에서는 실인증을 비활성화한다. 빌드·smoke는 loopback test server의 fake adapter와 폐기 가능한 DB/IdP에서 수행하고, 공개 Preview가 실인증 경로에 접근하면 고정된 unavailable 응답으로 실패해야 한다.
- 향후 Preview에서 실인증이 필요해지면 별도의 HTTPS 개발 도메인, 개발 IdP/Supabase project, exact 개발 `APP_ORIGIN`, 폐기용 secret을 갖춘 별도 설계를 승인한다. 이 경우에도 `__Host-` cookie 정책은 완화하지 않는다.

### 5.2 플랫폼 관리자

- GitHub, Vercel, Heroku, Supabase 관리자 계정에 MFA를 적용한다.
- 배포 토큰과 개인 관리자 토큰을 분리한다.
- 장기 토큰을 저장소, 문서, 명령 인자, CI 로그에 넣지 않는다.
- 플랫폼 secret은 환경별로 분리하고 담당자·생성일·회전일을 기록한다.
- secret 회전은 새 값 배포, smoke 검증, 이전 값 폐기 순서로 수행한다.

### 5.3 데이터베이스

| 주체 | 런타임 secret | 허용 범위 | 금지 범위 |
| --- | --- | --- | --- |
| Vercel BFF `app_session_bff` | `BFF_DATABASE_URL` | `app_private`의 인증 세션, OAuth/email/recovery transaction, auth rate limit, user security state에 필요한 DML | 금융 도메인 테이블, DDL, owner·`BYPASSRLS` |
| Heroku API `app_api` | `API_DATABASE_URL` | 금융 계정·거래·분류·예산 테이블의 사용자 범위 DML, `api_jwt_replays` 원자 소비와 승인된 Storage 작업 | provider token ciphertext, 인증 session/transaction, DDL, owner·`BYPASSRLS` |
| migration one-off `app_migration` | `MIGRATION_DATABASE_URL` | 승인 migration의 DDL·grant·revoke와 migration metadata | Vercel·Heroku 일반 runtime, Preview, PR workflow |
| Supabase project owner | runtime secret 없음 | 최초 provisioning과 break-glass 복구 | 애플리케이션·일반 CI·일상 migration |

- 애플리케이션은 owner, superuser, migration principal, `BYPASSRLS` 역할로 실행하지 않는다.
- 새 금융 테이블은 `app_api`에만 명시적으로 grant하고 `app_session_bff`와 `public`, `anon`, `authenticated`, `service_role`의 불필요한 권한을 revoke한다.
- PostgreSQL SSL enforcement를 활성화한다.
- Supabase dashboard 관리자 MFA를 필수로 한다.
- 공개 schema에 금융 테이블을 노출하지 않는다.
- Supabase service-role credential을 일반 런타임 쿼리에 사용하지 않는다.

#### 연결 수 예산

프로젝트를 provision한 날 Supabase Dashboard와 `SHOW max_connections`로 실제 DB 상한 `M`을 운영 기록에 고정한다. 공급자 내부 서비스와 관리자·migration을 위해 최소 30%를 예약하고, 정상 runtime의 관측된 총 DB 연결은 `floor(M × 0.70)`을 넘지 않는다.

- Vercel BFF: warm function instance당 application pool `max=1`; transaction pooler가 backend connection을 공유한다.
- Heroku API: dyno당 application pool `max=5`에서 시작하며, dyno 수를 늘리기 전에 `5 × dyno 수`와 Supavisor backend pool이 70% 상한 안인지 확인한다.
- migration·backup·복구: 동시에 한 작업만 실행하고 runtime 예산과 별도로 1개 연결을 예약한다.
- 총 연결 60%에서 경고하고 70%에서 dyno/function 동시성 확대와 배포를 중단한다. Supabase 내부 baseline `C_base`를 측정해 runtime 가용치는 `floor(M × 0.70) - C_base`로 계산한다.
- Supabase Observability의 role별 direct·pooled connection과 `pg_stat_activity`를 함께 확인한다. 실제 플랜의 client/pool limit가 위 예산보다 작으면 더 작은 값을 hard limit로 사용한다.

### 5.4 인증 abuse와 BFF rate limit

§3.1의 Heroku rate limit은 유효 JWT를 가진 API 남용과 공인 endpoint 공격을 제한한다. 로그인 brute force, signup·recovery spam과 OAuth 시작 남용은 Heroku에 도달하기 전 Vercel BFF에서 별도로 제한한다.

| 흐름 | 초기 제한 | key |
| --- | --- | --- |
| 로그인 실패 | 5회/15분 | normalized account identifier의 keyed-HMAC fingerprint |
| 로그인 전체 | 20회/15분 | 신뢰된 client IP의 keyed-HMAC fingerprint |
| 회원가입 | 3회/60분 | account fingerprint와 IP fingerprint 각각 |
| 비밀번호 재설정 | 3회/60분 | account fingerprint와 IP fingerprint 각각 |
| OAuth 시작 | 30회/10분 | interaction과 IP fingerprint 각각 |

raw IP, email과 provider code는 rate-limit table이나 log에 저장하지 않는다. fingerprint HMAC key는 provider-token 암호화 key, CSRF key, JWT signing key와 분리한다. 계정 존재 여부와 무관하게 같은 상태·body·지연 범위의 `429`와 bounded `Retry-After`를 반환한다. 제한 성공·실패도 사용자 입력 원문 없이 집계한다.

현재 `app_private.auth_rate_limits`는 schema만 있고 repository operation과 use case가 구현되지 않았다. 위 원자 increment·window rollover·cleanup, 동시 요청과 clock-boundary test가 완료되지 않으면 지인 베타에도 실제 인증을 공개하지 않는다. Vercel 인스턴스 메모리는 authoritative limiter로 사용하지 않는다.

### 5.5 OAuth provider별 계약

애플리케이션은 Google·Kakao·Naver upstream access token을 직접 갱신하지 않는다. Supabase Auth가 broker 역할을 하고 BFF는 Supabase session access·refresh token만 암호화해 보관한다. 공통 app state와 app→Supabase S256 PKCE는 유지하되 provider registration, upstream scope·state·PKCE·철회 동작은 아래처럼 분리한다.

| Provider | Supabase 연결 | 최소 정보·설정 | 별도 검증 |
| --- | --- | --- | --- |
| Google | built-in `google` | `openid email profile`; Google API offline scope와 `access_type=offline` 요청 금지 | exact Supabase callback, 계정 선택·취소, consent 철회, Supabase session refresh |
| Kakao | built-in `kakao` | `account_email`, `profile_nickname`만; 전화번호·이름·성별·연령·생일 scope 금지 | Biz App과 email consent 상태, email 미제공, 사용자가 추가 동의를 거부한 경우, logout 후 Supabase session 폐기 |
| Naver | custom OAuth2 `custom:naver` | exact authorization/token/userinfo/revoke endpoint, `email_optional=true`, dashboard API 권한 최소화 | Naver-required upstream `state`, callback error, refresh·cascade revoke, email 누락과 userinfo mapping |

Naver 공식 OAuth 사양에는 upstream `code_challenge`·`code_verifier`가 없으므로 `custom:naver`의 provider→Naver `pkce_enabled=false`를 개발 프로젝트에서 검증한다. 이는 BFF가 생성하는 app→Supabase S256 PKCE를 끄는 것이 아니다. Supabase와 Naver가 각각 소유하는 state와 BFF의 interaction-bound app state를 혼동하거나 같은 값으로 재사용하지 않는다.

Kakao `account_email`은 Business App 또는 허용된 test app 조건을 충족해야 한다. 이 조건을 확보하지 못하면 전화번호 등 더 민감한 scope로 대체하지 않고 Kakao production login을 비활성화한다. Naver는 Supabase built-in provider가 아니므로 custom provider의 userinfo stable identifier, email optional mapping과 token revoke 결과가 live smoke에서 확인되지 않으면 production provider allowlist에 넣지 않는다.

공식 근거:

- [Supabase 지원 social provider 목록](https://supabase.com/docs/guides/auth)
- [Supabase Custom OAuth/OIDC provider](https://supabase.com/docs/guides/auth/custom-oauth-providers)
- [Kakao Login 개인정보 scope](https://developers.kakao.com/docs/en/kakaologin/utilize)
- [Naver Login OAuth API](https://developers.naver.com/docs/login/api/api.md)
- [Google OAuth web-server 정책](https://developers.google.com/identity/protocols/oauth2/web-server)

### 5.6 설치형 Web과 기기 저장 경계

현재 저장소에는 web app manifest와 service worker가 없으므로 구현 상태를 PWA로 부르지 않는다. 1차 목표는 설치 가능한 Web shell이며 금융 데이터의 offline 읽기·쓰기·동기화는 제공하지 않는다.

- service worker는 revision hash가 있는 JS·CSS·font·아이콘 등 공개 정적 shell asset만 cache-first로 저장한다.
- `/api/**`, `/app/**`, `/settings/**`, 인증·OAuth callback, Next.js RSC·SSR payload와 사용자별 image/object URL은 항상 `NetworkOnly`이며 cache fallback을 제공하지 않는다.
- API·인증·금융 HTML 응답은 `Cache-Control: private, no-store`를 사용하고 `Vary: Cookie, Authorization`을 필요한 경계에 적용한다.
- 거래, 금액, 분류, 금융 메모, 사용자 profile, query response, opaque selector와 OAuth code·state는 Cache Storage, IndexedDB, localStorage, sessionStorage와 persisted TanStack Query cache에 저장하지 않는다.
- TanStack Query는 process-memory cache만 사용하고 logout, 사용자 변경, session expiry 때 인증된 query를 제거한다. service worker update와 logout은 앱 소유 cache의 공개 shell version만 정리한다.
- offline 상태에서는 저장된 금융 데이터를 보여주거나 mutation을 queue하지 않고 “연결이 필요합니다” 화면만 표시한다.

향후 offline 거래 작성·동기화가 필요하면 기기별 암호화 key, OS secure storage, 잠금·분실 기기 폐기, conflict resolution과 보존 기간을 포함한 별도 설계와 승인을 거친다.

## 6. 백업·복구

Supabase Pro의 자동 일일 백업과 최근 7일 보관을 기본 복구선으로 사용한다. 단일 공급자의 백업만 신뢰하지 않고 다음 절차를 추가한다.

1. 주 1회 논리 DB dump와 Storage manifest·객체를 client-side 암호화해 private Cloudflare R2 bucket에 보관한다. R2는 Supabase의 AWS 기반 운영 장애와 분리된 off-site 공급자로 사용한다.
2. 백업 파일에는 데이터베이스 credential을 포함하지 않는다.
3. `age` recipient public key로 업로드 전에 암호화한다. 복호화 private key는 Vercel·Heroku·Supabase·GitHub·Cloudflare secret에 두지 않고 사용자 소유 오프라인 password manager와 분리된 recovery medium에만 보관한다.
4. R2 API token은 백업 bucket에만 최소 쓰기 권한을 부여하고 production backup runner에만 주입한다. bucket은 public access를 비활성화하고 90일 bucket lock을 적용하며 날짜와 commit SHA가 포함된 새 object key만 생성한다.
5. Supabase Storage 객체는 DB 백업에 포함되지 않으므로 별도 manifest와 객체 백업을 만든다.
6. 월 1회 폐기 가능한 환경에서 DB·Storage 복구 훈련을 실행한다.
7. 복구 결과에 migration 버전, row count, checksum·무결성 검사, 소요 시간, 담당자를 기록한다.
8. 백업 삭제, lock과 보존 기간 변경은 중요 작업으로 승인받는다.

비공개 베타의 목표는 RPO 24시간, RTO 4시간이다. PITR은 일일 백업보다 더 작은 RPO가 필요하거나 일반 공개 위험 검토에서 요구될 때 별도 비용과 함께 승인한다. 사용자가 입력한 최근 데이터가 최대 24시간 손실될 수 있다는 잔여 위험은 베타 운영 기록에 남긴다.

Cloudflare R2는 자체적으로 TLS와 AES-256 at-rest 암호화를 제공하지만, 공급자 계정 탈취와 키 관리 경계를 분리하기 위해 위 client-side 암호화를 추가한다.

공식 근거:

- [Cloudflare R2 데이터 보안](https://developers.cloudflare.com/r2/reference/data-security/)
- [Cloudflare R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)

## 7. 배포와 릴리스 게이트

모든 프로덕션 배포는 저장된 동일 commit SHA를 사용한다. 다음 중 하나라도 실패하면 배포하지 않는다.

- lockfile 고정과 production dependency audit
- secret·credential·고위험 패턴 탐지
- lint, typecheck, unit, integration, build
- disposable PostgreSQL migration 001부터 최신까지
- 실제 브라우저 인증 E2E
- BFF Node.js runtime·`iad1`·5초 내부 budget과 10초 `maxDuration` 검사
- delegated JWT claim·request binding·one-time `jti`, key rotation과 `BFF_AUTH_DISABLED` drill
- Supabase 사용자 JWT가 Heroku에 전달되지 않는 negative test
- BFF 인증 abuse limiter의 원자성·동시성·enumeration resistance 검사
- Google built-in, Kakao built-in, Naver `custom:naver`의 provider별 live smoke
- service worker가 정적 shell 외 인증·금융 response를 저장하지 않는 browser cache 검사
- 최소 권한 DB 역할과 RLS 사용자 격리 검사
- 백업 생성과 최근 복구 훈련 증거
- Heroku `/regions/us` provider mapping과 한국망 p95 측정 증거
- Vercel BFF, Heroku API, Supabase 상태 확인

DB migration은 애플리케이션 시작 시 자동 실행하지 않는다. 승인된 migration job이 순서대로 실행하고, 파괴적 변경은 백업·rollback 분석·호환 배포 순서를 요구한다.

정상적인 production migration 실행 주체는 승인된 GitHub Actions one-off다. `workflow_dispatch`만 허용하는 `production-migration` workflow가 입력받은 full commit SHA를 detached checkout하고, 배포 예정 Vercel·Heroku release SHA와 같은지 검증한 뒤 migration을 한 번 실행한다. job 권한은 `contents: read`, concurrency는 1이며 third-party action은 full SHA로 pin한다. `MIGRATION_DATABASE_URL`은 production migration job에만 주입하고 PR·push·schedule workflow에는 제공하지 않는다. 실행 기록에는 secret이나 SQL parameter를 제외한 SHA, migration 범위, 시작·종료 시각, 결과만 남긴다.

GitHub Free의 비공개 저장소에서는 environment secret과 required reviewer를 사용할 수 없으므로 repository-level migration secret으로 우회하지 않는다. 이 제약이 유지되는 비공개 베타에서는 저장소 소유자가 신뢰된 작업 PC에서 다음 one-off를 수행한다: clean detached checkout으로 배포 SHA 고정 → OS credential manager의 production migration secret을 해당 process에만 주입 → migration 실행 → schema version 검증 → process secret 제거 → 비밀정보 없는 실행 증거 저장. GitHub의 보호 환경을 사용할 수 있게 되면 위 Actions 경로로 전환한다.

Heroku one-off dyno는 정상 migration 경로가 아니다. 장애 복구 시 배포된 release SHA와 정확히 같은 image에서 migration credential을 app config에 남기지 않고 일회성 주입할 방법이 검증된 경우에만 break-glass 절차로 허용한다. owner credential과 `MIGRATION_DATABASE_URL`을 일반 web dyno config에 저장하는 방식은 금지한다.

공식 근거:

- [GitHub Actions deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub Actions deployment 구성](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)

## 8. 관측성과 개인정보 보호

- day-1 수집 위치는 Vercel Functions runtime log, Heroku Logplex, Supabase Database·Auth log다. 외부 통합이 없어도 세 위치에서 같은 무작위 request ID로 한 요청을 추적할 수 있어야 한다.
- 모든 구조화 로그는 `request_id`, `service`, `environment`, `commit_sha`, `route_template`, `status`, `duration_ms` 필드를 같은 이름과 형식으로 기록한다. BFF가 유효한 외부 ID를 받지 못하면 새 ID를 만들고 Heroku와 DB query context에 전달한다.
- request ID에 사용자 ID, 이메일, 세션 selector, token을 인코딩하지 않는다.
- 인증 성공·실패, 권한 거부, 관리자 변경, 배포 SHA, migration 결과를 감사한다.
- delegated JWT 검증 metric은 결과 code, accepted `kid`, route template과 replay 충돌 수만 집계한다. raw JWT, `jti`, `rbh`, `sub`, `sid`, rate-limit fingerprint를 기록하지 않는다.
- `BFF_AUTH_DISABLED` 변경, accepted `kid` 변경, replay cleanup cron 실패는 중요 보안 경보로 운영 이메일에 즉시 전달한다.
- 로그에 수입·지출 메모, provider token, cookie, Authorization header, DB URL을 기록하지 않는다.
- 외부 오류 추적 도구를 추가하면 payload redaction과 데이터 처리 위치를 별도 승인한다.
- 비공개 베타에서도 API 오류율, p95 지연, 인증 실패 급증, DB 연결 60% 경고·70% 중단, migration·백업 실패를 경보한다.
- day-1 경보 채널은 저장소 소유자의 별도 운영 이메일 하나로 고정하고 Vercel·Heroku·Supabase·백업 job 알림을 이 주소에 모은다. 팀 운영을 시작하면 Slack은 보조 채널로 추가할 수 있지만 이메일을 유일하게 대체하지 않는다.
- incident runbook에는 서비스별 로그 위치, request ID 검색법, 경보 소유자, 최초 확인 시간과 escalation 기준을 기록한다. 공개 전에는 보존 기간이 짧은 PaaS 로그를 보완할 외부 log sink를 별도 개인정보 검토 후 승인한다.

## 9. 비용·플랜 승격

### 9.1 비공개 베타

- Vercel Hobby는 비상업 범위에서만 사용한다.
- Heroku Basic은 always-on API를 제공한다.
- Supabase Pro는 자동 백업, 7일 보존, 비정지 프로젝트를 제공한다.
- 각 플랫폼의 spend alert 또는 사용량 알림을 활성화한다.

### 9.2 일반 공개 전 필수 승격

- Vercel Pro로 전환한다.
- Heroku Standard-1X 이상으로 전환해 metrics, preboot, zero-downtime rollout, 수평 확장 경로를 확보한다.
- Supabase Pro의 실제 DB·Storage·egress 사용량과 연결 수를 검토한다.
- RPO 요구가 24시간보다 짧아지면 PITR 비용을 승인한다.
- 개인정보 처리방침, 이용약관, 데이터 삭제·내보내기 절차와 보안 연락처를 공개한다.
- 공개 전 독립적인 보안 검토 또는 전문 침투 테스트 범위를 승인한다.

## 10. 대안과 재검토 조건

### 10.1 Hostinger KVM 2

서버 자원 대비 비용과 싱가포르 리전은 유리하지만, 한 명이 OS, Docker, TLS, 방화벽, 모니터링, 배포 복구를 책임지고 Web/API 단일 장애점을 만든다. 현재는 보류한다.

다음 조건이 모두 충족될 때 재검토한다.

- Heroku 비용 또는 측정된 리전 지연이 승인된 한도를 지속적으로 초과한다.
- 자동 패치, immutable 배포, 외부 백업, 복구 훈련, 경보를 코드와 문서로 운영할 준비가 됐다.
- 장애 시 Web/API 동시 중단을 허용하거나 두 번째 인스턴스로 제거한다.
- 운영 시간까지 포함한 총비용이 관리형 PaaS보다 낮다는 측정 근거가 있다.

### 10.2 Firebase Firestore

오프라인·실시간 모바일 경험은 강하지만, 금융 관계·집계·RLS 중심 설계를 문서 비정규화와 Security Rules 중심으로 다시 작성해야 한다. 서버 SDK가 Firestore Security Rules를 우회하는 점도 현재 서버 중심 경계와 맞지 않는다. 데이터베이스와 인증 대체재로 채택하지 않는다.

### 10.3 Firebase SQL Connect

Cloud SQL PostgreSQL과 Firebase Auth를 제공하지만 GraphQL operation, 생성 SDK, `@auth` 권한 모델로 기존 Drizzle, 직접 SQL migration, PostgreSQL 역할·RLS, Supabase Auth adapter를 다시 설계해야 한다. 신규 프로젝트라면 비교 가치가 있으나 현재 전환 이익이 비용보다 작다.

Firebase Cloud Messaging, Crashlytics 등 모바일 운영 기능은 향후 네이티브 앱 설계에서 개별적으로 승인할 수 있다. 이 승인은 Firebase를 인증 또는 금융 데이터 기준점으로 바꾸지 않는다.

## 11. 테스트 전략

- Vercel adapter와 Heroku adapter가 application contract를 바꾸지 않는지 단위 테스트한다.
- Preview 환경은 운영 secret 없이도 빌드·smoke가 가능해야 한다.
- Preview에서 production `APP_ORIGIN`, provider callback, 실인증 secret을 주입하면 startup 또는 smoke가 실패하는지 검사한다.
- 모든 BFF route가 Node.js·`iad1`·dynamic·`maxDuration=10` 정책을 명시하고 Edge runtime export와 client bundle secret이 없는지 정적·build artifact 검사한다.
- BFF가 Heroku 오류를 allowlisted public error로 변환하고 upstream body를 브라우저에 전달하지 않는지 검사한다.
- delegated JWT는 exact header·claim 성공 외에 Supabase JWT 전달, 누락·만료·future `iat`, 30초 초과 lifetime, wrong `typ`·`alg`·`kid`·issuer·audience·scope, audience array, `crit`, malformed UUID와 4,096-byte 초과를 모두 거부하는지 검사한다.
- method·path·정렬 query·content type·exact body·request ID 중 하나만 바꿔도 `rbh` 검증이 실패하고, 같은 `jti`의 동시 요청 중 정확히 하나만 성공하는지 실제 PostgreSQL에서 검사한다.
- key rotation의 old+new overlap, 40초 후 old rejection, accepted `kid` 제거와 `BFF_AUTH_DISABLED`가 아직 만료되지 않은 token도 거부하는지 incident drill로 확인한다.
- Heroku API의 browser CORS preflight가 허용되지 않고, CORS header가 없어도 JWT 없는 직접 요청은 401 또는 403인지 검사한다.
- BFF가 Supavisor transaction mode에서 named prepared statement 없이 동작하고 연결 폭주 시 pool `max=1`을 지키는지 검사한다.
- API dyno의 pool `max=5`, connection timeout, graceful shutdown과 60%·70% 연결 임계 경보를 부하 시험한다.
- RLS 격리 테스트는 서로 다른 두 사용자와 관리자 아닌 런타임 역할로 실행한다.
- `app_session_bff`가 금융·`api_jwt_replays` 테이블에, `app_api`가 인증 token·session 테이블에, 두 runtime 역할이 DDL·cron 정의에 접근하지 못하는지 negative test한다.
- BFF limiter는 동일 account·IP·interaction, 서로 다른 key, 동시 increment, window rollover, cleanup과 계정 존재·부재 응답 동등성을 실제 PostgreSQL에서 검사한다.
- Google, Kakao, `custom:naver` 각각 성공·사용자 취소·provider error·잘못된 state·재사용 callback·email 누락·Supabase refresh·consent 철회를 별도 live test한다. Kakao Biz App 조건과 Naver upstream state·refresh·cascade revoke는 공통 mock 성공으로 대체할 수 없다.
- OAuth callback, logout, replay, refresh, account recovery를 실제 브라우저에서 검사한다.
- service worker Cache Storage를 열어 정적 revision asset 외 항목이 없고, 인증·금융·RSC URL은 online과 offline 모두 cache hit가 발생하지 않는지 검사한다. localStorage·sessionStorage·IndexedDB와 persisted query cache에 금융 데이터·token·selector가 없어야 한다.
- 배포 후 synthetic login을 사용한다면 실제 사용자 credential 대신 전용 최소권한 test principal을 사용하고 결과에서 token을 제거한다.
- 백업 복구 훈련은 복원된 데이터에 대해 migration과 사용자 격리 테스트를 다시 실행한다.

## 12. 운영 완료 조건

다음 조건을 만족해야 이 배포 설계를 구현 완료로 간주한다.

1. Vercel·Heroku·Supabase 환경이 production, preview, test로 분리됐다.
2. production secret이 Preview와 pull request workflow에 노출되지 않는다.
3. 비공개 베타 플랜과 리전이 문서의 결정과 일치한다.
4. 실제 Supabase Auth·PostgreSQL과 동일 SHA 인증 E2E가 통과한다.
5. 자동 일일 백업과 별도 암호화 백업이 존재한다.
6. 복구 훈련이 RTO 목표 안에 성공한다.
7. 사용자 데이터 격리와 로그 redaction 검사가 통과한다.
8. 비용 알림, 장애 경보, incident runbook 연락 경로가 활성화됐다.
9. 관리자 페이지는 이 설계 범위에 포함되지 않고 기존 기능 완료 후 별도 설계한다.
10. 한국 네트워크에서 대표 인증 조회를 측정한 날짜, commit SHA, 리전, 표본 수, end-to-end p50·p95와 BFF→API p95가 운영 기록에 남고 §4의 재검토 임계값을 충족한다.
11. 지인 베타 사용자에게도 미국 동부 저장·처리와 RPO 24시간의 잔여 위험을 사전 고지하고 동의 기록과 삭제 문의 경로를 마련했다.
12. `BFF_DATABASE_URL`, `API_DATABASE_URL`, `MIGRATION_DATABASE_URL`이 서로 다른 역할과 secret으로 분리되고 pool `max`, 실제 `M`, `C_base`, 60% 경고와 70% 중단 값이 운영 기록에 고정됐다.
13. 현재 GitHub 플랜에 맞는 production migration one-off가 fixed SHA와 migration 전용 secret으로 실행되고, 일반 runtime과 PR workflow에 해당 secret이 없다는 증거가 남았다.
14. Heroku가 Supabase 사용자 JWT를 받지 않고 30초 delegated JWT만 허용하며 request binding, one-time `jti`, key rotation과 kill-switch drill이 통과했다.
15. 모든 BFF 인증 route가 Node.js `iad1`, dynamic, 5초 내부 budget과 `maxDuration=10`으로 배포됐고 Edge runtime과 client secret 노출 검사가 실패 0건이다.
16. Google·Kakao·`custom:naver`의 provider별 production configuration과 live smoke가 모두 통과하고 미검증 provider는 allowlist에서 비활성화됐다.
17. BFF의 persistent 인증 limiter와 Heroku API limiter가 설정된 임계값, 동시성, enumeration resistance와 `Retry-After` 검사를 통과했다.
18. 설치형 Web의 service worker와 browser storage에 정적 shell 외 인증·금융 데이터가 없고 offline 금융 조회·mutation이 불가능하다는 browser evidence가 남았다.
19. provisioning과 최근 분기 점검에서 Heroku `/regions/us` mapping을 기록했고 문서의 리전·고지·지연 판단과 일치한다.

## 12.1 Task 7 로컬 구현 증거

code commit `357f8412dcb19b004a0a0e45f08449682fc23f75`에서 모든 BFF route의 Node.js/`iad1`/`force-dynamic`/10초 `maxDuration` export, thin-adapter·명시 method allowlist·cache/security semantics와 production dependency remediation을 함께 검증했다. route-wiring RED는 누락된 정책 export 때문에 14개 route가 실패했고, GREEN은 25 files/479 tests passed였다.

Playwright config는 매 실행 P-256 pair를 생성해 private PKCS8 key를 BFF에만, public SPKI key와 static accepted-key allowlist를 Heroku API에만 준다. API trust boundary는 30초 TTL, exact issuer/audience, scope, request binding, `jti`, atomic PostgreSQL replay consume와 독립 `BFF_AUTH_DISABLED`를 계속 요구한다. opaque browser cookie journey는 Authorization header 없이 `/api/me`을 통과하고 logout 뒤 이전 selector를 401로 거부하도록 설계되며, 내부 JWT나 secret-derived 값은 browser evidence에 노출하지 않는다.

각 E2E child environment는 security-boundary variable을 Windows case-insensitive predicate로 inherited environment에서 제거한 뒤 자기 explicit allowlist만 받는다. `API_`, `AUTH_`, `BFF_`, `SUPABASE_`, 모든 database URL, test/migration database, app origin이 대상이다. 따라서 API에는 BFF private signing material·key ID·session/cookie/CSRF secret이, BFF에는 API database·public keyring·accepted keys·kill switch가 전달되지 않는다.

`pnpm --filter @account-book/e2e typecheck`와 `pnpm run verify`는 exit 0이었다. 개발 PC의 PostgreSQL listener 부재 때문에 guarded disposable migration과 browser E2E는 로컬에서 실행하지 않았고, Chromium 설치만으로 이를 대체하지 않았다. GitHub security-gate run 30211236719에서 발견된 PostCSS 파일 읽기·경로 순회와 `find-my-way` HTTP/2 DoS high advisory는 `postcss@8.5.19`, `find-my-way@9.7.0` override 및 잠금파일 재생성으로 제거했으며 `pnpm audit --prod --audit-level high`는 exit 0이었다.

최종 SHA `93737d3c8278f92242670b403c30cb3beb05b0e2`의 GitHub `security-gate` [run 15](https://github.com/jawon0407/account-book/actions/runs/30214338261)는 pinned Node 22, disposable PostgreSQL migration·catalog·privilege·replay, Chromium browser E2E, 전체 verify와 production audit를 통과했다. 같은 tree의 로컬 `pnpm test`도 legacy 53, contracts 22, database 12, API 113, web 479, E2E preflight 2 tests로 exit 0이었다. Hosted Supabase의 실제 pooler·role·`cron.job`, provider별 live OAuth, production key rotation overlap/removal, kill-switch, backup·restore와 한국망 p95는 여전히 production blocker다.
