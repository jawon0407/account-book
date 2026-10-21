# Android 클라이언트 첫 실행 설계

상태: Android 우선·루틴 승인 생략이라는 기존 사용자 결정에 따른 구현 단위. iOS/스토어 배포는 시작하지 않는다.

## 범위와 경계

이번 단위는 `apps/mobile`을 추가하여 이메일 로그인 → 같은 서버 장부 조회 → 로그아웃이 가능한 Android 앱 기반을 만든다. 알림 listener, 수기 작성, 전체 복수 필터, 환불·통계·수집 설정 UI는 다음 단위다. 기존 서버 계약과 PC 기능은 바꾸지 않는다. 서버 수집 lease 설정이 있다고 OS 알림을 이미 수집하는 것은 아니다.

React Native·Expo·Expo Router를 사용한다. 순수 TypeScript 세션 제어와 네이티브 저장소 어댑터를 분리한다. 별도 Kotlin 전용 앱은 공용 계약 재사용이 줄고, 웹뷰는 네이티브 수집 요구와 맞지 않아 채택하지 않는다.

## 인증·네트워크

- 기존 `/api/native/auth/*`, `/api/native/transactions`만 고정 경로로 호출한다. 서버 URL은 빌드 설정의 HTTPS origin 하나로 고정하며 credential/path/query/fragment를 넣을 수 없다. localhost 예외도 이 클라이언트에는 넣지 않는다.
- SDK는 Expo 57.0.30 / React Native 0.86.3 / React 19.2.3으로 고정했다. SDK 58 조합의 peer 제약 충돌을 확인해 57 호환 조합을 채택했고 strict peer 검사를 끄지 않았다. 웹 React 버전은 건드리지 않는다.
- password는 요청 중 메모리에만, opaque session과 설치 UUID만 Expo SecureStore에 보관한다. DB 키·IdP 토큰·금융 응답·이메일은 영구 저장하지 않는다.
- 세션 저장 레코드는 서버 origin에 결속한다. 다른 서버로 바꾼 빌드가 기존 토큰을 전송하면 안 된다.
- 로그인/restore/refresh/logout을 직렬화한다. logout과 계정 전환은 세대 번호로 이전 응답의 화면 반영을 거부한다. refresh 응답 유실/저장 실패는 재로그인으로 복구한다.
- **10/20에 대체된 초기 정책:** 첫 개발 버전은 재실행 시 잔존 토큰을 정리했으나, 현재는 안전한 저장 표식과 서버 검증 후 세션을 복원한다. 검증 전 장부를 숨기고 만료·철회 시 재로그인을 요구한다. 상세 동작과 제한은 [세션 복원 기록](../../status/2026-10-20-android-session-restore.ko.md), 10/21 실기기 근거는 [실기기 검증 기록](../../status/2026-10-20-android-session-device-test.ko.md)을 따른다.
- 저장소 읽기/삭제 실패는 로그인 화면으로 조용히 넘어가지 않고 차단 오류로 표시한다. 삭제 완료 전 새 계정 로그인 금지.
- HTTP 재시도 0, timeout 10초, redirect error, credentials omit, 응답 schema 검증. 사용자에게 원시 서버 메시지를 표시하지 않는다.
- Android 전송은 `expo/fetch` 어댑터가 redirect/credentials 정책을 다시 명시한다. React Native 기본 fetch가 같은 옵션을 강제한다고 가정하지 않는다. 전송 구현 소스와 어댑터 테스트를 확인했지만 실제 APK의 TLS/redirect 검증은 남아 있다.
- 응답 헤더와 읽은 문자열에 크기 검사를 적용한다. 스트리밍 수신 단계의 바이트/메모리 상한 검증은 아직 아니므로 완전한 1MiB 네트워크 수신 제한으로 표현하지 않는다.
- 금융 목록은 메모리에만 유지한다. background에서 가리고 foreground에서 세션과 목록을 재검증한다. logout 즉시 목록 제거.
- 초기 앱은 알림 접근·SMS·접근성 서비스 권한을 요구하지 않는다. 자동 수집은 별도 동의/OS 권한/서버 lease/파서 게이트 이후에만 추가한다.

## 화면

Bookify `4008:848` 인증과 `4032:961` 목록의 실제 Figma code/screenshot을 확인했다. 배경 #F5F6FA, 표면 #FFFFFF, 선 #DFDFDF, 보조 글자 #6A6B82, 강조 #2B46F9, 목록 반경 10, 외곽 여백 16, 행 패딩 16/12를 재사용한다. 한국어는 Android 시스템 폰트를 사용한다. 앱 로고·외부 회계 서비스·iPhone 시스템 표시·원본의 허위 동의 문구는 복사하지 않는다.

로그인: 제목/설명, 이메일·비밀번호, 48dp 이상 주 동작, 안전한 오류와 재시도. 미구현 소셜 버튼을 노출하지 않는다.
거래: 제목, 새로고침·로그아웃, 흰 그룹 목록, 상대명/발생일/방향/금액, 계좌 미지정·미분류 표시, cursor 추가 조회. 합계는 아직 없으므로 첫 페이지 합계를 전체 합계처럼 표시하지 않는다. 날짜 계약은 아직 `occurredOn`이므로 임의 거래 시각을 만들지 않는다.

화면 작업 계약: 기존 Bookify 방향을 이용한 코드 기반 구현이며 새 디자인 탐색은 하지 않는다. 주 사용 경로는 이메일 로그인 → 현재 장부 확인 → 새로고침/추가 조회 → 로그아웃이다. 좁은 Android 세로 화면·큰 글자·키보드·TalkBack·시스템 뒤로가기는 실제 네이티브 화면에서 별도로 확인한다. 현재는 스타일/화면 코드와 번들까지이며 원본과의 시각적 일치 검증 완료가 아니다.

## 파일과 검증

신규: apps/mobile 설정 5~7개, src/auth 3~4개, src/api 2개, src/ui 3~4개, app 라우트 2개, 테스트 3~4개, README. 수정: root package.json의 mobile test/typecheck/build gate, .gitignore의 Expo/서명 산출물 제외, lockfile. 예상 신규 제품 코드 약 700~1,100줄, 테스트 약 300~500줄. 기존 PC/API/DB 제품 코드는 범위 밖.

TDD: URL 검증, strict 응답, timeout/no retry, 저장 실패, origin 불일치, refresh 경합, logout 중 응답, 오류 마스킹. `pnpm verify`, mobile Android Metro export, dependency audit. SDK/JDK가 없으면 APK/화면/실기기 검증은 미완료라고 명시하며 브라우저 렌더로 대체 통과하지 않는다.

Android package `com.accountbook.dev`는 개발 빌드 전용 임시 식별자다. 스토어 등록·서명·외부 배포에는 사용자 확정 값이 필요하다. 실금융 데이터 베타는 허용하지 않는다.

## 근거

- [Expo SDK 호환표](https://docs.expo.dev/versions/latest/)
- [Expo monorepo](https://docs.expo.dev/guides/monorepos/)
- [SecureStore와 Android backup](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Notion 05](https://app.notion.com/p/3e2323168ba68148bebbec0a298f89dd)
