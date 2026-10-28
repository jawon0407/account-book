# Server Consent Device Verification and Capture Controls Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute the verification tasks. Source-selection implementation is gated on device verification and a concrete follow-up design.

**Goal:** 최신 서버 동의·철회 UI를 실제 Android에서 확인한 뒤 알림 출처 선택·수집 시작/중지 개발로 이어간다.

**Architecture:** 기존 Android 개발 앱 → localhost HTTPS BFF → Nest API → 격리 PostgreSQL을 사용한다. 서버 동의, Android 권한, 수집 기기 지정은 독립 상태다. 실제 금융 알림 읽기·업로드는 이번 동의 확인에 포함하지 않는다.

**Tech Stack:** Expo/React Native, Android SDK/ADB, Next.js BFF, NestJS, PostgreSQL, Vitest, Playwright.

**Spec:** `../specs/2026-10-21-mobile-server-consent-design.md`, `../specs/2026-10-21-android-collector-settings-design.md`, Notion 02 알림 요구사항.

## Global Constraints

- 실계정·운영 Supabase·실제 금융 원문은 시험하지 않는다. 합성 계정을 사용한다.
- 서버 변경 성공 전 성공 표시 금지. 변경 요청 자동 재전송은 0회다.
- OS 권한을 강제로 변경하지 않는다. 실제 알림 본문 callback은 현재 미구현이다.
- 기존 합성 거래 폴더를 보존한다. DB 초기화·삭제 준비기를 재실행하지 않는다. 기존 임시 클러스터의 내부 파일 누락으로 원본을 중단·보존하고 별도 빈 클러스터를 사용했다. 원본 거래 복구 완료로 표시하지 않는다.
- 테스트 인증서는 개발 APK localhost/127.0.0.1에만 신뢰한다. TLS 우회 금지.
- 인증서·개인키·APK·로그는 Git 제외 output 경로에만 둔다. 개인키·토큰·기기 ID는 Notion에 기록하지 않는다.
- 출처 선택·시작/중지 제품 구현은 아래 실기기 확인 통과 뒤 진행한다.

## Review Focus

- 만료 인증서: 연결 실패를 동의 API 오류로 잘못 판단하지 않도록 Task 1에서 먼저 검증한다.
- 응답 유실: 철회가 성공했다고 오인하지 않고 서버 재조회와 재시도 안내를 Task 2에서 확인한다.
- 재실행·계정 전환: 이전 계정/요청의 결과가 노출되지 않도록 Task 2에서 확인한다.
- 권한과 동의 불일치: 동의 완료만으로 수집 중으로 표시하지 않음을 Task 2에서 확인한다.
- 테스트 잔여 상태: Task 3에서 동의 철회·기기 권한 상태 및 서버 유지/종료 상태를 기록한다.

## 변경 파일과 규모

현재 확정된 변경은 이 계획과 `docs/status/2026-10-28-server-consent-device.ko.md` 2개 문서다. 인증서 갱신·개발 APK 재패키징은 무시되는 로컬 산출물이며, release 신뢰 정책을 바꾸지 않는다. 버그가 재현되면 해당 구현/회귀 테스트 변경을 먼저 알리고 범위를 갱신한다.

후속 출처 선택·수집 제어는 단순 CSS 변경이 아니다. 계정별 설정, 서버 동의/기기 유효성, Android 서비스가 함께 움직이는 중규모 작업이다. 아래 파일은 검토 대상이며 수정 확정 목록이 아니다.

- `apps/mobile/src/ui/collector-screen.tsx`: 기존 기기·동의 화면과 새 설정 진입 연결.
- `apps/mobile/src/collector/`: 출처 및 시작/중지 상태 모델을 별도 파일로 분리하고 회귀 테스트 추가.
- `apps/mobile/src/api/native-collector-client.ts`, `apps/mobile/src/auth/session-manager.ts`: 필요한 서버 계약만 연결.
- `apps/mobile/modules/notification-access/android/src/main/java/com/accountbook/notificationaccess/`: 명시적 시작/중지와 선택 출처 gate. 별도 네이티브 빌드 검증 필요.
- `packages/contracts/src/`, `apps/api/src/collector/`: 실제 수집 제어 계약이 필요한지 기존 기기 지정과 분리 검토.
- DB 변경은 저장 정책·기기 교체/철회 원자성 계약 확정 전에는 실행하지 않는다.

기존 파일 규모(이번 확인 시점)는 다음과 같다. 특히 431줄의 세션 관리 파일에 새 화면·상태 로직을 몰아넣지 않고 별도 모듈로 분리한다.

| 기존 파일 | 줄 수 | 용량 | 후속 변경 원칙 |
| --- | --- | --- | --- |
| `apps/mobile/src/ui/collector-screen.tsx` | 213 | 6,570 bytes | 새 패널 연결만 담당 |
| `apps/mobile/src/ui/notification-access-panel.tsx` | 215 | 7,823 bytes | 동의 UI 유지, 출처/제어 UI와 분리 |
| `apps/mobile/src/collector/notification-access.ts` | 228 | 8,515 bytes | 동의/권한 상태 경계 유지 |
| `apps/mobile/src/auth/session-manager.ts` | 431 | 16,291 bytes | 필요한 요청/계정 경계 연결만 추가 |
| `apps/mobile/src/api/native-collector-client.ts` | 68 | 2,328 bytes | 타입이 있는 서버 요청만 추가 |

후속 구현은 한 번에 완료한 것으로 처리하지 않고 아래 단위로 나눈다. 파일 수·변경 줄 수는 상세 계약 확정 전 예상 범위이며, 구현 직전 실제 목록을 갱신한다.

1. **출처 선택 설정**: 기존 모바일 파일 2~3개 연결, 출처 모델·저장 계층·UI·테스트 4~6개 분리 추가 예상. 계정별 분리, 지원/미지원 출처 안내, 기본 선택 없음, 저장과 수집 시작의 분리부터 검증한다.
2. **수집 시작/중지 제어**: 모바일·서버 계약·API·테스트 6~10개 검토 예상. 서버 동의·OS 권한·지정 기기·유효 세션·선택 출처가 모두 충족돼야 시작하며, 조건이 깨지면 중지하는 상태 전이를 먼저 테스트한다. 기존 기기 지정을 실제 수집 상태로 대체 표시하지 않는다.
3. **네이티브 실제 처리 연결**: Android 서비스/연결 모듈·구조화 이벤트 경계·테스트·문서가 추가되는 별도 중규모 단계다. Kotlin 변경은 기존 산출물 재사용이 아닌 정상 빌드와 실기기 검증이 필요하다. 지원 출처만 기기 안에서 판독하고, 미지원/실패는 수기 안내로 처리하며 금융 원문 재전송 큐를 도입하지 않는다.

이 단계들은 단순 스타일 변경이 아니므로 테스트 코드를 포함한다. PC 제품 화면 수정은 현재 예정되어 있지 않으나 공유 계약 변경 시 Playwright 회귀를 수행한다.

## Task 1: 최신 실기기 환경 복구

**Files:** 기존 `output/android-device-2026-10-20/resume-1021.ts`, `tests/e2e/device/lifecycle.ts`, `apps/mobile/tooling/apply-debug-trust.cjs`를 참조. 일회용 실행 산출물은 output 아래.

- [x] 기준 커밋 be94992, 깨끗한 작업 트리, 테스트 서버 중단 상태 확인.
- [x] 사용자 연결 후 authorized Android 1대 확인.
- [x] 기존 CA/localhost 인증서의 2026-10-27 만료 확인.
- [x] 새 테스트 CA/localhost 인증서 생성, SAN/기한/체인 확인.
- [x] 개발 APK에 새 공개 CA만 반영, 서명·패키지·네이티브 재사용 범위 기록 후 기존 앱 업데이트 설치. 네이티브 클린 빌드 통과는 아님.
- [x] 기존 로컬 테스트 DB의 파일 누락 확인 후 원본 보존. 새 격리 클러스터와 합성 사용자로 테스트 범위 변경(기존 거래 동기화 검증 제외).
- [x] 최신 API 빌드·HTTPS 웹·Metro 기동, USB loopback 연결 확인.

## Task 2: 동의·철회 실제 화면 검증

**Interfaces:** 기존 NotificationConsentState 및 SessionManager.read/change 경계를 변경 없이 사용한다.

- [x] 합성 계정 로그인 → 수집 설정에서 서버 상태와 OS 권한 상태를 별도 확인.
- [x] 고지 확인 → 동의 저장 → 서버 응답 뒤 granted 표시. 자동 수집 중이라고 표시하지 않는다.
- [x] 화면 재진입/앱 재실행 후 서버 동의 상태 유지.
- [x] 명시적 동의 철회 → withdrawn → 재실행/상태 조회만 한 구간에서 유지.
- [x] 연결 단절 시 변경 성공 오표시 없음, GET 복구가 PATCH 자동 재전송을 만들지 않음.
- [x] 로그아웃 후 두 번째 합성 계정에서 첫 계정의 동의가 보이지 않음.
- [x] PC Playwright 로그인·내 계좌 화면·새로고침·로그아웃 회귀 확인. 기존 거래 조회/공유 동기화는 이번 범위에서 제외.
- [x] 추가 동의(version 3, 5) 이후 사용자 직접 활성화 확인. “켰었어”라는 답변으로 자동 재동의 의심 해소. OS 권한 해제 확인은 아래 별도 항목으로 남긴다.
- [x] 사용자의 OS 권한 켜기 확인 후 끄기·앱 복귀를 관찰. 앱 ‘철회됨 / 허용되지 않음’, 서버 version 6 철회가 GET 재조회 후에도 유지됨. 권한을 자동 변경하지 않음.

제품 결함이면 재현 테스트를 먼저 추가하고 최소 수정 후 관련 회귀를 실행한다. 환경 문제와 제품 결함을 분리한다.

## Task 3: 인계와 다음 개발 경계

- [x] QA 결과·cso 보안 경계·독립 review 결과를 상태 문서에 반영. Notion 기록도 동일하게 유지.
- [x] 사용자 직접 활성화 확인 및 재로그인 요청 처리. 서버 복구·USB 재연결·합성 로그인 완료. 최신 관찰은 동의 저장 유지·기기 미지정·OS 허용·서비스 연결됨이며, 임의 재지정하지 않음. 보안 설정 복원 안내를 인계에 포함.
- [x] 출처 선택 첫 단위의 상세 계약과 수정/추가 파일을 별도 2026-10-28-notification-source-preferences 설계/계획에 확정. 시작/중지·네이티브 연결은 후속 단위이며 이번에 완료했다고 표시하지 않음.
- [x] 후속 사용자 요청 반영: 고정 출처 선택·저장은 폐기하고 ‘알림 허용’ → 앱 확인 팝업 → Android 사용자 선택 흐름으로 대체한다. 별도 notification-permission-entry 계획을 따른다.
- [ ] 실제 수집 시작 표시 전에 금융 알림 선별·계정 격리·철회 즉시 중지·기기 교체·권한 해제·앱 재시작 정책을 검증. 고정 5종 선택을 시작 조건으로 두지 않는다.

이번 요청에 별도 커밋·푸시 지시는 없으므로 준비/검증 변경은 우선 로컬에 남긴다. 원격 CI의 이전 통과를 새 APK나 새 개발 기능의 검증으로 재사용하지 않는다.
