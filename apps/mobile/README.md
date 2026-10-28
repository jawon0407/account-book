# Android 앱 개발 기반

Android를 먼저 구현하고 검증한 뒤 iOS를 개발한다. **이메일 로그인·거래 목록·로그아웃에 수기 입력/계좌·카테고리 선택/거주 기준 설정 소스를 연결했다.** 2026-10-20 합성 계정으로 실기기 HTTPS 로그인·수기 저장·PC 조회를 확인했고, 10-21 Android 16에서 앱 프로세스 재실행 복원·API 연결 실패 시 장부 숨김/재연결·로그아웃 후 재시작까지 확인했다. 휴대폰 OS 재부팅·독립 실행 배포본 시험과는 구분한다. 알림을 읽거나 거래를 자동으로 저장하는 앱은 아니다.

## 데이터 흐름

`화면 → SessionManager → NativeClient → HTTPS native BFF → 기존 NestJS/DB`

앱은 DB에 직접 접속하지 않는다. 같은 계정으로 서버의 같은 장부를 조회한다. 로그인 화면은 이메일과 비밀번호를 요청 중 메모리에서만 사용한다. BFF가 반환한 앱 세션과 설치 UUID만 OS 보안 저장소에 넣으며, 금융 목록은 메모리에만 둔다.

## 파일별 역할

| 경로 | 하는 일 |
| --- | --- |
| `app/index.tsx` | 로그인 상태에 맞춰 화면을 선택하고 background에서 장부를 가린다 |
| `src/app-runtime.ts` | 고정 서버 주소, 전송 어댑터, 저장소, 세션 제어기를 조립한다 |
| `src/api/native-client.ts` | 고정 API 경로, 입력/응답 검증, 10초 제한, 안전한 오류를 담당한다 |
| `src/api/android-transport.ts` | Android의 Expo 전송 계층에 리디렉션 거부·쿠키 미사용을 강제한다 |
| `src/auth/session-manager.ts` | 로그인/갱신/로그아웃을 직렬 처리하고 이전 계정의 늦은 응답을 거부한다 |
| `src/auth/session-persistence.ts` | 저장된 서버·설치 ID를 대조하고 세션 후보 읽기·저장·로그아웃 표시/삭제를 담당한다 |
| `src/auth/secure-storage.ts` | Expo SecureStore를 작은 저장소 인터페이스로 감싼다 |
| `src/ui/login-screen.tsx` | 이메일 로그인 입력과 오류 안내 |
| `src/ui/ledger-screen.tsx` | 50건씩 조회·새로고침·추가 조회·로그아웃 |
| `src/api/native-collector-client.ts` | 수집 기기 및 서버 동의 조회/변경 HTTP 계약. UI가 토큰이나 기기 식별자를 입력하지 않는다 |
| `src/collector/collector-settings.ts`, `collector-copy.ts` | 조회·확인·저장 상태와 고정 안내. 중복 변경을 막고 실패하면 현재 상태만 다시 조회한다 |
| `src/ui/collector-screen.tsx` | 수집 기기 지정/교체/해제 확인 화면. 실제 알림 읽기는 아직 제공하지 않는다 |
| `src/ui/notification-access-guide.tsx` | 선택적 동의·두 종류의 권한·예정 처리 범위를 펼쳐 읽는 안내. 동의 저장이나 OS 권한 요청은 하지 않는다 |
| `src/collector/notification-access.ts`, `notification-consent-copy.ts` | 서버 동의 조회·철회·재동의와 OS 상태를 분리하고 늦은 응답/중복 변경을 차단한다. 표시와 버튼 조건을 함께 검증한다 |
| `src/collector/notification-consent.ts` | 이전 로컬 동의 저장 모듈. 현재 화면은 읽거나 자동 전송하지 않으며, 저장된 과거 값은 이 단계에서 삭제하지 않는다 |
| `src/platform/notification-access.ts`, `modules/notification-access/` | OS의 실제 알림 접근/연결 상태와 설정 이동만 제공. 본문 callback/조회/전송 없음 |
| `src/ui/notification-access-panel.tsx` | 명시적 동의·철회, Android 설정 이동, 실제 상태 확인. 안내를 읽기만 해서는 저장하지 않음 |
| `src/ui/ledger-presentation.ts` | 금액/방향/미분류 표시를 화면 밖에서 검증 가능한 함수로 분리한다 |
| `src/api/native-ledger-client.ts` | 프로필·선택 목록·수기 생성의 고정 경로와 strict 계약 |
| `src/ledger/manual-input.ts`, `manual-time.ts` | 화면 문자열을 금액/날짜/UTC로 변환. 모르는 시각은 만들지 않고 DST 중복은 사용자 선택 |
| `src/ledger/manual-entry.ts` | 한 저장 시도의 변경 불가 payload/UUID와 결과 불명 재시도 |
| `src/ledger/manual-workspace.ts` | 계정별 메모리 초안·선택 목록·화면 이동·조회 시작 표식 관리. 로그아웃 때 폐기 |
| `src/ui/ledger-flow.tsx`, `manual-entry-screen.tsx` | 목록→수기 작성→확인→재조회. Android Back은 목록/입력으로 돌아감 |
| `src/ui/manual-entry-fields.tsx`, `form-controls.tsx`, `residence-screen.tsx` | 선택 계좌/분류, 날짜/시각, DST 선택, 거주 기준 입력 |
| `tooling/metro-files.test.cjs` | Windows 파일 속성 때문에 번들이 누락되는 회귀를 실제 설치 도구로 검사한다 |
| `tooling/router-query.test.cjs` | URI 디코더 보안 교체 후 포함된 Navigation 코어와 실제 Expo fork의 한국어·복수 필터·잘못된 인코딩 호환을 구분해 검사한다 |

## 실행 준비

Node 22.15.1, pnpm 11.9.0을 사용한다. Expo 57.0.30 / React Native 0.86.3 / React 19.2.3 조합이다.

1. 저장소 루트에서 `pnpm install --frozen-lockfile`을 실행한다.
2. `.env.example`을 참고해 로컬 전용 환경 파일에 `EXPO_PUBLIC_API_ORIGIN`을 설정한다. 값은 **휴대폰에서 접근 가능하고 인증서를 신뢰하는 테스트 BFF의 HTTPS origin** 하나다. 경로(`/api` 등)를 붙이지 않는다.
3. Android SDK/JDK와 에뮬레이터 또는 개발용 Android 기기를 준비한다.
4. SDK/JDK 환경이 준비된 지원 경로에서 `pnpm --filter @account-book/mobile android`로 개발 빌드를 만든다. **Windows 한글 경로에서는 아래 APK 준비 기록의 영문 빌드 복사본 절차를 먼저 따른다.** 이미 개발 빌드가 설치돼 있다면 원본 저장소에서 `pnpm --filter @account-book/mobile start`로 번들 서버를 실행할 수 있다.

`EXPO_PUBLIC_*` 값은 앱에 공개된다. DB URL, service-role 키, OAuth secret, BFF 서명키를 넣지 않는다. 휴대폰의 `localhost`는 PC가 아니다. TLS 검증을 끄거나 HTTP 예외를 넣어 우회하지 않는다. 실제 사용자 자료 대신 합성 계정과 테스트 서버를 사용한다.

`pnpm --filter @account-book/mobile build`는 Android JavaScript/Hermes 번들 생성이다. **APK 제작·설치·실기기 시험·스토어 배포와 다르다.** 현재 개발 식별자 `com.accountbook.dev`는 출시 식별자가 아니다.

Windows SDK/JDK 설치·개발 APK 산출 현황은 [APK 준비 기록](../../docs/status/2026-10-19-android-development-apk.ko.md), 휴대폰에서 할 일과 USB/Metro/HTTPS 연결 구분은 [실기기 테스트 안내](../../docs/guides/android-device-testing.ko.md)를 따른다. 한글 경로에서 AGP가 빌드를 차단하므로 원본을 이동하지 않고 비밀 파일을 제외한 영문 경로 빌드 복사본을 사용한다.

## 현재 동작과 제한

- 가입/비밀번호 복구는 기존 웹에서 처리하고 앱에서는 이메일 로그인만 제공한다.
- 앱을 완전히 종료한 뒤에도 같은 서버·설치의 세션을 서버에서 확인한 후 복원한다. 확인 중/오프라인에는 장부를 가리고 ‘다시 연결’ 또는 ‘이 기기에서 로그아웃’을 제공한다. background 복귀도 서버 확인을 거친다. 이는 무기한 로그인이 아니며 기존 서버 수명(미사용 7일/절대 30일)·철회 정책을 따른다.
- 저장소 정리에 실패하면 새 계정 로그인을 막는다. 초기 저장소 읽기 실패 뒤에는 토큰 정리와 설치 ID 준비가 모두 성공해야 로그인 화면을 연다. 로그아웃 표식 기록·삭제·서버 철회가 모두 실패하면 로그아웃 완료가 아니며, 그 상태의 강제 종료 뒤까지 복원 금지를 보증하지 않는다. 정리를 재시도해야 한다. 네트워크가 끊겨 서버 철회에 실패하면 원격 세션까지 폐기됐다고 보장하지 않는다.
- 모바일 목록은 서버의 `occurredOn` 날짜를 표시한다. 수기 입력은 날짜만 또는 명시 시각/시간대를 받으며 계좌·카테고리 미지정을 허용한다. 상세 시각 목록 표시는 후속이고 날짜-only에 임의 시각을 표시하지 않는다.
- 저장 결과가 불명확하면 동일 요청만 재시도한다. 목록 확인 후 새 입력을 시작할 때 중복 가능성을 다시 안내한다. 저장/재시도 전에 시작한 오래된 목록 응답은 확인 근거로 인정하지 않는다.
- background에서 초안/저장 시도는 같은 계정 메모리에만 남고 화면은 가린다. 로그아웃/계정 변경/프로세스 종료 시 금융 초안을 폐기한다. 완전 종료 후에는 저장 여부를 목록에서 먼저 확인한다.
- 이사 전 거래는 ‘거래 당시 장부 거주 시간대’를 선택 입력해 UTC 순간을 유지하면서 날짜를 정정한다. 서버가 실제 거주 이력과 대조하므로 이 입력은 기록 기준을 임의로 덮어쓰지 않는다. 프로필 변경은 expectedVersion으로 동시 수정을 확인한다.
- 금융 데이터 영구 캐시, 모바일 계좌/카테고리 생성·관리, 다중 필터, 알림 수집, 환불/통계, iOS는 후속이다.
- 장부의 ‘수집 설정’에서 계정의 지정 기기를 조회하고 이 기기로 지정/교체하거나 해제할 수 있다. 변경 전 영향 안내를 확인하며, 서버 버전 충돌/통신 실패 때 자동으로 다시 변경하지 않는다. 조회조차 실패하면 상태 확인 전까지 변경을 막는다. 이는 기기 지정 UI이며 Android 알림 접근 권한과 자동 기록을 켜는 기능은 아니다. 새 화면의 실기기 확인은 아직 남아 있다.
- 화면 가림 코드가 Android 최근 앱 미리보기까지 확실히 가린다는 실기기 증거는 아직 없다.
- 알려진 의존성 경고와 네이티브 검증 게이트가 남아 있으므로 실금융정보 베타/배포에 사용하지 않는다.

## 검증 명령

```sh
pnpm --filter @account-book/mobile test
pnpm --filter @account-book/mobile typecheck
pnpm --filter @account-book/mobile build
pnpm verify
pnpm audit --json
```

앱 TypeScript는 RN/DOM 라이브러리 선언 충돌 때문에 `skipLibCheck`를 사용한다. 순수 HTTP/세션/표시 로직은 별도 `tsconfig.core.json`으로 라이브러리 검사까지 유지한다. Windows Metro 파일 판별 패치는 `patches/@expo__metro-file-map@57.0.4.patch`에 고정돼 있다. 해당 의존성을 올릴 때 패치 필요 여부와 회귀 테스트를 다시 확인한다.

`query-string@7.1.3`은 API를 유지하면서 decoder만 공식 수정판 0.5.0으로 한정 교체했다. `patches/query-string@7.1.3.patch`의 한 줄은 ESM default export를 기존 CommonJS에서 받기 위한 호환 처리다. Node 22.15.1 및 Metro 번들에서 검증하며 Expo/Node 버전을 바꿀 때 함께 재확인한다. 감사 예외나 로컬 암호 알고리즘 변경은 없다. node-forge·braces의 경고 2건은 아직 남아 있다.

상세 결과는 [첫 기반 기록](../../docs/status/2026-10-16-android-client-foundation.ko.md)과 [후속 의존성 보완 기록](../../docs/status/2026-10-16-android-dependency-remediation.ko.md)을 참고한다.

수기 입력의 구현 범위·파일 설명은 [수기 입력 진행 기록](../../docs/status/2026-10-16-android-manual-entry.ko.md), 후속 실기기 검증은 [HTTPS 실기기·PC 교차 기록](../../docs/status/2026-10-20-android-https-device-test.ko.md)에 있다. 기존 Bookify 토큰을 재사용했으며 실기기 화면도 확인했지만, 디자인 동일성·전체 접근성 검증을 통과했다고 주장하지 않는다.

로그인 유지의 설계·복원 실패 처리·독립 리뷰 결과는 [세션 복원 기록](../../docs/status/2026-10-20-android-session-restore.ko.md)에 있다. 소셜 로그인은 [Supabase 설정 안내](../../docs/guides/social-auth-readiness.ko.md)를 참고하되, 공급자 활성만으로 Android 소셜 복귀 화면이 구현되는 것은 아니다.

실제 SecureStore를 사용한 핵심 3개 시나리오와 PC 재확인 증거는 [10-21 세션 실기기 결과](../../docs/status/2026-10-20-android-session-device-test.ko.md)에 있다. 10-21 후속 문구 수정으로 로그인 화면에도 서버 확인 후 복원하며 세션 만료 때 재로그인한다는 현재 동작을 안내한다.

수집 설정 화면의 파일별 역할·동시 변경 방어·검증 범위는 [수집 설정 진행 기록](../../docs/status/2026-10-21-android-collector-settings.ko.md)에 있다.

알림 접근 전 안내는 수집 설정 화면 아래에서 언제든 펼쳐 읽을 수 있다. ‘안내 보기’는 이 화면의 표시만 바꾸며, 기기 지정 API·동의 저장·OS 권한 설정·알림 읽기를 호출하지 않는다. 안내에는 후속 자동 기록의 처리 범위와 선택권, 알림 접근/표시 권한의 차이, 중지·철회와 기존 거래 삭제의 차이, 누락 시 수기 보완을 설명한다. 자세한 범위와 검증 제한은 [동의·권한 안내 기록](../../docs/status/2026-10-21-android-notification-access-guide.ko.md)을 참고한다.

10/21 앞선 단계에서 **로컬 동의 저장·철회와 OS 설정 연결**을 실기기로 확인했다. 이 당시의 [구현·APK·실기기 결과](../../docs/status/2026-10-21-notification-consent-permission.ko.md)와 아래 서버 연결 결과를 구분한다. OS 연결 모듈이 없는 예전 APK에서는 업데이트 안내를 표시한다.

서버 동의 조회/변경 API와 철회 후 자동 저장 차단 기반은 [서버 검증 기록](../../docs/status/2026-10-21-server-notification-consent.ko.md)에 있다. **현재 모바일 화면은 서버 동의 API에 연결됐다.** 현재 회원·설치의 상태를 조회하고 고지를 명시적으로 확인한 뒤 저장/철회한다. 이전 로컬 동의는 자동 이관하지 않는다. 실패/충돌 시 PATCH를 재전송하지 않고 GET으로 상태를 확인한 뒤 사용자가 다시 결정한다. 서버 장애 중에도 OS 접근이 켜져 있으면 해제용 설정 이동은 가능하며 OS 조회 실패가 서버 철회를 막지 않는다.

동의/OS 접근/서비스 연결/서버 기기 지정은 별개다. **알림 분석·자동 기록은 아직 하지 않는다.** [화면 연결 검증 기록](../../docs/status/2026-10-21-mobile-server-consent.ko.md)은 실제 로컬 HTTPS 왕복과 실기기 미검증을 구분한다. 개발 앱은 PC Metro/HTTPS와 USB 연결이 필요하며 독립 실행 배포본이 아니다.
