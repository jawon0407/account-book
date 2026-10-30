# Android development APK implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 공식 JDK/Android SDK로 로컬 개발 APK를 만들고 실기기 연결 절차를 전달한다.
**Architecture:** 기존 Expo 57 앱을 prebuild한 뒤 로컬 Gradle debug 빌드. 개발 APK는 Metro와 별도의 HTTPS BFF가 필요하며 스토어 배포본이 아니다.
**Tech Stack:** Node 22, Microsoft OpenJDK 17, Android command-line SDK, Expo/React Native, Gradle.
**Spec:** `docs/superpowers/specs/2026-10-16-android-client-foundation-design.md`, 수기 입력 설계와 2026-10-19 사용자 요청.

## Global constraints

- Android만 대상. 기존 미커밋 변경 보존. 커밋/푸시/배포/실제 DB 변경 없음.
- 공식 배포와 checksum 검증. TLS 검증/보안 보호를 끄지 않는다.
- SDK/JDK/캐시는 사용자 로컬 디렉터리에 설치하고 전역 환경변수는 바꾸지 않는다.
- 비밀키는 APK에 넣지 않는다. API origin은 공개 HTTPS 주소만 사용한다.
- 개발 APK 생성, 설치, 앱 실행, 로그인/거래 검증은 각각 별도 완료 조건이다.

## Review focus

1. 긴 한글 Windows 경로에서 Gradle/CMake 빌드 실패 여부.
2. 생성된 manifest의 백업/권한과 디버그 전용 네트워크 예외.
3. 개발 APK를 독립 실행·운영 배포본으로 오해하지 않도록 안내.
4. 실기기 HTTPS 신뢰·localhost·USB 연결 차이.
5. APK 무결성/서명·아키텍처와 민감 파일 Git 제외.

## Task 1: 환경 준비 및 APK 산출

**Files:** 생성 `apps/mobile/android/`(Git 제외), 로컬 SDK/JDK/Gradle 캐시, `output/android-apk/` 산출물. 필요 시 빌드 호환 설정만 최소 수정.
**Interfaces:** 기존 app.json → generated Android project → debug APK.

- [x] JDK/SDK/adb 미설치, 네이티브 프로젝트 부재, 저장 공간 확인.
- [x] 공식 JDK/SDK 다운로드·해시 검증·설치 및 버전 확인.
- [x] Expo Android prebuild, 요구 SDK/NDK 확인, Gradle assembleDebug 종료 0 확인.
- [x] apksigner/aapt로 서명·package·minSdk·권한 검사, APK SHA-256 기록.
- [x] 모바일 기존 시험/typecheck 재검증. 기기가 없으면 실기기 미검증으로 기록.

## Task 2: 전달·기록

**Files:** `docs/guides/android-device-testing.ko.md`, `docs/status/2026-10-19-android-development-apk.ko.md`, `apps/mobile/README.md`, 본 계획.
**Interfaces:** Task 1의 실제 명령/버전/결과 → 재현 안내와 Notion 07 진행 기록.

- [x] USB 디버깅·설치·Metro·HTTPS 테스트 서버 절차와 미구현 알림 수집 경계 기록.
- [x] 범위별 읽기 전용 리뷰, 변경/산출물 검사 후 Notion 갱신·readback.

## Execution rulings

- 사용자 명시 요청과 기존 루틴 승인 생략 방침에 따라 계획 재승인 없이 직접 진행한다.
- 제품 기능 추가가 아닌 도구 설치·생성 빌드다. 환경 부재 → 실제 빌드/산출물 검사로 검증하며 제품 코드를 수정할 경우 별도 RED→GREEN을 적용한다.
- 혼합 작업트리에 커밋하지 않는다. 설치·빌드 기록은 상태 문서에 보존한다.
