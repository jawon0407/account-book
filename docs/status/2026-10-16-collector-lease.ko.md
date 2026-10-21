# Android 자동 수집 1대 제한 — DB 기반 구현 보고

## 완료 범위

여러 기기 로그인은 허용하되 자동 수집을 할 서버 세션은 하나만 지정하는 DB 기반을 구현했다. **Android 앱/APK, 알림 접근 권한 화면, 실제 금융 알림 수집, 수집 설정 HTTP는 아직 없다.** iOS는 Android 승인 범위 구현·실기기 검증 뒤 진행한다.

예: 휴대폰 A에서 B로 수집 기기를 교체하면 권한 버전이 1에서 2로 증가한다. A의 버전 1 요청이 늦게 도착해도 저장하지 않는다. A의 로그인과 수기 입력은 유지한다.

## 초급 개발자를 위한 구조

`app_private.collector_state`는 사용자당 한 행이다. 금융 알림이나 로그인 비밀을 복제하지 않는다.

| 열 | 의미 |
| --- | --- |
| user_id | 설정 소유자. 한 사용자 한 행 |
| active_session_id | 허용된 서버 세션. 해제하면 NULL |
| version | 이전 요청을 구별하는 정수. 권한 변경 때 증가 |
| updated_at | DB가 기록하는 변경 시각 |

1. 검증된 사용자·세션 ID로 채널, 소유자, 만료·로그아웃·철회 대기·탈퇴 상태를 검사한다.
2. 활성 세션·버전을 확인하고 행을 잠근다. 함수 반환 때가 아니라 transaction 종료까지 잠근다.
3. **같은 연결·transaction**으로 원장을 저장한다. 중간 실패면 저장도 되돌린다.
4. commit 성공 후 결과를 반환한다. 수기 작성은 수집 전용 검사를 요구하지 않는다.

저장이 먼저 잠금을 얻으면 저장 후 교체/로그아웃이 완료된다. 교체/로그아웃이 먼저 완료되면 이전 수집 요청을 거절한다. 버튼을 누르는 순간 이미 진행 중인 SQL을 강제 취소하는 것은 아니다.

## 파일별 역할·규모

제품4·테스트5·문서4, 총13파일 범위다. 기존 혼합 미커밋 작업은 보존한다. E2E가 바꾼 next-env 생성 경로는 복원한다.

| 파일 | 역할 |
| --- | --- |
| `supabase/migrations/20261016053724_collector_lease.sql` | 테이블, 세션/상태/변경/저장 잠금 함수, RLS/ACL |
| `packages/database/src/schema/collector.ts` 및 `src/index.ts` | Drizzle 선언과 export |
| `apps/api/src/core/user-database.ts` | runCollector(userId,sessionId,version,operation), 동일 transaction 강제 |
| 위 파일의 `.test.ts` | 입력·권한·연결/commit·오류 은폐 |
| `tests/database/support/collector-fixtures.ts` | 폐기용 loopback DB·합성 세션·실제 역할 |
| `tests/database/collector-lease.test.ts` | 활성/교체/해제·CAS·권한·세션 수명 |
| `tests/database/collector-concurrency.test.ts` | 두 연결의 실제 잠금 경쟁 |
| `tests/database/collector-runner.test.ts` | 원장 저장·stale 거절·수기 유지·롤백/계정 격리 |

## 보안상 구분

API에 auth_sessions SELECT/UPDATE를 주지 않는다. 고정 search_path와 명시적 객체 이름을 쓰는 제한된 SECURITY DEFINER 함수만 허용한다. 내부 helper·collector 테이블은 모든 runtime 역할의 직접 접근을 거절한다. ENABLE/FORCE RLS, 공개 정책 없음, runtime NOBYPASSRLS를 유지한다. 시험 owner도 비슈퍼유저 BYPASSRLS다.

응답은 version과 inactive/active_here/active_elsewhere뿐이다. 세션 ID·토큰·알림 원문은 반환하지 않는다. 교체에는 최신 버전과 명시적 교체 선택을 요구한다. 갱신은 sid가 같아 설정을 유지하지만 재로그인은 새 sid라서 다시 켜야 한다. 설치 ID는 하드웨어 증명이 아니다.

기존 API에는 수기 원장 쓰기 권한이 있다. 이 기능은 모든 SQL의 전역 차단 장치가 아니다. **후속 알림 접수 HTTP가 반드시 runCollector를 사용하도록 검증해야 한다.**

## 검증 기록

- 최초 DB 실행은 폐기용 동의 env 누락으로 안전하게 거부. 고정 env 뒤 함수/테이블 없음으로10건 RED → 구현 후10건 GREEN.
- 동시성5건은 pg_blocking_pids로 실제 대기를 확인했다. 이 추가 회귀를 구현 전 RED로 표시하지 않는다.
- runCollector 미구현으로 새 단위7건 RED → 기존 포함12건 GREEN. 실제 runner DB2건 통과.
- 전체 verify 종료0: 린트·6 workspace 타입·1,906개 테스트(legacy208/contracts98/DB단위19/API303/web1192/preflight86)·API/웹 production build 통과.
- 전체 PostgreSQL353개/31파일 통과. 작업 완료 대상 재검사15개도 통과.
- core Playwright17개/44.1초·종료0. 실제 로컬 Next/NestJS/DB와 합성 인증으로 PC 관리·Android HTTP→PC 편집·세션/충돌 회귀 확인. APK/실기기 시험이 아니다. NO_COLOR/FORCE_COLOR 개발 실행 경고는 있었고 제품 오류는 없었다.
- 운영/전체 의존성 감사 알려진 취약점0. 등록 AWS/GitHub/private-key 패턴 검사780파일/발견0(보고서 추가 전). 모든 비밀·취약점이 없다는 보증은 아니다.
- 독립 read-only 코드·보안 리뷰 Critical0/Important0/Minor2. 전체 혼합 브랜치·PR·운영 침투시험 승인과 구분한다.

후속 Minor2건: **잠금 대기 중 세션 만료**, **사용자 삭제 시 collector FK cascade**의 추가 회귀. 현재 실패를 재현한 지적은 아니다. 기본 만료 경계·세션 삭제 시험은 통과했지만 이 두 추가 시험은 완료로 표시하지 않는다.

## 적용·다음 작업

실제 Supabase 적용·배포·커밋/푸시는 하지 않았다. 이관은 기존 user 스키마/세션 채널 이후 owner one-off로 실행한다. 기존 세션·원장은 변경하지 않는다. 관리형 owner 권한·함수 ACL·호환/되돌리기를 적용 전에 검증한다. APK 없는 PC 작성 제한 상태는 배포하지 않는다.

다음: **Android 수집 설정 HTTP(조회·켜기·명시적 교체·해제)** → 기본 앱/안전 저장소/수기 장부 → 알림 접근·검증 형식 판독·자동 기록·PC 동기화. 모바일 가입/복구·소셜, 시각·복수 필터·규칙·환불/복구·집계도 남아 있다.

## 판단 기록·리뷰 한계

- DB-first로 작은 검증 단위 유지. 비용은 HTTP/앱 통합이 별도로 남는 것이다.
- 일반 재승인 생략 지시를 따르되 외부 DB/배포/Git 전송 없음. 실제 제공은 통합 이후다.
- Autoplan 필수 참조 누락은 직접 설계/TDD/독립 리뷰로 보완. 전체 자동 계획 검토는 아니다.
- 빈 commit 범위 대신 현재 파일 목록으로 리뷰. 전체 혼합 브랜치 인증은 아니다.
- 리뷰 유보: 후속 HTTP JWT/채널·접수 강제, APK/동의/판독/멱등성/금융 진위, 신뢰된 API의 기존 수기 권한, 벽시계 만료/동시 profile soft-delete 순간의 작업 강제 취소, 운영 자격/전체 브랜치, 최종 시험 실행 여부. 미래 기능은 후속 검증, 즉시 강제 취소는 비보장이다. 실제 시험 결과는 위에 따로 확인했다.

설계: `docs/superpowers/specs/2026-10-16-collector-lease-design.md`. 계획: `docs/superpowers/plans/2026-10-16-collector-lease.md`.
