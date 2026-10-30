-- 자동 스케줄/LOGIN 자격은 설치하지 않는다. 승인된 유지관리 주체만 이 함수를 호출한다.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='app_bank_maintenance') then
    create role app_bank_maintenance nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if exists(select 1 from pg_roles where rolname='app_bank_maintenance' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls))
    or exists(select 1 from pg_auth_members where roleid='app_bank_maintenance'::regrole or member='app_bank_maintenance'::regrole) then
    raise exception 'BANK_MAINTENANCE_ROLE_UNSAFE';
  end if;
end $$;
grant usage on schema app_bank to app_bank_maintenance;
create index bank_requests_pending_deadline_idx on app_bank.bank_connection_requests(least(expires_at,code_expires_at))
  where status in ('awaiting_callback','awaiting_completion','exchanging');

-- p_batch: 대상 종류별 최대1..500행(기본100). 잠긴 행은 기다리지 않고 다음 실행으로 넘긴다.
-- 만료 상태 전환/임시 코드 제거와 만료 quota 삭제만 수행한다. 연결/토큰/종료 이력은 보존한다.
create function app_bank.cleanup_requests(p_batch integer default 100)
returns table(expired_requests integer,removed_limits integer)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r record; scan_time timestamptz; at_time timestamptz;
begin
  if p_batch is null or p_batch<1 or p_batch>500 then raise exception 'BANK_CLEANUP_BATCH_INVALID'; end if;
  expired_requests := 0; removed_limits := 0;
  scan_time := clock_timestamp();
  for r in select id,expires_at,code_expires_at from app_bank.bank_connection_requests
    where status in ('awaiting_callback','awaiting_completion','exchanging')
      and least(expires_at,code_expires_at)<=scan_time
    order by least(expires_at,code_expires_at),id limit p_batch for update skip locked
  loop
    at_time := clock_timestamp();
    if r.expires_at<=at_time or r.code_expires_at<=at_time then
      update app_bank.bank_connection_requests set status='expired',encrypted_code=null,code_expires_at=null where id=r.id;
      expired_requests := expired_requests+1;
    end if;
  end loop;
  scan_time := clock_timestamp();
  for r in select scope,key_digest,expires_at from app_bank.bank_request_limits
    where expires_at<=scan_time order by expires_at,scope,key_digest limit p_batch for update skip locked
  loop
    if r.expires_at<=clock_timestamp() then
      delete from app_bank.bank_request_limits where scope=r.scope and key_digest=r.key_digest;
      removed_limits := removed_limits+1;
    end if;
  end loop;
  return next;
end $$;
revoke all on function app_bank.cleanup_requests(integer) from public;
grant create on schema app_bank to app_bank_flow;
alter function app_bank.cleanup_requests(integer) owner to app_bank_flow;
revoke create on schema app_bank from app_bank_flow;
grant execute on function app_bank.cleanup_requests(integer) to app_bank_maintenance;
commit;
