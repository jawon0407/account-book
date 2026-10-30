# Android client foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Android 앱에서 안전한 이메일 로그인과 공용 장부 조회를 연결한다.
**Architecture:** Expo Router 화면 → 순수 세션 manager → 고정 HTTPS native BFF API. SecureStore 어댑터 외에는 네이티브 구현과 핵심 정책을 분리한다.
**Tech Stack:** Expo 57.0.30, React Native 0.86.3, React 19.2.3, TypeScript, ky, Zod, Vitest.
**Spec:** [설계](../specs/2026-10-16-android-client-foundation-design.md)

## Global Constraints

- Android만 시작한다. iOS, DB migration, production secret, 배포 변경 없음.
- origin 고정, token SecureStore, 금융 데이터 메모리만, 자동 HTTP 재시도 0, timeout 10초.
- Bookify 원본을 적용하되 Android 시스템 UI·한국어·접근성을 보존한다.
- 혼합된 기존 변경은 stage/commit하지 않는다. 전체 PR 인증으로 해석하지 않는다.

## Review Focus

1. 저장소 삭제 실패 뒤 재실행에서 이전 계정이 복원되는지: storage 실패/복구 테스트.
2. refresh와 logout 경합 뒤 이전 사용자가 다시 보이는지: deferred promise 테스트.
3. 다른 서버 URL로 빌드 시 토큰 누출: origin mismatch 테스트.
4. 인증 만료/네트워크 실패를 빈 장부로 잘못 표시: 상태/오류 테스트.
5. 큰 글자/keyboard/system Back/실제 TLS redirect: 네이티브 검증 필수, 환경 부재면 미검증으로 보고.

### Task 1: 인증·HTTP 클라이언트와 workspace

Files: apps/mobile/package.json, tsconfig.json, vitest.config.ts, src/api/{native-client,client-error}.ts, src/auth/{session-manager,secure-storage}.ts 및 테스트. Root package scripts, .gitignore, pnpm-lock.yaml.
Interfaces: NativeClient(origin, transport), SessionManager(client, storage, createDeviceId); public state에는 token이 없다.

- [x] RED: URL/고정 경로·응답·재시도와 세션 storage/refresh/logout 경합 테스트 작성·실패 확인.
- [x] GREEN: Expo 설정과 adapter/manager 구현. 핵심 함수에 역할·매개변수 설명.
- [x] 집중 테스트 및 타입 검사: 모바일 39개, Windows 도구 회귀 4개 통과.

### Task 2: 실제 Android 화면과 번들

Files: apps/mobile/app/{_layout,index}.tsx, src/ui/{theme,login-screen,ledger-screen}.tsx, src/app-runtime.ts, app.json, README.md.
Interfaces: 화면은 SessionManager snapshot/subscribe와 목록 조회만 사용한다.

- [x] 로그인 → 장부 목록 → 새로고침/추가 조회 → 로그아웃 코드 연결. foreground 재검증, background 가림.
- [x] 설정·화면 논리 테스트, Android JavaScript/Hermes export.
- [x] 독립 코드·보안 리뷰 한 번, Important 4건의 실패 테스트 및 보완. native 디자인 미검증 상태 기록.
- [ ] APK·에뮬레이터·실기기 화면/접근성/TLS/최근 앱 미리보기 검증: SDK/JDK/adb 확인부터 필요.

### Task 3: 회귀 검증·진행 기록

- [x] pnpm verify 종료 0, 2,004개 테스트 및 API/웹/Android 번들 통과. 감사 실행은 완료했으나 3건 남음. diff 및 등록 비밀 패턴 821파일/0건 검사.
- [ ] 의존성 감사 high 2/moderate 1 해결 또는 검증된 대체: 출시/실금융 베타 차단 유지.
- [x] PC Playwright 회귀 18개/48.4초 종료 0. 실제 Android 기기 시험과 구별해 기록.
- [x] 구현/번들/APK/실기기/배포를 구분하여 MD·Notion 04/07 및 최상위 페이지 갱신. 비동기 저장 성공과 다시 읽기 확인.
- [x] 커밋은 기존 혼합 변경 분리 후 별도 단계로 남긴다. 이번에는 수행하지 않음.

## 구현 중 확정한 제한과 후속

- SDK58 peer 충돌 때문에 호환 SDK57로 고정. 정책 검사를 끄지 않음.
- 완전 재실행 시 재로그인은 첫 개발 버전의 임시 제한. 알림 수집의 프로세스 재시작 지원 전에 지속 로그인/철회 내구성을 보강한다.
- 응답 문자열 크기 검사는 정확한 수신 바이트/메모리 상한이 아니다. 스트리밍 상한 검증을 출시 전에 보강한다.
- 전체 자동 autoplan 도구는 설치본 참조 누락 때문에 완료로 표기하지 않는다. 직접 설계 검토·TDD·독립 리뷰·전체 검증으로 보완했다.
- 결과/파일 지도/실패 이력: [검증 기록](../../status/2026-10-16-android-client-foundation.ko.md), [앱 README](../../../apps/mobile/README.md).
