create table app_private.auth_user_security_state (
  user_id uuid primary key,
  minimum_accepted_iat bigint not null default 0,
  constraint auth_user_security_state_minimum_iat_nonnegative check (minimum_accepted_iat >= 0)
);

revoke all privileges on table app_private.auth_user_security_state from public, anon, authenticated, service_role, app_session_bff;
grant select, insert, update, delete on table app_private.auth_user_security_state to app_session_bff;
