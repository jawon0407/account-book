# How to: Vercel·Heroku·Supabase와 OAuth를 안전하게 준비하는 방법

이 문서는 저장소 소유자가 외부 계정과 결제를 천천히 준비할 때 사용하는 실행 체크리스트다. 실제 secret 값, 결제 정보, recovery code, DB 연결 문자열은 이 문서·GitHub issue·PR·채팅·화면 캡처에 기록하지 않는다.

## 현재 상태와 중단 조건

2026-07-27 기준으로 저장소·인증·delegated-JWT의 로컬 구현과 disposable CI는 완료됐지만 프로덕션 배포 설정은 아직 구현되지 않았다. 다음 항목이 코드와 운영 절차로 닫히기 전에는 실제 금융 데이터를 저장하지 않는다.

- persistent 인증·API rate limit
- Vercel의 `DATABASE_URL`을 역할이 드러나는 `BFF_DATABASE_URL`로 정리하고 Supavisor transaction pool 설정 검증
- Heroku monorepo build/start와 Vercel monorepo 배포 설정
- hosted `app_session_bff`, `app_api`, migration role의 실제 최소 권한 검증
- Google·Kakao·Naver provider별 live smoke
- backup·복구, key rotation, kill switch, 로그 경보 훈련
- 개인정보 처리방침과 국외 이전 고지 최종 검토

따라서 지금 안전하게 할 수 있는 범위는 관리자 MFA, 도메인 후보 결정, 각 플랫폼의 빈 project/app 준비, 결제 상한 확인, OAuth 개발 앱의 최소 설정과 테스트 계정 등록이다. 실제 secret 입력과 production deploy는 위 차단 조건을 닫는 후속 PR에서 진행한다.

## 전체 순서

| 단계 | 사용자 작업 | 완료 증거 | 실제 데이터 |
| --- | --- | --- | --- |
| 1 | 전용 운영 이메일·password manager·MFA 준비 | 모든 관리자 계정의 2개 이상 복구 수단 | 금지 |
| 2 | 도메인과 canonical origin 결정 | 소유권·자동 갱신·DNS 접근 확인 | 금지 |
| 3 | Supabase Pro 조직·project 준비 | region, project ref, spend cap 기록 | 금지 |
| 4 | Vercel project와 Heroku app 준비 | project/app ID, region, billing alert 기록 | 금지 |
| 5 | Google·Kakao·Naver 개발 앱 준비 | 최소 scope, tester, callback matrix 확인 | 금지 |
| 6 | 배포 코드와 secret inventory 승인 | 환경별 변수 이름·소유자·회전일 기록 | 금지 |
| 7 | hosted smoke·복구·보안 gate 통과 | 동일 SHA의 증거 URL과 운영 기록 | test data만 |
| 8 | 개인정보·국외 이전 고지 승인 | 게시 URL, 버전, 승인일, 동의 기록 방식 | 금지 |
| 9 | 지인 베타 go/no-go 승인 | 대상, 시작일, 삭제·문의 경로, rollback owner | 승인 후 허용 |

각 단계를 건너뛰지 않는다. 앞 단계의 값이 바뀌면 callback, cookie, privacy notice와 smoke evidence를 다시 확인한다.

## 1. 관리자 계정과 MFA

### 1.1 공통 준비

1. 운영 알림을 받을 전용 이메일 주소를 만든다. 개인 일상 메일과 분리하고 recovery 이메일도 보호한다.
2. password manager에 플랫폼별로 서로 다른 긴 비밀번호를 저장한다.
3. 주 인증 수단은 passkey 또는 hardware security key를 우선하고 TOTP를 보조로 둔다.
4. 서로 다른 기기나 보관 위치에 두 번째 복구 수단을 둔다. SMS만 유일한 복구 수단으로 사용하지 않는다.
5. recovery code가 제공되면 암호화된 password manager와 오프라인 복구 매체에 분리 보관한다. 화면 캡처나 클라우드 메모에 두지 않는다.
6. MFA 설정 직후 private browsing 창에서 한 번 로그아웃·재로그인하고, 두 번째 수단으로도 복구 가능한지 확인한다.
7. 운영 기록에는 `플랫폼 / 계정 식별자 / MFA 활성일 / 주 수단 / 백업 수단 보유 여부`만 적는다. seed와 recovery code 원문은 적지 않는다.

### 1.2 플랫폼별 위치

- GitHub: **Settings → Password and authentication**. TOTP보다 passkey/security key를 우선하고 recovery method를 두 개 이상 둔다. [GitHub 2FA 문서](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/changing-your-two-factor-authentication-method)
- Vercel: **Account Settings → Authentication/Two-factor authentication**에서 2FA를 켜고 recovery code를 분리 보관한다. [Vercel 2FA 문서](https://vercel.com/docs/two-factor-authentication)
- Heroku: 신규 계정은 MFA가 필수다. **Account Settings → Manage Multi-Factor Authentication**에서 backup verifier를 추가한다. [Heroku MFA 문서](https://devcenter.heroku.com/articles/multi-factor-authentication)
- Supabase: **Account Settings → MFA**에서 primary와 backup TOTP를 서로 다른 기기에 등록한다. Supabase는 recovery code를 제공하지 않으므로 backup factor가 특히 중요하다. Pro 조직을 만든 뒤 **Organization Security → Require MFA**도 켠다. [Supabase 관리자 MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication), [조직 MFA 강제](https://supabase.com/docs/guides/platform/mfa/org-mfa-enforcement)
- Google Cloud: Google 계정의 **Security → 2-Step Verification**을 켜고 passkey/security key와 backup code를 준비한다. [Google 2단계 인증](https://support.google.com/accounts/answer/10956730)
- Kakao Developers: 앱 소유 Kakao 계정의 보안 설정에서 2단계 인증을 켜고 복구 연락처를 확인한다.
- NAVER Developers: **네이버ID → 보안설정 → 2단계 인증**을 켜고 등록 기기 분실 시 복구 경로를 확인한다. [네이버 2단계 인증](https://help.naver.com/service/5640/contents/19238?lang=ko&osType=MOBILE)

## 2. 도메인과 canonical origin

### 2.1 결정할 값

다음 세 항목을 문서로 먼저 결정한다.

```text
서비스 루트 도메인: <owned-domain>
production canonical origin: https://<app-subdomain>.<owned-domain>
운영 문의 이메일: <security-or-support-address>
```

권장 예시는 `https://app.<owned-domain>`이다. 실제 값은 사용자가 소유한 도메인이어야 한다. `vercel.app`, `herokuapp.com`, Preview URL은 production canonical origin으로 사용하지 않는다.

### 2.2 구매·DNS 체크리스트

1. registrar 계정에도 MFA를 설정한다.
2. 자동 갱신과 결제 실패 알림을 켠다.
3. registry lock 또는 transfer lock을 켠다.
4. DNS 변경 권한이 있는 계정을 최소화한다.
5. production app subdomain, 홈페이지, 개인정보 처리방침, 이용약관, 문의 페이지를 같은 소유 도메인 아래 계획한다.
6. `APP_ORIGIN`은 scheme과 host만 포함한 exact HTTPS origin으로 고정한다. path, query, fragment, trailing slash, user-info는 넣지 않는다.
7. production callback에는 Preview wildcard를 넣지 않는다.

도메인이 정해지지 않았다면 OAuth production 심사를 신청하지 않는다. Google production 앱은 소유·검증 가능한 domain과 공개 home/privacy page를 요구할 수 있다.

## 3. Supabase Pro 조직과 project

### 3.1 결제 승인

1. Supabase Dashboard에서 이 서비스 전용 organization을 만든다.
2. **Billing**에서 Pro를 선택한다. Supabase는 organization 단위로 plan을 적용하므로 같은 organization의 project가 모두 같은 plan 영향을 받는다는 점을 확인한다.
3. checkout 화면의 현재 고정 요금, 포함 quota, 초과 단가, 세금을 캡처가 아닌 운영 메모의 숫자로 기록하고 사용자가 승인한다.
4. **Cost Control**에서 spend cap과 사용량 알림을 켠다.
5. 실제 데이터가 들어가기 전 자동 backup 보존과 복구 옵션을 다시 확인한다.

[Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [cost control](https://supabase.com/docs/guides/platform/cost-control)

### 3.2 project 생성

1. project name은 환경을 드러내게 한다. 예: `account-book-production`.
2. database password는 password manager가 생성하고 저장한다. 문서·Git·채팅에 복사하지 않는다.
3. region은 승인된 설계대로 East US/North Virginia 계열을 선택한다. 생성 후 project 이동이 쉽지 않으므로 결제 전에 다시 확인한다.
4. project 생성 후 다음 비밀이 아닌 식별 정보만 운영 기록에 남긴다.
   - organization 이름
   - project 이름
   - project ref
   - region
   - 생성일
   - plan
5. **Account/Organization Security**에서 MFA 강제를 켠다.
6. **Auth → URL Configuration**의 Site URL은 아직 production deploy 전이면 임시로 바꾸지 않는다. canonical origin의 실제 HTTPS 응답과 callback이 준비된 후 변경한다.

### 3.3 DB 연결 경계

Dashboard의 **Connect** 화면에서 연결 경로를 확인하되 URL 전체를 문서에 복사하지 않는다.

| 용도 | 역할 | 연결 방식 | 플랫폼 변수 |
| --- | --- | --- | --- |
| Vercel 인증 저장소 | `app_session_bff` | Supavisor transaction mode `:6543`, pool max 1 | 최종 `BFF_DATABASE_URL` |
| Heroku 금융/API·replay | `app_api` | Supavisor session mode `:5432`, pool max 5/dyno | `API_DATABASE_URL` |
| 승인 migration | `app_migration` | direct `:5432` 우선 | `MIGRATION_DATABASE_URL` |

[Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)

세 URL은 사용자명, 비밀번호, 권한을 모두 다르게 한다. owner, `postgres`, service-role, `BYPASSRLS` credential을 Vercel·Heroku runtime에 넣지 않는다. 현재 BFF 코드는 `DATABASE_URL`을 읽으므로 후속 배포 PR에서 `BFF_DATABASE_URL`로 정리되기 전에는 production secret을 입력하지 않는다.

## 4. Vercel project

### 4.1 준비

1. Vercel Dashboard에서 **Add New → Project**를 연다.
2. GitHub의 `jawon0407/account-book`를 선택하되 production deploy는 배포 설정 PR이 merge된 뒤 진행한다.
3. monorepo web app의 **Root Directory는 `apps/web`**으로 설정한다. 이 디렉터리의 `vercel.json`이 함수 리전 정책의 기준이다. “Include source files outside of the Root Directory in the Build Step”를 켜고 공유 workspace package의 선행 빌드와 import 해석을 배포 PR에서 검증한다. 현재 프로젝트는 아직 생성하지 않았다.
4. production branch는 `main`, Preview는 feature branch로 둔다.
5. `apps/web/vercel.json`의 `regions: ["iad1"]`로 Function region을 지정한다. runtime은 Node.js, route의 `maxDuration`은 10초로 유지한다. deprecated된 `preferredRegion` route export를 다시 추가하지 않는다.
6. custom domain은 production build와 health/smoke가 준비된 뒤 연결한다.
7. spend/usage 알림을 켠다.

[Vercel project](https://vercel.com/docs/projects), [environment variables](https://vercel.com/docs/environment-variables)

### 4.2 리전 설정의 의미와 배포 확인

리전은 서버 함수가 실행되는 지역이다. `apps/web/vercel.json`의 `$schema`는 편집기에서 JSON 설정을 검사할 수 있게 하고, `regions`는 배포할 함수 지역 목록을 지정한다. 단일 `iad1`만 허용하며 함수별 다른 지역, 자동 failover와 멀티리전은 설정하지 않는다. JSON에는 주석이나 secret을 넣지 않는다.

로컬 Next build는 Vercel의 실제 배치 위치를 검증하지 않는다. 다음 항목은 **프로젝트 생성 및 별도 배포 승인 후** 확인한다.

1. Root Directory가 `apps/web`이며 위 설정 파일이 사용되는지 확인한다. 저장소 최상위로 루트를 바꾸려면 파일 위치·공유 패키지 빌드·정책 테스트도 재검토한다.
2. CLI `--regions`, 함수별 override 또는 failover 설정으로 단일 리전 정책을 우회하지 않는다.
3. 배포 상세에서 Functions의 실제 지역이 `iad1`인지 확인하고 해당 배포 SHA와 비밀값 없는 증거를 기록한다. 불일치하면 공개를 보류한다.
4. 정적 파일의 CDN 배포 위치와 서버 함수 실행 지역은 다르다. 이 설정만으로 DB·로그·백업의 저장 위치나 국외 이전 고지 충족을 주장하지 않는다.

[Vercel JSON 위치](https://vercel.com/docs/project-configuration/vercel-json), [Functions 리전 설정](https://vercel.com/docs/functions/configuring-functions/region)

### 4.3 환경 분리

- Production에는 production secret만 둔다.
- Preview에는 production DB, Supabase project, OAuth credential, JWT private key를 넣지 않는다.
- Development는 별도 개발 project와 폐기 가능한 값만 사용한다.
- `NEXT_PUBLIC_` 접두사가 붙은 변수에 credential을 넣지 않는다.
- 변수 변경 후에는 기존 deployment가 자동으로 갱신되지 않으므로 새 deployment를 만들고 smoke한다.

## 5. Heroku app

1. Heroku Dashboard에서 빈 app을 만들고 region은 `United States`로 선택한다.
2. app 이름은 전역 고유값이므로 환경을 드러내는 이름을 사용하되 production URL로 사용자에게 노출할 필요는 없다.
3. Billing에서 결제 수단을 등록하고 사용자가 Basic always-on dyno의 현재 요금과 초과 항목을 승인한다. Heroku는 실행 시간 기준으로 과금되며 Basic의 공식 예시는 월 최대 US$7이지만 checkout의 현재 금액을 최종 기준으로 한다.
4. Eco dyno는 인증·금융 API에 사용하지 않는다.
5. GitHub 연결과 자동 deploy는 Heroku monorepo build/start 설정 PR이 merge된 후 활성화한다.
6. **Settings → Config Vars**에 secret을 입력하는 단계도 그때 진행한다. CLI command line에 secret 값을 직접 적지 않는다.
7. CORS는 브라우저 origin에 열지 않는다. 보호 API는 delegated JWT가 없으면 거부되어야 한다.
8. Vercel 고정 egress IP를 전제로 allowlist를 만들지 않는다.

[Heroku app 생성](https://devcenter.heroku.com/articles/creating-apps), [config vars](https://devcenter.heroku.com/articles/config-vars), [usage와 billing](https://devcenter.heroku.com/articles/usage-and-billing)

## 6. callback URL matrix

Supabase가 Google·Kakao·Naver의 OAuth broker다. 따라서 provider console의 callback과 앱의 callback은 서로 다른 두 단계다.

### 6.1 Provider → Supabase

Supabase Dashboard의 각 provider 설정 화면에 표시되는 read-only callback을 그대로 복사한다.

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

| Provider console | 등록할 callback |
| --- | --- |
| Google OAuth client | Supabase provider callback exact URI |
| Kakao REST API key | Supabase provider callback exact URI |
| Naver Login app | Supabase custom provider callback exact URI |

scheme, host, path, 대소문자, trailing slash가 정확히 같아야 한다. 앱의 `${APP_ORIGIN}/api/auth/callback`을 provider console에 직접 넣지 않는다.

### 6.2 Supabase → Account Book BFF

Supabase **Auth → URL Configuration**에는 다음 production URL을 exact allowlist로 등록한다.

```text
Site URL:
https://<app-subdomain>.<owned-domain>

Additional Redirect URLs:
https://<app-subdomain>.<owned-domain>/api/auth/callback
https://<app-subdomain>.<owned-domain>/api/auth/email/callback
https://<app-subdomain>.<owned-domain>/api/auth/password/callback
```

Vercel Preview wildcard는 production Supabase project에 넣지 않는다. Supabase의 Site URL은 email confirmation과 password reset의 기본 redirect에도 영향을 주므로 production 전환 시 반드시 실제 링크를 새 private browser에서 확인한다. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

## 7. Google OAuth app

1. 이 서비스의 production 전용 Google Cloud project를 만든다. test와 production을 분리한다.
2. **Google Auth Platform → Branding**에서 앱 이름, support email, home page, privacy policy, terms URL을 소유 도메인으로 입력한다.
3. **Audience**에서 초기에는 External/Testing을 선택하고 지인 계정을 test user로 등록한다.
4. **Data Access**는 `openid`, `email`, `profile`만 요청한다. Drive, Calendar 등 가계부 로그인에 필요 없는 scope는 추가하지 않는다.
5. **Clients → Create Client → Web application**을 선택한다.
6. Authorized JavaScript origin에는 production canonical origin을 넣는다.
7. Authorized redirect URI에는 §6.1의 Supabase callback을 exact하게 넣는다.
8. 생성된 Client ID와 Client Secret은 Google 화면에서 Supabase provider 설정으로만 옮긴다. 다운로드한 credential 파일은 source tree에 저장하지 않는다.
9. Supabase **Auth → Providers → Google**에 ID와 secret을 입력하고 활성화한다.
10. test user로 성공, 취소, state 오류, email 누락, logout·session refresh를 hosted HTTPS에서 검증한다.
11. 일반 공개 전에 publishing 상태와 brand/scope verification 필요 여부를 다시 확인한다. basic identity scope만 사용해도 production home/privacy/domain 요구는 남는다.

[Google web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [Supabase Google 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)

## 8. Kakao Login app

1. Kakao Developers에서 이 서비스 전용 앱을 만든다.
2. 앱 이름, 회사/개발자 정보, icon을 실제 서비스와 일치시킨다.
3. **앱 → 플랫폼 키 → REST API 키**를 사용한다.
4. **카카오 로그인 → 사용 설정**을 ON으로 한다.
5. REST API key의 redirect URI에 §6.1의 Supabase callback을 등록한다.
6. client secret 기능을 활성화하고 발급값은 Supabase provider 설정으로만 옮긴다.
7. 동의항목은 실제 로그인에 필요한 최소값만 설정한다. 전화번호, 성별, 생일, 연령 등은 현재 범위에서 요청하지 않는다.
8. email이 반드시 필요하다면 `account_email` 권한 조건과 Business App/추가 기능 심사 필요 여부를 확인한다. 권한을 얻지 못했을 때 더 민감한 정보로 대체하지 않고 Kakao login을 비활성화한다.
9. Supabase **Auth → Providers → Kakao**에 REST API key와 client secret을 입력한다.
10. test app 조건에서 성공, 사용자 취소, email 미제공·동의 거부, callback replay, logout 후 local session 폐기를 검증한다.
11. 개인정보 동의항목 심사가 필요하면 가입 화면, 개인정보 처리방침, 수집 목적·항목·필수/선택 조건이 모두 일치하는 자료만 제출한다. 제출 캡처에는 실제 개인정보를 넣지 않는다.

[Kakao Login 설정](https://developers.kakao.com/docs/ko/kakaologin/prerequisite)

## 9. Naver Login app

1. NAVER Developers에서 **Application → 애플리케이션 등록**을 연다.
2. 사용 API로 네이버 로그인을 선택하고 PC Web 환경을 등록한다.
3. 서비스 URL은 production 소유 도메인, callback은 §6.1의 Supabase callback으로 등록한다.
4. 제공 정보는 이용자 식별자와 실제 필요한 최소 정보만 선택한다. email이 없어도 계정을 안전하게 처리할 수 있도록 `email_optional=true` 설계를 유지한다.
5. Client ID와 Client Secret은 Supabase custom provider 설정으로만 옮긴다.
6. Supabase **Auth → Providers → New Provider → Manual configuration**에서 OAuth2 `custom:naver`를 만든다.
7. Supabase 화면의 callback을 Naver app과 다시 대조한다. authorization, token, userinfo endpoint는 Naver 공식 OAuth 문서의 현재 값을 사용한다.
8. Naver upstream이 PKCE를 지원하지 않는 현재 계약 때문에 custom provider의 upstream `pkce_enabled=false`가 필요한지 개발 project에서 확인한다. Account Book BFF→Supabase의 S256 PKCE는 끄지 않는다.
9. 개발 중에는 애플리케이션 등록자와 등록된 tester만 사용한다.
10. 성공, 취소, Naver state, callback replay, email 누락, refresh/revoke, stable user identifier mapping을 각각 검증한다.
11. 일반 사용자에게 열기 전에 사전 검수를 신청한다. 로그인 버튼부터 가입 완료까지의 전체 화면, 정보 활용처, 서비스 이름·logo를 제출하고 실제 개인정보는 가린다.

[Supabase custom OAuth](https://supabase.com/docs/guides/auth/custom-oauth-providers), [Naver 로그인 API](https://developers.naver.com/docs/login/api/api.md), [Naver 사전 검수](https://developers.naver.com/docs/login/verify/)

## 10. secret 입력 순서

### 10.1 먼저 만들 기록

값이 아닌 metadata만 기록한다.

| 변수/secret | 보관 플랫폼 | 소유자 | 생성일 | 다음 회전일 | Preview 허용 |
| --- | --- | --- | --- | --- | --- |
| BFF session DB credential | Vercel Production | 저장소 소유자 | TBD | TBD | 아니오 |
| API DB credential | Heroku Production | 저장소 소유자 | TBD | TBD | 아니오 |
| migration credential | 승인 one-off만 | 저장소 소유자 | TBD | 사용 직후 | 아니오 |
| provider-token envelope key | Vercel Production | 저장소 소유자 | TBD | TBD | 아니오 |
| CSRF HMAC key | Vercel Production | 저장소 소유자 | TBD | TBD | 아니오 |
| delegated JWT private key | Vercel Production | 저장소 소유자 | TBD | TBD | 아니오 |
| delegated JWT public keyring | Heroku Production | 저장소 소유자 | TBD | private key 회전과 연동 | 아니오 |
| Google/Kakao/Naver secret | Supabase provider settings | 저장소 소유자 | TBD | TBD | 아니오 |

정확한 애플리케이션 변수 이름은 [인증 환경 변수 가이드](auth-environment.md)를 기준으로 한다.

### 10.2 주입 순서

1. migration으로 role과 schema를 만든다.
2. BFF, API, migration DB credential이 서로 다른지 확인한다.
3. Vercel에 BFF-only secret을 입력한다.
4. Heroku에 API-only secret과 public keyring을 입력한다.
5. Supabase Auth에 provider client credential을 입력한다.
6. 배포 전 platform 화면에서 변수 **이름만** 상호 검토한다. 값 보기나 복사는 하지 않는다.
7. 새 SHA를 배포하고 health, login, `/api/me`, logout smoke를 실행한다.
8. smoke 성공 후 이전 key/credential을 폐기한다.

`.env`, `.env.*`는 Git에서 제외돼 있고 현재 추적 중인 env 파일은 없다. `.env.example`에는 실제 값과 실물 형태의 credential을 넣지 않는다.

## 11. 개인정보·국외 이전 고지 승인

이 절은 기술 준비 체크리스트이며 법률 자문이 아니다. 실제 금융 데이터 수집 전 한국 개인정보 전문가의 검토를 권장한다.

개인정보 보호법 제28조의8은 국외 제공·처리위탁·보관의 적법 근거와 고지·동의 요건을 규정한다. 최종 문안에는 최소한 다음 항목을 현재 DPA와 실제 region에 맞춰 채운다.

- 이전받는 자의 정확한 법인명과 연락처
- 이전 국가와 실제 처리·보관 region
- 이전되는 개인정보 항목
- 이전 목적
- 이전 일시와 방법
- 보유·이용 기간과 backup 삭제 시점
- 동의 거부 또는 서비스 계약상 처리 거부 방법과 그 결과
- 정보주체의 열람·정정·삭제·처리정지·문의 경로
- 재위탁/subprocessor 확인 경로
- 사고 통지와 피해구제 경로

[개인정보 보호법 제28조의8](https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029331979)

승인 절차:

1. Vercel, Heroku/Salesforce, Supabase의 현재 DPA와 subprocessor 목록에서 법인명·국가·연락처를 확인한다.
2. 기술 설계의 미국 동부 처리와 실제 dashboard region이 같은지 대조한다.
3. 개인정보 처리방침, 국외 이전 고지, 서비스 화면의 동의 문구를 같은 버전 번호로 만든다.
4. 수집 항목과 OAuth scope가 문안보다 넓지 않은지 확인한다.
5. 가입 전 쉽게 읽을 수 있는 위치에 고지하고 동의 시각·문안 버전을 기록한다.
6. 동의 철회와 계정 삭제가 DB, Storage, backup 보존 정책에서 어떻게 처리되는지 설명한다.
7. 게시 URL, 승인자, 승인일, 다음 검토일을 운영 기록에 남긴다.

## 12. 지인 베타 go/no-go

다음 표의 빈칸을 채우고 모두 승인되기 전에는 실제 금융 데이터를 받지 않는다.

| 항목 | 결정 |
| --- | --- |
| 초대 대상과 최대 인원 | TBD |
| 초대 방식 | 개인 초대만 / 공개 가입 비활성 |
| test data 기간 | TBD |
| 실제 데이터 저장 시작일 | 현재 미승인 |
| 지원·삭제 문의 이메일 | TBD |
| incident 연락 담당자 | 저장소 소유자 |
| RPO/RTO 고지 | 최대 24시간 / 목표 4시간 |
| 미국 동부 처리 고지와 동의 | TBD |
| backup 복구 성공일 | TBD |
| hosted OAuth 3종 성공 SHA | TBD |
| key rotation·kill switch 훈련일 | TBD |
| 한국망 p95 측정 | TBD |

Go 조건:

- 모든 administrator MFA와 backup factor가 확인됐다.
- production과 Preview secret이 분리됐다.
- 모든 release gate가 같은 commit SHA에서 통과했다.
- 두 사용자 간 금융 데이터 격리와 최소 권한이 hosted DB에서 증명됐다.
- Google·Kakao·Naver 중 실제로 제공할 provider만 live smoke를 통과했다.
- backup을 별도 환경에 복원하고 RTO 안에 읽기·무결성 검증을 완료했다.
- 개인정보·국외 이전 문안이 게시되고 동의 기록·삭제 문의 경로가 동작한다.
- beta 사용자가 RPO 24시간과 기능 제한을 이해하고 동의했다.

No-go 조건:

- 금융 핵심 기능이 아직 구현되지 않았거나 test data만 검증됐다.
- rate limit, role, backup, provider, privacy gate 중 하나라도 미완료다.
- production secret을 Preview나 로컬 공유 파일에 넣어야만 동작한다.
- 오류·로그·브라우저 storage에서 token, selector, DB URL, 금융 메모가 발견된다.

현재 판단은 **No-go**다. 플랫폼 계정과 개발 앱은 준비할 수 있지만 금융 핵심 기능과 hosted 운영 gate가 끝나기 전에는 실제 수입·지출 내역 저장 시작일을 승인하지 않는다.
