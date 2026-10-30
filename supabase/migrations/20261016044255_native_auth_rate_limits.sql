begin;

-- 기존 웹 제한 종류와 권한을 유지하고 Android 요청 제한 종류만 추가한다.
alter table app_private.auth_rate_limits drop constraint auth_rate_limits_kind_check;
alter table app_private.auth_rate_limits add constraint auth_rate_limits_kind_check
  check (kind in ('sign_in','sign_up','password_reset','oauth_start','native_auth'));

-- 제한된 묶음 정리에서 다른 종류 전체를 스캔하지 않게 한다.
create index auth_rate_limits_native_cleanup_idx
  on app_private.auth_rate_limits(window_started_at) where kind='native_auth';

commit;
