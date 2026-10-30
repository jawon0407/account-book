# Android 장부 연결·채널 권한 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 동일 세션 TDD 실행 후 한 번의 독립 리뷰.

**Goal:** Android에서 기존 개인 장부를 사용하고 PC는 신규 거래 작성 없이 조회·편집하도록 서버/화면을 맞춘다.
**Architecture:** 서버 세션의 채널 → 필수 서명 클레임 → NestJS 경로 권한. 기존 작업표/원장/공유 DB를 재사용한다.
**Tech Stack:** TypeScript, Next Node.js BFF, NestJS/Fastify, JOSE, Zod, PostgreSQL, Vitest/Playwright.
**Spec:** [설계](../specs/2026-10-16-native-ledger-channel-design.md).

## Global Constraints

- Android 우선. iOS·실계좌 API·앱 화면/알림 수집은 별도 단위다.
- 서명키·공급자 토큰은 서버 전용. chn 누락/오류는 거절, 클라이언트가 권한 채널을 지정하지 못한다.
- 새 DB 테이블/권한/패키지는 추가하지 않는다. 실제 DB 변경·배포·커밋/푸시/병합은 이 단위에 포함하지 않는다.
- 기존 혼합 미커밋 원장·은행·인증 변경 보존. 파일 수 예상40~55, 실제 수는 결과에 기록한다.
- 일반 구현의 추가 승인은 생략하라는 사용자 지시를 유지한다. 설계/계획은 먼저 기록하고 큰 정책 변경만 문의한다.
- Autoplan 필수 참조 경로 누락을 확인했다. 전체 자동 파이프라인 완료로 표시하지 않고 직접 설계 점검·독립 리뷰·TDD로 보완한다.

## Review Focus

1. 클레임 누락의 암묵적 web 기본값이나 header 우회: Task1/2 음성 시험.
2. 웹/Android 세션 교차 사용과 계정 전환 뒤 stale 사용자 쓰기: Task2 시험.
3. Android 수기 거래가 실제 PC 목록·편집·합계에 이어지는지: Task3 실제 HTTP/DB/브라우저.
4. 라우트 메서드·경로·쿼리/본문의 모호성: Task2 실패 표와 응답 스키마 시험.
5. 구 BFF/API 조합의 거절과 새 배포 순서: Task1 누락 클레임 시험 및 최종 운영 안내.

### Task 1: 서명된 채널 계약

**Files:** `packages/contracts/src/internal-api.ts`, `apps/web/src/server/security/delegated-jwt-signer.ts`, `http/delegated-api-client.ts`, `http/auth-controller.ts`, `bank-connections/bank-controller.ts`, `core/core-controller.ts`, `apps/api/src/auth/principal.ts`, `jwt-verifier.ts` 및 각 테스트/인증 fixture.
**Interfaces:** `DelegatedClientChannelSchema=web|android`, `DelegatedClientChannel`; `DelegatedSignInput.clientChannel`과 `DelegatedApiRequest.clientChannel` 필수; JWT `chn`; `AuthPrincipal.clientChannel` 필수.

- [x] 실제 서명기에서 web/android chn 생성, 누락/무효 입력 거절 시험 작성·RED 실행.
- [x] 실제 검증기에서 두 채널 전달, 누락/null/배열/임의값 및 변조 거절 시험 작성·RED 실행.
- [x] 공용 타입·서명/검증과 기존 호출자의 서버 세션 채널 전달 구현. 기존 fake principal/서명 fixture도 의미에 맞게 명시한다.
- [x] 대상 Vitest와 전체 타입 검사 GREEN. 기존 JWT TTL/요청 결합/replay 검증 유지.

### Task 2: Native 장부 경로·서버 권한

**Files:** CoreController/operations/route-adapter와 새 채널별 인증 helper, `security/native-request.ts`, 기존 native-auth boundary/rate-types/limiter, 컨테이너, `apps/web/src/app/api/native` 장부 라우트9개, `apps/api/src/auth/delegated-scope.ts`, `auth.guard.ts`, `transactions/transactions.controller.ts`, 관련 단위/DB 테스트.
**Interfaces:** CoreController의 서버 고정 `web|android` 정책과 대응 SessionService. `RequireDelegatedChannels(...channels)` 메타데이터를 AuthGuard가 검증된 principal에 적용. 거래 생성만 android 전용. `NativeRateOperation`에 ledgerRead/ledgerWrite 추가(설계의 제한 수치 고정).

- [x] web 생성403·android 생성 허용·잘못된 채널 메타데이터 거절·저장소 미호출 시험 RED.
- [x] native 장부의 전 작업/소유자·응답·경로/쿼리/본문·세션 교차·계정 전환·갱신/제한 오류 시험 RED.
- [x] 채널별 HTTP 인증 helper와 기존 작업 처리 연결, native route adapter/9파일, 공유 제한 구현.
- [x] NestJS 서버 채널 강제와 BFF web 생성 거절 구현. 클라이언트 채널/header 입력은 무시/거절한다.
- [x] 제한 단위·CoreController·실제 Nest HTTP/DB 테스트 GREEN. 기존 세션/원장/공급자 토큰 비노출 보존.

### Task 3: PC 편집 UX·종단 검증

**Files:** `apps/web/src/features/ledger/transactions/transaction-page.tsx`와 관련 UI 테스트, `tests/e2e/core`의 합성 거래 준비/helper·native HTTP·PC 시나리오, 현황 MD·통합 설계·Notion04/07.
**Interfaces:** PC는 native에서 생성된 같은 사용자 거래를 조회·수정·삭제한다. 로그인 공급자·실제 BFF/API/폐기용 DB는 기존 test harness를 사용한다.

- [x] PC 신규 작성 없음/관리·편집 유지와 Android 생성→PC 조회/편집, web POST403, 계정 격리 시험. PC 버튼 RED1 확인; HTTP 결합 사례는 최종 회귀로 검증했다.
- [x] PC 생성 폼 연결·버튼 제거, 모바일 작성/PC 편집과 APK 미제공 상태 안내. 회귀 데이터는 native HTTP로 준비한다.
- [x] `pnpm verify`, web coverage, 실제 폐기용 `pnpm test:db`, core Playwright, 의존성/비밀 패턴 검사, `git diff --check` 실행·실패 수리. 기준은 낮추지 않는다.
- [x] 독립 코드·보안 리뷰 완료. Critical/Important 0으로 수정 pass 불필요. 범위 밖/남은 위험은 결과에 명시.
- [x] 초급 개발자용 파일/흐름/실패·검증·배포 호환 안내와 Notion04/07 갱신·재조회 확인. 앱/수집기·전체 PR 승인으로 표시하지 않는다.

검증 결과: [구현 보고](../../status/2026-10-16-native-ledger-channel.ko.md). 실제 변경 범위 제품/테스트/설정52파일. verify1899, DB336, core E2E17, web1192/인증보안27파일 분기1098/1098. 별도 앱·알림 수집·운영 배포는 다음 단위다.

## 결정 기록

| 결정 | 이유 | 대안/틀릴 때 비용 |
| --- | --- | --- |
| 필수 서명 chn, 무누락 기본값 없음 | 명시된 서버 권한과 위조 경계 유지 | 구 API/BFF 혼합 배포가 거절됨; 함께 배포 검증 필요 |
| 기존 Core 작업 재사용 | 프로필/계좌/분류/거래 검증 이중화 방지 | 분리 경계가 흐리면 테스트로 차단하고 작은 helper로 추출 |
| 현재 단계 새 DB 없음 | 기존 세션·원장·요청 제한으로 연결 가능 | 활성 수집 기기는 후속 전용 계약/저장 필요 |
| PC 생성 제거와 native 생성 연결을 같이 검증 | 승인된 최종 UX에 맞춤 | Android APK 제공 전에는 실제 사용자 신규 작성 공백; 배포하지 않고 상태 안내 |

선행 사용 정책·권한·암호·데이터 수명 검토는 기존 승인 문서를 유지한다. 시작 잔액 A안의 별도 공수 보고는 이 단위에서 건너뛰지 않는다.
