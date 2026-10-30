-- 전체 파일을 owner의 단일 transaction으로 적용한다. runtime에 세션 원문 권한은 주지 않는다.
do $$ begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls))
    or not exists(select 1 from pg_roles where rolname='app_api' and not rolsuper and not rolbypassrls
      and not rolcreaterole and not rolcreatedb and not rolreplication)
    or current_user in ('app_api','app_session_bff','anon','authenticated','service_role') then
    raise exception 'COLLECTOR_ROLE_CONFIGURATION_UNSAFE';
  end if;
end $$;

create table app_private.collector_state (
  user_id uuid primary key references "user".users(user_id) on delete cascade,
  active_session_id uuid references app_private.auth_sessions(id) on delete set null,
  version integer not null default 0 check(version>=0),
  updated_at timestamptz not null default clock_timestamp() check(isfinite(updated_at))
);
create index collector_state_session on app_private.collector_state(active_session_id) where active_session_id is not null;
alter table app_private.collector_state enable row level security;
alter table app_private.collector_state force row level security;
revoke all on app_private.collector_state from public,anon,authenticated,service_role,app_session_bff,app_api;

-- 내부 전용: app.user_id와 현재 세션을 결합한다. 잠금=true는 logout/refresh와 직렬화한다.
-- 다른 활성 세션의 상태 표시에서는 잠금=false로 두 번째 세션 잠금/교착을 피한다.
create function app_private.collector_session_valid(p_session uuid,p_lock boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare s app_private.auth_sessions%rowtype; owner_id uuid; at_time timestamptz;
begin
  owner_id := nullif(current_setting('app.user_id',true),'')::uuid;
  if owner_id is null or p_session is null or p_lock is null then return false; end if;
  if p_lock then
    select * into s from app_private.auth_sessions where id=p_session and user_id=owner_id for share;
  else
    select * into s from app_private.auth_sessions where id=p_session and user_id=owner_id;
  end if;
  if not found then return false; end if;
  at_time := clock_timestamp();
  return s.client_channel='android' and s.device_id is not null
    and s.revoked_at is null and s.revocation_pending_at is null
    and isfinite(s.absolute_expires_at) and s.absolute_expires_at>at_time
    and isfinite(s.access_token_expires_at) and s.access_token_expires_at>at_time
    and s.last_seen_at>at_time-interval '7 days' and "user".is_active_user();
exception when invalid_text_representation then return false;
end $$;

-- 상태는 식별자를 반환하지 않는다. 행이 없어도 정상적인 inactive/version=0이다.
create function app_private.collector_status(p_session uuid) returns table(version integer,state text)
language plpgsql security definer set search_path='' as $$
declare item app_private.collector_state%rowtype;
begin
  if not app_private.collector_session_valid(p_session,true) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  select * into item from app_private.collector_state where user_id=nullif(current_setting('app.user_id',true),'')::uuid for share;
  if not app_private.collector_session_valid(p_session,false) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  return query select coalesce(item.version,0),case
    when item.active_session_id is null or not app_private.collector_session_valid(item.active_session_id,false) then 'inactive'
    when item.active_session_id=p_session then 'active_here' else 'active_elsewhere' end;
end $$;

-- CAS: 최신 version과 명시적 교체 승인을 요구한다. 입력으로 다른 소유자를 지정할 수 없다.
create function app_private.collector_change(p_session uuid,p_expected integer,p_action text,p_replace boolean)
returns table(version integer,state text)
language plpgsql security definer set search_path='' as $$
declare item app_private.collector_state%rowtype; owner_id uuid; next_session uuid;
begin
  if p_expected is null or p_expected<0 or p_action is null or p_action not in ('activate','deactivate') or p_replace is null then
    raise exception 'COLLECTOR_INPUT_INVALID' using errcode='22023';
  end if;
  if not app_private.collector_session_valid(p_session,true) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  owner_id := nullif(current_setting('app.user_id',true),'')::uuid;
  insert into app_private.collector_state(user_id) values(owner_id) on conflict(user_id) do nothing;
  select * into item from app_private.collector_state where user_id=owner_id for update;
  if not app_private.collector_session_valid(p_session,false) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  if item.version<>p_expected then raise exception 'COLLECTOR_VERSION_CONFLICT'; end if;
  if p_action='activate' and item.active_session_id is distinct from p_session
    and app_private.collector_session_valid(item.active_session_id,false) and not p_replace then
    raise exception 'COLLECTOR_REPLACE_REQUIRED';
  end if;
  next_session := case when p_action='activate' then p_session else null end;
  if next_session is distinct from item.active_session_id then
    if item.version=2147483647 then raise exception 'COLLECTOR_VERSION_EXHAUSTED'; end if;
    update app_private.collector_state as target set active_session_id=next_session,version=item.version+1,
      updated_at=greatest(clock_timestamp(),item.updated_at) where target.user_id=owner_id returning * into item;
  end if;
  return query select item.version,case when next_session is null then 'inactive' else 'active_here' end;
end $$;

-- 반드시 원장 INSERT와 같은 transaction에서 호출한다. 반환 뒤에도 session/state 공유 잠금은 commit까지 유지된다.
create function app_private.lock_active_collector(p_session uuid,p_expected integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare item app_private.collector_state%rowtype;
begin
  if p_expected is null or p_expected<1 or not app_private.collector_session_valid(p_session,true) then return false; end if;
  select * into item from app_private.collector_state where user_id=nullif(current_setting('app.user_id',true),'')::uuid for share;
  return coalesce(item.active_session_id=p_session and item.version=p_expected
    and app_private.collector_session_valid(p_session,false),false);
end $$;

revoke all on function app_private.collector_session_valid(uuid,boolean),app_private.collector_status(uuid),
  app_private.collector_change(uuid,integer,text,boolean),app_private.lock_active_collector(uuid,integer)
  from public,anon,authenticated,service_role,app_session_bff,app_api;
grant execute on function app_private.collector_status(uuid),app_private.collector_change(uuid,integer,text,boolean),
  app_private.lock_active_collector(uuid,integer) to app_api;
