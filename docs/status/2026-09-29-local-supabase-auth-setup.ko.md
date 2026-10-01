# 로컬 Supabase 인증 연결 — DB·서버 적용 기록

확인일: 2026-09-29. 코드 기준: `feature/bank-state-transitions`, `f72f91f482c622fc9bb85fd6e9c793d5257d58f3`.

## 지금 가능한 것과 아직 안 되는 것

사용자가 승인한 새 개발용 Supabase에 인증 테이블 7개와 BFF/API 최소 권한 계정을 적용했다. 로컬 HTTPS 웹·NestJS API·독립 서버 키를 연결했고 CSRF는 기존 503에서 200으로 바뀌었다. 실제 역할 DB 검사 32개, HTTP 통합 검사 13개를 통과했다. 사용자 승인 후 현재 Windows 사용자 계정에 개발 CA를 신뢰 등록하고 Windows 기본 검증으로 `/sign-up` HTTPS 200을 확인했다. **실제 이메일 가입·확인·로그인 전체 여정은 아직 미완료**다. Supabase Redirect URLs 3개는 사용자 화면에서 확인했으며 Site URL의 HTTPS 변경·저장 확인이 남아 있다. [실행·학습 가이드](../guides/local-auth-development.ko.md)를 참고한다.

- [x] 새 개발 프로젝트 확인
- [x] 로컬 공개 연결 정보 설정과 Git 제외 확인
- [x] 실제 Supabase 인증 설정 읽기 요청 성공
- [x] DB 입력 파일 저장 여부 및 URI 형식 점검: 사용자 수정 후 지정 프로젝트의 Session pooler URI 확인
- [x] PostgreSQL 접속 및 앱 전용 스키마·역할 존재 여부의 읽기 전용 점검
- [x] PC→풀러 TLS 1.3, 공식 CA·호스트명 검증 성공
- [x] 사용자 SSL enforcement 활성화 확인 및 새 연결의 풀러→DB TLS 1.3 재검증
- [x] 검토된 개발 DB migration 적용과 최소 권한 런타임 계정 구성
- [x] 로컬 origin/HTTPS 서버, API 연결, 독립 서버 키 구성
- [x] Windows 현재 사용자 계정에 개발 CA 신뢰 등록: 명시적 승인 후 등록, 기본 HTTPS 검증 200
- [x] Supabase 정확한 callback allowlist 3개: 사용자 제공 화면에서 확인
- [ ] Supabase Site URL을 `https://localhost:3000`으로 변경·저장했는지 확인
- [ ] 이메일 가입·이메일 확인·로그인·로그아웃 전체 검증
- [ ] Google·Kakao·Naver 각각의 공급자 설정과 실제 인증 검증
- [ ] 로그인 이후 장부 화면 구현과 연결

## 최신 실행 결과 — 2026-09-29 후속 작업

- 실제 적용 시각: 2026-09-29 12:56:54 KST. 인증 migration 4개, `app_private` 테이블 7개. 금융 스키마·은행 호출은 제외했다.
- BFF: `app_bff_login`이 NOLOGIN `app_session_bff` 그룹을 상속. API: 별도 `app_api`. 관리자 자격증명은 런타임에 전달하지 않았다.
- 실제 역할의 TLS, 허용 CRUD, 교차 접근 거부, owner 전환 거부, DDL 거부 등 32개 검사 통과. 쓰기 probe는 모두 롤백했다.
- HTTPS CSRF 200·no-store·Secure/HttpOnly 쿠키, 비인증 401, CSRF/교차 출처 403, 실제 Supabase 잘못된 로그인 401, 위임 JWT 200 및 replay 401 등 13개 HTTP 검사 통과.
- `/sign-up` 200, `/app` 404. 로그인 후 장부 화면은 여전히 미구현이다.
- 관리형 postgres의 ALTER ROLE 권한 문제와 API의 Supavisor 사용자명 형식 거부를 재현한 뒤 보완했다. 실제 SQL 전체 rollback 검사와 API 환경 테스트 18개 RED→GREEN을 확인했다.
- 독립 리뷰 Important 2개: 테스트 명령과 정책 기대값 불일치, 초기화 전 Windows ACL 검사 누락. 각각 재현 후 보완했으며 관련 10개 테스트와 실제 디렉터리 ACL 확인을 통과했다. Critical/Minor 확정 항목은 없었다.
- 로컬 비밀은 Git/OneDrive 밖에 보관하며 현재 사용자/SYSTEM ACL을 확인했다. 초기에는 CA 신뢰 등록을 보류했고, 이후 사용자의 명시적 승인으로 CurrentUser Root에만 등록했다. LocalMachine Root는 변경하지 않았다.
- 브라우저 자동화는 Windows helper ACL 오류로 시작 실패. 따라서 사용자 화면 실제 가입 성공은 미검증으로 유지한다.
- 전체 `pnpm test`: **1,199개 통과** (repository 201 + contracts 74 + database 19 + API 176 + web 643 + E2E preflight 86). `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check` 모두 종료 코드 0. 이번 빌드 로그에서 warning/deprecated/error 패턴은 없었다. `pnpm test:db`는 별도 폐기용 DB가 없어 실행하지 않았다. hosted 역할 검사를 파괴적 DB suite 전체 성공이라고 표현하지 않는다.
- 적용 후 메타데이터: 인증 테이블 7개 소유자는 postgres, anon/authenticated/service_role의 app_private USAGE는 모두 false, app_bff_login의 유일한 부모 역할은 app_session_bff이며 ADMIN OPTION=false. replay 만료 정리 작업은 매분 활성화되어 있다(스케줄 등록 확인이며 실제 정리 실행 이력까지 검증한 것은 아니다).
- 변경은 미커밋이다. 사용자의 `.gitignore` 변경 및 Next 자동 생성 파일은 보존했다.
- Git 대상 472개 파일을 새 비밀값과 대조해 일치 0건을 확인했다(값은 출력하지 않음). `apps/web/.env.local`은 `.env.*` 규칙으로 제외되고 추적 중인 실제 env 파일은 없다. 서버는 최종 점검 시 웹/API 모두 `127.0.0.1`에만 바인딩되어 있다.

## 2026-09-29 로컬 HTTPS 신뢰 등록 후 확인

- 사용자 화면의 `ERR_CERT_AUTHORITY_INVALID`와 Windows 신뢰 저장소 미등록 상태를 확인한 뒤 승인을 받았다.
- 기존 mkcert 공개 CA가 실제 localhost 서버 인증서의 발급자인지, 유효 기간·호스트명·서명·실제 서버 인증서 일치를 검증했다. CA 개인키를 읽거나 공유하지 않았다.
- 등록 위치: `Cert:\CurrentUser\Root`. 인증서 thumbprint: `330AD908B9BF9BAA4047980ADDCE1E14BA12ED65`(공개 식별자). 현재 사용자 등록=true, 시스템 전체 등록=false를 확인했다.
- 별도 CA 지정이나 TLS 우회 옵션 없이 Windows `Invoke-WebRequest`로 `https://localhost:3000/sign-up` HTTP 200을 확인했다. 실제 브라우저 화면의 경고 해소 및 가입 성공까지 확인한 것은 아니다.
- `/`는 페이지 미구현으로 404이며 HTTP 접속은 HTTPS 전용 서버에서 연결이 끊긴다. 진입 주소는 `/sign-up` 또는 `/login`이다. 경고가 남으면 먼저 새로고침하고 필요 시 브라우저를 다시 시작한다.
- 이 후속 작업은 로컬 신뢰 설정, MD 2개와 Notion 인증 카드 기록만 변경했다. 기능 코드·DB·Supabase 대시보드 설정은 변경하지 않았고 전체 회귀 테스트도 재실행하지 않았다.

## 이전 준비 단계의 기록

아래 내용은 SQL 적용 전 확인 과정의 이력이다. 현재 상태는 위 최신 실행 결과가 우선한다.

### 당시 변경 범위

기능 코드는 수정하지 않았다. 공개 설정 파일 1개, 비밀번호 입력용 임시 템플릿 1개, 이 진행 문서 1개를 추가한다. Notion의 `02. 로그인·가입·복구·소셜 인증` 카드에도 완료/미완료 범위를 구분해 기록한다.

| 파일 | 역할 | 보안 경계 |
| --- | --- | --- |
| `apps/web/.env.local` | Supabase 루트 URL, 공개 키, 인증 어댑터 선택 | `.env.*` 규칙으로 Git 제외. 현재는 공개 연결 정보만 저장 |
| `%LOCALAPPDATA%/Temp/account-book-supabase-setup.env` | 사용자가 DB 접속 URI를 입력할 초기 설정용 파일 | 프로젝트와 OneDrive 밖. 암호화 저장소가 아니므로 설정 이후 비밀번호 제거 필요 |
| 이 문서 | 확인 결과와 다음 절차 | 키·비밀번호·전체 DB 접속 문자열을 기록하지 않음 |

기존 변수 이름 `SUPABASE_ANON_KEY`에 publishable key를 넣었다. 코드가 사용하는 변수 이름을 유지한 것으로, 관리자용 `secret` 또는 `service_role` 키를 넣은 것이 아니다. REST 경로 `/rest/v1/`가 아니라 프로젝트 루트 URL을 `SUPABASE_URL`로 사용한다.

## 확인한 증거

실제 프로젝트의 `/auth/v1/settings`에 GET 요청만 실행했다. `apikey` 헤더만 사용하는 경우와 현재 어댑터처럼 같은 공개 키를 `apikey` 및 `Authorization: Bearer`에 보내는 경우 모두 HTTP 200이었다. 응답 전체를 로그에 남기지 않고 필요한 설정만 확인했다.

| 확인 항목 | 결과 |
| --- | --- |
| 이메일 인증 | 활성화 |
| 신규 가입 제한 | 비활성화: 가입이 허용되는 설정 |
| 이메일 자동 확인 | 비활성화: 이메일 확인이 필요한 설정 |
| Google / Kakao | 둘 다 비활성화 |
| Naver | 이번 설정 응답으로 확인하지 못함 |

이 조회 성공만으로 가입 POST, SDK의 PKCE 흐름, 공급자별 callback, 세션 저장이 검증되는 것은 아니다. 실제 계정 생성·이메일 발송·은행 호출·SQL 변경·결제 변경은 실행하지 않았다. 기능 코드를 수정하지 않았으므로 이번 작업에서 테스트 코드 추가나 전체 회귀 재실행은 하지 않았다.

추가 재확인: 기존 로컬 서버 세션이 종료되어 `127.0.0.1:3000` 전용 Next 개발 서버를 재시작했다. `.env.local` 로드를 확인했고, `/sign-up`은 HTTP 200, `/api/auth/csrf`는 HTTP 503이었다. 따라서 공개 키 연결 이후에도 전체 인증 환경은 아직 준비되지 않았다.

## 회원가입이 계속 막힐 수 있는 이유

공개 키는 Supabase 인증 API에 접근할 때 쓰는 프로젝트 식별 정보다. 이 앱이 직접 저장하는 세션과 OAuth 임시 요청은 별도의 PostgreSQL 저장소가 필요하다. 웹 BFF 컨테이너는 `APP_ORIGIN`, 세션 DB, API 주소, CSRF·암호화·서버 간 JWT 설정도 검사한다. 공개 키만으로 이 준비가 완료되지 않는다.

설정 전 진단에서 공통 CSRF 경로가 HTTP 503을 반환했다. 가입과 소셜 로그인은 이 단계를 먼저 거치므로 둘 다 중단됐다. 또한 당시 `/app` 경로가 없었으므로 인증 연결과 로그인 이후 화면 구현을 별개로 추적한다.

인증 구조는 Next.js 웹 BFF → Supabase Auth 및 세션 DB, 그리고 Node.js/NestJS API다. 이번 작업은 인증 로직을 NestJS로 이전하는 작업이 아니다.

## 다음 절차

### 2026-09-29 최초 입력 파일 확인 결과 — 이후 수정으로 해소

사용자의 저장 완료 안내 후, 입력 파일의 값 자체를 출력하지 않고 환경 변수 존재 여부와 URI 형식을 점검했다. `MIGRATION_DATABASE_URL`은 한 번 정의되어 있고 값도 있지만, `postgresql://` 또는 `postgres://` 접속 주소가 포함되어 있지 않아 URI 파싱에 실패했다. 비밀번호만 입력한 것인지는 단정하지 않는다.

안전 조치: 이 값으로 원격 DB 인증을 시도하지 않았다. 따라서 TLS, 스키마, 역할, DB 비밀번호의 유효성은 아직 미검증이다. SQL 실행, migration 적용, 권한 변경은 없었다. 이번 추가 변경은 이 진행 문서와 Notion 기록뿐이며 기존 사용자 설정값을 임의로 고치거나 호스트를 추정하지 않았다.

필요한 사용자 조치: Supabase의 **Connect → URI → Session pooler**에서 전체 문자열을 복사한다. 그 문자열 안의 `[YOUR-PASSWORD]`만 실제 DB 비밀번호로 바꾼 다음, 임시 파일의 `MIGRATION_DATABASE_URL=` 오른쪽 값 전체를 교체하고 저장한다. 비밀번호만, REST API URL, publishable key는 PostgreSQL 접속 URI를 대신할 수 없다. 완성된 값은 채팅에 보내지 않는다.

### 2026-09-29 수정 후 실제 DB 점검 결과

아래는 SSL enforcement 활성화 전 점검 이력이다. URI 오류는 이미 해소되었으며, SSL 상태의 최신 결과는 아래의 활성화 후 재검증 절을 따른다.

| 점검 | 결과와 의미 |
| --- | --- |
| 접속 정보 | 지정 프로젝트의 Session pooler, 포트 5432, DB `postgres`로 확인. 인증 성공 |
| 최초 TLS 시도 | 기본 신뢰 목록으로는 `SELF_SIGNED_CERT_IN_CHAIN`. 인증서 검증을 끄지 않고 중단 |
| 공식 CA 적용 | Supabase 공식 대시보드 소스의 인증서 배포 주소에서 HTTPS로 읽어 이번 클라이언트에만 지정. PC 전역 신뢰 저장소 변경 없음 |
| PC→풀러 | 인증서·호스트명 검증 성공, `authorized=true`, TLS 1.3 |
| 읽기 전용 | `BEGIN READ ONLY`와 `transaction_read_only=on` 확인 후 메타데이터 SELECT, 종료 시 ROLLBACK |
| DB 버전 | PostgreSQL 17.6 |
| 앱 스키마 | 조회 대상 중 `auth`만 존재. `app_private`, `app_bank`, `supabase_migrations`는 없음. 앱 전용 테이블도 없음. 전체 DB에 데이터가 없다는 의미는 아님 |
| 앱 역할 | `app_session_bff`, `app_api` 없음. 현재 `postgres`는 관리자 성격의 BYPASSRLS·역할/DB 생성 권한을 가지므로 앱 런타임으로 사용 금지 |
| 확장 | `pgcrypto` 1.3 설치, `pg_cron`은 사용 가능 목록에 있으나 미설치 |
| 풀러→DB | 활성화 전 backend의 `pg_stat_ssl.ssl=false`, TLS version 없음. 이후 활성화 후 재검증에서 해소됨 |
| Direct 연결 대안 | 같은 프로젝트의 공식 Direct endpoint로 검증된 TLS 연결을 시도했으나 DNS `ENOTFOUND`. 원인을 IPv6 문제로 단정하지 않음 |

CA 출처: [Supabase 공식 대시보드 설정 소스](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json)의 `ssl:certificate_url`이며 production 공개 CA를 사용했다. 유효 기한은 2031-04-26, SHA-256 지문은 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`다. CA 인증서는 비밀값이 아니며 이번에는 메모리에서만 사용했다.

사용자 계정·금융 데이터 행은 조회하지 않았다. DB 스키마·권한·확장·예약 작업은 변경하지 않았고, 실제 회원가입·이메일 발송도 하지 않았다. 공개 키나 DB 비밀번호, 접속 URI는 로그·문서·Notion에 남기지 않았다.

### 2026-09-29 SSL enforcement 활성화 후 재검증 — 완료

사용자가 대시보드에서 설정을 켰다고 알린 뒤, 2026-09-29 12:39:47 KST(03:39:47 UTC)에 새 Session pooler 연결을 만들어 다음을 확인했다.

| 구간/점검 | 실제 관측 결과 |
| --- | --- |
| PC→풀러 | 공식 CA 지문 확인, 인증서·호스트명 검증 유지, `authorized=true`, `TLSv1.3` |
| 풀러→DB | 현재 backend의 `pg_stat_ssl.ssl=true`, `version=TLSv1.3`, `bits=256` |
| SQL 안전 경계 | `transaction_read_only=on`, 메타데이터 SELECT 후 ROLLBACK |
| 앱 초기화 상태 | 조회한 앱 스키마 범위에는 `auth`만 있고 `app_session_bff`·`app_api` 역할은 여전히 없음 |

확인 범위는 이번 연결에서 두 구간이 TLS를 사용한다는 사실이다. 풀러가 upstream 인증서를 어떻게 검증하는지, 모든 클라이언트의 설정, 비TLS 연결 거부 여부까지 이 결과 하나로 검증한 것은 아니다. 대시보드 설정 변경 주체는 사용자이며 에이전트는 관리 API나 DB 쓰기를 실행하지 않았다. 실제 가입/로그인 성공 및 운영 배포 완료와 구분한다.

### 다음 작업과 안전 경계

1. 인증용 기존 migration 네 개의 Supabase 17.6 호환성, 역할 소유권, `pg_cron` 생성·만료 자료 정리 범위를 검토한다. 읽기 전용 점검 성공만으로 원격 migration을 일괄 실행하지 않는다.
2. BFF와 API의 최소 권한 로그인 계정·CA 연결 설정을 분리한다. 관리자 URI를 `.env.local`의 런타임 URL로 복사하지 않는다.
3. 로컬 HTTPS/origin·CSRF·토큰 암호화·서버 간 JWT 키 및 API 설정을 구성한다. 가입·이메일 확인·로그인 전체 여정은 그 뒤에 검증한다.

이번 후속 수정은 이 MD와 Notion 인증 카드뿐이다. 기존 DB 연결 라이브러리에서 connection string을 전달한다는 사실은 확인했지만, 실제 런타임 CA·pool 설정과 최소 권한 검증은 아직 구현/적용하지 않았다. 전체 테스트 재실행이나 배포 완료로 표시하지 않는다.

관련 근거: [공식 SSL 검증 안내](https://supabase.com/docs/guides/platform/ssl-enforcement), [Supavisor와 PostgreSQL 연결 관측 안내](https://supabase.com/docs/guides/troubleshooting/monitor-supavisor-postgres-connections).

### 최초 설정 절차 참고

1. Supabase Dashboard의 **Connect**에서 PostgreSQL 연결 문자열을 확인한다. IPv4 환경에서는 **Session pooler**를 사용할 수 있다. Transaction pooler와 구분하고, 표시된 실제 호스트를 복사한다.
2. 임시 입력 파일의 `MIGRATION_DATABASE_URL=` 오른쪽에 접속 URI를 저장한다. `[YOUR-PASSWORD]`는 실제 DB 비밀번호로 바꾸고, URI 예약문자는 percent-encode한다. 채팅으로 보내지 않는다.
3. 접속 가능 여부, TLS 설정, 기존 스키마와 역할을 먼저 읽기 전용으로 확인한다. 접속 정보가 들어왔다는 이유만으로 검토 없이 전체 migration을 실행하지 않는다.
4. 기존 migration과 신규 Supabase 환경의 호환성을 점검한 후 개발 DB 설정 범위 및 변경 파일을 기록하고 진행한다.
5. `app_session_bff`와 API 역할 등 최소 권한 연결을 분리한다. 관리자 `postgres`/owner 연결을 웹이나 API의 런타임 `DATABASE_URL`에 그대로 넣지 않는다.
6. 서버 간 JWT 서명 키는 앱이 별도로 생성하는 키다. Supabase의 JWT Secret을 사용자에게 요청하거나 재사용하지 않는다.
7. 로컬 HTTPS·origin·서버 설정을 맞춘 뒤 합성 테스트와 사용자 승인된 테스트 계정 흐름을 검증한다. 그 다음 공급자별 소셜 로그인과 로그인 후 화면을 진행한다.

Direct connection은 migration 도구의 기본 선택이지만 기본 네트워크는 IPv6다. PC에서 IPv4만 가능한 경우 Session pooler가 대안이므로 유료 IPv4 옵션부터 구매할 필요는 없다. 최종 연결 방식과 TLS 검증은 실제 접속 환경에서 확인한다.

근거: [Supabase PostgreSQL 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase API 키 안내](https://supabase.com/docs/guides/getting-started/api-keys).
