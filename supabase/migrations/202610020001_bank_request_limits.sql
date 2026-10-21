-- A2.3: 조회 연결용 내부 quota. 브라우저/공개 역할은 직접 접근하지 않는다.
begin;
create table app_bank.bank_request_limits (
  scope text not null,
  key_digest bytea not null,
  accepted_at timestamptz[] not null,
  expires_at timestamptz not null,
  constraint bank_request_limits_pkey primary key(scope,key_digest),
  constraint bank_limits_scope check(scope in ('start','callback')),
  constraint bank_limits_digest check(octet_length(key_digest)=32),
  constraint bank_limits_hits check(array_ndims(accepted_at)=1 and array_lower(accepted_at,1)=1
    and cardinality(accepted_at) between 1 and case when scope='start' then 5 else 60 end
    and array_position(accepted_at,null) is null),
  constraint bank_limits_expiry check(isfinite(expires_at) and expires_at>accepted_at[cardinality(accepted_at)])
);
create index bank_limits_expiry_idx on app_bank.bank_request_limits(expires_at);
alter table app_bank.bank_request_limits enable row level security;
alter table app_bank.bank_request_limits force row level security;
revoke all on app_bank.bank_request_limits from public,anon,authenticated,service_role,app_session_bff,app_api;
grant select,insert,update,delete on app_bank.bank_request_limits to app_bank_flow;
create policy bank_limits_flow on app_bank.bank_request_limits to app_bank_flow using(true) with check(true);

-- p_scope: 서버의 고정 start/callback, p_digest:32바이트 지문. 호출자는 두 wrapper뿐이다.
-- 같은 key를 직렬화하고 잠금 이후 시각으로 최근 승인 목록을 줄여 한 번만 추가한다.
create function app_bank.consume_limit(p_scope text,p_digest bytea)
returns table(allowed boolean,retry_after_seconds integer)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare hits timestamptz[]; at_time timestamptz; window_size interval; maximum integer;
begin
  if p_scope is null or p_scope not in ('start','callback') then raise exception 'BANK_LIMIT_SCOPE_INVALID'; end if;
  if p_digest is null or octet_length(p_digest)<>32 then raise exception 'BANK_LIMIT_KEY_INVALID'; end if;
  window_size := case when p_scope='start' then interval '300 seconds' else interval '60 seconds' end;
  maximum := case when p_scope='start' then 5 else 60 end;
  perform pg_advisory_xact_lock(hashtextextended('bank-limit:'||p_scope||':'||encode(p_digest,'hex'),0));
  select l.accepted_at into hits from app_bank.bank_request_limits l
    where l.scope=p_scope and l.key_digest=p_digest for update;
  at_time := clock_timestamp();
  select coalesce(array_agg(t order by t),'{}'::timestamptz[]) into hits
    from unnest(hits) t where t>at_time-window_size;
  if cardinality(hits)>=maximum then
    return query select false,greatest(1,ceil(extract(epoch from hits[1]+window_size-at_time))::integer);
    return;
  end if;
  hits := array_append(hits,at_time);
  insert into app_bank.bank_request_limits(scope,key_digest,accepted_at,expires_at)
    values(p_scope,p_digest,hits,at_time+window_size)
    on conflict(scope,key_digest) do update set accepted_at=excluded.accepted_at,expires_at=excluded.expires_at;
  return query select true,0;
end $$;
revoke all on function app_bank.consume_limit(text,bytea) from public;

-- 매개변수 없음: API가 검증한 principal의 UUID에서 key를 계산하므로 다른 사용자 key를 받지 않는다.
-- 성공/거절 결과는 후속 은행 작업 전에 별도 transaction으로 반드시 commit해야 한다.
create function app_bank.consume_start_limit()
returns table(allowed boolean,retry_after_seconds integer)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare uid uuid := nullif(current_setting('app.user_id',true),'')::uuid;
begin
  if uid is null then raise exception 'BANK_IDENTITY_REQUIRED'; end if;
  return query select * from app_bank.consume_limit('start',sha256(convert_to(uid::text,'UTF8')));
end $$;
revoke all on function app_bank.consume_start_limit() from public;

-- p_digest: API가 신뢰 경계에서 산출한 주소 HMAC. 원문 IP/브라우저 제공 값을 전달하지 않는다.
create function app_bank.consume_callback_limit(p_digest bytea)
returns table(allowed boolean,retry_after_seconds integer)
language sql security definer set search_path=pg_catalog,pg_temp as $$
  select * from app_bank.consume_limit('callback',p_digest);
$$;
revoke all on function app_bank.consume_callback_limit(bytea) from public;
grant create on schema app_bank to app_bank_flow;
alter function app_bank.consume_limit(text,bytea) owner to app_bank_flow;
alter function app_bank.consume_start_limit() owner to app_bank_flow;
alter function app_bank.consume_callback_limit(bytea) owner to app_bank_flow;
revoke create on schema app_bank from app_bank_flow;
grant execute on function app_bank.consume_start_limit(),app_bank.consume_callback_limit(bytea) to app_api;
commit;
