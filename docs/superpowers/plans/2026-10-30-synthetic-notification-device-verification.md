# 합성 알림 실기기 검증 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 기존 작업처럼 현재 세션에서 직접 진행한다. 제품 범위 추가나 권한 강제 허용은 하지 않는다.

**Goal:** 개인 금융 알림을 읽지 않고 실제 Android 알림 전달 경로에서 명시적 시작·중지·권한 철회 동작을 검증한다.

**Architecture:** OS가 게시한 합성 알림을 개발용 APK의 동일 수신·판독 엔진으로 전달한다. 빌드 시 고정하는 합성 전용 출처 정책만 분리하고, 사용자 동의·대표 기기·서버 세션·5초 만료는 그대로 적용한다. 일반 빌드의 KB 출처 정책과 시험 전용 정책을 동시에 허용하지 않는다.

**Tech Stack:** React Native/Expo, Kotlin, Android notification shell, Gradle, PowerShell, 기존 로컬 합성 인증·BFF·NestJS·폐기용 DB.

**Spec:** `docs/superpowers/plans/2026-10-29-notification-capture-foundation.md`, `docs/status/2026-10-30-notification-capture-foundation.ko.md`.

## 현재 사전 확인

> 최종 실행 갱신: 최초 시작 직후 실패2회를 재현한 뒤 [별도 수정 계획](2026-10-30-capture-start-fix.md)에서 원인을 확인·수정했다. 수정 APK의 합성 입출금 판독·비채택·중지·화면 이탈·권한 재허용과 최종 동의/기기/OS 접근 정리를 완료했다. 정확한 관찰 범위와 미검증 항목은 `docs/status/2026-10-30-synthetic-notification-device-verification.ko.md`를 따른다. 아래 사전 확인과 예상 시험표는 시작 당시 계획이며, 실제 시험 결과를 대신하지 않는다.

- 기준 HEAD: `fa714829a719457efb7a7ca0aabced94b23ba55e`. 기존 CSO 결과 문서의 미커밋 변경을 보존한다.
- 작업 폴더: `.worktrees/ledger-public-contracts`. 새 작업 트리나 브랜치를 만들지 않는다.
- USB 도구는 처음 접근 오류가 있었으나 필요한 로컬 접근 권한으로 다시 실행해 정상화했다. **인식된 Android 기기 0대**다. 기기 설정이나 알림 권한은 변경하지 않았다.
- 현재 `CaptureEngine`은 `com.kbstar.kbbank`만 처리한다. 일반 테스트 알림으로 성공 경로를 검증했다고 주장할 수 없다.
- 기존 Kotlin/JVM 시험은 순수 엔진 시험이며 실제 Android 서비스/OS 전달 검증을 대신하지 않는다.
- 이번 계획 작성 시 제품 코드 수정·APK 설치·알림 게시·계정 로그인은 하지 않았다.

## Global Constraints

- 실제 금융 알림, 실제 비밀번호, 운영 Supabase/DB를 사용하지 않는다. 저장소 환경변수 파일을 출력하지 않는다.
- 대표 기기·서버 동의·Android 접근·명시적 시작을 모두 유지한다. 시험을 위해 성공 응답이나 권한 상태를 가짜로 만들지 않는다.
- Android 접근 허용/해제는 사용자가 설정 화면에서 직접 수행한다. adb 강제 권한 변경이나 제조사 전역 보안 해제는 금지한다.
- 합성 전용 APK는 실제 은행 알림을 본문 접근 전에 거절해야 한다. 종료 후 해당 앱 알림 접근을 해제한다.
- 원문은 파일·로그·서버·장부에 저장하지 않는다. 시험 알림은 고정된 가명·가짜 마스킹 계좌·금액을 사용한다.
- PC·서버·DB 제품 코드, DB 스키마, 의존성 변경은 계획하지 않는다. 커밋·푸시·배포는 이번 요청 범위가 아니다.
- 실행 증거/캡처는 Git 제외 `output/android-capture-device-2026-10-30/` 아래에 보관한다. 기기 식별자·알림창·개인 알림·비밀값을 노션에 올리지 않는다.

## 변경 파일과 규모

예상 10파일, 코드·시험 도구 약 200~350줄. 구현 중 범위가 커지면 변경 전에 다시 보고한다. 단순 CSS 수정이 아니라 시험 전용 안전 경계를 추가하므로 회귀 검사는 필요하다.

| 구분 | 파일 | 역할 |
| --- | --- | --- |
| 수정 | `apps/mobile/modules/notification-access/android/build.gradle` | debug 합성 전용 빌드 상수, 기본/릴리스에서는 비활성 고정 |
| 수정 | `apps/mobile/modules/notification-access/android/src/main/java/com/accountbook/notificationaccess/CaptureEngine.kt` | 기존 기본 KB 정책을 보존하며 생성 시 허용 출처를 고정 |
| 수정 | `apps/mobile/modules/notification-access/android/src/main/java/com/accountbook/notificationaccess/NotificationAccessService.kt` | 출처·시험 태그 검사 후 동일 엔진 사용, 실제 은행 본문 차단 |
| 신규 | `apps/mobile/modules/notification-access/android/src/main/java/com/accountbook/notificationaccess/CaptureSourcePolicy.kt` | 일반/합성 전용의 상호 배타적 출처 정책 |
| 수정 | `apps/mobile/modules/notification-access/android/src/test/kotlin/CaptureBehaviorTest.kt` | 합성/일반 출처 분리, 본문 미접근, 기존 만료/중지 회귀 |
| 수정 | `apps/mobile/tooling/test-notification-native.ps1` | 새 순수 정책 파일을 기존 JVM 시험에 포함 |
| 신규 | `apps/mobile/tooling/post-synthetic-notification.ps1` | 정해진 합성 사례만 OS에 게시; 권한 변경·실알림 조회 없음 |
| 신규 | 이 계획 문서 | 순서·파일·안전 경계·완료 기준 |
| 신규 | `docs/status/2026-10-30-synthetic-notification-device-verification.ko.md` | 사전 확인 및 실제 시험별 결과·미검증 구분 |
| 수정 | `docs/guides/android-device-testing.ko.md` | 합성 전용 APK 사용/종료·안전 복원 안내 |

## Review Focus

1. 일반/릴리스 빌드가 합성 출처를 허용하는 사고: 빌드별 상수와 컴파일 산출물을 검사한다.
2. 시험 APK가 실제 금융 알림도 읽는 사고: 반대 출처는 본문 콜백 호출 0회여야 한다.
3. 중지·권한 복구 뒤 오래된 검증 응답으로 재시작: 기존 세대·일회용 검증·만료 회귀와 실기기 재시작 절차를 함께 확인한다.
4. OS가 합성 알림을 전달하지 않았는데 차단 성공으로 오판: 시작 상태의 양성 대조를 먼저 확인하고, 미전달은 보류로 기록한다.
5. Android 설정 이동 자체로 이미 중지되는 혼재: OS 철회 후 화면 반영과 네이티브 연결 해제 단독 경로를 구별한다. 이번 UI 시험만으로 후자의 독립 검증을 주장하지 않는다.

## Task 1: 시험 출처 분리와 사전 검증

**Interfaces:** `CaptureSourcePolicy(syntheticOnly: Boolean)`은 `packageName: String`과 `accepts(packageName: String, tag: String?): Boolean`을 제공한다. `CaptureEngine`은 `allowedSource: String = "com.kbstar.kbbank"`를 시계 함수 앞의 기본 매개변수로 받아 기존 `CaptureEngine { clock() }` 호출을 유지한다.

- [x] 기존 JVM 회귀에 일반 모드 KB 허용/shell 차단, 합성 모드 shell+`account-book-test-` 태그만 허용, KB/다른 출처/누락 태그 차단 사례를 추가하고 변경 전 실패를 확인한다.
- [x] `accountBookSyntheticCapture=true`를 명시한 debug 빌드만 합성 모드로 만든다. 기본값과 release 상수는 false다. 임의 URL/JS/저장값/알림 내용으로 모드를 바꾸지 못하게 한다.
- [x] 서비스에서 정책을 본문 접근 전에 검사하고 엔진에도 같은 허용 패키지를 전달한다. 합성 경로를 KB 패키지로 위장해서 전달하지 않는다.
- [x] 합성 제목/본문은 기존 KB 형식의 가상상점·가상입금자와 가짜 마스킹 계좌만 사용한다. 정상 출금/입금, 단순 승인, 금액 불일치 사례를 준비한다.
- [x] 기존 `test-notification-native.ps1 -JavaHome <확인한 경로> -GradleCache <확인한 경로>`로 순수 경계 회귀를 실행한다. 새 모듈 debug/release 컴파일 및 산출물의 빌드 상수를 확인한다. 도구 경로는 기존 설치 상태를 확인하고 기록한다.
- [x] 합성 APK 해시·서명·모드 증거를 기록한 뒤 설치한다. 은행 앱을 대체하는 패키지나 출처 위장은 사용하지 않는다.

## Task 2: 실기기 연결과 합성 알림 전달

**Interfaces:** 게시 스크립트는 `-AdbPath`, `-Serial`, `-Case`만 받고 Case를 `expense`, `income`, `approval`, `amount-mismatch`로 제한한다. 고유한 시험 태그를 생성하며 사용자 임의 본문이나 임의 명령은 받지 않는다. 게시 결과 코드만으로 판독 성공을 판정하지 않는다.

- [x] 사용자가 USB 연결·디버깅 승인·앱 열기를 완료했는지 확인한다. 여러 기기가 있으면 자동 선택하지 않는다.
- [x] 대상 기기의 `cmd notification help`를 읽어 게시 기능을 확인한다. 지원하지 않으면 OS 경로 검증을 보류하고 임의 우회 앱을 설치하지 않는다.
- [x] 기존 테스트 실행기·단기 인증서·폐기용 DB의 경로/유효성을 확인하고 필요한 로컬 서버와 Metro를 준비한다. 실제 DB를 대신 사용하거나 인증서 검증을 해제하지 않는다.
- [x] 합성 테스트 계정으로 로그인한다. 앱 접근 동의 및 대표 기기 지정은 실제 시험 서버의 기존 API를 사용한다.
- [x] Account Book Dev의 **기존 허용 상태**를 확인했다. 이번 회차에는 OS 권한을 대신 변경하지 않았다. 앱이 앞에 있고 합성 모드임을 확인한 뒤 시작 전 합성 출금1건을 게시했다.

## Task 3: 시험표와 종료

| 순서 | 조작 | 기대 결과 |
| --- | --- | --- |
| 1 | 명시적 시작 전 합성 출금 게시 | 중지 상태 유지, 판독 미리보기 없음 |
| 2 | 판독 시작 후 합성 출금·입금 각각 게시 | 방향·금액·가상 상대가 일치; 장부 저장 성공으로 표시하지 않음 |
| 3 | 승인/금액 불일치 게시 | 정상 입출금으로 채택하지 않음 |
| 4 | 판독 중지 후 새 합성 알림 게시 | 결과 즉시 비움, 새 미리보기 없음 |
| 5 | 다시 시작 → 장부 이동/홈 이동 → 복귀 | 중지 유지, 과거 알림 재수집·자동 재시작 없음 |
| 6 | 다시 시작 → 앱의 알림 거부/서버 동의 철회 | 판독 중지, 재시작 거부; OS 권한 상태와 혼동하지 않음 |
| 7 | 동의 복구 후 시작 → 사용자가 Android 접근 해제 → 복귀 | 허용되지 않음, 판독 중지, 새 알림 처리 없음 |
| 8 | 사용자가 Android 접근을 다시 허용 → 복귀 | 자동 재시작하지 않음; 명시적 시작 뒤 새 합성 알림만 판독 |
| 9 | 시험 종료 | 판독 중지, 시험 계정의 동의/지정 정리, 사용자가 OS 접근 및 일시 디버깅 해제 |

- [x] 화면 증거는 앱이 앞에 있는지 확인한 뒤 최소 범위로 남긴다. 알림창 전체·무필터 logcat·실알림 목록을 수집하지 않는다.
- [x] 실패는 재현 조건과 기대/실제 결과를 먼저 기록한다. 제품 수정이 필요하면 별도 범위를 보고하고 회귀 확인 뒤 수정한다.
- [x] 결과 문서·가이드·노션에 통과/실패/보류를 구분한다. PC 코드 변경은 없으며 PC Playwright나 서버 저장 종단 검증을 이번 통과 항목으로 포함하지 않는다.
- [x] 일반은행 알림 원문·백그라운드 상시 수집·자동 장부 저장·타 은행/문자/카카오톡은 이번 시험의 완료 대상이 아님을 명시한다.

## 사용자 준비

USB 데이터 케이블 연결, 테스트 동안만 USB 디버깅 허용, 휴대폰 잠금 해제 후 Account Book Dev 열기. 실제 비밀번호 입력·송금·카드 결제는 하지 않는다. 알림 접근 허용/해제는 준비된 시험 APK를 설치한 뒤 안내하는 시점에만 직접 수행한다. 보안 정책이 막으면 강제 해제하지 말고 차단 문구를 알려준다.

## 근거와 한계

Android의 `onNotificationPosted`는 원래 알림과 발신 패키지 정보를 제공한다. [Android 공식 API](https://developer.android.com/reference/android/service/notification/NotificationListenerService)

AOSP의 notification shell 구현은 `post`·제목·bigtext 형식과 `com.android.shell` 출처를 제공한다. 이것은 기기별 지원 보장이 아니므로 대상 기기 도움말과 양성 대조로 다시 확인한다. [AOSP 고정 소스](https://android.googlesource.com/platform/frameworks/base/+/4578854ad4dc3013b94e8068bca6533321b0a011/services/core/java/com/android/server/notification/NotificationShellCmd.java)

합성 전용 빌드의 OS 전달·판독 검증은 실제 KB 앱의 알림 포맷/발신자 진위를 검증하는 시험이 아니다. 실제 금융 알림을 이용한 검증은 별도 동의·범위가 필요하다.
