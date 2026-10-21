# Android 우선 개발 — 서버 세션 경계 구현 결과

작성: 2026-10-16, 한국시간. 작업 트리: `ledger-public-contracts`, 브랜치: `feature/bank-state-transitions`, 기준 HEAD: `8af7a0d`.

후속 기록: [Android 자격 증명 회전](2026-10-16-native-session-rotation.ko.md)을 추가 구현했다. 아래 수치와 미완료 목록은 채널 경계 단위를 마친 시점의 기록이며, 최신 회전 구현 상태는 후속 보고서를 기준으로 읽는다.

## 1. 이번에 완료한 것과 아직 없는 것

**웹 로그인과 앞으로 만들 Android 로그인이 서로의 세션을 잘못 사용하는 것을 막는 서버 기반을 구현하고 로컬 검증했다. Android 앱 자체를 완성한 것은 아니다.**

Android 승인 범위부터 구현·실기기 검증하고 iOS는 그 이후 진행한다. 기존 은행 A5·원장·인증 미커밋 변경은 보존했으며, 이번 작업에서 커밋/푸시·원격 CI 재실행·병합·배포·실제 Supabase DB 적용은 하지 않았다.

완료 범위:

- 세션 저장소에 웹/Android 구분과 Android 설치 식별자를 저장한다.
- 웹 경로는 Android 세션을, Android용 서비스는 웹 세션을 조회·갱신·현재 로그아웃에 사용하지 못한다.
- 전체 로그아웃·비밀번호 복구는 웹/Android 모두 철회한다.
- 기존 세션과 구버전 웹 INSERT를 보존하는 추가형 DB migration을 만들었다.
- 기존 웹 로그인·복구·로그아웃·장부 편집을 실제 PC 브라우저 회귀로 확인했다.

미완료 범위:

- `apps/mobile`, Android 화면·APK·알림 수집기·실기기 검증.
- Android 로그인 HTTP 경로·앱 자격 보관·앱 세션 식별자 회전.
- NestJS로 전달할 신뢰된 채널/기기 정보와 PC 신규 거래 작성 제한.
- 계정당 활성 수집 기기 한 대 제한·기기 교체·이전 기기 쓰기 차단.
- 시각/시간대·접수 후보·중복·규칙·환불/복구 등 통합 설계의 나머지 기능.

## 2. 초급 개발자를 위한 동작 설명

세션은 ‘로그인이 유지되는 동안 서버가 확인하는 출입증’에 가깝다. 앱에는 서버 비밀키를 주지 않고 무작위 식별자만 주는 방향이다. 제공자 토큰은 기존 방식대로 서버에서 암호화한다.

이번에 추가한 정보는 다음과 같다.

| 정보 | 의미 | 예외 처리 |
| --- | --- | --- |
| `client_channel` | 서버가 정한 접속 경로: `web` 또는 `android` | 알 수 없는 값은 거절 |
| `device_id` | Android 앱 설치를 구분하는 무작위 UUID | Android는 필수, 웹은 NULL |

설치 UUID는 전화번호·IMEI가 아니며 실제 하드웨어나 정식 앱의 진위를 증명하지 않는다. **이 값이 있다고 알림 수집 권한이 생기는 것도 아니다.** 수집 기기 한 대 제한은 별도 기능이다.

처리 흐름:

1. 서버가 `SessionService`를 구성할 때 채널을 고정한다. 사용자가 보낸 `mobile` 헤더로 웹 세션 권한을 바꾸지 않는다.
2. `create(tokens, now, deviceId?)`는 제공자 토큰·현재 시각·선택 설치 ID를 받는다. Android 생성에는 유효한 설치 ID가 필요하고 웹에는 넣을 수 없다.
3. 저장소는 채널과 설치 ID를 함께 기록한다. DB CHECK도 잘못된 조합을 거부한다.
4. `resolve`·`refresh`는 저장된 채널을 먼저 확인한다. 다르면 토큰 복호화나 제공자 갱신 전에 거절한다.
5. `revokeCurrent`는 세션 해시와 채널을 SQL 조건으로 함께 확인한다. 반대 채널의 세션을 지우지 않는다.
6. 계정 전체 로그아웃·비밀번호 복구에서는 채널을 한정하지 않는다. 두 종류의 세션 모두 철회한다.

기존 7일 유휴/30일 절대 수명, 토큰 암호화, 갱신 경쟁 보호는 유지한다. 토큰 갱신으로 채널·설치 ID를 변경하지 않는다. 관련 함수에 역할·입력·실패 경계를 설명하는 주석을 함께 유지했다.

## 3. 파일별 변경 지도와 규모

이번 단위의 제품/테스트/설정은 15파일, 설계·계획·통합 문서·보고서 4파일로 총 19파일이다. 기존 브랜치 전체 변경량과 다르다. 사전 예상 12~15파일보다 문서와 기존 컨트롤러 fixture 보완이 추가됐다. 대규모 폴더 이동이나 의존성 추가는 없다.

| 역할 | 파일 |
| --- | --- |
| 공통 채널 검사(신규) | `apps/web/src/server/security/session-context.ts` |
| 저장 계약·SQL | `apps/web/src/server/persistence/auth-repository.ts`, `postgres-auth-repository.ts` |
| 세션 생성·조회·갱신·철회 | `apps/web/src/server/session/session-service.ts` |
| 단위 테스트·대역 | `session-service.test.ts`, `postgres-auth-repository.test.ts`, `postgres-auth-repository.test-fixtures.ts` |
| 기존 컨트롤러 fixture 보완 | `apps/web/src/server/bank-connections/bank-controller.test.ts`, `apps/web/src/server/core/core-controller.test.ts` |
| 인증 커버리지 대상 추가 | `apps/web/vitest.config.ts` |
| DB 선언·추가형 이관 | `packages/database/src/schema/auth.ts`, `supabase/migrations/20261016040532_native_session_channel.sql` |
| 실제 DB 검증(신규) | `tests/database/native-session-channel.test.ts` |
| 실제 저장소를 사용하는 시험의 이관 목록 | `tests/database/auth-recovery-skew.test.ts`, `tests/e2e/core/setup.ts` |

문서: [상세 설계](../superpowers/specs/2026-10-16-native-session-boundary-design.md), [실행 계획](../superpowers/plans/2026-10-16-native-session-boundary.md), [통합 설계](../superpowers/specs/2026-10-13-notification-ledger-data-flow-design.md), 이 보고서.

## 4. 검증 결과와 한계

모든 결과는 이번 로컬 작업 트리의 결과다. 원격 CI·운영 DB·실제 은행/소셜 제공자·Android 실기기 검증으로 확대하지 않는다.

| 검사 | 최종 결과 |
| --- | --- |
| `pnpm verify` | 종료 0. 린트·6 workspace 타입·1,760개 테스트·API/웹 production build 통과 |
| 실제 폐기용 PostgreSQL | 27파일 319개 통과 |
| 새 세션 DB 시험 | 위 DB 전체에 포함된 13개 통과 |
| PC core Playwright | 15개 통과, 40.2초, 종료 0 |
| 웹 coverage | 1,072개 통과. 선택된 인증/보안 20파일의 분기 855/855(100%) |
| 의존성 감사 | 389개 의존성, 보고된 모든 심각도 경고 0건 |
| 기존 비밀 패턴 검사·diff 공백 | tracked/non-ignored untracked 731파일의 패턴 일치 0건, 공백 검사 통과 |
| 독립 코드·보안 리뷰 | 이번 단위의 Critical/Important/Minor 0건 |

1,760개는 legacy/security 208 + contracts 96 + database 단위 19 + API 279 + web 1,072 + preflight 86이다. DB·PC·coverage 수치를 무조건 더해 고유 테스트 개수로 표시하지 않는다. coverage 100%는 선택된 인증 분기 기준이며 전체 프로젝트 100%가 아니다.

비밀 검사는 등록된 AWS·GitHub 토큰·개인키 패턴 범위다. 모든 비밀번호·개인정보 유형이나 전체 Git 이력을 검사했다는 뜻은 아니다. 값 자체는 출력하지 않았다.

DB 시험은 기존 행/INSERT 호환, 잘못된 채널·설치 조합 거절, `app_api`·`anon`·`authenticated`·`service_role`의 직접 접근 거절, 양방향 채널별 철회, 갱신 후 문맥 유지, 전체 로그아웃·복구 및 다른 사용자 격리를 확인했다. BFF 최소권한으로 실제 저장소를 실행했다.

PC 시험은 합성 인증 공급자와 로컬 BFF/API/DB를 사용했다. 공개 비밀번호 복구, 없는 합성 계정 안내, 중복 가입, 거절된 로그아웃의 세션 보존, 계좌/분류/프로필, 거래 편집·409 충돌·응답 유실·미지정 거래·세션 만료를 확인했다. 사용자 비밀번호나 실제 금융 원문을 시험 자료로 쓰지 않았다.

실패 기록도 남긴다. 구현 전 서비스/저장소 16개 및 새 DB 8개가 실패해 누락 경계를 확인했다. 구현 후 대상 72개·DB 13개가 통과했다. 첫 전체 타입 검사는 기존 컨트롤러 대역 2곳의 새 필드 누락으로 실패했으며, 실제 반환형에 맞춰 고친 뒤 전체 검증을 재실행했다.

`autoplan` 설치본의 하위 리뷰 참조 경로 누락으로 전체 자동 파이프라인 완료를 주장하지 않는다. 직접 설계 대조·TDD·독립 리뷰로 보완했다. 독립 리뷰는 전체 PR #22의 수백 파일이나 운영 환경을 감사한 결과가 아니다.

## 5. 적용 순서와 다음 작업

실제 적용은 **대상·백업·승인 SHA 확인 → migration/owner 실행 주체로 추가형 이관 → BFF 코드 배포 → 로그인 회귀** 순서다. 새 코드가 없는 DB 열을 조회하면 실패하므로 코드부터 배포하면 안 된다. 이번 migration은 인증 테이블의 기존 접근 권한을 넓히지 않는다.

다음 구현 순서:

1. Android 전용 로그인/갱신/로그아웃 HTTP 계약, 식별자 수명·회전·제한·OAuth 복귀 경계.
2. 검증된 채널을 NestJS에 위임하고 PC/모바일 기능 권한을 서버에서 강제.
3. 로그인 기기와 별개인 활성 수집 기기 한 대·교체·늦은 요청 차단.
4. `apps/mobile` 기본 앱, 안전한 자격 보관, 로그인·계좌/분류·수기·조회·PC 동기화.
5. 검증된 알림 한 형식의 Android 수집 → 미분류 기록 → 분류 → PC 확인을 실기기에서 연결.

각 단위마다 파일·규모·테스트 계획을 먼저 기록한다. 기존 승인 범위를 바꾸지 않는 구현은 별도 반복 승인 없이 진행한다. 표준 설치 경로/PATH에서 Android SDK·Java·adb를 확인하지 못했으므로 실제 설치 위치와 개발 빌드 환경은 후속으로 확인해야 한다. Android Studio가 어느 경로에도 없다고 단정한 것은 아니다. 사용자에게 필요한 실기기 알림 접근 허용·개발자 설정은 해당 단계에서 안내한다.

Notion 기술 문서: [04. 기술 구조·데이터 설계·개발 흐름](https://app.notion.com/p/3e2323168ba6810bb34cec8227a85a78). 진행 기록: [07. 현재 구현 상태·변경 이력·다음 작업](https://app.notion.com/p/3e2323168ba681b59204c2342edb27b3).

두 페이지의 이번 단위 내용·남은 경계·체크 상태를 갱신하고 재조회로 확인했다. 과거 실행의 테스트 개수는 당시 기록으로 보존했다.
