# Android 단일 수집 기기: DB 실행 경계

## 목적과 범위

승인된 정책은 복수 기기 로그인 허용, 자동 수집은 계정당 최대 1대다. 이번 단위는 이를 서버 DB에서 강제하는 기반이다. Android 우선이며 iOS는 후속이다. 앱 화면, 알림 접근 동의, 실제 NotificationListenerService, 판독/접수 HTTP는 이번 완료 범위가 아니다.

기존 앱 세션 ID는 갱신해도 유지되고 자격 증명만 교체된다. 이 세션을 수집 권한에 연결한다. 기기 ID나 사용자 ID를 요청 본문에서 받아 권한을 부여하지 않는다. 후속 HTTP는 검증된 JWT sub/sid와 android 채널만 사용한다.

## 저장과 인터페이스

`app_private.collector_state`: `user_id` PK 및 user.users FK, `active_session_id` nullable auth_sessions FK, `version` 0..2147483647, `updated_at` 유한 DB 시각. 한 사용자 한 행이므로 최대 1개 활성 세션이다. 금융 알림 원문·계좌·이메일·토큰 복제는 저장하지 않는다. 실제 세션 삭제 시 연결만 NULL, 버전은 되돌리지 않는다.

- `collector_status(session_id uuid)` → `{version integer, state text}` 한 행. state는 inactive/active_here/active_elsewhere. 다른 기기/사용자의 식별자를 반환하지 않는다.
- `collector_change(session_id uuid, expected_version integer, action text, replace_existing boolean)` → 동일 응답. action은 activate/deactivate. 변경마다 version+1. 다른 유효 세션을 교체하려면 replace_existing=true가 필요하다. deactivate는 같은 계정의 다른 Android 세션에서도 가능하다.
- `lock_active_collector(session_id uuid, expected_version integer)` → boolean. 유효 세션과 정확한 활성 버전일 때만 true. 원장 INSERT와 반드시 같은 transaction/connection에서 호출한다.
- `UserDatabase.runCollector(userId, sessionId, version, operation)`은 기존 run을 이용하고 lock_active_collector=true인 경우에만 operation을 실행한다. 이 메서드는 후속 수집 저장소용이며 수기 거래는 기존 run을 사용한다.

존재하지 않는 상태는 version=0/inactive다. 활성 세션이 만료/철회되면 status는 inactive지만 버전은 보존한다. 같은 세션 재활성/이미 해제는 정확한 버전일 때 no-op. 오래된 버전은 항상 충돌한다. 교체 응답 유실 시 상태를 다시 조회하며 무작정 변형 요청을 반복하지 않는다. version 최대값에서는 변경을 거절한다.

## 권한·동시성

API 역할에 auth_sessions 읽기/수정 권한을 주지 않는다. 고정 search_path와 명시된 객체 이름을 쓰는 좁은 SECURITY DEFINER 함수만 app_api에 실행 허용한다. private 내부 helper와 테이블은 모든 runtime 역할에 직접 접근 금지다. RLS ENABLE/FORCE, 정책 없음. 관리형 migration owner는 BYPASSRLS, runtime은 NOBYPASSRLS다. 기존 서버 전용 app.user_id를 사용하며 공개 Supabase Auth RPC가 아니다.

현재 사용자와 session.user_id 일치, Android 채널/device 존재, revoked/revocation_pending 없음, access/absolute expiry 및 7일 idle을 DB 시각으로 확인한다. active profile도 확인한다. DB owner는 배포 실행 주체일 뿐 runtime이 아니다.

잠금 순서는 현재 auth_sessions 행 FOR SHARE → collector_state 행 잠금 → 원장이다. 수집 저장은 collector 행 FOR SHARE, 변경은 FOR UPDATE다. 잠금 후 현재 DB 시각으로 세션 만료를 검사한다. 수집이 먼저 잠그면 저장 commit 후 교체/로그아웃이 완료된다. 교체/로그아웃이 먼저 완료되면 이전 요청은 거절된다. 따라서 철회 완료 응답 이후 이전 수집 쓰기가 성공하지 않는다. 기존 5초 statement/idle 및 1초 lock timeout을 유지한다. 잠금 실패는 성공이 아니라 서비스 일시 오류다.

일반 로그인과 수기 작성은 수집 lease와 무관하다. 로그아웃 후 재로그인하면 같은 설치라도 새 세션이므로 수집을 명시적으로 다시 켠다. 갱신은 sid가 같으므로 권한을 유지한다. 하드웨어 진위나 금융 거래의 진위를 이 기능으로 보장하지 않는다.

## 검증과 후속

실제 폐기용 PostgreSQL에서 활성/교체/해제, stale CAS, 잘못된 소유자/채널/만료/철회/탈퇴, 최소 권한, 동시 최초 활성, 진행 중 저장 대 교체/로그아웃, 교체 후 이전 세션의 실제 원장 INSERT 거절, 수기 작성 유지, 삭제 시 FK를 검증한다. 단위 테스트는 runCollector 입력/오류/콜백 실행 경계를 검증한다. 전체 verify와 DB 회귀를 실행한다. PC 제품 코드를 바꾸지 않지만 기존 core Playwright 회귀도 확인한다.

후속은 Android 전용 수집 설정 HTTP와 앱 설정 화면 → Android 앱/안전 저장소 → 알림 접근 권한·판독·접수다. 실제 Supabase 변경, 배포, 커밋/푸시, 공개 전환은 이번 단위에 포함하지 않는다.

근거: [PostgreSQL 행 잠금](https://www.postgresql.org/docs/17/explicit-locking.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). 보안 함수는 권한 오류 우회가 아니라 세션 비밀을 API에 공개하지 않기 위한 제한된 계약이다.
