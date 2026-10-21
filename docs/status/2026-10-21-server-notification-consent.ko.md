# 서버 알림 동의·철회 검증

확인일: 2026-10-21. 기준 체크포인트: `ae6743e`.

## 이번에 한 일

이전 모바일 동의·권한 연결 24파일을 `ae6743ea3f8b60eb3efb3142fb2ae695a2cc6c84`로 커밋·푸시하고 원격 해시를 확인했다. 모바일191개/타입/변경 린트를 다시 실행했고 푸시 보안 게이트919 blob을 통과했다.

이번 후속은 **서버가 동의와 철회를 직접 검증하는 기반**이다. 화면의 로컬 체크 값만으로 자동 기록을 허용하지 않는다. 실제 알림 읽기·업로드나 Android 화면의 서버 호출은 아직 연결하지 않았다. 운영 Supabase DB에도 적용하지 않았다.

## 계획과 변경 파일

수정 전에 [설계](../superpowers/specs/2026-10-21-server-notification-consent-design.md), [실행 계획](../superpowers/plans/2026-10-21-server-notification-consent.md)을 작성하고 Notion 07번에 기록했다.

| 구분 | 주요 파일 | 역할 |
| --- | --- | --- |
| 공통 계약 | packages/contracts/src/notification-consent.ts와 시험/index | 동의·철회 요청, 공개 상태, 현재 고지 버전 |
| DB | supabase/migrations/20261021050645_notification_consent.sql, packages/database/src/schema/notification-consent.ts/index | 회원·설치별 현재 상태와 최소 권한 함수 |
| API | apps/api/src/collector/notification-consent.repository.ts/controller.ts/test.ts | 검증된 회원·세션으로 고정 SQL 실행, 내부 오류 숨김 |
| 자동 기록 경계 | apps/api/src/core/user-database.ts/test.ts | 기기 지정과 동의를 같은 DB transaction에서 확인 |
| 연결·HTTP 검사 | core.module.ts/core-http.test.ts | Android 전용 API, 권한·입력 검증 |
| BFF | apps/web/src/app/api/native/collector/consent/route.ts, server/core/operations.ts 및 native 시험2개 | 앱 요청을 인증된 서버 세션에 묶어 중계 |
| 실제 DB 시험 | tests/database/notification-consent*.test.ts, support/notification-consent-fixtures.ts, collector-runner.test.ts | 격리/철회/경쟁/역할 보존/부분 저장 rollback |
| 안내 | 본 문서·계획/설계·모바일 README·실기기 가이드·이전 체크포인트 문서 | 초급 개발자용 흐름과 완료/미완료 구분 |

## 함수가 작동하는 순서

GET/PATCH `/api/native/collector/consent` → BFF의 Android 세션 확인 → 서명된 요청 → Nest `/v1/collector/consent` → 제한 DB 함수 순서다.

- `get(userId, sessionId)`: 요청 본문이 아닌 검증된 인증 정보로 설치별 상태를 조회한다.
- `change(userId, sessionId, input)`: accept는 현재 고지 버전과 expectedVersion, withdraw는 expectedVersion을 받는다. 서버가 시각과 실제 설치 ID를 정한다.
- `notification_consent_change`: DB 행을 잠그고 현재 버전을 비교한다. 맞지 않으면 409에 대응하는 충돌을 반환한다. 처음 철회해도 버전을 올려 예전 동의 요청이 뒤늦게 들어오는 것을 막는다.
- `runCollector(userId,sessionId,leaseVersion,consentVersion,operation)`: 유효한 세션, 지정 기기 버전, 동의 버전을 검사하고 같은 연결/transaction에서 operation을 실행한다. 실패하면 저장 전체를 되돌린다. 수기 입력은 별도 `run`이므로 알림 동의가 없어도 사용 가능하다.

예를 들어 동의1 → 철회2 → 재동의3이면 버전1로 보낸 요청은 다시 허용되지 않는다. 단, 철회보다 먼저 잠금을 얻고 정상 완료한 거래는 남는다. 철회는 미래 자동 기록을 차단하며 기존 거래를 소급 삭제하지 않는다.

동의 테이블은 최신 상태만 보관한다. 불변 감사 이력이나 법적 동의 증빙 전체를 완성했다는 의미는 아니다. 회원 삭제 시 연결 행도 삭제된다. 기존 로컬 동의 기록은 자동으로 서버에 올리지 않는다.

## 검증 결과

- 전체 `pnpm test`: 2,253개 통과(기존 도구208 + 계약186 + DB 모델19 + 모바일191 + API333 + 웹1,225 + E2E 사전검사91).
- 동의 관련 실제 PostgreSQL 시험: 4파일13개 통과. 동의/철회/재동의, 계정·설치 격리, 만료·철회 세션, 최소 권한, 두 순서의 동시 철회/쓰기, 지연 accept, 잠금 대기 중 세션 만료, 수기 유지, 부분 저장 rollback, 기존 역할 로그인 설정 보존.
- 전체 린트/타입 검사 통과. 검증 도구 추가 후 재실행도 통과했다.
- PC Playwright: 합성 입출금 각1건(지출20,000/수입50,000), 새로고침 후2건 유지, 로그아웃 후0건, 페이지 오류0. 별도 테스트 브라우저 문맥에서 개발 인증서 예외만 사용했다. 일반 브라우저/앱의 TLS 정책을 바꾸지 않았으며 인증서 신뢰 검증 결과는 아니다.
- 독립 최종 리뷰: 진행 중. 중요 지적을 처리하기 전 출시 승인으로 보지 않는다.

## 발견한 문제와 처리

기존 `account_book_core_test`는 PC·모바일 합성 화면 서버가 사용 중이어서 삭제하지 않고 별도 `account_book_consent_test`를 만들었다. 테스트가 직접 만든 DB/owner만 정리한다. 기존 DB가 이미 있으면 실패하며 덮어쓰지 않는다.

초기 기반 migration의 전역 ALTER ROLE이 기존 로컬 BFF 역할을 NOLOGIN으로 바꾸는 문제도 확인했다. 원래 LOGIN을 복원하고, 관련 회귀 시험의 실패→통과를 확인했다. fixture는 사전 역할 안전성을 확인하고 migration 전체를 transaction으로 실행하며 기존 로그인 속성을 commit 전에 복원한다. 기존 PC 로그인은 이후 재검증했다. 비용은 기존 core fixture 일부 중복이며 추후 공통 추출 후보다.

시험 도구의 pnpm 검색 차이는 검증된 Node/pnpm 절대 경로로 해결했다. API의 잘못된 scope는 기존 인증 계약상401이며 채널 거부403과 다르므로 시험 기대를 바로잡았다. PC는 로그인 직후 계좌 화면이며 거래 화면으로 이동해야 한다. 로그아웃 완료 제목도 ‘로그아웃했어요’로 확인한 뒤 화면 동작에 맞게 검사했다.

## 남은 작업과 적용 경계

1. Android 화면을 서버 동의 API에 연결: 조회 완료 전 시작 금지, 명시적 재확인, 통신 실패/버전 충돌 처리, 로컬·서버 철회 상태 일치.
2. 선택 출처·시작/중지·실제 권한 해제 연결.
3. 합성 알림 한 지원 형식 → 판독 → 미분류 거래 → PC 동일 기록.
4. 운영 적용 전 DB migration 검토/실행과 실제 연결 시험. 이번에는 hosted DB 적용, 전체 DB suite, Supabase advisors, 운영 빌드/원격 CI, 전체 취약점 재감사, 실금융 베타, 새 APK/실기기 시험을 하지 않았다.

기존 기본 브랜치 의존성 경고25건은 별도 미해결이다. 자동 수집이 작동한다고 안내하면 안 된다.

## 모바일에서 직접 화면 보기

현재 설치된 **Account Book Dev**를 사용한다. 지금 PC의 HTTPS3000과 Metro8081은 실행 중이다.

1. 신뢰하는 이 PC에 USB 연결하고 테스트하는 동안만 USB 디버깅을 허용한다.
2. 이미 준비된 개발 APK를 연다. 개발 서버 선택 화면이면 `http://localhost:8081`을 선택한다.
3. 연결이 초기화됐으면 개발자가 USB 포트3000·8081 연결을 다시 준비해야 한다. 장부 확인에는 금융 알림 접근을 다시 켤 필요가 없다.
4. 현재 합성 테스트 계정만 사용한다. 사용 후 USB 디버깅과 일시 변경한 보안 설정을 복원한다.

PC 종료/USB 분리/외출 중 독립 실행은 이 APK의 목표가 아니다. 화면 코드가 포함된 독립 테스트 APK와 외부 HTTPS 서버가 준비되면 앱 아이콘만 눌러 사용할 수 있다. 실제 공개 서비스/비용/서명 정책을 정한 후 별도 작업한다. 휴대폰 브라우저의 localhost는 휴대폰 자신이므로 PC URL을 그대로 입력하는 방식도 아니다. [자세한 실기기 안내](../guides/android-device-testing.ko.md).
