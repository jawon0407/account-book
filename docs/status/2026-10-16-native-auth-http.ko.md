# Android 이메일 인증 HTTP 구현 기록

## 무엇이 달라졌나요?

Android 앱이 서버에 이메일 로그인을 요청하고, 로그인 상태를 확인·갱신·종료할 수 있는 **서버 접속 경로 4개**를 구현했다. 기존 PC 인증 경로를 모바일용으로 억지로 공유하지 않고 서버 세션의 Android 채널을 사용한다.

이 단계는 APK나 Android 화면을 완성한 것이 아니다. `apps/mobile`, 기기 안전 저장소, 금융 알림 접근·판독·원장 기록은 후속이다. 실제 Supabase DB 이관·배포·커밋/푸시는 하지 않았다. 기존 미커밋 원장·은행 작업은 보존했다. iOS는 Android 승인 범위와 실기기 검증 뒤에 진행한다.

## 초급 개발자를 위한 처리 흐름

1. 앱은 이메일·비밀번호·설치 UUID로 로그인 경로를 호출한다. 설치 UUID는 앱 설치를 구분하는 값이며 그 자체로 사용자를 인증하지 못한다.
2. 서버는 요청 주소·메서드·헤더·본문과 요청 횟수를 검사한다. 잘못된 입력이나 제한 저장소 오류는 로그인 허용으로 처리하지 않는다.
3. 인증 공급자에서 확인한 사용자와 토큰 소유자·메일 인증·유효 시각을 검증한다. 서버는 공급자 토큰을 암호화하여 보관한다.
4. 앱에는 서버 세션을 찾는 32바이트 무작위 자격 증명과 최소 사용자/기기/갱신 시각만 반환한다. 공급자 접근·갱신 토큰이나 DB 비밀번호를 앱에 주지 않는다.
5. 앱은 후속 요청의 `Authorization: Bearer ...`에 앱 자격 증명을 넣는다. 갱신하면 새 값으로 교체하고 이전 값은 사용할 수 없다. 현재 기기의 로그아웃은 PC·다른 기기의 로그인에 영향을 주지 않는다.

`refreshAt`은 공급자 접근 토큰 만료 60초 전이다. 앱의 절대 로그인 수명과 같은 뜻이 아니다. 앱에서 갱신·로그아웃을 직렬화하고 안전 저장소의 값을 교체하는 코드는 아직 구현하지 않았다. 서버 저장 후 응답 유실 시 재로그인하는 계약을 유지한다.

## 경로와 책임

| 경로 | 요청 | 역할 |
| --- | --- | --- |
| `/api/native/auth/sign-in` | POST 이메일·비밀번호·설치 ID | 이메일 인증된 기존 계정의 Android 세션 생성 |
| `/api/native/auth/session` | GET Bearer | 세션의 안전한 메타데이터만 조회 |
| `/api/native/auth/session/refresh` | POST Bearer + `{}` | 서버 토큰과 앱 자격 증명을 원자적으로 교체 |
| `/api/native/auth/sign-out` | POST Bearer + `{}` | 현재 앱 세션을 먼저 폐기하고 현재 공급자 세션만 종료 |

모든 응답은 캐시 금지다. 쿠키를 만들지 않으며 브라우저의 Cookie·Origin·Sec-Fetch 헤더는 거절한다. 로그인에는 Bearer를 받지 않는다. 나머지는 올바른 형식의 Bearer 하나만 받는다. 이 경계는 브라우저와의 혼용 방지이며 정식 앱이나 Android 하드웨어를 증명하는 장치는 아니다.

POST는 UTF-8 JSON, 최대 16KiB, 전체 읽기 3초와 엄격한 필드 검증을 적용한다. HTTPS·정확한 origin/path·메서드를 검사한다. 로컬 NextURL이 loopback 주소를 localhost로 정규화하는 경우만 같은 HTTPS·포트와 원래 Host의 정확한 일치를 추가 확인한다. 공인 호스트 허용 범위를 넓히거나 임의 X-Forwarded 헤더를 신뢰하지 않는다.

## 파일을 왜 나눴나요?

이번 단위는 제품·테스트·설정 **31파일**, 문서 4파일에 걸친 중간 규모 기능 추가다. 최초 예상 20~26파일보다 실제 SDK 로그아웃 회귀와 HTTP 테스트용 인증 갱신 연결 등이 늘었다. 이전 원장/은행/세션 단위의 변경 전체를 이번 변경량으로 계산하지 않는다.

| 파일/묶음 | 맡은 일 |
| --- | --- |
| `packages/contracts/src/native-auth.ts`, `index.ts` | 앱과 서버가 공유하는 요청/응답의 정확한 모양 |
| `native-auth/native-boundary.ts` | HTTP 주소·헤더·본문·Bearer 검사 |
| `native-auth/native-controller.ts` | 검사 → 제한 → 인증/세션 작업 → 안전한 응답의 순서 |
| `native-auth/native-rate-limiter.ts`, `native-types.ts` | 고정 작업별 횟수 제한과 서비스 인터페이스 |
| `native-auth/route-adapter.ts` | 요청용 서비스 구성 실패도 안전한 응답으로 변환 |
| `apps/web/src/app/api/native/auth`의 라우트 4개 | Node.js 경로와 고정 작업 연결, 잘못된 메서드 거절 |
| `container.ts`, `email-auth-service.ts` | 서버가 Android 채널을 고정하고 기존 토큰 검증 재사용 |
| `supabase-auth-adapter.ts`, `supabase/sdk-client.ts`, `auth-provider-port.ts` | 현재 세션만 로그아웃하도록 공급자 계약 명시 |
| `packages/database/src/schema/auth.ts`, 새 migration | 기존 제한 테이블에 native 종류와 정리용 인덱스 추가 |
| `fake-auth-provider.ts`, 테스트 IdP·core 설정 | 실제 HTTP 회귀에서만 사용하는 합성 인증 갱신 연결 |
| 계약·controller·limiter·adapter·공급자·DB·E2E 테스트, Vitest 설정 | 정상/거절·경쟁·권한·PC 회귀 검증 |

위 `native-auth` 서버 폴더는 `apps/web/src/server/native-auth`다. 기능을 한 거대한 파일에 모으지 않고 HTTP 검사·업무 순서·DB 제한·라우트 구성을 나눴다. 새 제품 모듈은 boundary 39줄, controller 92줄, limiter 49줄, types 6줄, route adapter 14줄이다. 함수 주석에 매개변수와 실패/반환 역할을 적었다.

## 요청 제한과 DB 변경

여러 서버 인스턴스가 같은 DB 제한을 공유한다. 이메일·자격 증명 원문 대신 용도가 구분된 HMAC 지문을 저장한다. 시간 창은 DB 시계로 계산하고 증가와 상한 처리를 한 SQL에서 수행한다.

- 전역 분당: 로그인 120, 조회 1,200, 갱신/로그아웃 각각 600.
- 로그인: 이메일별 10분 6회, 설치 ID별 10분 30회.
- 인증 후 사용자+설치: 조회 분당 60, 갱신/로그아웃 각각 10회.
- 한도 초과는 429, DB 오류는 503. 전역 상한은 베타용 보호이며 서비스 거부 공격 방어 전체를 대신하지 않는다.
- 전역 제한 검사 때 20분 이전 native 기록을 최대 500개 정리한다. 트래픽이 없으면 다음 요청까지 남으며 정확한 삭제 시각 보장은 아니다. 다른 종류의 제한 기록은 건드리지 않는다.

`20261016044255_native_auth_rate_limits.sql`은 공식 CLI로 생성한 이관 파일이다. 기존 제한 종류를 유지하면서 native 종류와 정리 인덱스만 더하며 권한을 넓히지 않는다.

실제 적용 순서는 대상/백업/승인 SHA 확인 → 이전 `20261016040532_native_session_channel.sql` → 새 제한 이관 → BFF → 앱이다. 런타임 역할로 이관하지 않는다. 이번에는 로컬 폐기용 PostgreSQL만 사용했다.

## 실패를 먼저 확인하고 고친 부분

- controller 33개, limiter 2개, route adapter 1개의 미구현 실패를 확인한 뒤 구현했다. 계약 테스트는 먼저 작성했지만 별도의 계약 전용 RED 실행을 기록하지 않았으므로 그렇게 주장하지 않는다.
- 실제 DB에서는 새 종류 CHECK 때문에 7개 중 2개가 실패했다. 이관 후 7개 모두 통과했다. 두 독립 연결의 제한 공유·최대 500개 정리·최소 권한을 검증했다.
- 첫 PC/core 실행은 기존 PC 15개 통과, 새 HTTP 2개가 403으로 실패했다. 설치된 NextURL의 loopback 정규화를 재현하는 단위 테스트를 추가해 실패를 확인한 후 좁은 로컬 예외를 구현했다.
- 독립 코드·보안 리뷰는 Critical 0, Important 1, Minor 0을 보고했다. 중요 지적은 기본 공급자 로그아웃의 global 범위로 PC까지 끊길 수 있다는 점이었다. 실제 설치된 SDK와 두 활성 세션을 모사한 HTTP 전송 계층에서 `global` 요청을 재현했고 `local` 명시 후 PC 세션 보존 테스트 15개가 통과했다. 실제 서비스의 두 계정/기기 실험은 아니다.

## 검증 결과

- 실제 PostgreSQL 통합: **335개 / 28파일 통과**, 종료 0. 이후 변경은 공급자 로그아웃 범위와 회귀 테스트이며 DB 코드는 바뀌지 않았다.
- 최종 웹 coverage: **1,133개 / 66파일 통과**, 종료 0. 선택한 인증/보안 24파일의 분기 **1,007/1,007(100%)**, 문장 99.71%, 함수 99.53%, 줄 99.75%. 프로젝트 전체 100%가 아니며 기준을 낮추지 않았다.
- 운영 및 전체 의존성 감사: 알려진 취약점 보고 0건. 검사 시점의 공개 권고 결과이며 안전성 보증이 아니다.
- 결과 문서를 포함한 Git 추적/비무시 754파일의 등록된 비밀 패턴 최종 검사: 0건. 무시된 실제 환경변수는 읽지 않았고 모든 비밀 형식을 탐지한다는 뜻은 아니다.
- 최종 `pnpm verify`: 종료 0. 린트·6 workspace 타입·**1,823개 테스트**(legacy/security 208·contracts 98·database 단위 19·API 279·web 1,133·preflight 86)·API/웹 production build 통과.
- 로그아웃 수정 후 core Playwright: **17개 통과(42.8초)**, 종료 0. 기존 PC 15개와 Android HTTP 2개를 실제 로컬 Next/NestJS/폐기용 DB·합성 인증 공급자로 검증했다. 새 자격 교체·이전 값 401·브라우저 혼용 403·로그아웃 뒤 401·요청 제한 429를 확인했다. SDK 로그아웃 범위는 별도의 실제 SDK/가짜 HTTP 전송 테스트로 검증했다.
- `git diff --check` 통과. E2E가 자동으로 바꾼 Next 타입 참조 두 줄은 기존 production 경로로 복원했다. 검증을 위해 띄운 임시 서버는 정리하고 실제 서비스 서버/DB에는 손대지 않는다.

자동 리뷰 도구의 누락 참조는 직접 설계 점검·TDD·독립 리뷰로 보완했다. 전체 autoplan 파이프라인, 전체 PR 완전 리뷰, 운영 침투시험, 실 Android 기기 검증을 완료했다고 표시하지 않는다. SDK의 현재 세션 종료 동작은 [공식 signOut 문서](https://supabase.com/docs/reference/javascript/auth-signout)와 설치된 코드도 대조했다.

## 다음 순서

후속 상태: 아래 1번은 같은 날 [Android 장부 채널 연결](2026-10-16-native-ledger-channel.ko.md)에서 로컬 구현·검증했다. 아래 목록은 이 HTTP 인증 단위 완료 당시의 순서이며 APK/배포 완료를 의미하지 않는다.

1. Android 자격 증명을 서버에서 검증해 NestJS 원장 API로 위임하고 PC/모바일 기능 권한을 강제한다.
2. 계정당 활성 수집 기기 1대·교체·철회 뒤 늦은 쓰기 차단을 계약과 테스트로 고정한다.
3. Android 기본 앱의 안전 저장소·로그인/갱신 직렬화·계좌/카테고리·수기·조회 화면을 연결한다. 가입·복구/소셜 복귀는 별도 모바일 계약으로 완성한다.
4. 알림 권한 → 검증한 금융 형식 하나 → 미분류 기록 → 사용자 분류 → PC 조회를 실기기까지 연결한다.

현재 단계에서 사용자에게 새 키나 실금융 데이터를 요청할 필요는 없다. Android SDK·Java·adb 설치 위치, 개발 빌드와 실제 기기 시험이 필요한 시점에는 별도로 안내한다.

관련 문서: [통합 설계](../superpowers/specs/2026-10-13-notification-ledger-data-flow-design.md), [HTTP 계약](../superpowers/specs/2026-10-16-native-auth-http-design.md), [실행 계획](../superpowers/plans/2026-10-16-native-auth-http.md).
