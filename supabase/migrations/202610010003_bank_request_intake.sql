-- A2.2: 승인된 migration 주체만 실행. 운영 적용·외부 은행 연결은 별도 절차다.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='app_bank_flow') then
    create role app_bank_flow nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if exists(select 1 from pg_roles where rolname='app_bank_flow' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls))
    or exists(select 1 from pg_auth_members where roleid='app_bank_flow'::regrole or member='app_bank_flow'::regrole) then
    raise exception 'BANK_FLOW_ROLE_UNSAFE';
  end if;
end $$;
grant usage on schema app_bank to app_bank_flow;
grant select,insert,update on app_bank.bank_connection_requests,app_bank.bank_connections,app_bank.bank_connection_credentials to app_bank_flow;
grant execute on function app_bank.valid_token_envelope(jsonb),app_bank.valid_base64url(text,integer,integer) to app_bank_flow;
-- 직접 로그인/membership은 없으며 아래 제한된 함수 안에서만 이 역할을 사용한다.
create policy bank_requests_flow on app_bank.bank_connection_requests to app_bank_flow using(true) with check(true);
create policy bank_connections_flow on app_bank.bank_connections to app_bank_flow using(true) with check(true);
create policy bank_credentials_flow on app_bank.bank_connection_credentials to app_bank_flow using(true) with check(true);

-- p_id: 새 UUID, p_session: 검증한 세션, p_environment: 서버 설정, 지문: API/BFF 난수의 SHA-256.
-- 같은 사용자·세션 시작을 직렬화하고 이전 대기를 취소한다. 교환 중이면 NULL로 충돌을 알린다.
create function app_bank.start_request(p_id uuid,p_session uuid,p_environment text,p_state bytea,p_proof bytea)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  uid uuid := nullif(current_setting('app.user_id',true),'')::uuid;
  previous app_bank.bank_connection_requests%rowtype;
  at_time timestamptz;
begin
  if uid is null or p_session is null then raise exception 'BANK_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bank-start:'||uid::text||':'||p_session::text,0));
  select * into previous from app_bank.bank_connection_requests
    where user_id=uid and session_id=p_session and status in ('awaiting_callback','awaiting_completion','exchanging') for update;
  at_time := clock_timestamp();
  if found then
    if previous.expires_at<=at_time or (previous.code_expires_at is not null and previous.code_expires_at<=at_time) then
      update app_bank.bank_connection_requests set status='expired',encrypted_code=null,code_expires_at=null where id=previous.id;
    elsif previous.status='exchanging' then return null;
    else
      update app_bank.bank_connection_requests set status='cancelled',encrypted_code=null,code_expires_at=null where id=previous.id;
    end if;
  end if;
  insert into app_bank.bank_connection_requests(id,user_id,session_id,provider,environment,channel,state_digest,proof_digest,status,created_at,expires_at)
    values(p_id,uid,p_session,'kftc',p_environment,'web',p_state,p_proof,'awaiting_callback',at_time,at_time+interval '300 seconds');
  return p_id;
end $$;
revoke all on function app_bank.start_request(uuid,uuid,text,bytea,bytea) from public;

-- p_state: Callback의 state 지문. API의 코드 암호화 AAD에 필요한 문맥만 돌려준다.
-- 승인/완료 권한은 주지 않으며 receive_callback에서 잠금·기한을 다시 확인한다.
create function app_bank.callback_context(p_state bytea)
returns table(id uuid,user_id uuid,environment text) language sql security definer set search_path=pg_catalog,pg_temp as $$
  select r.id,r.user_id,r.environment from app_bank.bank_connection_requests r
  where r.state_digest=p_state and r.status='awaiting_callback' and r.expires_at>clock_timestamp();
$$;
revoke all on function app_bank.callback_context(bytea) from public;

-- p_code: API가 요청 ID·사용자·환경에 결속한 암호화 봉투. p_denied: 공급자 거절 여부.
-- 한 Callback만 수락한다. 만료/중복은 NULL, 공급자 거절은 failed로 종료한다.
create function app_bank.receive_callback(p_state bytea,p_code jsonb,p_denied boolean)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r app_bank.bank_connection_requests%rowtype; at_time timestamptz;
begin
  if p_denied is null then raise exception 'BANK_CALLBACK_INVALID'; end if;
  select * into r from app_bank.bank_connection_requests where state_digest=p_state for update;
  if not found or r.status<>'awaiting_callback' then return null; end if;
  at_time := clock_timestamp();
  if r.expires_at<=at_time then
    update app_bank.bank_connection_requests set status='expired' where id=r.id;
    return null;
  end if;
  if p_denied then
    update app_bank.bank_connection_requests set status='failed' where id=r.id;
  else
    update app_bank.bank_connection_requests set status='awaiting_completion',encrypted_code=p_code,
      callback_received_at=at_time,code_expires_at=least(at_time+interval '60 seconds',expires_at) where id=r.id;
  end if;
  return r.id;
end $$;
revoke all on function app_bank.receive_callback(bytea,jsonb,boolean) from public;

-- 함수 owner 변경에 필요한 CREATE만 transaction 중 잠깐 주고 커밋 전에 회수한다.
grant create on schema app_bank to app_bank_flow;
alter function app_bank.start_request(uuid,uuid,text,bytea,bytea) owner to app_bank_flow;
alter function app_bank.callback_context(bytea) owner to app_bank_flow;
alter function app_bank.receive_callback(bytea,jsonb,boolean) owner to app_bank_flow;
revoke create on schema app_bank from app_bank_flow;
grant execute on function app_bank.start_request(uuid,uuid,text,bytea,bytea),app_bank.callback_context(bytea),app_bank.receive_callback(bytea,jsonb,boolean) to app_api;
commit;
