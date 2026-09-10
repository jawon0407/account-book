# 프로젝트 폴더 구조와 역할별 리팩터링 지도

- 기준: 2026-09-10, HEAD `66a2319`, `feature/vercel-region-policy`.
- 상태: **R1 구현·검증·리뷰 완료 / R2 이후 개별 착수 전**. [R1 실행 계획 및 실제 결과](../superpowers/plans/2026-09-10-auth-adapter-role-split.md)을 우선한다. R1은 미커밋이며 푸시·배포하지 않았다.
- 확인 방법: 저장소 파일 목록·줄 수 집계, 주요 클래스/함수 책임과 일부 중요 구현의 정적 확인. 프로젝트 전체 보안 감사·중복 코드 자동 분석·새 테스트 실행 결과가 아니다.
- 아래 줄 수와 구조는 분리 전 조사 기준이다. R1은 기존 linked worktree의 `feature/auth-adapter-role-split`에서 제품·테스트의 동작 보존 분리를 마쳤다. 패키지·DB·Git 커밋은 변경하지 않았으며 기존 `.gitignore` 수정은 보존했다.

## 1. 현재 실제 구조

```text
apps/
  web/                              # Next.js 웹 + 브라우저 전용 서버 진입점(BFF)
    src/
      app/                          # URL별 page/layout, 전역 CSS, Query Provider
        (auth)/                     # 로그인·가입·복구·메일 확인 화면
        api/                        # BFF route: 인증, CSRF, 세션, 현재 사용자
      components/auth/              # 인증 화면/폼/상태/소셜 버튼
      queries/                      # TanStack Query용 인증 요청/옵션
      lib/http/                     # 브라우저 ky 통신 및 CSRF 처리
      server/
        auth/                       # 이메일·OAuth·복구 서비스, 공급자 어댑터/포트
        http/                       # HTTP controller, route 연결, 위임 API 호출
        session/                    # 로컬 세션 생성·갱신·조회·폐기
        persistence/                # 인증 저장소 계약과 PostgreSQL 구현
        security/                   # 쿠키·CSRF·Origin·PKCE·암호화·JWT 서명
        container.ts                # 설정 검증과 의존성 조립, 공유 DB 관리
  api/                              # NestJS + Fastify API
    src/
      auth/                         # JWT 검증, 가드, scope, raw body
      common/                       # request ID, 공통 오류 응답
      me/                           # 보호된 현재 사용자 조회
      persistence/                  # JWT 재사용 방지 저장소
      types/                        # Fastify 타입 보강
packages/
  contracts/src/                    # auth/accounts/categories/transactions 등 계약
  database/src/                     # Drizzle client 및 auth/api 스키마
supabase/
  migrations/                       # DB 변경 이력(SQL)
  seed/                             # 초기 데이터 관련 자원
tests/
  database/                         # 실제 PostgreSQL 기반 migration/권한 등 검증
  e2e/                              # HTTP·UI·layout 및 안전한 테스트 실행 경계
scripts/
  security/                         # secret 검사·push 정책·Git 변경 판독
  ...                               # 저장소 구조·workspace·hook 검사
.github/workflows/                  # CI 보안/품질 gate
docs/                               # API·설계·DB·보안·가이드·진행/계획
```

소규모 테스트는 제품 파일 옆의 `*.test.ts(x)`에 있고, DB/E2E는 별도 workspace에 있다. `.agents`, `.codex`, `.superpowers`, `.gstack`은 도구/작업 기록, `node_modules`, `output`은 의존성/산출물로 제품 구조 개편 대상이 아니다. 별도 `apps/mobile`은 아직 없다. 가계부 accounts/categories/transactions 계약이 존재한다고 실제 금융 CRUD와 모바일 동기화까지 완성된 것은 아니다.

## 2. 판단: 상위 경계는 유지하고 내부를 단계별로 분리

현재도 앱/공유 계약/DB 스키마/보안 유틸리티는 나뉘어 있다. 문제는 폴더 전체가 없는 것이 아니라 일부 파일 안에 여러 변경 이유가 모여 있다는 점이다.

| 대안 | 장점 | 단점 |
| --- | --- | --- |
| A — 추천: 현재 상위 폴더 유지, 큰 책임 묶음을 단계별 분리 | 기존 import·테스트·보안 경계를 보존하기 쉽고 단계별 되돌리기 가능 | 일정 기간 기존/신규 내부 폴더가 함께 존재 |
| B: 모든 코드를 기능별 feature 폴더로 재배치 | 기능별 코드 탐색이 쉬워질 수 있음 | 아직 인증 중심인 프로젝트에서 이동·공유 경계 재설계 비용이 큼 |
| C: 줄 수 기준 일괄 자동 분할 | 파일 크기를 빠르게 줄일 수 있음 | 결합된 로직이 흩어지고 순환 의존·테스트/권한 검사 누락 위험 |

A안에서는 server-side 리팩터링과 browser 번들 분할을 구분한다. 파일을 나눴다고 FCP나 서버 응답 시간이 자동으로 개선되지는 않는다. 동적 import는 이후 실제 번들/측정 근거가 있을 때만 제안한다.

## 3. 단계별 후보, 파일 지도, 예상 규모

줄 수는 주석·빈 줄을 포함한다. 각 단계의 파일 수는 제품·테스트·설정·결과 문서를 포함한 초기 추정이며 여러 단계가 같은 문서를 수정하므로 합산한 고유 파일 수가 아니다. 상세 승인 전 실제 변경 목록을 다시 확정한다.

### R1. Supabase 어댑터 — 중간 규모, 약 14파일

- 현재: `apps/web/src/server/auth/supabase-auth-adapter.ts` 625줄, 테스트 465줄.
- 기존 공개 파일 유지, `auth/supabase/{validation,session-parser,error-mapper,http-client,sdk-client}.ts` 신규 후보.
- 테스트를 통합 경계/응답 검증/오류 시나리오로 나누고 test-fixtures를 테스트 전용으로 둔다.
- `apps/web/vitest.config.ts`의 명시적 coverage 대상에 새 제품 파일을 포함한다. 임계값을 낮추지 않는다.
- 약 500~800줄 이동·재배치 예상, 새 사업 로직 추가 없음. 상세 [어댑터 분리안](2026-09-10-auth-role-split-review.ko.md)을 따른다.

### R2. HTTP 인증 controller와 조립부 — 중대 규모, 약 12~18파일

- 현재: `apps/web/src/server/http/auth-controller.ts` 779줄, 테스트 630줄. `apps/web/src/server/container.ts` 297줄.
- controller는 고정 오류 응답, JSON/redirect, cookie 직렬화/읽기, 제한된 본문 읽기, 검증 순서, 여러 인증 작업 호출을 함께 가진다.
- 기존 `auth-controller.ts`/`AuthController`/`safeAuthFailure` 외부 경로를 유지한다. 신규 후보는 `http/auth/{responses,request-input,request-security,controller-context}.ts`, 필요에 따라 `http/auth/handlers/{credentials,oauth,password,session}.ts`다.
- 조립부는 `server/runtime/auth-config.ts`와 `server/runtime/shared-database.ts` 후보를 검토한다. `container.ts`는 의존성 조립을 유지한다. 공유 DB가 요청마다 새로 생성되지 않게 한다.
- 약 600~900줄 이동 후보이나 handler 분리를 필수로 고정하지 않는다. response/input 추출만으로 책임이 명확하면 추가 계층을 만들지 않는다.
- **보존 조건:** Origin/CSRF/selector/body 검사가 side effect보다 먼저 실행되는 순서, cookie 속성, no-store, 오류 코드/상태, callback URL, 요청별 객체/프로세스 공유 객체의 수명.

### R3. 인증 UI와 CSS — 중간 규모, 약 9~14파일

- 현재: `apps/web/src/components/auth/auth-form.tsx` 293줄. 로그인/가입 공통 폼, 복구 요청, 비밀번호 변경, 입력 오류·피드백 문구가 함께 있다.
- 신규 후보 `components/auth/forms/{credentials-form,password-reset-request-form,password-update-form,form-feedback}.tsx` 또는 순수 로직은 `.ts`. 기존 `auth-form.tsx`는 외부 export 호환용 진입점으로 유지 가능하다.
- 폼 공통 hook은 중복 상태 전이와 안정적인 인터페이스가 확인될 때만 만든다. 로그인과 복구의 다른 정책을 억지로 하나의 거대 generic 폼에 넣지 않는다.
- `apps/web/src/app/globals.css`는 200줄로 길이만으로 분리할 필요는 낮다. 공통 token/base와 인증 전용 스타일의 범위를 나누는 것은 유용하다. 후보 `src/styles/{tokens,base,auth}.css`를 기존 globals에서 순서대로 import한다. CSS Modules 전환은 별도 선택지이며 이번 기본안에 넣지 않는다.
- 약 250~450줄 이동 후보. `app/layout.tsx`, 인증 페이지와 UI 테스트는 import·client 경계 영향에 따라 확인한다.
- **보존 조건:** 기존 DOM/class/label/aria, 오류 포커스, 중복 제출 방지, 성공 callback, 계정 열거 방지 문구, 중립 오프화이트·약한 그림자·반응형 너비·reduced-motion.
- 기존 동작 테스트는 유지한다. 순수 CSS 이동에는 새 테스트 코드를 강제하지 않고 실제 브라우저 경계 폭과 키보드 동작을 확인한다. 폼 동작/상태를 바꾸면 별도 승인을 받는다.

### R4. PostgreSQL 인증 저장소 — 중대 규모·높은 보안 위험, 약 10~16파일

- 현재: `apps/web/src/server/persistence/postgres-auth-repository.ts` 589줄, 테스트 424줄.
- DB 행→도메인 객체 변환과 session/OAuth/email/recovery 쿼리가 한 파일에 있다.
- 기존 `PostgresAuthRepository`/`AuthRepository` 계약은 유지한다. 신규 후보 `persistence/postgres/{record-mappers,session-queries,oauth-queries,email-confirmation-queries,recovery-queries}.ts`다.
- 약 400~600줄 이동 후보. `auth-repository.ts`, `tests/database/auth-migration.test.ts`와 회귀 검사 범위를 확인한다. 새 pool·migration·권한 변경은 없다.
- **핵심:** `consumeRecoveryAndRevokeSessions()`는 복구 소비·minimumAcceptedIat 상향·전체 세션 폐기를 같은 transaction에서 수행한다. 파일이 나뉘어도 동일 transaction executor로 실행하고 각각 독립 commit하지 않는다. createSession의 보안 상태 잠금도 유지한다.
- 실제 폐기용 PostgreSQL로 rollback·동시성·권한 회귀 검사가 필요하다. 실행 환경이 없으면 정적/unit 결과만으로 DB 단계 완료를 선언하지 않는다.

### R5. 대형 테스트와 남은 응집도 점검 — 중간 규모, 약 8~16파일의 별도 후보

- 현재 테스트: `tests/e2e/ui-facade-boundary.test.ts` 933줄, `tests/e2e/support/transport-tripwire.test.ts` 799줄, `tests/e2e/support/safe-ui-test.test.ts` 685줄, `apps/api/src/auth/mutation-boundary.integration.test.ts` 652줄.
- 후보: import/경로/syntax/capability 또는 framing/인증/본문 경계별 테스트 파일과 전용 fixture. 모든 단계에서 자신이 건드린 제품 테스트는 함께 정리하며, 이 단계는 독립적인 대형 검사 도구 테스트의 나머지를 대상으로 한다.
- 테스트는 표 기반 사례가 많으면 길어도 응집도가 좋을 수 있다. 줄 수만으로 분리하지 않으며 coverage와 test discovery가 그대로인지 확인한다. E2E의 안전 facade import 허용 목록을 편의를 위해 넓히지 않는다.
- `session-service.ts` 408줄은 세션 상태 전이 책임이 모여 있다. 필요하면 순수 validation/mapping만 추출하고 갱신 경쟁·폐기 순서를 한 흐름으로 유지한다. 별도 상태 머신 도입은 범위 밖이다.
- 신규 파일명과 이동량은 해당 단계 진입 시 사례별 영향 확인 후 확정한다. 지금 일괄 구현 승인을 요구하지 않는다.

## 4. 당장 나누지 않을 영역

- `apps/api/src/auth`는 JWT verifier/guard/scope/raw-body가 이미 분리돼 있다. 239줄 verifier를 길이만으로 쪼개지 않는다.
- `packages/contracts/src`는 auth/accounts/categories/transactions/internal-api 계약별로 나뉘어 있다. 서버 비밀 타입을 공용 패키지로 옮기지 않는다.
- `packages/database`는 client와 auth/api schema로 분리돼 있다. DB 연결·세션 저장·API replay의 서로 다른 소유권을 억지로 공용 서비스 하나에 합치지 않는다.
- `apps/web/src/lib/http`와 `queries`의 브라우저 통신/서버 상태 역할은 유지한다. 이번 리팩터링을 이유로 새 상태관리 라이브러리를 설치하지 않는다.
- security 암호화/CSRF/PKCE/JWT 코드는 기존 독립 모듈을 유지한다. SQL migration의 과거 이력은 정리 대상으로 수정하지 않는다.
- 미구현 모바일·원장 기능용 빈 폴더나 추상화는 미리 만들지 않는다.

## 5. 공통 실행 규칙과 승인 범위

추천 구조는 **현재 모노레포 경계 유지 → 내부 역할 분리 → 필요할 때 기능별 하위 폴더 추가**다. 파일당 150~250줄은 검토 신호일 뿐 강제 제한이 아니다. 함수 역할·매개변수·반환·실패 원리의 한국어 주석은 유지하고 반복 설명만 통합한다.

각 단계는 파일 지도/규모 확정 → 기존 테스트 baseline → 작은 단위 이동 → import/type/동작 회귀 확인 → 전체 verify/해당 경계 검사 → 독립 리뷰/문서 → 별도 커밋 단위 순서다. 외부 동작·보안 정책·SQL 조건은 바꾸지 않고, 버그 발견 시 구조 변경과 구분해 보고한다. 새 로직을 넣는 경우 회귀 테스트를 먼저 추가한다. 순수 이동에 인위적인 실패를 만들지 않는다.

`docs/architecture/{frontend,backend-authentication}.ko.md`, `docs/guides/security-auth-testing.md`, `docs/status/2026-08-24-development-progress.ko.md`를 관련 단계별로 갱신한다. 커버리지/경계 검사에서 새 파일을 빠뜨려 통과시키지 않는다. 운영 secret·실제 금융 데이터·패키지 업그레이드·배포·대규모 framework 전환은 모두 제외한다.

R1~R5 전체는 소규모 정리가 아니라 여러 작업 단위의 중대 리팩터링이다. R1을 시작점으로 하며 다음 단계마다 실제 필요성과 범위를 다시 확인한다. 보안 안정성 기능인 인증 시간 제한을 모든 리팩터링 뒤로 반드시 미루지는 않는다. R1 후 새 구조에서 시간 제한을 추가할지 R2를 이어갈지 우선순위를 확인한다. **2026-09-10 R1 착수 승인을 받았으며 R2~R5와 인증 시간 제한의 자동 착수는 승인 범위가 아니다.**
