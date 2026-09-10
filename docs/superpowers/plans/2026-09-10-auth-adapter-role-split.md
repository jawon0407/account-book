# R1 Supabase 인증 어댑터 역할 분리 실행 계획

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 외부 인증 동작은 그대로 유지하면서 긴 어댑터를 책임별로 읽고 수정할 수 있게 나눈다.

**Architecture:** 기존 공개 어댑터가 인증 흐름을 조합하고, 내부 validation / session-parser / error-mapper / http-client / sdk-client가 각 경계를 맡는다. 입력 검증과 오류 변환의 순환 참조는 허용하지 않는다.

**Tech Stack:** TypeScript strict, Next.js Node runtime, Supabase SDK, Vitest, pnpm.

**Spec:** `docs/status/2026-09-10-auth-role-split-review.ko.md`, `docs/status/2026-09-10-project-refactoring-map.ko.md`. 사용자 “시작하자”로 R1 착수 승인(2026-09-10).

## Global Constraints

- R1은 동작 보존 리팩터링이다. timeout·재시도·SDK 교체·오류 코드·검증 규칙·DB·UI·의존성은 변경하지 않는다.
- 기존 `supabase-auth-adapter.ts` 공개 클래스·생성자·10개 메서드·타입 import 경로를 보존한다. `container.ts`와 포트는 변경하지 않는다.
- 모든 신규 제품 모듈은 `import "server-only";`로 시작한다. 테스트 fixture를 제품 코드에서 import하지 않는다.
- JWT 해석은 서명 검증이 아니다. 토큰·개인정보·제공자 원문 오류가 공개 응답/로그에 새로 노출되지 않게 한다.
- 입력 검증 순서, HTTP 상태 우선순위, 계정 존재 은폐, SDK 작업별 fresh instance, 같은 작업의 setSession→후속 호출 관계를 보존한다.
- 기존 테스트 시나리오/단언은 삭제하거나 약화하지 않는다. 순수 이동은 기존 GREEN→리팩터링→GREEN으로 검증하며 인위적인 RED는 만들지 않는다. 동작을 추가/수정할 필요가 발견되면 이번 범위와 분리한다.
- 커버리지에 신규 제품 5모듈을 모두 포함한다. 기존 branches 100 threshold를 낮추지 않는다. 기존 미달과 새 회귀를 구분해 기록한다.
- 함수 역할·매개변수·반환/오류의 한국어 JSDoc을 유지한다. 인접한 영문/한글 중복 블록만 하나로 합칠 수 있다. 줄 수 목표를 위해 압축하지 않는다.
- 이 작업은 커밋·푸시·PR·병합·배포하지 않는다. 기존 `.gitignore` 변경과 다른 작업 기록을 보존한다.

## 작업 규모와 절차

제품 6파일(수정 1/추가 5), 테스트 4파일(수정 1/추가 3), 설정 1파일, 결과 문서 3파일이 기본 범위다. 승인 기록과 이 계획은 별도 문서다. 기존 제품 625줄·테스트 465줄이며 이동·재배치 중심이다. 진입점 180~260줄/내부 모듈 50~180줄은 참고 범위이지 강제 상한이 아니다.

- [x] 기존 linked worktree 및 변경 상태 확인.
- [x] `66a2319`에서 `feature/auth-adapter-role-split` 생성.
- [x] 변경 전 전체 web 테스트/선택적 coverage와 개별 테스트 이름 목록 기록.
- [x] Task 1 구현 및 독립 task review.
- [x] 컨트롤러: 전체 `pnpm verify`, 변경 후 coverage, 테스트 목록/서버 경계/의존 관계 확인.
- [x] 컨트롤러: 결과 문서 작성 및 최종 전체 리뷰.

## Task 1: 제품·테스트·커버리지 설정을 하나의 동작 보존 단위로 분리

**작업 디렉터리:** `C:/Users/PC/OneDrive/문서/account-book/.worktrees/ledger-public-contracts`

**필수 제약:** R1 동작 보존만. timeout/재시도/SDK 교체/오류 정책/DB/UI/의존성 변경 금지. 공개 어댑터의 클래스·생성자·10메서드와 타입 경로 보존. 모든 제품 모듈 server-only. 테스트 시나리오/단언 유지. 새 제품 모듈 coverage 포함 및 branches 100 유지. 한국어 함수·입력·반환·오류 주석 유지. 커밋/푸시/브랜치 변경/서브에이전트 생성 금지. `.gitignore`와 문서는 컨트롤러 소유이므로 수정 금지.

**파일 지도와 내부 인터페이스:**

1. 수정 `apps/web/src/server/auth/supabase-auth-adapter.ts`: 공개 흐름 조합만 유지한다. type-only 재노출로 SupabaseServerConfig / SupabaseClientFactory / SupabaseFetch의 기존 경로를 보존한다. providerId는 공개 인증 흐름 매핑이므로 어댑터에 남겨도 된다. 중복 영문 JSDoc만 한국어 블록으로 통합한다.
2. 추가 `apps/web/src/server/auth/supabase/validation.ts`: UUID_PATTERN 및 object / hasControlCharacter / nonEmpty / token / uuid / safeUrl / config / code / verifier / challenge를 이동. SupabaseServerConfig를 이 모듈에 둔다. error-mapper.fail만 하위 의존으로 사용하고, error-mapper는 validation을 import하지 않는다. 외부 URL/입력 규칙을 그대로 유지한다.
3. 추가 `apps/web/src/server/auth/supabase/session-parser.ts`: BASE64URL_PATTERN, dataOf / accepted / canonicalSegment / jwtClaims / commonTokenPair / tokenPair / rawTokenPair를 이동. 공개 사용되는 dataOf / accepted / tokenPair / rawTokenPair만 export한다. CurrentUserSchema와 AuthTokenPair는 여기서 사용. JWT 구문/사용자/시각 일관성 검사이며 암호학적 검증이 아니라는 주석 유지.
4. 추가 `apps/web/src/server/auth/supabase/error-mapper.ts`: fail / providerCode / mappedProviderError와 오류 코드 집합을 이동. 가입/복구의 400·422 + code 검사 묶음은 `isSignupExistenceResponse(body, status)` / `isResetAbsenceResponse(body, status)`로 표현하여 원래 boolean 분기와 동일하게 유지한다. rethrow는 `rethrowProviderError(error)`로 이동하여 알려진 AuthProviderError의 identity를 보존한다. 여기서는 입력 검증 모듈을 import하지 않는다.
5. 추가 `apps/web/src/server/auth/supabase/http-client.ts`: SupabaseFetch / HttpResult, 기존 request/post 로직을 함수로 이동한다. 인터페이스 `requestSupabaseAuth(config, fetcher, url, body)` 및 `postSupabaseAuth(config, fetcher, path, body, redirect)`를 사용한다. URL 구성·헤더·JSON 읽기·실패 JSON/null 처리·상태 유지가 완전히 같아야 한다. 어댑터 private request/post는 제거하고 직접 함수 호출로 연결한다. timeout/AbortSignal 추가 금지.
6. 추가 `apps/web/src/server/auth/supabase/sdk-client.ts`: AUTH_OPTIONS / SupabaseClient / SupabaseClientFactory를 이동하고 기본 팩토리를 export한다. 기존 createClient(url, anonKey, { auth }) 호출과 structural cast 유지. 어댑터의 private client()가 매 작업마다 factory(config.url, config.anonKey, AUTH_OPTIONS)를 호출하도록 유지한다. singleton/캐시 도입 금지.
7. 수정 `apps/web/src/server/auth/supabase-auth-adapter.test.ts`: provider URL 매핑, 직접 HTTP payload/header, 모든 성공 PKCE 경로, SDK fresh 옵션, unsafe-input 무부작용, localhost, 잘못된 사용자 password update 시나리오를 남긴다. 아래 파일로 나머지 테스트 블록을 내용 그대로 이동한다.
8. 추가 `apps/web/src/server/auth/supabase/session-parser.test.ts`: 기존 SDK/raw 토큰의 malformed JWT·사용자·시각·만료overflow·token_type/expires_in·불완전 token 시나리오를 이동한다. 기존처럼 공개 어댑터/EmailAuthService를 거치는 검증과 sessions.create 미호출 단언을 유지한다. private helper 존재만 검사하는 테스트로 바꾸지 않는다.
9. 추가 `apps/web/src/server/auth/supabase/error-mapper.test.ts`: 기존 PKCE HTTP 상태/본문 우선순위, malformed/scalar 429, 가입 존재/복구 부재 은폐 및 unrelated status/error, SDK 오류 비노출 시나리오를 이동한다. 공개 어댑터를 거치는 검증을 유지한다.
10. 추가 `apps/web/src/server/auth/supabase/test-fixtures.ts`: 기존 jwt / jwtPayload / 값 fixture / ok / client / jsonResponse / adapter / request / expectSafeError / emailFlow 중 공통 테스트 준비물을 옮긴다. 사용하지 않는 내부 값은 export하지 않는다. 제품에서 이 모듈을 import하지 않는다. 실제 token/비밀값 추가 금지.
11. 수정 `apps/web/vitest.config.ts`: 기존 include에 신규 제품 5파일을 각각 명시. exclude에 `src/server/auth/supabase/test-fixtures.ts`만 추가. branches: 100 유지.

**검증 순서:**

- [x] 컨트롤러 baseline 결과를 확인하고 원본 테스트 블록별 이동 목록을 메모한다.
- [x] 오류→검증→파서→HTTP/SDK→어댑터 연결 순서로 기계적으로 이동한다. import 경로의 `.js` 규칙 유지.
- [x] 테스트 fixture와 두 시나리오 파일을 이동하고 본래 단언을 보존한다. 테스트 이름도 유지하여 이전 JSON 목록과 대조할 수 있게 한다.
- [x] `pnpm --filter @account-book/web exec vitest run src/server/auth/supabase-auth-adapter.test.ts src/server/auth/supabase/session-parser.test.ts src/server/auth/supabase/error-mapper.test.ts src/server/auth/auth-provider-port.test.ts` 실행.
- [x] `pnpm --filter @account-book/web typecheck` 실행. 컨트롤러가 전체 verify/coverage를 별도 실행하므로 중복하지 않는다.
- [x] 스스로 diff를 읽고 오류 순서·SDK 생성 수명·HTTP JSON·server-only·주석 계약·테스트 이동 누락을 확인한다.
- [x] 보고서에 실제 파일 줄 수, 변경 요약, 실행 명령/출력, concern을 남긴다. 커밋하지 않는다.

## 컨트롤러 결과 기록

수정 예정: `docs/architecture/backend-authentication.ko.md`, `docs/guides/security-auth-testing.md`, `docs/status/2026-08-24-development-progress.ko.md`. 구조/파일별 읽는 순서/무엇이 바뀌지 않았는지/로컬 검증과 실제 IdP 통합 검증의 차이를 초급 개발자가 이해할 수 있게 기록한다. 승인 제안 문서의 상태도 최신화한다. R2 이후와 인증 시간 제한은 자동 착수하지 않는다.

### 구현 결과 및 실제 크기

| 영역 | 분리 전 | 분리 후 |
| --- | ---: | ---: |
| 공개 어댑터 | 625줄 | 248줄 |
| 입력 검증 | 어댑터에 포함 | 111줄 |
| 세션 파서 | 어댑터에 포함 | 119줄 |
| 오류 변환 | 어댑터에 포함 | 83줄 |
| HTTP 전송 | 어댑터에 포함 | 47줄 |
| SDK 생성 | 어댑터에 포함 | 50줄 |
| 어댑터 테스트 | 465줄 | 연결 계약 125줄 + 세션 120줄 + 오류 79줄 + fixture 188줄 |

줄 수는 빈 줄/주석을 포함한다. 제품 합계는 625→658줄(+33), 테스트 합계는 465→512줄(+47)이다. 공개 진입점의 읽기 부담은 줄었지만 import/export와 파일 경계 때문에 전체 줄 수가 감소한 것은 아니다. 최종 리뷰에서 fixture의 의미 있는 한국어 주석 11블록을 복원했으며 그 결과 fixture는 151→188줄로 늘었다. 함수별 무분별한 파일 분할, 새 추상 기반 클래스, 동적 import는 도입하지 않았다.

실제 제품·테스트·설정은 예정한 11파일이며, 결과 문서 3파일과 승인/계획 기록 4파일을 합해 이번 작업에서 다룬 파일은 18개다. 기존 `.gitignore` 변경은 이 집계에서 제외하고 보존했다. `container.ts`·공개 포트·DB·UI·lockfile은 변경하지 않았다.

### 검증 증거와 한계

- 상태: **R1 구현·로컬 검증·독립 리뷰 완료, 미커밋**. 마지막 주석 복원 후 인계 대상 전체 `pnpm verify`도878tests·lint·타입·API/웹build 종료코드0이다(`output/r1-handoff-verify.log`). 기능 브랜치와 기존 linked worktree를 보존한다.
- 기준: `66a2319`, 변경 전 웹 510/510. 선택적 branches733/799=91.73%는 기존100% threshold 미달.
- 최종 focused68/68, web typecheck exit0. 최종 웹510/510 및 branches734/799=91.86%; coverage 명령은 threshold 미달 exit1을 유지한다.
- 원본24개 테스트 블록과64개 확장 사례를 그대로 보존했다. 최종 TypeScript AST 프린터 비교에서 모든 테스트 블록·21개 이동 함수 본문이 일치하며 공개 생성자/메서드 시그니처도 같다. fixture 주석 보완 전후에는 주석 제거 후 생성한 실행 코드가 동일했다.
- 전체 verify의 최초 실행은878tests·lint·타입·API/웹 build exit0이었다. 자체 점검에서 추출한 post helper의 기존 async 선언을 복원한 뒤 **최종 전체 `pnpm verify`도 종료 코드0**을 확인했다. 테스트 합계878(legacy54 + contracts66 + database15 + API148 + web510 + E2E preflight85), lint·6 workspace 타입 검사·API/웹 build 통과. 마지막 제품 변경 이후 결과는 `output/r1-final-verify.log`다.
- 실제 외부 IdP·hosted DB/TLS·브라우저 전체 인증 E2E·침투 테스트·FCP는 이번에 실행하지 않았다. 새 의존성이 없어 audit 재실행도 이번 범위에 포함하지 않았다.
- 커밋·푸시·PR·병합·배포 없음. R2~R5 및 인증 timeout 구현은 별도 착수 범위다.
- 독립 task review: 명세 준수·품질 승인, Critical/Important/Minor 없음. reviewer의 최종 전체검증 확인 요청은 controller의 최종878tests/lint/type/build 종료코드0으로 해결했다.
- 최종 전체 review: Critical/Important 없음, Minor 1건(테스트 fixture의 한국어 한계·매개변수 설명 축약). 원래 주석11블록을 복원하고 focused68/68 및 실행 코드 동일성을 확인했다. 범위를 한정한 독립 재리뷰에서 **지적 해결·새 결함 없음**을 확인했다. 미해결 리뷰 지적은 없다.

### 커밋·푸시 승인 후 절차 (2026-09-10)

전송 직전 전체 `pnpm verify` 재실행은 종료 코드 0이며 878개 테스트·lint·타입 검사·API/웹 빌드가 통과했다. 스테이징한 18파일의 저장소 비밀정보 패턴 검사 및 `git diff --cached --check`도 통과했다. 실제 `.env` 파일은 추적되지 않으며 루트·웹·API의 환경 파일 제외 규칙을 확인했다. 이 검사는 모든 종류의 비밀정보 부재나 실제 hosted 인증 동작을 보증하지 않는다.

사용자가 R1의 커밋·푸시를 승인했다. 위의 미커밋·미푸시는 구현 완료 시점 기록이다. 제품·테스트·설정 11파일과 관련 문서 7파일만 명시적으로 스테이징하며 기존 `.gitignore` 수정은 제외한다. 전체 `pnpm verify` 재검증 로그는 `output/r1-prepush-verify.log`에 남긴다. 비밀정보 검사와 pre-push 보안 게이트를 통과한 경우에만 `feature/auth-adapter-role-split`을 일반 푸시하고 로컬 HEAD와 원격 SHA를 비교한다. 아직 원격에 없던 조상 커밋 `92e54e2`·`66a2319`도 함께 전송되는 이력이다. PR 생성·병합·배포·R2 이후 개발은 수행하지 않는다. 기존 선택적 커버리지 기준 미달은 해결된 것으로 표시하지 않는다.
