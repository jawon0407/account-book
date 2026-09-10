# Vercel 단일 리전 설정 이전 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the single code task and review it. 사용자 A안 승인 및 프로젝트 미생성 확인 후 실행한다.

**Goal:** BFF의 단일 `iad1` 실행 정책을 Vercel 설정으로 통합해 Next의 deprecated 경고를 해소한다.
**Architecture:** 향후 Vercel Root Directory는 `apps/web`. 그 루트의 `vercel.json`이 프로젝트 함수 리전을 지정한다. route의 Node runtime·dynamic·10초 제한은 그대로 둔다.
**Tech Stack:** Next 16.3.3, TypeScript, Vitest, pnpm 11.9.0, Node 22.15.1.
**Spec:** [승인된 A안](2026-09-09-next-security-update.md#81-우선-과제-bff-실행-리전-설정-이전), [작업 절차](../../guides/change-workflow.ko.md).

## Global Constraints

- 기준 `afacc4c`, 브랜치 `feature/vercel-region-policy`, 기존 linked worktree 재사용. `.gitignore` 기존 변경 보존.
- 사용자 확인: Vercel 프로젝트는 아직 없다. `apps/web`은 앞으로 생성할 프로젝트의 루트 계약이지 현재 hosted 설정 검증 결과가 아니다.
- 단일 `iad1` 유지. failover·멀티리전·secret·패키지·CI workflow·DB·인증 동작·UI 변경 금지.
- route의 `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 10` 유지.
- 이번 작업은 로컬 구현/검증/기록만. 커밋·푸시·PR·배포·관리자 설정 변경은 하지 않는다.

## 파일 지도와 규모

제품/테스트 16파일: `apps/web/vercel.json` 추가, `apps/web/src/app/api/route-wiring.test.ts` 수정, 아래 14 route에서 preferredRegion export만 제거.

```text
apps/web/src/app/api/me/route.ts
apps/web/src/app/api/auth/callback/route.ts
apps/web/src/app/api/auth/csrf/route.ts
apps/web/src/app/api/auth/email/callback/route.ts
apps/web/src/app/api/auth/oauth/[provider]/continue/route.ts
apps/web/src/app/api/auth/oauth/[provider]/start/route.ts
apps/web/src/app/api/auth/password/callback/route.ts
apps/web/src/app/api/auth/password/reset-request/route.ts
apps/web/src/app/api/auth/password/update/route.ts
apps/web/src/app/api/auth/session/route.ts
apps/web/src/app/api/auth/session/refresh/route.ts
apps/web/src/app/api/auth/sign-in/route.ts
apps/web/src/app/api/auth/sign-out/route.ts
apps/web/src/app/api/auth/sign-up/route.ts
```

문서 7파일: 이 계획, 선행 승인 계획, `docs/guides/platform-and-oauth-onboarding.ko.md`, `docs/architecture/frontend.ko.md`, `docs/architecture/backend-authentication.ko.md`, `docs/guides/security-auth-testing.md`, `docs/status/2026-08-24-development-progress.ko.md`. 승인/대기 기록 해소로 선행 계획이 추가되어 기존 후보 22보다 총 23파일이다. 제품 영향은 동일하다. 예상 직접 변경 20~50줄 및 문서 100~180줄, 잠금파일 변경 없음.

### Task 1: 배포 리전 계약 이전

**Interfaces:** Vercel은 배포 루트의 JSON `regions`를 소비한다. 기존 route handlers의 HTTP 계약은 변하지 않는다. 테스트는 배포 설정 JSON을 읽어 허용 지역/override 부재를 검사하며 실제 hosted 배치를 증명하지 않는다.

- [x] 기존 route-wiring 테스트 15/15 통과 확인.
- [x] 기존 파일에 새 JSON 정책 테스트를 추가하고 RED를 확인했다. 설정 부재는 명시적 existence assertion으로 실패했다. 구성 파싱은 `unknown`으로 받고 아래 전체 객체를 비교해 승인하지 않은 region/failover/function override까지 방지한다. JSON 주석은 넣지 않고 테스트 콜백에 한국어 역할/무매개변수 설명을 썼다.

```ts
const configUrl = new URL("../../../vercel.json", import.meta.url);
expect(existsSync(configUrl), "web deployment root must provide its region policy").toBe(true);
const config: unknown = JSON.parse(await readFile(configUrl, "utf8"));
expect(config).toEqual({ $schema: "https://openapi.vercel.sh/vercel.json", regions: ["iad1"] });
```

- [x] expectedRoutePolicy에서 preferredRegion 기대문만 제거했다. 나머지 thin adapter/HTTP/security assertions를 유지했다. 삭제 문자열 중복 테스트 없이 production build로 deprecated 경고 부재를 확인했다.
- [x] 14 route의 `export const preferredRegion = "iad1";` 줄만 제거하고 다음 파일을 생성했다.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["iad1"]
}
```

- [x] `pnpm --filter @account-book/web exec vitest run src/app/api/route-wiring.test.ts` GREEN 16/16 확인.
- [x] 독립 작업/최종 리뷰에서 차단 결함 없음. `pnpm verify`: lint·6 workspace 타입·모든 테스트·API/웹 build 통과, deprecated 경고 없음.
- [x] 문서 갱신: 루트 계약, 설정 키 의미, Node/dynamic/10초 유지, future hosted 검증 절차를 한국어로 설명했다. 과거 SHA 테스트 기록을 보존했다.
- [x] diff/문서 링크 검증 후 실제 파일 수·결과·미실행 gate 기록. 커밋/푸시는 하지 않았다.

## 사전 계획 자체 점검

| 확인 | 판단 |
| --- | --- |
| Task 1 내부 | JSON 생성과 테스트가 동일한 배포 루트를 가리킨다. 인증/HTTP 테스트는 유지한다 |
| Task 1 코드 ↔ 문서 | 문서는 향후 Root Directory 계약을 설명하며 hosted 완료를 주장하지 않는다 |
| 독립 단계 관계 | 단일 코드 작업이므로 공유 파일을 여러 구현자에게 나누지 않는다. 문서는 주 에이전트가 처리한다 |

전역 변경을 막는 기존 정책 테스트의 의도에 따라 JSON exact equality를 사용한다. 이는 Vercel 동작 테스트가 아니라 승인된 배포 입력 계약 검사다. 설정을 늘려야 하면 승인과 테스트를 함께 갱신한다.

## 검증 경계

- 이전 보안 업데이트 `afacc4c`의 [CI](https://github.com/jawon0407/account-book/actions/runs/34307677601)는 성공했다. 이번 미커밋 변경의 CI 증거로 재사용하지 않는다.
- Vercel 프로젝트 생성 후 별도 배포 승인에서 Root Directory `apps/web`, 루트 밖 workspace 소스 포함, 공유 패키지 빌드, Functions 실제 `iad1`을 확인한다. CLI `--regions`/함수별 override/자동 failover를 임의 추가하지 않는다.
- 실제 DB·OAuth·hosted 배치·한국망 p95는 이번 로컬 설정 검사로 입증되지 않는다. 지역 설정은 캐시 보안·DB 권한·국외 이전 고지를 대체하지 않는다.

공식 근거: [Vercel JSON 위치](https://vercel.com/docs/project-configuration/vercel-json), [Functions 리전](https://vercel.com/docs/functions/configuring-functions/region).

## 실행 기록

상태: **로컬 구현·검증·독립 리뷰 완료**. `feature/vercel-region-policy`에 미커밋 상태로 보존한다. hosted 배포 준비 완료를 뜻하지 않는다.

- 계획 정정: 테스트 파일 위치 `src/app/api`에서 웹 루트까지는 세 단계다. 초안의 네 단계 상대 경로는 `apps/vercel.json`을 가리켰다. 구현 중 existence assertion으로 발견했고 `../../../vercel.json`으로 바로잡았다. 이는 배포 루트 변경이 아니라 계획 스니펫 오류 수정이다. 초기 설정 부재 RED와 이 경로 오류를 구분해 기록한다.
- RED: focused 16개 중 새 설정 존재 assertion 1개 실패, 기존 15개 통과. GREEN: 경로 정정 및 설정/route 이전 후 16/16 통과, 종료 코드 0.
- `pnpm verify` 종료 코드 0: legacy/security 54 + contracts 66 + database unit 12 + API 147 + web 510 + E2E preflight 85 = 874 tests. lint·6 workspace 타입 검사·API/웹 build 통과. 이전 `preferredRegion` deprecated 경고 없음.
- 문서 7파일의 로컬 링크 대상 검사 통과. 코드 예시의 백틱과 괄호가 포함된 경로를 구분해 검사했다. `git diff --check` 통과(상태 문서의 기존 CRLF 정규화 안내만 있음).
- 원시 검증 출력은 Git 제외 `output/vercel-region-verify.log`. 제품 16파일 직접 변경 +14/-15줄(설정 +4, 테스트 +10/-1, route -14). 문서 7파일을 포함한 작업 파일은 23개이며 기존 `.gitignore` 1파일은 집계에서 제외한다.
- 새 브라우저 UI/FCP·DB/전체 인증 E2E·운영 audit은 이번에 재실행하지 않았다. 제품 로직·패키지·UI 변경이 없고 production build와 기존 테스트로 로컬 회귀를 확인했다. 새 SHA CI 및 실제 hosted 리전 검증은 별도이며 이전 CI로 대체하지 않는다.
- 독립 작업 리뷰: 사양 일치, 차단 결함 없음, 기존 HTTP/security 검증 유지 확인. 최종 코드·문서 리뷰: 정확성·보안·범위 위반·실질적 문서 모순 없음. 로컬 수용 가능이며 hosted 완료 판정은 아니다.
- 절차 선택: 커밋/푸시는 별도 요청으로 남기므로 스킬 기본 자동 커밋/정리 대신 미커밋 diff와 로컬 검증 기록을 보존했다. 후속 전송 승인 및 새 SHA CI가 필요하다.
