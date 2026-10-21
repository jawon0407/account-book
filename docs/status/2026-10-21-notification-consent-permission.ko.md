# Android 실제 동의 저장·알림 접근 연결

확인일: 2026-10-21. 기준 커밋 `1df9f84` 이후의 기능 변경이다.

## 요약과 범위

이전 동의·권한 **안내 UI 5파일은 `1df9f8478b47e31054f0fab41fa8e152ca2f38d2`로 커밋·푸시**했고 원격 해시까지 대조했다. 푸시 보안 게이트는 903개 변경 blob을 통과했다. 이번 후속 코드와는 별도 체크포인트다.

후속으로 **계정·설치별 로컬 동의 저장/철회와 Android 알림 접근 설정 이동·실제 상태 조회**를 연결했다. 네이티브 서비스는 연결 여부만 확인한다. 금융 알림 본문 판독·과거 알림 조회·파일 기록·로그·서버 전송은 하지 않는다. 따라서 권한이 허용되어도 거래가 자동으로 생성되지는 않는다.

서버 동의 증빙 API/DB, 출처 선택, 자동 기록 켜기/끄기, 수집 접수 권한은 다음 단위다. 현재 로컬 동의를 서버 감사 증빙이나 법적 적합성 검증 완료로 표현하지 않는다. Supabase/운영 DB·패키지 버전·웹 제품 코드는 변경하지 않았다.

## 작업 계획과 변경 파일

착수 전 [설계](../superpowers/specs/2026-10-21-notification-consent-permission-design.md)·[실행 계획](../superpowers/plans/2026-10-21-notification-consent-permission.md)을 작성하고 Notion 07번에 범위와 약15~20파일 예상을 기록했다.

| 경로 | 하는 일 |
| --- | --- |
| `src/collector/notification-consent.ts`와 시험 | 고지 버전·시각·계정/설치/서버 범위를 검증하고 OS 보안 저장소에 저장·재조회·철회 |
| `src/collector/notification-access.ts`와 시험 | 동의/OS 권한을 별개 상태로 관리하고 중복 클릭·늦은 응답·저장 실패를 차단 |
| `src/collector/android-notification-access.ts`와 시험 | 네이티브 반환 형식 검증, 이전 APK의 모듈 부재를 안전하게 처리 |
| `src/platform/notification-access.ts` | Expo 모듈을 순수 상태 모델 밖에서 연결 |
| `src/auth/session-manager.ts`, `session-collector.test.ts` | 서버가 검증한 세션에서만 비밀값 없는 동의 식별 범위를 제공 |
| `modules/notification-access/` 5파일 | Expo 검색 설정·Gradle·manifest·Kotlin 모듈·연결 상태 전용 서비스 |
| `src/ui/notification-access-panel.tsx` | 명시적 동의 확인·취소·저장·철회·OS 설정 이동·상태 조회 |
| `collector-screen.tsx`, `notification-access-guide.tsx`, `collector-copy.ts` | 기존 설정 화면 연결과 현재 기능/후속 기능 설명 구분 |
| 모바일 README·화면 설계 기록·실기기 안내·본 기록·계획/설계 | 초급 개발자용 흐름, 검증 결과, 사용자 준비 절차 |

위 `src/`와 `modules/`는 `apps/mobile/` 아래다. 공통 상태 코드에 Expo를 직접 import하면 RN/DOM 타입 선언이 충돌하므로 플랫폼 연결을 별도 파일로 옮겼다. 타입 검사 설정을 완화하지 않았다.

실제 변경은 **24파일: 제품/시험/네이티브18 + 문서6**, 신규16·수정8이다. 예상보다 늘어난 것은 플랫폼 연결 파일 분리와 재현/실기기 문서를 포함했기 때문이다. 기존 `apps/web/next-env.d.ts` 변경은 이 수에 넣거나 수정하지 않았다. APK·환경 파일은 Git 제외 대상임을 확인했다. 이번 후속 코드는 아직 미커밋이며 위 `1df9f84` 푸시 완료 범위와 구분한다.

## 실제 작동 원리

1. 로그인 후 서버 확인을 통과한 계정/설치 ID와 고정 API origin을 받는다. 토큰/비밀번호를 동의 모델에 전달하지 않는다.
2. 화면 진입 때 로컬 동의와 실제 OS 권한을 각각 읽는다. 저장되지 않은 상태를 임의 동의로 간주하지 않는다.
3. 사용자가 처리 범위를 읽고 ‘동의하고 이 기기에 저장’을 눌러야 SecureStore에 고지 버전 `notification-access-v1`, UTC 시각, 식별 범위가 저장된다. 저장 뒤 다시 읽어 일치해야 성공이다.
4. 동의 저장과 OS 접근 허용은 다르다. 설정 이동 버튼은 Android 화면만 열며 실제 허용/거부는 사용자가 한다.
5. 앱이 background로 이동하면 기존 장부 가림을 유지한다. 돌아와 로그인 상태를 검증한 다음 새 모델이 실제 동의/권한을 읽는다. 설정 화면을 열었다고 성공 처리하지 않는다.
6. 철회는 해당 기기·계정의 로컬 동의를 삭제하고 확인한다. 기존 거래를 지우거나 OS 접근을 자동 해제하지 않는다. OS 접근이 남아 있으면 해제용 설정 이동은 계속 허용한다.
7. 로그아웃/화면 종료/세션 세대 변경 후 도착한 응답은 버린다. 같은 저장 키는 화면을 나갔다 들어와도 직렬 처리해 늦은 저장이 뒤의 철회를 덮지 않게 한다.

실제 알림을 읽을 후속 서비스는 이 로컬 UI 상태만 믿어서는 안 된다. 서버 동의·수집 기기·출처 선택·사용자 스위치·OS 연결을 함께 검증해야 한다.

## 자동 검증과 리뷰

- 전체 `pnpm test`: **2,224개 통과**, 종료0. legacy208 + contracts176 + DB단위19 + API320 + web1,219 + mobile191 + E2E preflight91.
- 모바일191개 = Vitest181 + 도구10. 저장/철회 재조회, 사용자/설치/origin 격리, 옛 버전·손상 데이터, 저장/삭제 실패, 늦은 응답, 재진입 중 저장/철회 순서, 모듈 부재와 OS 응답 검증 포함.
- 전체 타입·린트 통과, Android JavaScript/Hermes export 종료0. Kotlin 새 모듈 컴파일 성공.
- PC Playwright: 합성 계정 로그인 → 입금/지출 각1건 → 새로고침 각1건 → 로그아웃 후 기록0건 → 로그인 링크. 페이지 오류0.
- 독립 코드 리뷰: Critical0 / Important0 / Minor1. 중복 저장 시험에 실제 저장 호출 횟수 검증이 빠졌다는 지적을 반영하고 모바일191개 재통과. 리뷰는 이 기능 범위이며 운영 보안 감사/혼합 브랜치 전체 승인과 다르다.
- 실제 DB 통합 전체·운영 production build·커버리지·원격 CI·의존성 재감사는 이번 실행 범위 밖이다. GitHub의 기본 브랜치 경고25건(치명2/높음6/중간12/낮음5)은 해결했다고 주장하지 않는다.

## 개발 APK와 빌드 한계

[새 개발 APK](../../output/android-apk/account-book-dev-notification-access-arm64.apk): `com.accountbook.dev`, arm64, 크기93,275,079bytes.

SHA-256: `6EBC20C622C36FF2F60DCE040DE9542BF28CB7B7B394030A71E6FD4B929FBA8D`.

서명v2·ZIP 정렬 검사 통과. 최종 manifest에 정확한 `NotificationAccessService`, `exported=false`, `BIND_NOTIFICATION_LISTENER_SERVICE` 보호가 있다. READ_SMS/RECEIVE_SMS/READ_CONTACTS를 추가하지 않았다. OS 알림 접근과 우리 앱 알림 표시 권한은 다르며 후자는 이번에 요청하지 않는다.

Windows 전체 재컴파일은 기존 C++ 의존성에서 260자 경로 한도로 실패했다. 새 Kotlin 모듈은 정상 컴파일됐고 변경 없는 C++ 의존성 산출물을 재사용해 최종 패키징은 7초·468tasks·종료0이었다. **새 APK의 `.so` 23개가 이전 HTTPS 검증 APK와 모두 같은 SHA-256**임을 대조했다. 깨끗한 환경의 전체 네이티브 재빌드 성공으로 표시하지 않는다. 재현 로그는 `output/notification-apk-build.log`, `notification-apk-reuse-build.log`, `notification-apk-final-build.log`다.

기존 영문 빌드 복사본 `C:/Users/PC/a3`에 모바일 `src/`와 새 `modules/`만 동기화했다. 환경 파일·키·DB 자료는 복사하지 않았다. 단기 개발 CA의 debug/localhost 신뢰 범위를 유지했고 전역 TLS 우회·공개 터널·운영 배포는 없다. 개발 APK는 Metro와 로컬 HTTPS 테스트 서버가 필요하며 독립 실행 배포본이 아니다.

## 실기기 확인

Android16 실기기1대에 업데이트 설치 성공. 실제 비밀번호 대신 합성 테스트 계정을 사용했다.

- [x] 최신 로그인 안내와 기존 합성 입출금 각1건 확인.
- [x] 동의 없음 / OS 미허용 분리 표시. 동의 전 OS 설정 버튼 차단.
- [x] 명시적 확인 뒤 실제 SecureStore 동의 저장. 저장 뒤에도 OS 미허용 유지.
- [x] 앱 force-stop/재실행 → 비밀번호 재입력 없이 세션 검증 → 설정에서 동의 저장됨 유지.
- [x] 앱 버튼으로 Android ‘알림 접근 허용’ 설정 이동. Account Book Dev 항목 확인.
- [x] 사용자가 OS 접근을 직접 허용하고 앱으로 복귀 → 동의 저장됨 / OS 허용됨 / 서비스 연결됨을 각각 표시. 해당 서비스의 실제 OS 허용 여부도 별도로 읽어 확인.
- [x] 앱에서 명시적으로 동의 철회 → 동의하지 않음 / OS 허용됨 / 서비스 연결됨으로 분리 표시. 기존 거래는 유지.
- [x] 철회 후 앱 force-stop/재실행 → 비밀번호 재입력 없이 합성 계정 복원 → 동의하지 않음 유지. 동의 없이도 이미 허용된 OS 접근을 해제하기 위한 설정 이동은 가능.
- [x] 사용자가 Account Book Dev의 OS 접근을 끄고 복귀 → OS 실제 허용값 false와 앱의 ‘허용되지 않음’을 대조. 동의하지 않음 유지, 서비스 연결 문구 제거, 동의 전 설정 이동 버튼 비활성(enabled=false) 확인.
- [ ] 계정 전환과 다른 계정 동의 미노출의 추가 실기기 확인.
- [ ] TalkBack·큰 글자·잠금/OS 재부팅·제조사별 제한 검증.

초기 구현 화면을 실제로 캡처해 상태 구분, 줄바꿈, 버튼 가시성, 스크롤을 확인했다. Impeccable의 기존 Bookify 토큰/48dp/명시적 확인 원칙을 적용했다. 전체 접근성·최종 디자인 동일성 검증 완료는 아니다. 화면 증거는 Git 제외 `output/notification-*.xml/png`에만 보관하고 Notion에는 실제 알림·식별자·비밀값을 올리지 않는다.

사용자의 OS 허용 회신 후 진행한 추가 시험은 실기기 상태 확인과 문서 갱신이다. 제품 코드를 더 수정하거나 전체 2,224개 시험을 다시 실행한 것은 아니다. 재시작 후 첫 UI 읽기 두 차례는 Android의 idle-state 오류로 실패했으며 이전 XML을 완료 근거로 사용하지 않았다. 새 화면 캡처와 새로운 파일명의 정상 UI 조회로 철회 유지 상태를 재확인했다.

사용자의 OS 해제 회신 뒤 `notification-permission-revoked-final.xml`, `notification-permission-revoked-buttons.xml`, `notification-permission-revoked-final.png`로 최종 미허용 상태를 확인했다. 이로써 동의 저장 → 사용자 OS 허용 → 앱 복귀 → 동의 철회 → 재시작 유지 → 사용자 OS 해제 → 앱 복귀의 핵심 왕복은 확인했다. 자동 기록 기능 완료나 남은 실기기 항목 전체 통과는 아니다. 테스트용 접근은 꺼져 있으며 사용자는 USB 디버깅과 테스트 중 일시 변경한 보안 설정을 복원해도 된다.

## 다음 순서

10/21 체크포인트 갱신: 이 문서의 로컬 동의·권한 연결 24파일은 `ae6743e`로 커밋·푸시하고 원격 해시를 확인했다. 모바일191개·타입·변경 린트를 재검사했다. 후속 [서버 동의·철회 검증](2026-10-21-server-notification-consent.ko.md)은 별도 기능 단위이며 현재 모바일 화면의 서버 연결 완료를 뜻하지 않는다.

Notion `07. 현재 구현 상태·변경 이력·다음 작업`에 계획·실제24파일·2,224개 시험·APK 빌드 한계·실기기 완료/대기 경계·후속 미커밋 상태를 반영하고 다시 읽어 확인했다.

서버 동의/철회 계약과 실제 수집 차단 → 선택 출처·시작/중지 → 합성 알림 한 지원 형식 → 미분류 거래 저장 → PC 같은 기록 확인 순서다. 권한만 허용했다고 금융 앱의 모든 형식을 지원하거나 누락 없이 자동 기록한다고 안내하지 않는다.
