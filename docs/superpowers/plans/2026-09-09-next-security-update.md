# Next.js 보안 의존성 업데이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after user approval. Steps use checkbox syntax for tracking. 이 계획 작성 자체는 구현 승인이 아니다.

**Goal:** 현재 Next 16.2.11의 알려진 보안 공지를 해소하면서 기존 인증 경계와 화면을 유지한다.

**Architecture:** Node.js + NestJS + Fastify API 및 Next.js BFF 구조를 변경하지 않는다. Next 패키지·전이 의존성·기존 보안 override·버전 정책 테스트만 함께 갱신한다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, Next.js 목표 16.3.3, React 19.2.7, NestJS 11.1.28, Fastify 5.12.3, Vitest, Playwright.

**Spec:** [작업 승인·기록 원칙](../../guides/change-workflow.ko.md), 본 계획의 범위/보안 요구사항, [공식 v16.3.3 릴리스](https://github.com/vercel/next.js/releases/tag/v16.3.3).

**상태:** 의존성 적용 및 실행 가능한 로컬 검증 완료 / DB·전체 인증 E2E·리전 정책·원격 CI 미검증. 2026-09-09 사용자 A안 승인 후 실행했다. 기준 SHA `a36f719`, 실행 브랜치 `hotfix/next-security-20260909` (미병합 `feature/ledger-public-contracts`에서 분기). 후속 요청으로 커밋·푸시가 승인됐다. PR 생성·병합·배포 및 다음 제품 변경은 이번 전송 범위에 포함하지 않는다. 전송 결과는 실제 Git SHA와 원격 상태로 확인한다.

## Global Constraints

- 사용자 우선순위는 보안이다. 승인 전 코드·패키지·잠금파일을 수정하지 않는다.
- `engine-strict=true`, `save-exact=true`, `strict-peer-dependencies=true` 및 TypeScript strict 정책을 유지한다.
- 기존 `allowBuilds`의 `esbuild: true` 외에 새 install script 실행 허용을 추가하지 않는다.
- 기존 sharp 제거, PostCSS 8.5.23, Fastify 계열 보안 고정을 무심코 해제하지 않는다.
- 인증/Cookie/CSRF/JWT/DB 모델, Nest·Passport 구성, 디자인·금융 기능은 이번 범위 밖이다.
- 실제 인증/금융정보나 운영 DB로 회귀 테스트하지 않는다. 보안 실패를 무시하는 옵션으로 검증을 통과시키지 않는다.
- 승인된 npm audit 메타데이터 전송과 이후 패키지 다운로드·설치는 별개의 행위다. 본 업데이트안 승인 후에만 설치한다.

## 1. 현재 근거와 대안

2026-09-09 `pnpm audit --prod --json`은 Critical 2건, Moderate 1건을 보고했다. 현재 Next는 16.2.11이며 공식 공지는 16.x 수정 버전을 16.3.3으로 지정한다.

- [Windows 서버 공지](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36): Windows 파일시스템 서버의 해당 조건에서 원격 코드 실행 위험.
- [AVIF 이미지 최적화 공지](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4): 실제 취약 경로 성립 여부와 패키지 버전 감지는 구분한다.
- [baseline-browser-mapping 공지](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv): 현재 2.10.43, 수정 2.11.0.

추가로 확인한 중요한 사항: `pnpm-workspace.yaml`은 이미 `next@16.2.11>sharp: '-'`로 optional native 이미지 의존성을 제거한다. 따라서 AVIF 공지만 보고 현재 앱에서 공격 가능하다고 단정하지 않는다. 새 Next에서도 불필요한 sharp가 다시 설치되지 않게 확인한다. Windows 공지와 버전 업데이트 필요성은 별도로 남는다.

| 안 | 장점 | 단점/판정 |
| --- | --- | --- |
| A. 검증된 16.3.3으로 한정 업데이트, 기존 보안 정책 유지 — 추천 | 변경 이유와 범위가 좁고 전후 비교가 쉬움 | 16.2→16.3 minor 변경이라 호환성 검증 필요 |
| B. Next·React·관련 패키지 전반을 최신화 | 후속 업데이트를 묶을 수 있음 | 보안 수정과 무관한 변경·검증 범위가 커짐. 이번에는 제외 |

서버 외부 노출 중단은 임시 운영 조치이지 보안 업데이트의 대체안이 아니다. A안의 정확한 목표 버전은 16.3.3이며, 더 높은 버전이 필요해지면 이유를 제시하고 계획을 갱신한다.

## 2. 파일 지도

아래 경로는 저장소 루트 기준이다. 정확한 파일명이며 한 파일에 여러 역할을 섞지 않는다.

| 구분 | 경로 | 변경 목적 |
| --- | --- | --- |
| 수정 | `apps/web/package.json` | next 정확한 버전 16.2.11 → 16.3.3 |
| 수정 | `pnpm-workspace.yaml` | Next selector를 새 버전으로 갱신, sharp 제외/PostCSS 고정 유지, 필요 시 baseline만 한정 고정 |
| 생성 도구로 갱신 | `pnpm-lock.yaml` | pnpm이 만든 실제 해석 버전·무결성·전이 의존성 기록. 수동 편집 금지 |
| 실행 중 확인한 자동 생성 변경 | `apps/web/next-env.d.ts` | Next build가 `.next/types/root-params.d.ts` import 1줄 추가. 수동 제품 로직 수정 아님 |
| 수정 | `scripts/workspace-policy.test.mjs` | 승인 버전/override 기대값 변경 및 취약 버전·sharp 재유입 방지 검증 |
| 수정 | `docs/guides/security-auth-testing.md` | 이번 업데이트의 RED/GREEN·audit·빌드·E2E 결과를 날짜별 추가 |
| 수정 | `docs/status/2026-08-24-development-progress.ko.md` | 기존 기능 상태는 보존하고 보안 업데이트 상태·미검증 항목 추가 |
| 수정 | `docs/README.md` | 과거 audit 0건과 최신 audit 상태를 명확히 구분하고 결과 문서 연결 |
| 수정 | 이 계획서 | 승인·단계별 실행·결과 상태 갱신 |
| 검증만 | `apps/web/next.config.ts`, `apps/web/scripts/assert-auth-startup.mjs` | production fake 차단 및 빌드 구성 유지 확인 |
| 검증만 | `tests/e2e/ui/auth-ui.spec.ts`, `tests/e2e/layout/auth-shell-width.spec.ts`, `tests/e2e/auth-response.spec.ts` | 기존 브라우저/HTTP 계약 회귀 |
| 검증만 | `.github/workflows/security-gate.yml` | 기존 같은-SHA CI 사용. job/검사 완화하지 않음 |

제품 소스 신규 파일·삭제 파일은 계획하지 않는다. 호환성 문제로 route/component/config 변경이 필요하면 해당 파일과 원인을 제시하고 재승인받는다.

예상 규모: 기존 파일 8개 내외(계획 포함). 설정·정책 테스트 직접 변경 약 40~100줄, 검증 문서 약 50~120줄. 잠금파일은 플랫폼별 SWC 기록 때문에 수백 줄 변경될 수 있으므로 별도 집계한다. 배포/DB migration 작업은 0개다.

## 3. 단계별 실행

### Task 1: 승인 범위 및 재현 기준 고정

**Files:** 읽기 전용 package/lock/policy/config, 상태 기록은 이 계획서.

**Interfaces:** 기존 package manifest와 보안 검사 출력을 소비하며, 동일 런타임의 비교 기준을 만든다. 새 런타임 함수/API는 없다.

- [x] A안 및 패키지 다운로드/설치·로컬 검증 범위에 대한 사용자 승인을 기록한다.
- [x] `git status --short`, `git branch --show-current`, `git rev-parse HEAD`로 시작 상태 확인. 기존 `.gitignore` 변경을 보존한다.
- [x] Node 22.15.1/pnpm 11.9.0 확인. 다른 버전으로 잠금파일을 재생성하지 않는다.
- [x] PR #8 OPEN·미병합을 확인하고 현재 feature HEAD에서 `hotfix/next-security-20260909`를 생성했다. 기존 worktree를 재사용했고 미커밋 문서·`.gitignore` 변경을 보존했다.
- [x] 공개 메타데이터 확인: Node >=20.9.0, React ^19.0.0과 현재 고정 버전 호환. sharp는 optional이고 baseline ^2.9.19는 2.11.0을 허용한다.

### Task 2: 버전 정책 테스트 RED → 의존성 변경 → GREEN

**Files:** `scripts/workspace-policy.test.mjs`, `apps/web/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.

**Interfaces:** existing workspace policy test를 사용하며, manifest/override/lock 세 파일이 같은 해석 결과를 갖도록 한다. 서비스 API 계약은 변경하지 않는다.

- [x] 테스트의 Next 기대값을 먼저 16.3.3으로 바꾸고 관련 override 기대 selector도 갱신했다. 기존 보안 assertion은 유지했다.

```js
assert.equal(webPackage.dependencies.next, "16.3.3");
// expectedWorkspaceOverrides의 기존 두 Next 항목을 아래로 교체한다.
"next@16.3.3>sharp": "-",
"next@16.3.3>postcss": "8.5.23",
```

- [x] 같은 테스트 파일에서 취약 버전 재유입과 이미지 의존성 부재를 검사했다. 아래 계획 예시와 달리 실제 assertion은 정규식의 boolean 결과를 비교하여 실패 시 lock 전체 출력이 발생하지 않게 했다.

```js
test("Next security update excludes audited vulnerable resolutions", () => {
  const lockfile = readFileSync(lockfilePath, "utf8");
  assert.match(lockfile, /^ {2}next@16\.3\.3:/mu);
  assert.doesNotMatch(lockfile, /^ {2}next@16\.2\.11:/mu);
  assert.doesNotMatch(lockfile, /^ {2}baseline-browser-mapping@2\.10\.43:/mu);
  assert.doesNotMatch(lockfile, /^ {2}sharp@/mu);
});
```

- [x] `node --test scripts/workspace-policy.test.mjs` RED 확인: 2 fail/2 pass. 기존 Next 16.2.11와 새 resolution 부재가 원인이며 도구 오류가 아니다.
- [x] manifest와 YAML의 두 Next selector를 같은 버전으로 변경했다. Fastify/nanoid/fast-uri 고정은 유지했다.

```json
"next": "16.3.3"
```

```yaml
  "next@16.3.3>sharp": "-"
  "next@16.3.3>postcss": "8.5.23"
```

- [x] `pnpm install --lockfile-only` 종료 코드 0. install scripts 허용 목록은 변경하지 않았다.
- [x] 중간 해석에 baseline 2.10.43이 남아 테스트 1개 실패를 확인했다. Next 허용 범위 안의 scoped 2.11.0 override를 YAML과 기대값에 추가하고 재생성했다.
- [x] `pnpm install --frozen-lockfile` 종료 코드 0. why/lock에서 Next 16.3.3, baseline 2.11.0 및 sharp 부재를 확인했다. 무관한 의존성 갱신은 없었다.
- [x] `node --test scripts/workspace-policy.test.mjs` GREEN 4/4 확인. 별도 운영 audit도 수행했다.

### Task 3: 전체 회귀 검증과 결과 기록

**Files:** 테스트는 기존 파일 사용. 수정은 보안 가이드·상태·문서 지도·계획서만.

**Interfaces:** 변경된 설치 결과를 소비하고 테스트/빌드/audit/브라우저 증거를 산출한다.

- [x] `pnpm verify` 종료 코드 0: lint·6 workspace 타입·API/웹 build·873 tests 통과. build의 preferredRegion deprecated 경고는 별도 배포 전 과제로 기록했다.
- [x] `pnpm audit --prod --json` 종료 코드 0: 전 심각도 0, 대상 3 advisory 해소 확인.
- [x] loopback production 공개 인증 화면 5개/15조합, 빈 입력 오류·포커스, 공개 링크 4회 이동을 확인했다. 가로 넘침·axe 위반·수집 pageerror/별도 링크 검사 console error 0.
- [x] 동일 검사 소스로 `/login` 폭별 7회 측정. 390px p75 32ms, 1440px p75 56ms. warm loopback/무제한 CPU·네트워크 표본이며 실제 모바일 결과가 아니다.
- [ ] 폐기용 DB가 검증된 경우에만 `pnpm test:db`, `pnpm --filter @account-book/database-tests prepare:e2e`, `pnpm --filter @account-book/e2e test` 실행. 운영 연결 문자열로 대체하지 않는다.
- [x] PostgreSQL 5432 listener 부재로 DB/전체 인증 E2E는 미실행. preflight 통과와 구분하며, 커밋·푸시 승인 후 동일 SHA CI가 필요하다.
- [x] `git diff --check` 및 변경 파일 확인, 보안 가이드·상태·문서 지도·이 계획서에 결과를 기록했다.
- [x] 완료 내역 공유 후 사용자가 커밋·푸시 및 다음 작업 검토를 승인했다. PR 생성·main 병합·배포 승인은 포함하지 않는다.

## 4. 완료 조건 및 중단 조건

완료 조건: 목표 Next 적용, sharp 미재유입, 기존 보안 override 유지, 정책/전체 회귀·빌드 통과, 대상 advisory 해소, 실행 가능한 범위의 브라우저 재검증, 미실행 검사 명시, 변경 파일과 문서 일치.

중단 조건: 다른 메이저/새 네이티브 의존성/새 build-script 승인 필요, 인증 경계 수정 필요, 무관한 package 대규모 갱신, 취약 버전으로의 해석 회귀, 검증을 위해 보안 정책 완화가 필요하다는 제안. 실패 시 원인과 최소 수정 범위를 다시 보고한다. 취약 버전으로 되돌린 상태를 공개하지 않는다.

## 5. 후속 작업 — 이번 승인에 포함하지 않음

1. DB 유휴 연결 오류 처리 + 인증 제공자 timeout: 파일 지도/재현 테스트를 갖춘 별도 계획.
2. 개발 시작 안내의 공유 패키지 빌드·JWT 변수 누락 정정: 작은 문서 작업 단위.
3. 메일 안내·비밀번호 접근성·인증 화면 정렬: 동작과 CSS 검증을 구분한 별도 계획.
4. BFF DB 최소 권한·pool budget·persistent rate limit: DB 영향과 장애 정책을 먼저 설계.
5. 금융 원장 구현: 최신 M2 설계에 따라 별도 기능 계획.

## 6. 계획 자체 점검

- [x] 현재 코드·패키지·override·정책 테스트·문서 위치를 확인했다.
- [x] 기존 sharp 제외 조치를 반영하고 패키지 감지와 공격 가능성을 구분했다.
- [x] 직접 수정과 자동 생성 lock diff, 검증 전용 파일을 구분했다.
- [x] 문서 작성과 제품 변경 승인을 분리했다.
- [x] 사용자 A안 실행 승인.
- [x] 실제 의존성 변경 및 실행 가능한 로컬 검증. 위 미검증 gate는 완료로 처리하지 않는다.

## 7. 실행 결과와 후속 승인 필요 사항

- 독립 변경분 리뷰에서 차단 결함·범위 밖 갱신은 없었다. snapshot key 개별 검사는 선택적 강화 제안으로 남기며 현재 frozen-lockfile 검증을 생략하지 않았다.
- 제품 설정/테스트 3파일은 +19/-7줄, 자동 생성 잠금파일 1개는 +52/-51줄이다. 빌드가 `next-env.d.ts`에 타입 import 1줄을 추가해 예상 8파일보다 실제 1파일 늘었다(본 작업 9파일, 선행 절차 문서는 별도). 문서 변경량은 별도 집계하며 기존 `.gitignore` 1줄은 이 작업에 포함하지 않는다.
- UI·인증·DB 제품 소스에는 변경이 없다. 검토 서버는 검사 후 종료한다.
- 배포 설정 주의: `preferredRegion`은 새 Next에서 deprecated 경고가 발생한다. 기존 iad1 정책을 대체할 플랫폼 설정을 검토하기 전에 route export를 임의 삭제하지 않았다. [공식 안내](https://nextjs.org/docs/messages/preferred-region-deprecated)
- 전송 전 `pnpm verify`와 `pnpm audit --prod --json`을 재실행해 모두 종료 코드 0을 확인했다. DB/전체 E2E와 같은-SHA CI, 리전 정책 검토 전에는 배포 준비 완료로 표시하지 않는다.

## 8. 다음 작업 사전 검토 — 구현 승인 대기

이번 후속 요청에서는 문서만 보강한다. 아래 설정·route·테스트는 아직 변경하지 않는다.

### 8.1 우선 과제: BFF 실행 리전 설정 이전

리전은 서버 함수가 실행되는 지역이다. 현재 14개 BFF route가 `preferredRegion = "iad1"`을 선언하고 `apps/web/src/app/api/route-wiring.test.ts`가 이를 검사한다. Next 16.3.3 빌드는 이 선언에 deprecated 경고를 낸다. 현재 추적된 `vercel.json`은 없다. 배포 안내는 `apps/web`을 대상으로 하되 실제 Vercel Root Directory·외부 workspace 소스 포함 설정은 배포 PR에서 검증하도록 남겨 두었다.

| 대안 | 장점 | 단점·보안/유지보수 영향 |
| --- | --- | --- |
| A. 배포 설정 파일에 단일 `iad1`을 고정하고 route 선언 제거 — 추천 | Git diff와 정책 테스트로 변경 이력을 검토할 수 있고 14곳의 반복 설정을 줄인다 | monorepo Root Directory와 파일 적용 위치를 먼저 확정해야 한다. 로컬 build만으로 실제 배치 지역을 증명할 수 없다 |
| B. Vercel 관리 화면에서 지역을 고정하고 route 선언 제거 | 설정 파일 추가가 없으며 관리자 화면에서 조정하기 쉽다 | 저장소 밖 변경으로 설정 불일치가 생기기 쉬워 수동 증거·정기 확인이 필요하다 |
| C. 현재 선언 유지, 배포 준비 작업까지 이전 보류 | 당장 제품 파일 변경이 없고 배포 구성과 함께 결정할 수 있다 | 폐기 예정 경고와 전환 작업이 남는다. 기존 선언만으로 미래 버전의 지역 배치를 보장하지 않는다 |

A안의 변경 후보와 예상 규모(승인 전 추정):

- 추가 후보: `apps/web/vercel.json` 1개, 약 4~10줄. 실제 Root Directory가 `apps/web`일 때의 위치이며 배포 대상 확인 전 생성하지 않는다. single-region 설정만, failover/멀티리전/secret은 추가하지 않는다.
- 수정 후보: 아래 BFF route 14개에서 리전 export 1줄씩 제거. Node runtime·`force-dynamic`·10초 `maxDuration`과 인증 어댑터는 유지한다.

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

- 수정 후보: `apps/web/src/app/api/route-wiring.test.ts` 1개, 약 15~40줄. 기존 리전 export 기대값을 배포 설정의 단일 `iad1` 검증으로 이전하고 나머지 보안 경계 검증을 유지한다.
- 문서 후보: `docs/guides/platform-and-oauth-onboarding.ko.md`, `docs/architecture/frontend.ko.md`, `docs/architecture/backend-authentication.ko.md`, `docs/guides/security-auth-testing.md`, `docs/status/2026-08-24-development-progress.ko.md` 5개와 별도 실행 계획 1개. 총 약 80~160줄. 과거 SHA의 검증 기록은 당시 사실로 보존한다.
- 전체 후보 22파일(제품/설정/테스트 16, 문서 6). 파일 수는 많지만 제품 코드는 14줄 제거 중심인 소규모 구성 변경이다. DB migration·패키지 설치·UI/CSS 변경은 없다. 실제 파일 수·diff는 실행 계획 확정 때 다시 집계한다.

진행 순서: 배포 Root Directory 확인 → 승인된 위치/정책을 문서로 고정 → 정책 테스트 RED → 설정 이전 → GREEN·전체 verify → 같은-SHA CI → 별도 배포 승인 후 실제 Functions 지역 확인. 관리 화면 접근 권한이 없으면 로컬 구성 검증과 hosted 검증을 구분해 후자는 미완료로 남긴다. 지역 설정은 데이터 저장 위치·국외 이전 고지 전체를 대신하지 않는다.

공식 근거(2026-09-09 확인): [Next 폐기 안내](https://nextjs.org/docs/messages/preferred-region-deprecated), [Vercel Functions 지역 설정](https://vercel.com/docs/functions/configuring-functions/region). Vercel은 관리 화면과 `vercel.json`의 `regions` 설정을 안내한다. A안 추천은 이 근거와 현재 반복 설정을 고려한 프로젝트 판단이며 실제 배포 검증 결과가 아니다.

### 8.2 그다음 검토 순서

1. **인증 기반 안정성:** DB 유휴 연결 오류 처리와 실제 인증 제공자 요청의 제한시간을 별도 재현·설계한다. 이미 delegated API 3초·fake provider 5초 timeout이 있으므로 모두 누락됐다고 가정하거나 일괄 추가하지 않는다. 다음 승인 전 정확한 구현 파일/영향을 다시 조사한다.
2. **개발 문서와 접근성:** 공유 패키지 선행 빌드/JWT 환경변수 안내, 메일 안내·비밀번호 접근성·정렬을 각각 작은 단위로 제안한다. 단순 CSS와 동작 변경의 검증 범위를 분리한다.
3. **운영 보안 경계:** BFF DB 최소 권한·연결 예산·지속성 rate limit의 미구현/미검증 항목을 구분한다. 운영 계정이나 실제 금융정보로 테스트하지 않는다.
4. **금융 원장 구현:** 공용 계약을 실제 테이블·권한·멱등 저장 API와 연결한 뒤 PC 장부 화면, 별도 모바일 앱으로 진행한다. 새 기능은 단계별 파일 지도와 실패 테스트를 포함한 계획 승인 후 착수한다.

이번 커밋·푸시는 제품 완성/배포 승인과 다르다. 현재 실제 금융정보를 저장하는 베타는 아직 시작할 수 없다.
