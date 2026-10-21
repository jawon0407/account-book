-- 거주 설정은 위치 추적값이 아니다. 명시적으로 정한 장부 기준 이력만 저장한다.
-- p_zone: IANA 지역/이름 또는 UTC. 사용자 입력을 SQL 식/세션 설정으로 실행하지 않는다.
create function "user".is_ledger_time_zone(p_zone text) returns boolean
language sql stable strict security invoker set search_path='' as $$
  select char_length(p_zone) between 1 and 128
    and p_zone ~ '^(UTC|[A-Za-z_]+/[A-Za-z0-9_+/-]+)$'
    and exists(select 1 from pg_catalog.pg_timezone_names where lower(name)=lower(p_zone))
$$;
revoke all on function "user".is_ledger_time_zone(text) from public,anon,authenticated,service_role,app_session_bff,app_api;
grant execute on function "user".is_ledger_time_zone(text) to app_api;

create table "user".ledger_time_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  time_zone text not null,
  effective_from timestamptz,
  created_at timestamptz not null,
  primary key(user_id,revision),
  constraint ledger_time_history_revision check(revision between 1 and 9007199254740991),
  constraint ledger_time_history_zone check("user".is_ledger_time_zone(time_zone)),
  constraint ledger_time_history_baseline check((revision=1)=(effective_from is null)),
  constraint ledger_time_history_clock check(
    isfinite(created_at) and created_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00'
    and created_at=date_trunc('milliseconds',created_at,'UTC')
    and (effective_from is null or effective_from=created_at))
);
create unique index ledger_time_history_effective on "user".ledger_time_history(user_id,effective_from) where effective_from is not null;
alter table "user".ledger_time_history enable row level security;
alter table "user".ledger_time_history force row level security;
revoke all on "user".ledger_time_history from public,anon,authenticated,service_role,app_session_bff,app_api;
grant select on "user".ledger_time_history to app_api;
grant insert(user_id,time_zone) on "user".ledger_time_history to app_api;
create policy ledger_time_history_read on "user".ledger_time_history for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and "user".is_active_user());
create policy ledger_time_history_add on "user".ledger_time_history for insert to app_api
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and "user".is_active_user());

-- NEW의 user_id/time_zone만 caller가 지정한다. 프로필 잠금은 같은 회원의 동시 설정을 직렬화한다.
-- 불변 이력의 순번·시각은 DB가 정한다. 소유권/RLS는 invoker의 기존 권한으로 검사한다.
create function "user".guard_ledger_time_history() returns trigger
language plpgsql security invoker set search_path='' as $$
declare previous "user".ledger_time_history%rowtype;
begin
  perform 1 from "user".users where user_id=new.user_id and deleted_at is null for update;
  if not found then raise exception 'RESIDENCE_TIME_USER_UNAVAILABLE' using errcode='42501'; end if;
  select * into previous from "user".ledger_time_history where user_id=new.user_id order by revision desc limit 1;
  if found and lower(previous.time_zone)=lower(new.time_zone) then
    raise exception 'RESIDENCE_TIME_ZONE_UNCHANGED' using errcode='23514';
  end if;
  new.revision := coalesce(previous.revision,0)+1;
  new.created_at := date_trunc('milliseconds',clock_timestamp(),'UTC');
  new.effective_from := case when new.revision=1 then null else new.created_at end;
  if previous.created_at is not null and new.created_at<=previous.created_at then
    raise exception 'RESIDENCE_TIME_CLOCK_NOT_ADVANCED' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function "user".guard_ledger_time_history() from public,anon,authenticated,service_role,app_session_bff,app_api;
create trigger ledger_time_history_insert before insert on "user".ledger_time_history for each row execute function "user".guard_ledger_time_history();

-- 상수 default는 기존 DATE에 '시각 모름' 근거만 더한다. 기존 행을 UPDATE하지 않는다.
alter table finance.transaction_history
  add column occurred_at timestamptz,
  add column time_precision text not null default 'day',
  add column time_source text not null default 'legacy_date',
  add column source_time_zone text,
  add column ledger_time_zone text,
  add constraint transactions_time_shape check(
    (time_precision='day' and occurred_at is null and time_source in ('legacy_date','user') and source_time_zone is null)
    or (time_precision in ('minute','second','millisecond') and occurred_at is not null
      and time_source in ('user','notification','device_received') and ledger_time_zone is not null)),
  add constraint transactions_time_zones check(
    (source_time_zone is null or "user".is_ledger_time_zone(source_time_zone))
    and (ledger_time_zone is null or "user".is_ledger_time_zone(ledger_time_zone))),
  add constraint transactions_time_instant check(occurred_at is null or (
    isfinite(occurred_at)
    and occurred_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00'
    and occurred_at=date_trunc(case time_precision when 'minute' then 'minute' when 'second' then 'second' else 'milliseconds' end,occurred_at,'UTC')));

-- NEW/OLD은 DB가 제공한다. 과거 날짜 snapshot은 메모 수정·조회 시 새 tzdata로 재계산하지 않는다.
-- 새 시각 증거 또는 날짜 정정에 한해 입력한 장부 날짜가 적용 시간대와 일치하는지 검사한다.
create function finance.guard_transaction_time() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='UPDATE' and row(new.occurred_at,new.occurred_on,new.time_precision,new.time_source,new.source_time_zone,new.ledger_time_zone)
    is not distinct from row(old.occurred_at,old.occurred_on,old.time_precision,old.time_source,old.source_time_zone,old.ledger_time_zone) then
    return new;
  end if;
  if new.occurred_at is not null and new.ledger_time_zone is not null then
    if not "user".is_ledger_time_zone(new.ledger_time_zone) or not isfinite(new.occurred_at) then
      raise exception 'TRANSACTION_TIME_INVALID' using errcode='23514';
    end if;
    if (new.occurred_at at time zone new.ledger_time_zone)::date<>new.occurred_on then
      raise exception 'TRANSACTION_TIME_DATE_MISMATCH' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function finance.guard_transaction_time() from public,anon,authenticated,service_role,app_session_bff,app_api;
create trigger transactions_time_evidence before insert or update on finance.transaction_history for each row execute function finance.guard_transaction_time();
grant insert(occurred_at,time_precision,time_source,source_time_zone,ledger_time_zone),
  update(occurred_at,time_precision,time_source,source_time_zone,ledger_time_zone) on finance.transaction_history to app_api;
