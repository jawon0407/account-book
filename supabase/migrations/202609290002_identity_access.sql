-- profiles 자체 RLS는 자기 행 조건만 검사한다. 다른 테이블은 제한된 활성 회원 함수로 참조한다.
do $$ begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls))
    or not exists(select 1 from pg_roles where rolname='app_api' and not rolsuper and not rolbypassrls
      and not rolcreaterole and not rolcreatedb and not rolreplication)
    or exists(select 1 from pg_namespace where nspname='app_identity' and nspowner=(select oid from pg_roles where rolname='app_api')) then
    raise exception 'IDENTITY_ROLE_CONFIGURATION_UNSAFE';
  end if;
end $$;

-- 매개변수 없음: caller가 임의 UUID를 조회하지 못하게 app.user_id만 읽는다.
-- 반환: API가 설정한 사용자에게 존재하는 미탈퇴 프로필이 있는지. 빈 문맥은 false다.
create function app_identity.is_active_user() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_identity.profiles
    where user_id=nullif(current_setting('app.user_id',true),'')::uuid and deleted_at is null)
$$;
revoke all on function app_identity.is_active_user() from public, anon, authenticated, service_role, app_session_bff, app_api;
grant execute on function app_identity.is_active_user() to app_api;

-- OLD/NEW는 PostgreSQL이 제공하는 수정 전후 행이다. 서버가 버전과 수정 시각을 결정한다.
create function app_identity.guard_profile_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at
    or (old.signup_provider<>'unknown' and new.signup_provider is distinct from old.signup_provider)
    or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at) then
    raise exception 'PROFILE_IMMUTABLE_FIELD' using errcode='23514';
  end if;
  new.version := old.version+1;
  new.updated_at := greatest(clock_timestamp(),old.updated_at);
  return new;
end $$;
revoke all on function app_identity.guard_profile_update() from public, anon, authenticated, service_role, app_session_bff, app_api;
create trigger profiles_update before update on app_identity.profiles for each row execute function app_identity.guard_profile_update();

-- BEFORE UPDATE는 행 보호/수정 시각만 담당한다. 충돌로 건너뛴 INSERT에는 감사 부작용이 없어야 한다.
create function app_identity.guard_role_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
    raise exception 'ROLE_IMMUTABLE_FIELD' using errcode='23514';
  end if;
  new.updated_at := greatest(clock_timestamp(),old.updated_at);
  return new;
end $$;
revoke all on function app_identity.guard_role_update() from public,anon,authenticated,service_role,app_session_bff,app_api;
create trigger roles_update before update on app_identity.user_roles for each row execute function app_identity.guard_role_update();

-- TG_OP으로 실제 성공한 부여/변경/회수를 구분하고 같은 transaction에 감사 행을 추가한다.
create function app_identity.audit_role_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' and new.role is not distinct from old.role then return null; end if;
  insert into app_identity.role_change_events(target_user_id,previous_role,new_role,db_actor,reason)
    values(case when TG_OP='DELETE' then old.user_id else new.user_id end,
      case when TG_OP='INSERT' then null else old.role end,
      case when TG_OP='DELETE' then null else new.role end,session_user,
      case when TG_OP='INSERT' then 'bootstrap' when TG_OP='DELETE' then 'role_revoke' else 'role_change' end);
  return null;
end $$;
revoke all on function app_identity.audit_role_change() from public, anon, authenticated, service_role, app_session_bff, app_api;
create trigger roles_audit after insert or update or delete on app_identity.user_roles for each row execute function app_identity.audit_role_change();

-- NEW는 Auth가 생성한 계정 행이다. 클라이언트 raw_user_meta_data는 읽지 않는다.
create function app_identity.bootstrap_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into app_identity.profiles(user_id,signup_provider) values(new.id,
    case new.raw_app_meta_data->>'provider' when 'email' then 'email' when 'google' then 'google'
      when 'kakao' then 'kakao' when 'custom:naver' then 'naver' else 'unknown' end)
    on conflict(user_id) do nothing;
  insert into app_identity.user_roles(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end $$;
revoke all on function app_identity.bootstrap_user() from public, anon, authenticated, service_role, app_session_bff, app_api;
create trigger account_book_user_bootstrap after insert on auth.users for each row execute function app_identity.bootstrap_user();

-- 초기화 트리거 설치와 기존 계정 채우기를 같은 migration에서 수행한다. 기존 행은 덮어쓰지 않는다.
insert into app_identity.profiles(user_id,signup_provider)
  select id,case raw_app_meta_data->>'provider' when 'email' then 'email' when 'google' then 'google'
    when 'kakao' then 'kakao' when 'custom:naver' then 'naver' else 'unknown' end from auth.users
  on conflict(user_id) do nothing;
insert into app_identity.user_roles(user_id) select id from auth.users on conflict(user_id) do nothing;

grant usage on schema app_identity to app_api;
grant select on app_identity.profiles,app_identity.user_roles to app_api;
grant update(nickname,avatar_object_key) on app_identity.profiles to app_api;
create policy profiles_read on app_identity.profiles for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and deleted_at is null);
create policy profiles_update on app_identity.profiles for update to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and deleted_at is null)
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and deleted_at is null);
create policy user_roles_read on app_identity.user_roles for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and app_identity.is_active_user());
alter default privileges in schema app_identity revoke all on tables from public,anon,authenticated,service_role,app_session_bff,app_api;
