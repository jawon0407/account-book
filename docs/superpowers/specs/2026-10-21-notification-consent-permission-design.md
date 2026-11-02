# Android 동의 저장·알림 접근 연결

## 목표와 이번 경계

기존 안내 UI 다음 단계로, 현재 로그인 계정의 명시적 선택을 기기 보안 저장소에 저장하고 Android 알림 접근 설정과 실제 상태 조회를 연결한다. 기존 정책과 사용자 연속 진행 요청을 적용하며 반복 승인은 요구하지 않는다. 실기기에서 새 APK를 설치해 확인할 수 있도록 준비한다.

선택한 접근은 **로컬 동의 + 권한 연결 먼저**다. 서버 동의 증빙/접수까지 한꺼번에 확장하면 새 DB/API 계약이 필요하고 이 단계의 권한 왕복 확인과 분리해서 검증하기 어렵다. 단순 안내만 유지하는 방법은 실제 권한 요청 요구를 충족하지 못한다. 서버 저장이 아닌 점을 UI/문서에 명시하며 실제 수집 전에는 서버 측 동의/철회와 수집 접수 권한 계약을 반드시 추가한다.

이번 네이티브 서비스는 연결 상태만 알린다. 알림 본문 callback을 구현하지 않으며 과거/현재 알림 조회·본문 판독·로그·파일·네트워크 전송을 하지 않는다. OS가 권한을 부여할 때 콜백을 전달할 수 있다는 사실과 앱이 이를 기록하지 않는 현재 구현을 구분한다. 알림 수집 시작 버튼은 만들지 않는다.

## 동의 기록

- 고지 버전 `notification-access-v1`, 명시적 동의 시각(UTC ISO), 상태 `accepted`만 보안 저장소에 저장한다.
- 식별 경계는 서버 origin + 로그인 userId + 설치 deviceId. 저장 키는 사용자/설치 UUID 기반이며 기록의 origin도 대조한다. 다른 계정/서버/설치·옛 버전·형식 오류는 유효 동의로 인정하지 않는다.
- 휴대폰에만 저장된 준비 단계 동의이며 법적 적합성/서버 감사 증빙을 보장하지 않는다. 금융 원문·금액·상대명·토큰·비밀번호를 넣지 않는다.
- 쓰기 후 다시 읽어 동일 기록인지 확인한 뒤 성공으로 표시한다. 실패하면 동의 상태를 알 수 없음으로 가리고 권한 설정 이동을 차단한다.
- 철회는 보안 저장소의 해당 기록을 삭제하고 재조회한다. 삭제 실패는 완료로 표시하지 않는다. 이미 저장한 장부는 삭제하지 않는다. OS 접근이 남아 있으면 별도로 해제하도록 안내한다.
- 로그인 세대 변경·화면 종료 전에 시작한 결과는 새 화면에 반영하지 않는다. 저장/삭제 중 반복 동작을 막는다. 실패 시 자동 동의/자동 재시도 없음.

## Android 연결

- 로컬 Expo 모듈 `AccountBookNotificationAccess`: `getStatus(): { available, accessGranted, listenerConnected }`, `openSettings(): boolean`.
- Android NotificationManager의 해당 컴포넌트 접근 허용 상태를 읽는다(API27+). 구버전은 enabled_notification_listeners의 정확한 ComponentName만 대조한다. 앱 패키지 전체 허용으로 판정하지 않는다.
- 설정 이동은 foreground Activity에서 OS의 알림 접근 설정으로만 이동한다. 설정 Activity가 없거나 실패하면 안전한 안내를 표시한다. 기기를 직접 조작해 허용하지 않는다.
- `NotificationListenerService`는 연결/해제만 관리하며 본문을 읽는 메서드는 구현하지 않는다. exported=false, 시스템 bind 권한으로 보호한다.
- 오래된 개발 APK에 모듈이 없으면 ‘새 개발 앱 설치 필요’로 표시하고 강제 종료하지 않는다.
- 우리 앱의 알림 표시 권한 요청은 포함하지 않는다. 자체 알림을 보내는 후속 기능에서 별도로 요청한다.

## UI와 성공 기준

수집 기기 지정 아래에 동의 상태·OS 접근 상태·서비스 연결 상태·자동 기록 미구현을 각각 표시한다. 고지 내용을 확인하는 명시적 버튼과 취소, 동의 저장, 동의 철회, Android 설정 이동, 재조회가 있다. 수기 장부 사용은 그대로 유지한다.

앱이 background로 이동하면 기존 세션 가림 정책을 유지하고, 복귀 시 세션을 다시 검증한 뒤 새 모델이 로컬 기록과 OS 상태를 읽는다. 권한 설정을 열었다는 사실만으로 허용 성공을 표시하지 않는다.

완료 검증: 계정/설치/서버/버전 격리, 저장·삭제 실패, 중복 클릭, 늦은 응답, 동의 없는 설정 이동 차단, 네이티브 모듈 부재, 실제 permission boolean, 전체 회귀·타입·린트·Android bundle/APK compile. 실기기 허용/거부·왕복·철회·재시작·계정 전환은 연결되면 수행하고 미연결이면 미검증으로 명시한다. PC Playwright 회귀도 수행한다.

## 근거

- [Expo 로컬 모듈](https://docs.expo.dev/modules/get-started/)
- [Android NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [Android 알림 접근 설정](https://developer.android.com/reference/android/provider/Settings#ACTION_NOTIFICATION_LISTENER_SETTINGS)

기준 코드: `1df9f84`. 서버/DB·새 패키지 의존성·알림 본문 처리·운영 배포는 범위 밖이다. 기존 자동 생성 Next 파일 변경은 보존한다.
