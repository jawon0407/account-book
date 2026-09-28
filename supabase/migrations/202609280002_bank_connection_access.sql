-- 기존 app_api 역할의 hardened 속성은 선행 JWT migration에서 만든다.
-- 소유자·superuser·BYPASSRLS가 런타임으로 사용되면 RLS 보장을 할 수 없으므로 배포를 거부한다.
begin;
do $$
begin
  if exists(select 1 from pg_roles where rolname='app_api' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb))
    or exists(select 1 from pg_namespace where nspname='app_bank' and nspowner=(select oid from pg_roles where rolname='app_api')) then
    raise exception 'BANK_RUNTIME_ROLE_UNSAFE';
  end if;
end $$;

revoke all privileges on schema app_bank from public, anon, authenticated, service_role, app_session_bff, app_api;
revoke all privileges on all tables in schema app_bank from public, anon, authenticated, service_role, app_session_bff, app_api;
revoke all privileges on all functions in schema app_bank from public, anon, authenticated, service_role, app_session_bff, app_api;
alter default privileges in schema app_bank revoke all privileges on tables from public, anon, authenticated, service_role, app_session_bff, app_api;
-- 함수는 생성한 transaction 안에서 PUBLIC 실행을 개별 철회한다. 다른 schema의 전역 기본 권한은 변경하지 않는다.
grant usage on schema app_bank to app_api;
grant select on app_bank.bank_connections, app_bank.bank_connection_requests, app_bank.bank_connection_credentials to app_api;

alter table app_bank.bank_connections enable row level security;
alter table app_bank.bank_connections force row level security;
alter table app_bank.bank_connection_requests enable row level security;
alter table app_bank.bank_connection_requests force row level security;
alter table app_bank.bank_connection_credentials enable row level security;
alter table app_bank.bank_connection_credentials force row level security;

-- user_id는 검증된 API principal에서 SET LOCAL로 설정한다. 미설정/빈 값은 NULL이 되어0행이다.
-- API 자체가 침해되어 임의 GUC를 설정하는 공격까지 막는 정책은 아니다.
create policy bank_connections_owner_read on app_bank.bank_connections for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
create policy bank_requests_owner_read on app_bank.bank_connection_requests for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
create policy bank_credentials_owner_read on app_bank.bank_connection_credentials for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
commit;
