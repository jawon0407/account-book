# Android SDK/JDK와 개발 APK — 2026-10-19

현재 상태: **SDK/JDK 준비와 개발 APK 생성·정적 검사 완료**. 휴대폰 설치·실기기 실행·로그인·금융 알림 수집 완료가 아니다.

## 전달 파일과 확인 결과

- [개발 APK](../../output/android-apk/account-book-dev-arm64.apk): `output/android-apk/account-book-dev-arm64.apk`.
- 이름 `Account Book Dev`, 패키지 `com.accountbook.dev`, 버전0.1.0(1).
- 크기89,430,153bytes(85.29MiB), CPU `arm64-v8a`만 포함. minSdk24, target/compileSdk36.
- SHA-256: `C80EFAE441FCE2DC797F539C6317254AFE626436454C829FDA3996CD1D0D2797`.
- 최종 Gradle `assembleDebug`: **BUILD SUCCESSFUL, 2분52초, 455 tasks, 종료0**.
- `apksigner verify`: 종료0, Android Debug RSA2048 인증서1개, APK Signature Scheme v2 검증 성공. 출시용 서명이 아니다.
- `aapt`의 APK package/manifest/ABI 검사와 `zipalign -c -P 16 -v 4` 종료0. ZIP 정렬 검사는 실기기 16KB page 실행이나 전체 네이티브 호환성 시험을 대신하지 않는다.
- 빌드 원본 APK와 전달 APK의 해시 일치. APK·개발 서명키·모바일 환경 파일이 Git ignore 대상임을 재확인했다.

이 APK에는 앱의 독립 실행용 `assets/index.android.bundle`이 없다. **Metro에 연결하는 개발 클라이언트**이며, 설치만으로 서버 연결/로그인/장부 동작이 검증된 것은 아니다. 테스트 API origin도 별도로 설정해야 한다.

검사 로그: `output/android-gradle-final-snapshot.log`, `output/android-apk/signature-verification.txt`, `badging.txt`, `manifest.txt`, `alignment-verification.txt`. aapt는 한글 경로의 전달 파일을 열지 못해 동일 해시의 영문 경로 빌드 원본을 검사했다. APK 자체 결함으로 해석하지 않는다.

## 이번 범위

사용자가 SDK/JDK 준비부터 개발 APK 생성까지 요청했다. 기존 Android 앱을 로컬 컴파일하며 기능 추가/디자인 변경·실제 DB 변경·스토어 배포·클라우드 빌드·커밋/푸시는 하지 않는다. 기존 미커밋 변경은 보존한다.

## 준비한 도구

| 도구 | 확인한 버전 | 역할 |
| --- | --- | --- |
| Node/pnpm | 22.15.1 / 11.9.0 | 기존 프로젝트 고정 버전 |
| Microsoft OpenJDK | 17.0.20.1+1 | Java/Kotlin·Gradle 실행 |
| Android command-line tools | 22.0 | SDK 구성요소 설치 |
| Android platform | API36, revision2 | Android 컴파일 API |
| Build-tools | 36.0.0 / 35.0.0 | APK 패키징·검사·서명. 35.0.0은 네이티브 의존성 빌드 중 추가 설치 |
| Platform-tools/adb | 37.0.1 | 휴대폰 연결·설치 |
| NDK / CMake | 27.1.12297006 / 3.22.1 | 네이티브 C++ 컴파일 |
| Ninja | 1.13.2 | CMake 번들1.10.2의 Windows 긴 경로 문제 대응. 이번 전용 SDK만 교체 |
| Gradle | 9.3.1 | Expo 템플릿의 빌드 도구 |

도구는 `%LOCALAPPDATA%/account-book-android`에 설치했고 전역 Java/SDK 환경변수는 바꾸지 않았다. JDK·Google CLI ZIP은 공식 SHA-256과 일치했다. SDK 구성요소는 sdkmanager 표준 설치/라이선스 절차를 거쳤다. CLI22의 sdkmanager는 deprecated 안내를 출력하지만 설치는 종료0이었다.

다운로드 SHA-256:

- JDK17 ZIP: `3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f`
- Google CLI ZIP: `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`
- Ninja Windows ZIP: `07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65` (공식 GitHub release asset digest와 대조).

## 빌드 중 확인한 환경 문제

1. Java17의 Windows 기본 인코딩과 Node의 UTF-8 경로 출력이 달라 실제로 존재하는 Gradle plugin 경로를 찾지 못했다. `JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8`로 해당 단계가 통과했다.
2. 그 다음 AGP가 non-ASCII 프로젝트 경로를 명시적으로 차단했다. 검사를 끄지 않고 영문 경로의 별도 빌드 복사본을 준비했다. 원본을 이동/삭제하지 않았다.
3. 복사본에는 모바일/공용 계약/패치/고정 package·lock·workspace·tsconfig만 포함했다. `.env.example`을 제외한 환경 파일, 실제 서명키, DB 자료는 복사하지 않았다. 고정 lockfile로 offline install을 수행했다.
4. 복사본 첫 명령의 자동 pnpm 재호출이 시스템 기본 버전을 잡아 engine 검사가 거부했다. 엄격 검사를 끄지 않고 기존 Node22/pnpm11.9 shim을 PATH 앞에 지정했다. 이후 계약 build와 prebuild 종료0.
5. AppData 복사본에서 MSIX 가상 저장소 경로가 표시되고 Gradle의 `not a regular file` 오류가 발생했다. 경로 영향 가설로 `C:/Users/PC/ab`에 옮겨 재현했지만 동일 오류가 남아 **MSIX만이 원인이라는 가설은 기각했다.**
6. 원본과 복사본의 문제 파일 모두 같은 SHA-256, Windows `Archive, ReparsePoint`와 태그 `0x9000601a`를 갖는 것을 확인했다. 일반 복사한 파일은 동일 내용이면서 reparse 속성이 사라졌다. 공용 캐시/원본은 건드리지 않고 빌드 복사본의 reparse-backed 일반 파일20,925개만 각각 해시 대조 후 실파일로 치환했다. 실제 symlink/junction은 치환하지 않았다. 이후 Gradle plugin 컴파일과 프로젝트 설정 단계 통과를 확인했다.
7. 다음 빌드는 Java/Kotlin·manifest·DEX 단계 진행 후 screens/worklets의 Ninja `build.ninja still dirty after 100 tries`로 9분18초에 종료1이었다. 긴 C++ 경로 경고와 번들 Ninja1.10.2를 확인했다. 공식 Reanimated Windows 안내에 따라 Ninja1.13.2를 별도 다운로드·해시 검증하고 이번 전용 SDK의 바이너리만 교체했다. 이전 바이너리는 `.1.10.2.backup`으로 보존했다. Windows 전역 long-path 설정·제품 패키지 버전·새 아키텍처는 변경하지 않는다.
8. Ninja 교체만으로는 같은 오류가 남았다(47초/종료1). `-d explain`으로 반복 재생성과 긴 경로를 확인했다. hoisted 설치 시도는 기존 전체 lockfile의 누락 의존성 검사에서 거절돼 적용하지 않았다. lockfile을 재해결하지 않고 기존 isolated 방식에 `virtual-store-dir-max-length=32`, `package-import-method=copy`만 주는 별도 복사본 `C:/Users/PC/ab2`를 준비했다. 기존 복사본의 캐시 이동도 경로 문제로 실패했으므로 그 복사본은 최종 재현 대상으로 사용하지 않는다. 새 복사본은 동일한 허용 목록81파일과 고정 의존성704개만 사용한다.
9. 새 복사본 테스트의 합성 fixture1개가 빠져 첫 시험은 실패했다. `tests/fixtures/mobile-historical-transaction.json`만 추가해 최종82파일로 보완한 뒤 모바일110개·타입 검사·prebuild 종료0을 확인했다. root package/lock/workspace와 모바일 package/app 설정의 SHA-256은 원본과 같다. 새 경로에서 이전 실패 지점인 screens C++ 빌드가 통과했다.
10. `ab2` 빌드는 2분31초 후 Reanimated 한 곳에서 같은 Ninja 오류로 끝났다. 이 라이브러리의 CMake 입력 경로는 최대252자였다. 이전 폴더 이동은 접근 거부로 중단했고 강제 해제/삭제하지 않았다. 새 `C:/Users/PC/a3` 스냅샷에서 virtual store를 `.p`로 더 짧게 지정했다. 설치704개, 모바일110개, 타입 검사, prebuild 종료0이며 제품·lock 버전은 유지한다.
11. `a3/.p` 구성에서 Reanimated와 앱 C++ 빌드까지 통과하고 APK를 생성했다. 최종적으로 제품 소스·패키지/lock 버전·전역 정책을 바꾸지 않고 빌드 복사본의 인코딩·파일 가져오기 방식·경로와 전용 Ninja 버전을 조정해 해결했다.

## 현재 검증

- 원본과 최종 `a3` 복사본에서 각각 모바일 자동 시험110개(101 Vitest+9도구), 타입 검사 종료0. 최종 복사본의 package/lock/workspace/app 설정 해시는 원본과 같다.
- Android prebuild 종료0. `expo-system-ui` 미설치로 userInterfaceStyle 반영 경고가 남았다. 화면의 밝은 테마는 실기기 확인이 필요하다.
- adb 실행/버전 확인, 연결 기기0대. 휴대폰 설치·실행 시험은 아직 불가능하다.
- 최종 APK 빌드·서명·권한·ABI·ZIP 정렬·해시 검사를 완료했다. PC 제품 코드 변경이 없어 이번 SDK/APK 단위에서 PC Playwright는 재실행하지 않았다. 이전 PC 결과를 이번 실행으로 표시하지 않는다.
- 기존 node-forge/braces 의존성 경고는 이번에 해결하거나 재감사하지 않았다. 실제 금융 자료를 쓰는 베타/배포 게이트는 유지한다.

## 최종 APK 권한·보안 경계

실제 manifest의 권한은 INTERNET, ACCESS_NETWORK_STATE, VIBRATE, SYSTEM_ALERT_WINDOW, CHANGE_WIFI_MULTICAST_STATE, USE_BIOMETRIC, USE_FINGERPRINT와 앱 내부 signature receiver 권한이다. 화면 위 표시/멀티캐스트는 개발 도구, 생체 관련 선언은 안전 저장소 의존성에 포함된다. 선언만으로 생체 로그인 기능을 구현했다는 뜻은 아니다. 사용자가 이 권한들을 미리 모두 켤 필요도 없다.

READ_SMS, RECEIVE_SMS, READ_CONTACTS, RECORD_AUDIO, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE와 NotificationListenerService 선언은 없다. `allowBackup=false`, `debuggable=true`, `usesCleartextTraffic=true`를 APK에서 확인했다. HTTP 허용은 개발용 Metro 연결을 위한 템플릿 설정이고, 앱 API 클라이언트의 HTTPS origin 검증을 제거하지 않았다. Expo 개발 화면/디버거/검사 기능과 개발 전용 exported activity가 있어 **합성 계정으로만 사용하며 외부 배포하지 않는다.**

범위별 읽기 전용 리뷰에서 발견한 원인 단정·네트워크 흐름도·Windows 재현 지침은 수정했다. 전체 혼합 브랜치 또는 운영 보안 감사 완료는 아니다. 이번 제품 코드 수정은0파일, 문서4파일(신규3·모바일 README 갱신1)과 Git 제외 생성/검사 자료를 남겼다.

## 이 PC에서의 재현 설정

최종 빌드용 소스 위치는 `C:/Users/PC/a3`다. 이는 Git 작업트리가 아닌 일회성 스냅샷이므로 원본 소스 변경 후에는 필요한 소스를 다시 동기화해야 한다. `.env`·실제 키·서버 데이터는 포함시키지 않는다. Android/Gradle 산출물은 Git에 넣지 않는다. 이전 `ab`/`ab2`/AppData 복사본은 실패 진단 자료이며 재현 위치가 아니다.

새 복사본의 **첫 설치부터** `pnpm install --frozen-lockfile --offline --ignore-scripts --config.virtual-store-dir=.p --config.virtual-store-dir-max-length=32 --config.package-import-method=copy`를 사용한다. offline은 같은 고정 패키지가 이미 이 PC의 캐시에 있을 때만 가능하다. 이 설정은 원본 workspace에 저장하지 않는다. 공용 contracts build → 모바일 test/typecheck → `expo prebuild --platform android --no-install` 후 아래 명령을 실행했다. 일반 copy 방식이므로 OneDrive reparse 태그를 옮기는 공용 hardlink를 피한다. 기존 폴더에 옵션만 추가하는 재설치는 실제 경로가 유지돼 효과가 없었으므로 새 스냅샷의 `.modules.yaml`에서 `.p`/32 반영을 확인했다.

이 세션에서 사용한 도구 환경은 다음과 같다. 경로는 이 PC 전용이다.

```powershell
$tools = 'C:/Users/PC/AppData/Local/account-book-android'
$env:JAVA_HOME = "$tools/jdk/jdk-17.0.20.1+1"
$env:ANDROID_HOME = "$tools/sdk"
$env:GRADLE_USER_HOME = "$tools/gradle"
$env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8'
$env:PATH = "C:/Users/PC/OneDrive/문서/account-book/.worktrees/ledger-public-contracts/output/ledger-runtime;C:/Users/PC/AppData/Local/Temp/codex-node-v22.15.1-win-x64;$env:JAVA_HOME/bin;" + $env:PATH
$env:CI = '1'
$env:EXPO_NO_TELEMETRY = '1'
$env:NODE_ENV = 'development'
Set-Location 'C:/Users/PC/a3/apps/mobile/android'
./gradlew.bat :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

휴대폰용 arm64 한 종류로 빌드하며 x86 에뮬레이터용 APK는 아니다. `--max-workers=2`는 첫 빌드의 메모리 사용량을 제한한다. 임시 Node 경로가 사라지면 같은 고정 버전을 다시 준비해야 한다. SDK/JDK는 임시 폴더가 아닌 사용자 로컬에 남는다.

## 실기기 전 다음 조건

[사용자 준비 절차](../guides/android-device-testing.ko.md)에 따라 USB 디버깅을 허용하고 연결한다. APK는 개발 클라이언트이므로 Metro와 휴대폰이 신뢰하는 HTTPS 테스트 BFF가 따로 필요하다. 현재 모바일 디렉터리에 실제 환경 파일은 없고 테스트 API origin 설정도 별도다. 서버 준비·합성 계정·USB 설치는 다음 기기 확인과 함께 수행한다.

## 공식 근거

- [Microsoft JDK 다운로드](https://learn.microsoft.com/en-us/java/openjdk/download)
- [Android command-line tools](https://developer.android.com/studio#command-tools)
- [Expo 로컬 개발](https://docs.expo.dev/guides/local-app-development/)
- [Reanimated의 Windows 네이티브 빌드 안내](https://docs.swmansion.com/react-native-reanimated/docs/guides/building-on-windows/)
- [공식 Ninja1.13.2](https://github.com/ninja-build/ninja/releases/tag/v1.13.2)
