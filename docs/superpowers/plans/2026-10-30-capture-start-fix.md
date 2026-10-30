# Android 판독 시작 오류 수정 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 확인 팝업 직후 판독 시작 실패의 원인을 실기기에서 구분하고, 최소 수정 및 합성 알림 재검증을 완료한다.
**Architecture:** 현재 명시적 시작·네이티브 안전 경계는 유지한다. 먼저 개발용 진단으로 실패 단계와 비식별 상태만 확인하며, 원인 확인 뒤 회귀 시험과 최소 수정으로 해결한다.
**Tech Stack:** React Native/Expo, TypeScript/Vitest, Kotlin/JVM, Android API36.
**Spec:** 사용자 2026-10-30 수정·재검증 요청 및 `docs/status/2026-10-30-synthetic-notification-device-verification.ko.md`의 실패 관찰.

## Global Constraints

- 기존 작업은 보존한다. 커밋·푸시·배포는 수행하지 않는다.
- 합성 전용 APK 및 로컬 합성 DB만 사용한다. 실제 금융 알림 원문, 사용자 식별값, 토큰을 기록하지 않는다.
- 동의·대표 기기·세션·전경 상태·일회용 검증 번호·5초 만료를 우회하거나 완화하지 않는다.
- OS 알림 접근은 사용자가 직접 허용/해제한다. 끝날 때 동의·기기 지정·OS 접근을 정리한다.
- 자동 시험 통과와 실기기 성공은 별도로 판정한다.

## Review Focus

- 팝업 확인 직후 일시적인 포커스 부재와 실제 앱 백그라운드를 혼동하지 않는지.
- 확인 팝업 중 취소·계정 변경·화면 이동 시 늦은 시작을 차단하는지.
- 네이티브 연결 거절·형식 오류·응답 지연에서 안전하게 중지하는지.
- 진단에 원문·개인값이 포함되지 않고 임시 진단은 최종 코드에서 제거되는지.
- 권한 철회/재허용만으로 자동 재시작하지 않는지.

### Task 1: 원인 관찰 및 최소 수정

**Files:** 조사/조건부 수정 `apps/mobile/modules/notification-access/android/src/main/java/com/accountbook/notificationaccess/{NotificationAccessModule,CaptureEngine}.kt`, `apps/mobile/src/collector/{android-capture,collection-runtime}.ts`, `apps/mobile/src/ui/collection-runtime-panel.tsx`; 시험 `apps/mobile/src/collector/*.test.ts`, `apps/mobile/modules/notification-access/android/src/test/kotlin/CaptureBehaviorTest.kt`. 원인과 무관한 파일은 변경하지 않는다.
**Interfaces:** 기존 `begin(): Promise<number>`, `beginVerification(epoch): Promise<number>`, `prepareStart(): () => Promise<void>` 및 안전 검증 순서를 유지한다. 변경 필요 시 근거와 소비자 계약을 먼저 기록한다.

- [x] 현재 전체 시험 및 JVM 기준 상태 확인.
- [x] 비식별 개발 진단으로 시작 경계별 결과를 수집하고 단일 원인 가설을 검증.
- [x] 확인된 원인을 잡는 실패 회귀 시험을 먼저 실행.
- [x] 최소 수정 후 회귀/JVM/타입/전체 시험 통과 확인.
- [x] 임시 진단을 제거하고 독립 리뷰 수행. 커밋은 하지 않음.

### Task 2: 새 APK 실기기 검증과 기록

**Files:** `docs/status/2026-10-30-synthetic-notification-device-verification.ko.md`, 이 계획, 필요 시 `docs/guides/android-device-testing.ko.md`. 산출물/화면 증거는 Git 제외 `output`에 둔다.
**Interfaces:** 합성 전용 debug 빌드, 고정 가짜 입출금 게시 도구, 동일 OS 수신 경로.

- [x] 수정 APK 컴파일·합성 전용 상수·서명 확인 후 업데이트 설치.
- [x] 사용자 직접 권한 허용 후 명시적 시작 및 새 합성 출금/입금 양성 대조 확인.
- [x] 단순 승인/불일치 비채택, 중지 뒤 무처리 및 재시작 시 과거 알림 미조회 확인.
- [x] 장부 화면 이동 및 홈 이동 후 재진입 시 중지 확인.
- [x] 앱의 동의 철회 요청200 및 사용자 OS 해제 후 허용되지 않음/중지됨 확인.
- [x] OS 접근 재허용 후 자동 재시작 없음 확인 — ‘허용됨·중지됨’, 새 합성 알림 게시 후에도 무처리 확인.
- [x] 동의·기기 지정 해제 및 사용자 OS 접근 해제 확인 — OS 접근false, 지정된 기기 없음, 허용되지 않음, 중지됨.
- [x] 통과·실패·미검증을 구분해 MD와 노션에 기록. 권한 왕복 및 최종 정리 결과까지 반영.
