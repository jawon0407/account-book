# Mobile Server Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 기존 연속 진행 지시에 따라 직접 구현하고 마지막 독립 리뷰를 수행한다.

**Goal:** Android 동의 화면을 기존 서버 API에 안전하게 연결한다.
**Architecture:** NativeCollectorClient → SessionManager → NotificationAccess → 기존 UI. 서버 동의와 OS 권한을 독립적으로 표시한다.
**Tech Stack:** 기존 React Native/Expo/TypeScript/Zod/Ky/Vitest. 새 의존성 없음.
**Spec:** docs/superpowers/specs/2026-10-21-mobile-server-consent-design.md

## Global Constraints

- 기존 feature/bank-state-transitions worktree 재사용, unrelated next-env.d.ts 보존.
- 운영 DB/실제 알림 수집/자동 재전송 없음. 과거 로컬 동의 자동 이관 없음.
- 요청 본문 신원/시각 없음. GET/PATCH collector/consent만 사용.
- 10~14파일 예상; API/세션/모델/화면/시험/문서. 실제 파일 수는 결과 기록에 명시한다.
- 사용자 연속 진행 지시에 따라 승인 대기를 반복하지 않는다. 이 단위 구현 후 검증하며 PR/병합/배포는 별도다.

## Review Focus

- 실패한 철회 뒤 재조회가 granted이면 철회 완료로 오인시키지 않는가.
- 서버 오류 중 이미 허용된 OS 접근을 사용자가 해제할 수 있는가.
- OS 조회 실패가 서버 철회를 막거나 잘못된 권한 상태를 만들지 않는가.
- 재동의/화면 재진입/로그아웃 사이의 늦은 응답이 다른 세션으로 보이지 않는가.
- old/local consent와 현재 고지·서버 상태가 혼동되거나 자동 수집 중으로 표시되지 않는가.

### Task 1: HTTP와 세션 연결

**Files:** 수정 apps/mobile/src/api/native-collector-client.ts/test.ts, auth/session-manager.ts; 신규 auth/session-consent.test.ts.
**Interfaces:** readConsent(token):Promise<NotificationConsentState>; changeConsent(token,input):Promise<NotificationConsentState>; SessionManager.notificationConsent()/changeNotificationConsent(input).

- [x] 고정 경로/입력·응답 거부/무재전송과 세션 늦은 응답·401 시험 작성. 반환값은 {version:1,state:"granted",noticeVersion:"notification-access-v1"}.
- [x] mobile vitest 관련2파일 실행. Expected: 신규 메서드 없음 RED.
- [x] 기존 전송·인증 경계 재사용 구현, owner/body 확장 없이 계약 검증.
- [x] 같은 시험 실행. Expected: 모두 GREEN. 완료 기록 후 Task2.

### Task 2: 동의 모델과 화면

**Files:** 수정 collector/notification-access.ts/test.ts, ui/notification-access-panel.tsx, ui/notification-access-guide.tsx; 신규 collector/notification-consent-copy.ts/test.ts.
**Interfaces:** NotificationConsentPort.notificationConsent/changeNotificationConsent; AccessState.consent:NotificationConsentState|null; consentPresentation(state)로 표시/행동 가능 여부 파생.

- [x] 서버 상태별 표시/동의·철회·충돌·늦은 응답·부분 실패·무재전송 시험 작성. Expected: 로컬 저장 전용 모델에서 RED.
- [x] 서버 상태 모델 구현, OS 독립 조회/해제 경로 및 명시적 GET 복구. mutation 결과 버전/상태 대조.
- [x] UI의 로컬 저장 문구/연결을 교체하고 outdated 재동의·철회, 실패 알림을 표시.
- [x] 관련 모바일 시험 실행. Expected: 모든 상태 회귀 GREEN. UI 문구 자체가 아닌 행동 가능 여부를 시험한다.

### Task 3: 통합 검증과 기록

**Files:** 수정 apps/mobile/README.md; 신규 docs/status/2026-10-21-mobile-server-consent.ko.md; 필요시 기존 실기기 안내 갱신.
**Interfaces:** Task1의 SessionManager가 Task2의 port를 만족한다. 고정 기존 HTTPS API origin 유지.

- [x] 전체 pnpm test/typecheck/lint, mobile build 실행. Expected: 통과; 실패는 원인과 미검증 범위 기록.
- [x] PC Playwright 실제 합성 거래 조회·새로고침·로그아웃. Expected: 기존2건 유지, 로그아웃 뒤0건, 페이지 오류0.
- [x] 로컬 테스트 API 준비/Android 연결 여부 확인. 필요 변경은 로컬 합성 환경에만 한정하고 명시한다.
- [x] 독립 리뷰, 중요 지적 RED→GREEN 수정, 최종 문서/Notion 갱신. 코드 연결·실기기·운영 적용을 구분한다.

완료 근거는 [검증 기록](../../status/2026-10-21-mobile-server-consent.ko.md)을 따른다. 위 체크는 이 연결 단위의 구현/검증 계획 완료이며 Android 실기기 시험이나 운영 적용 완료가 아니다.
