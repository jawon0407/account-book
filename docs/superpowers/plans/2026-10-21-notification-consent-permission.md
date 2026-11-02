# Notification Consent Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax. 기존 사용자 지시에 따라 별도 승인 반복 없이 직접 실행하며 마지막에 독립 코드 리뷰를 받는다.

**Goal:** 계정별 로컬 동의 저장과 Android 알림 접근 설정 왕복을 실제 개발 APK에 연결한다.

**Architecture:** 보안 저장소 어댑터와 동의/권한 모델을 네이티브 모듈에서 분리한다. Expo 로컬 모듈은 OS 상태와 설정 이동만 제공하고 listener는 본문을 읽지 않는다.

**Tech Stack:** 기존 Expo57/RN0.86/TypeScript/Vitest/SecureStore + Kotlin/Android SDK36.

**Spec:** `docs/superpowers/specs/2026-10-21-notification-consent-permission-design.md`

## Global Constraints

- 고지 버전 `notification-access-v1`. origin/userId/deviceId 격리. 실제 세션 신원만 사용.
- 금융 알림 원문·로그·과거 조회·업로드·새 권한 우회 없음. 동의/OS 접근/서비스 연결/기기 지정은 별개.
- 서버/DB 변경 없음. 로컬 기록을 서버 동의 증빙으로 부르지 않는다. 실제 수집 전 서버 검증은 후속 필수.
- 기존 Next 자동 생성 변경 보존. 사용자 설정 변경은 직접 허용하며 adb로 OS 권한을 강제 부여하지 않는다.

## Review Focus

- 같은 계정 재로그인 중 늦은 저장 결과: 세션 세대와 모델 수명으로 응답 차단(T1).
- 보안 저장 성공 응답 뒤 실제 읽기 실패/불일치: 동의 미확인, OS 설정 이동 금지(T1).
- 접근 권한은 이미 있지만 동의가 없음: 권한과 동의를 따로 표시하고 자동 수집 금지(T1/T3).
- 네이티브 모듈 없는 이전 APK: 명확한 업데이트 안내, crash 금지(T2/T3).
- 설정 이동 실패/사용자 거부/철회 후 OS 권한 잔류: 실패를 성공으로 표시하지 않기(T1/T3).

### Task 1: 동의 저장·상태 모델

**Files:** 새 `apps/mobile/src/collector/notification-consent.ts`, `.test.ts`, `notification-access.ts`, `.test.ts`; 수정 `src/auth/session-manager.ts`, `src/auth/session-collector.test.ts`.

**Interfaces:** `NotificationConsentStore(storage, scope)`의 `read/accept/withdraw`; scope `{origin,userId,deviceId}`. `NotificationAccess`는 `getScope()`(scope+generation 또는 null), storage, native port를 받아 `start/stop/reload/accept/withdraw/openSettings`와 `snapshot/subscribe`를 제공한다. 세션의 `notificationConsentScope()`는 ready일 때만 인증된 scope+generation을 반환한다.

- [x] 저장·재조회·격리·실패·세션 변경·중복 동작 시험을 먼저 작성한다.
- [x] `pnpm --filter @account-book/mobile test`로 구현 부재 실패 확인.
- [x] 보안 저장소 검증과 상태 모델 구현. 권한은 getStatus 결과만 사용, ready 전에는 쓰기 금지.
- [x] 모바일 전체 테스트·타입 통과 확인. 이후 변경은 이번 요청의 후속 기능 작업으로 남기고 최종 검증 전 임의 푸시하지 않는다.

### Task 2: Android 네이티브 연결

**Files:** 신규 `apps/mobile/modules/notification-access/expo-module.config.json`, `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `android/src/main/java/com/accountbook/notificationaccess/NotificationAccessModule.kt`, `NotificationAccessService.kt`; 신규 `src/collector/android-notification-access.ts`와 `.test.ts`.

**Interfaces:** `AccountBookNotificationAccess.getStatus()` → `{available:true,accessGranted:boolean,listenerConnected:boolean}`, `openSettings()` → boolean. JS 어댑터는 미탑재/오류를 안전하게 처리한다.

- [x] 어댑터의 모듈 부재·잘못된 반환·설정 실패 시험 RED 확인.
- [x] 공식 Expo 로컬 모듈 형식으로 Kotlin과 manifest 구현. 알림 본문 callback/조회는 구현하지 않는다.
- [x] JS 시험 및 실제 Gradle Kotlin/manifest compile, 최종 manifest에서 listener bind 경계 확인. 새 모듈 compile 성공; 변경 없는 C++ 산출물 재사용 한계는 결과 문서에 기록.

추가 파일: `src/platform/notification-access.ts`. Expo 연결을 엄격 공통 타입 검사 밖으로 분리했으며 검사 설정을 약화하지 않았다.

### Task 3: UI·개발 APK·실기기 경로

**Files:** 신규 `src/ui/notification-access-panel.tsx`; 수정 `collector-screen.tsx`, `notification-access-guide.tsx`; README, 화면 설계 기록, `docs/status/2026-10-21-notification-consent-permission.ko.md`. 필요 시 고정 로컬 모듈 검색 설정만 모바일 package에 추가한다.

**Interfaces:** T1 모델 + T2 어댑터를 기존 설정 화면에 연결한다. 안내 보기와 동의 확인은 별개. 서버 SessionManager가 준비되지 않으면 화면/동작을 가린다.

- [x] 기존 테마/48dp/스크롤로 동의 확인·취소·철회·설정 이동·상태 재조회를 연결한다.
- [x] 전체 테스트·타입·린트·Android bundle 및 APK 생성. 기존 영문 빌드 복사본만 명시 파일 동기화, env/키 복사 금지.
- [x] 합성 계정으로 실기기 저장/재시작/초기 미허용/사용자 허용/복귀/철회/철회 후 재시작 유지 확인. OS 허용은 사용자가 직접 선택했고 실제 서비스 연결을 확인.
- [x] 사용자가 Account Book Dev의 OS 접근을 해제한 뒤 복귀. OS 실제 허용값 false / 앱 미허용 표시 / 동의하지 않음 / 서비스 연결 문구 제거 / 설정 버튼 비활성 확인.
- [x] PC Playwright 로그인·조회·새로고침·로그아웃 회귀 확인.
- [x] 독립 리뷰, 결과/제한/후속 서버 동의 검증을 MD와 Notion에 기록.

최종 확인: 구현 검증에서 전체2,224개·모바일191개·타입·린트·JS export·PC Playwright 통과. 새 Kotlin 모듈 compile/개발 APK 설치/동의 저장 및 재실행 복원/OS 설정 이동 확인. 사용자 허용 후 추가 실기기 시험에서 실제 OS 허용·서비스 연결·동의 철회·재시작 후 철회 유지·철회 상태의 설정 이동을 확인했다. 사용자 OS 해제 후 복귀에서도 실제 미허용과 앱 표시 일치를 확인해 핵심 권한 왕복을 마쳤다. 계정 전환/접근성/OS 재부팅은 별도 미검증이다. 추가 시험 때 제품 수정이나 전체 시험 재실행은 하지 않았다. 빌드의 기존 C++ 산출물 재사용과 서버 동의 미구현 경계는 상태 문서에 기록했다. 이전 안내 UI만 1df9f84로 푸시 완료이며 후속 코드는 미커밋이다.
