begin;
-- p_id/p_session/p_proof: 본인 요청의 결속값. p_action: cancel/fail/expire 중 서버가 선택한 명령.
-- 교환 중 취소를 거부하고 종료 상태는 불변이다. 결과 불명확은 fail로 닫으며 코드를 재발급하지 않는다.
create function app_bank.end_request(p_id uuid,p_session uuid,p_proof bytea,p_action text)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r app_bank.bank_connection_requests%rowtype; at_time timestamptz; next_status text;
begin
  if p_action is null or p_action not in ('cancel','fail','expire') then raise exception 'BANK_END_ACTION_INVALID'; end if;
  select * into r from app_bank.bank_connection_requests
    where id=p_id and user_id=nullif(current_setting('app.user_id',true),'')::uuid for update;
  if not found or r.session_id is distinct from p_session or r.proof_digest is distinct from p_proof then return null; end if;
  if r.status not in ('awaiting_callback','awaiting_completion','exchanging') then return r.status; end if;
  at_time := clock_timestamp();
  if r.expires_at<=at_time or (r.code_expires_at is not null and r.code_expires_at<=at_time) then next_status := 'expired';
  elsif p_action='cancel' and r.status<>'exchanging' then next_status := 'cancelled';
  elsif p_action='fail' and r.status='exchanging' then next_status := 'failed';
  else return r.status;
  end if;
  update app_bank.bank_connection_requests set status=next_status,encrypted_code=null,code_expires_at=null where id=r.id;
  return next_status;
end $$;
revoke all on function app_bank.end_request(uuid,uuid,bytea,text) from public;
grant create on schema app_bank to app_bank_flow;
alter function app_bank.end_request(uuid,uuid,bytea,text) owner to app_bank_flow;
revoke create on schema app_bank from app_bank_flow;
grant execute on function app_bank.end_request(uuid,uuid,bytea,text) to app_api;
commit;
