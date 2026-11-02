-- 전체 파일을 관리형 migration owner의 단일 transaction으로 적용한다.
do $$ begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls))
    or not exists(select 1 from pg_roles where rolname='app_api' and not rolsuper and not rolbypassrls
      and not rolcreaterole and not rolcreatedb and not rolreplication)
    or current_user in ('app_api','app_session_bff','anon','authenticated','service_role') then
    raise exception 'CONSENT_ROLE_CONFIGURATION_UNSAFE';
  end if;
end $$;

-- 설치를 넘어 동의를 복제하지 않는다. 최신 상태만 저장하며 불변 감사 이력은 아니다.
create table app_private.notification_consent (
  user_id uuid not null references "user".users(user_id) on delete cascade,
  device_id uuid not null,
  version integer not null default 0 check(version>=0),
  notice_version text check(notice_version is null or length(notice_version) between 1 and 80),
  accepted_at timestamptz check(accepted_at is null or isfinite(accepted_at)),
  withdrawn_at timestamptz check(withdrawn_at is null or isfinite(withdrawn_at)),
  updated_at timestamptz not null default clock_timestamp() check(isfinite(updated_at)),
  primary key(user_id,device_id),
  check((notice_version is null)=(accepted_at is null)),
  check(withdrawn_at is null or accepted_at is null or withdrawn_at>=accepted_at)
);
alter table app_private.notification_consent enable row level security;
alter table app_private.notification_consent force row level security;
revoke all on app_private.notification_consent from public,anon,authenticated,service_role,app_session_bff,app_api;

-- session은 서명 검증한 sid다. 본문에서 user/device 식별자를 받지 않는다.
create function app_private.notification_consent_status(p_session uuid)
returns table(version integer,state text,"noticeVersion" text)
language plpgsql security definer set search_path='' as $$
declare item app_private.notification_consent%rowtype; owner_id uuid; installation uuid;
begin
  if not app_private.collector_session_valid(p_session,true) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  owner_id := nullif(current_setting('app.user_id',true),'')::uuid;
  select s.device_id into installation from app_private.auth_sessions s where s.id=p_session;
  select * into item from app_private.notification_consent c where c.user_id=owner_id and c.device_id=installation for share;
  if not app_private.collector_session_valid(p_session,false) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  return query select coalesce(item.version,0),case
    when item.version is null or item.version=0 then 'not_granted'
    when item.withdrawn_at is not null then 'withdrawn'
    when item.notice_version='notification-access-v1' and item.accepted_at is not null then 'granted'
    else 'outdated' end, 'notification-access-v1'::text;
end $$;

-- 현재 버전을 요구한다. 첫 철회도 version=1을 남겨 늦은 accept(version=0)를 차단한다.
create function app_private.notification_consent_change(p_session uuid,p_expected integer,p_action text,p_notice text)
returns table(version integer,state text,"noticeVersion" text)
language plpgsql security definer set search_path='' as $$
declare item app_private.notification_consent%rowtype; owner_id uuid; installation uuid; at_time timestamptz;
begin
  if p_expected is null or p_expected<0 or p_action is null or p_action not in ('accept','withdraw')
    or (p_action='accept' and p_notice is distinct from 'notification-access-v1')
    or (p_action='withdraw' and p_notice is not null) then
    raise exception 'COLLECTOR_INPUT_INVALID' using errcode='22023';
  end if;
  if not app_private.collector_session_valid(p_session,true) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  owner_id := nullif(current_setting('app.user_id',true),'')::uuid;
  select s.device_id into installation from app_private.auth_sessions s where s.id=p_session;
  insert into app_private.notification_consent(user_id,device_id) values(owner_id,installation) on conflict(user_id,device_id) do nothing;
  select * into item from app_private.notification_consent c where c.user_id=owner_id and c.device_id=installation for update;
  if not app_private.collector_session_valid(p_session,false) then
    raise exception 'COLLECTOR_SESSION_INVALID' using errcode='28000';
  end if;
  if item.version<>p_expected then raise exception 'COLLECTOR_VERSION_CONFLICT'; end if;
  if item.version=2147483647 then raise exception 'CONSENT_VERSION_EXHAUSTED'; end if;
  at_time := greatest(clock_timestamp(),item.updated_at);
  update app_private.notification_consent c set version=item.version+1,
    notice_version=case when p_action='accept' then p_notice else item.notice_version end,
    accepted_at=case when p_action='accept' then at_time else item.accepted_at end,
    withdrawn_at=case when p_action='withdraw' then at_time else null end, updated_at=at_time
    where c.user_id=owner_id and c.device_id=installation;
  return query select item.version+1,case when p_action='accept' then 'granted' else 'withdrawn' end,'notification-access-v1'::text;
end $$;

-- 자동 INSERT와 같은 transaction에서만 사용한다. 잠금 순서 session→lease→consent.
create function app_private.lock_notification_collector(p_session uuid,p_lease integer,p_consent integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare item app_private.notification_consent%rowtype; installation uuid;
begin
  if p_consent is null or p_consent<1 or not app_private.lock_active_collector(p_session,p_lease) then return false; end if;
  select s.device_id into installation from app_private.auth_sessions s where s.id=p_session;
  select * into item from app_private.notification_consent c
    where c.user_id=nullif(current_setting('app.user_id',true),'')::uuid and c.device_id=installation for share;
  return coalesce(item.version=p_consent and item.accepted_at is not null and item.withdrawn_at is null
    and item.notice_version='notification-access-v1' and app_private.collector_session_valid(p_session,false),false);
end $$;

revoke all on function app_private.notification_consent_status(uuid),app_private.notification_consent_change(uuid,integer,text,text),
  app_private.lock_notification_collector(uuid,integer,integer) from public,anon,authenticated,service_role,app_session_bff,app_api;
grant execute on function app_private.notification_consent_status(uuid),app_private.notification_consent_change(uuid,integer,text,text),
  app_private.lock_notification_collector(uuid,integer,integer) to app_api;
