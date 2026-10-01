# 개발용 Supabase 인증 연결과 로컬 실행

확인일: 2026-09-29. 운영 배포 가이드가 아니라 **승인된 새 개발 프로젝트**를 연결한 기록이다. 실제 금융정보를 입력하는 베타 준비 완료를 뜻하지 않는다.

## 1. 무엇이 연결되었나요?

```text
PC 브라우저 ── HTTPS ── Next.js BFF ── HTTPS ── Supabase Auth
                            │                         비밀번호·이메일 확인
                            ├── TLS / BFF 계정 ── PostgreSQL 인증 테이블 6개
                            │
                            └── loopback HTTP + 요청별 JWT ── NestJS API
                                                              │
                                                              └── TLS / API 계정 ── JWT 재사용 차단 테이블
```

브라우저에는 DB 비밀번호나 Supabase access/refresh token을 주지 않는다. 브라우저는 의미 없는 세션 식별자를 Secure·HttpOnly 쿠키로 보관하고, BFF가 암호화된 토큰을 DB에 저장한다. API는 BFF가 만든 짧은 수명 JWT를 공개키로 검증한다.

`BFF→API`의 HTTP는 **같은 PC의 127.0.0.1에서만** 사용하는 개발 예외다. 네트워크/다른 기기로 공개하지 않는다. 운영 Vercel→Heroku는 HTTPS가 필요하다. 로컬 loopback에는 전송 암호화가 없으므로 다른 프로세스가 신뢰되지 않는 PC에서 사용하지 않는다.

## 2. DB 계정을 왜 나누나요?

| 주체 | 허용 범위 | 금지 범위 |
| --- | --- | --- |
| 초기화용 `postgres` | 승인된 SQL 적용과 권한 설정 | 앱 프로세스 환경에 전달 금지 |
| `app_session_bff` | 인증 테이블 6개의 SELECT/INSERT/UPDATE/DELETE를 묶은 NOLOGIN 그룹 | 직접 접속, 테이블 생성, API replay 접근 |
| `app_bff_login` | 별도 비밀번호로 접속, 위 BFF 그룹만 상속 | owner/API 역할 전환, Supabase auth.users 직접 조회 |
| `app_api` | `api_jwt_replays` INSERT | 인증 테이블 조회, replay 조회/삭제, owner/BFF 역할 전환 |

테이블 6개는 `auth_sessions`, `oauth_transactions`, `auth_recovery_transactions`, `auth_rate_limits`, `email_confirmation_transactions`, `auth_user_security_state`다. 일회성 인증 요청, 세션, 요청 속도 제한, 비밀번호 변경 이후 세션 무효화 상태를 저장한다. 사용자 계정 자체는 Supabase Auth가 관리한다.

Supavisor 연결 문자열의 사용자명은 `역할.프로젝트ID` 형식이다. 이것은 DB 역할을 새로 합성한 이름이 아니라 풀러가 접속할 프로젝트를 고르는 표기다. 실제 DB에서 확인한 사용자는 각각 `app_bff_login`, `app_api`다.

## 3. 비밀 파일의 위치와 접근권한

실제 값은 프로젝트/OneDrive 밖 `%LOCALAPPDATA%/account-book/dev-auth`에 있다.

- `web.json`: BFF DB 자격증명, 토큰 암호화 키, CSRF 키, JWT 개인키.
- `api.json`: API DB 자격증명과 JWT 공개키. BFF 개인키나 세션 키는 없다.
- `supabase-ca.pem`: DB 서버 인증서 검증용 공식 공개 CA.
- `localhost.pem`, `localhost-key.pem`: 이 PC의 개발 HTTPS 인증서와 개인키.
- `applied.json`: 적용 시각·SQL 체크섬·역할명. 비밀값은 없다.
- `rolled-back-*`: 첫 실패 시 보존한 생성 파일. DB 적용된 credential은 아니지만 임의 공유하면 안 된다.

폴더는 현재 사용자와 Windows SYSTEM만 FullControl을 갖고, 자식 파일에 상속하도록 설정했다. `private-directory.mjs`는 실제 소유자와 NTFS DACL을 읽어 이 조건을 만족하지 않으면 초기화를 거부한다. Node의 `mode: 0600`만으로 Windows ACL이 안전해지는 것은 아니다.

파일은 암호화 금고가 아니다. 같은 Windows 사용자나 관리자에게서 비밀을 격리하는 구성도 아니다. 공유 PC에 쓰지 말고, 운영에서는 플랫폼 secret manager에 역할별로 분리 보관한다. 관리자 입력 파일 `%TEMP%/account-book-supabase-setup.env`는 실행기에서 읽지 않으며, 후속 확인을 마치면 소유자가 삭제하거나 승인된 금고로 옮긴다.

## 4. 서버를 다시 켜는 방법

Node 22.15.1, pnpm 11.9.0 환경에서 **활성 작업 공간**의 루트로 이동한다. 현재 경로는 `C:/Users/PC/OneDrive/문서/account-book/.worktrees/ledger-public-contracts`다.

터미널 1:

```powershell
pnpm build:packages
pnpm --filter @account-book/api build
node scripts/local-auth/start.mjs api
```

터미널 2:

```powershell
node scripts/local-auth/start.mjs web
```

웹: `https://localhost:3000/sign-up`, 로그인: `https://localhost:3000/login`. API 상태: `http://127.0.0.1:3001/health`.

이전 `http://127.0.0.1:3000` 주소는 사용하지 않는다. 쿠키와 callback origin은 `https://localhost:3000`으로 통일한다. 실행기는 관리자 env나 다른 역할의 env를 상속하지 않고, 외부 바인딩도 거부한다. `starting` 출력은 준비 완료가 아니라 프로세스 생성 알림이므로 아래 HTTP 검사를 함께 실행한다.

개발 서버의 원문 로그는 수집하지 않는다. Next dev 요청 로그에 OAuth callback code가 남는 것을 막기 위한 설정이다. 시작 실패는 고정 오류와 종료 코드로 확인하며, 비밀 파일을 통째로 출력해 진단하지 않는다.

## 5. 사용자가 한 번 확인해야 하는 두 설정

### 로컬 HTTPS 인증서 신뢰

이미 있던 mkcert 개발 CA로 인증서 파일을 만들었고, **2026-09-29 사용자 승인 후 현재 Windows 사용자의 `Cert:\CurrentUser\Root`에만 신뢰 등록했다.** 시스템 전체 `LocalMachine` 저장소는 변경하지 않았다. 별도 CA 지정이나 검증 우회 없이 Windows 기본 HTTPS 검증으로 `/sign-up` 200을 확인했다. 브라우저에서 경고가 남으면 새로고침하고 필요 시 브라우저를 다시 시작한다. 실제 브라우저 화면과 가입 완료는 별도 검증 대상이다.

CA를 신뢰하면 해당 CA가 발급한 인증서를 현재 사용자 브라우저가 신뢰하게 된다. CA 개인키를 외부에 공유하지 않는다. 등록된 CA의 thumbprint는 `330AD908B9BF9BAA4047980ADDCE1E14BA12ED65`다. 나중에 개발용 신뢰를 제거할 때는 현재 사용자의 인증서 관리자에서 이 식별자가 일치하는 CA만 대상으로 한다. 인증서 경고를 무시한 상태를 검증 완료로 기록하지 않는다.

### Supabase callback 등록

해당 개발 프로젝트의 Authentication → URL Configuration에서 다음을 설정한다.

Site URL:

```text
https://localhost:3000
```

Redirect URLs는 와일드카드 없이 각각 추가한다.

```text
https://localhost:3000/api/auth/email/callback
https://localhost:3000/api/auth/password/callback
https://localhost:3000/api/auth/callback
```

그다음 브라우저에서 본인 이메일과 비밀번호를 직접 입력해 가입하고, **같은 브라우저**에서 확인 메일 링크를 연다. 서버에 보관된 PKCE와 브라우저 interaction 쿠키가 함께 있어야 한다. 이메일 링크나 비밀번호를 채팅/Notion에 붙여 넣지 않는다. 확인 후 로그인·새로고침·로그아웃을 검사한다. 메일이 오지 않으면 SMTP/발송 제한을 별도로 확인하며 이메일 확인 기능을 끄는 방식으로 우회하지 않는다.

사용자 제공 화면에서 위 Redirect URLs 3개는 확인했다. Site URL은 `http://localhost:3000`으로 표시되어 HTTPS로 변경·저장 안내를 했으며 완료 확인은 아직 남아 있다. 포트가 같더라도 HTTP와 HTTPS는 같은 출처가 아니다.

현재 `/` 및 `/app` 화면은 아직 없어 404가 나온다. 직접 진입할 때는 `/sign-up` 또는 `/login`을 사용한다. 로그인 이후 `/app` 404를 가입 실패로 혼동하지 말고 세션/API 인증 성공과 장부 화면 구현을 분리해서 확인한다. Google·Kakao·Naver는 별도 개발자 앱 및 Supabase 공급자 설정이 필요하다.

## 6. 검증 명령과 증거의 한계

```powershell
node --test scripts/local-auth/*.test.mjs
node scripts/local-auth/verify-database.mjs
node --import tsx scripts/local-auth/verify-http.mjs
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- DB 검사: 실제 두 역할의 TLS·권한·금지 동작을 검사하고 시험 쓰기를 ROLLBACK한다. 사용자 데이터 행은 읽지 않는다.
- HTTP 검사: CSRF·보안 쿠키·비인증/교차 출처 차단·잘못된 로그인·서명 JWT·replay를 확인한다. 계정 생성과 메일 발송은 하지 않는다. 실패 로그인 rate-limit 기록과 짧은 수명 replay digest는 남을 수 있다.
- JWT 성공 검사는 가상 UUID로 BFF→API 신뢰 경계를 검증한다. 실제 Supabase 사용자 로그인 성공의 증거가 아니다.
- 이번 브라우저 자동화는 Windows helper의 `apply deny-read ACLs` 오류로 시작하지 못했다. HTTPS HTTP 검증을 브라우저/실기기 E2E라고 부르지 않는다.
- `pnpm test:db`는 스키마를 삭제하는 폐기용 DB 테스트다. **이 Supabase 개발 프로젝트에는 절대 실행하지 않는다.** 새 비슈퍼유저 회귀 테스트는 폐기용 CI DB에서 별도로 실행해야 한다.

## 7. 초기화 도구와 실제로 발견한 문제

`provision.mjs --check-new-development-only`는 승인된 프로젝트의 앱 스키마·역할이 없을 때만 SQL 전체를 실행 후 롤백한다. `--apply-new-development-only`는 비밀을 안전한 폴더에 새 파일로 보존한 뒤 한 트랜잭션으로 적용한다. 기존 파일이나 스키마가 있으면 거부한다. **지금 프로젝트에는 이미 적용했으므로 둘 다 재실행하지 않는다.** 서버 시작 때 migration을 실행하지 않는다.

최초 실행에서 관리형 `postgres`가 `ALTER ROLE ... NOSUPERUSER`를 수행하지 못해 SQLSTATE 42501이 났다. 전부 롤백하고, 기존 역할의 SUPERUSER/REPLICATION/BYPASSRLS가 true면 명시적으로 중단하도록 보완했다. 안전 속성을 확인한 뒤 일반 속성만 정규화하므로 권한을 높이지 않는다. 수정 후 같은 비슈퍼유저 환경에서 전체 SQL→ROLLBACK 검증을 통과하고 실제 적용했다.

초기화 영수증은 `applied.json`이다. Supabase CLI migration history를 자동으로 위조/생성하지 않았다. 미래에 CLI/CI migration runner를 도입할 때는 실제 스키마·영수증·체크섬을 확인해 baseline을 먼저 맞추고, 이미 적용한 초기화 SQL을 무작정 재실행하지 않는다. 이번 SQL 수정은 새 개발 DB 부트스트랩 호환성 보완이며 운영 DB에 재적용하지 않았다.

근거: [PostgreSQL 17 ALTER ROLE](https://www.postgresql.org/docs/17/sql-alterrole.html), [Supabase superuser 제한](https://supabase.com/docs/guides/database/postgres/roles-superuser), [Supabase 역할](https://supabase.com/docs/guides/database/postgres/roles), [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

## English summary

The new development project now has seven private authentication tables and separate least-privilege BFF/API logins. Local HTTPS and delegated JWT integration have been exercised. With explicit user approval, the existing development CA was trusted in Windows CurrentUser Root only; a normal Windows HTTPS request to sign-up returned 200. Real email confirmation and browser sign-in remain unverified; the HTTPS Site URL save still needs confirmation. No financial data, bank API calls, production deployment or paid changes were performed.
