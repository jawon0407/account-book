-- runtime 역할은 owner/권한 우회 역할이 아니어야 한다. 신규 schema의 권한만 변경한다.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='app_api' and not rolsuper and not rolbypassrls
      and not rolcreaterole and not rolcreatedb and not rolreplication)
    or exists(select 1 from pg_namespace where nspname='app_ledger' and nspowner=(select oid from pg_roles where rolname='app_api')) then
    raise exception 'LEDGER_ROLE_CONFIGURATION_UNSAFE';
  end if;
end $$;
revoke all on schema app_ledger from public,anon,authenticated,service_role,app_session_bff,app_api;
revoke all on all tables in schema app_ledger from public,anon,authenticated,service_role,app_session_bff,app_api;
revoke all on all functions in schema app_ledger from public,anon,authenticated,service_role,app_session_bff,app_api;
grant usage on schema app_ledger to app_api;
grant select on all tables in schema app_ledger to app_api;
-- ID·시각·version은 DB가 생성한다. 클라이언트 값으로 직접 덮어쓰지 못한다.
grant insert(user_id,kind,name) on app_ledger.accounts to app_api;
grant update(name,archived_at) on app_ledger.accounts to app_api;
grant insert(user_id,kind,name,sort_order) on app_ledger.categories to app_api;
grant update(name,sort_order,archived_at) on app_ledger.categories to app_api;
grant insert(user_id,from_account_id,to_account_id,amount_krw,occurred_on,memo) on app_ledger.transfers to app_api;
grant insert(user_id,account_id,kind,amount_krw,occurred_on,memo,category_id,transfer_id,opening_direction) on app_ledger.transactions to app_api;
grant update(account_id,kind,amount_krw,occurred_on,memo,category_id,deleted_at) on app_ledger.transactions to app_api;
grant insert(user_id,operation,idempotency_key,request_fingerprint,response_snapshot) on app_ledger.idempotency_requests to app_api;
-- 삭제/수정 정책이 있어도 GRANT가 없는 행위는 불가하다. ALL 정책은 소유권 조건을 한 곳에 고정한다.
create policy accounts_owner on app_ledger.accounts for all to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user())
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user());
create policy categories_owner on app_ledger.categories for all to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user())
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user());
create policy transfers_owner on app_ledger.transfers for all to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user())
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user());
create policy transactions_owner on app_ledger.transactions for all to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user())
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user());
create policy idempotency_owner on app_ledger.idempotency_requests for all to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user())
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user());
alter default privileges in schema app_ledger revoke all on tables from public,anon,authenticated,service_role,app_session_bff,app_api;
