begin;
-- p_id/p_session/p_proof: API principal과 BFF 확인 쿠키로부터 검증한 요청 결속값.
-- 임시 암호문은 한 번 반환하면서 삭제한다. 호출 commit 확인 전 공급자에 보내지 않는다.
create function app_bank.claim_exchange(p_id uuid,p_session uuid,p_proof bytea)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r app_bank.bank_connection_requests%rowtype; at_time timestamptz; code jsonb;
begin
  select * into r from app_bank.bank_connection_requests
    where id=p_id and user_id=nullif(current_setting('app.user_id',true),'')::uuid for update;
  if not found or r.session_id is distinct from p_session or r.proof_digest is distinct from p_proof then return null; end if;
  if r.status<>'awaiting_completion' then return null; end if;
  at_time := clock_timestamp();
  if r.expires_at<=at_time or r.code_expires_at<=at_time then
    update app_bank.bank_connection_requests set status='expired',encrypted_code=null,code_expires_at=null where id=r.id;
    return null;
  end if;
  code := r.encrypted_code;
  update app_bank.bank_connection_requests set status='exchanging',encrypted_code=null,code_expires_at=null where id=r.id;
  return code;
end $$;
revoke all on function app_bank.claim_exchange(uuid,uuid,bytea) from public;

-- p_connection: 새 연결 UUID, p_subject/p_access/p_refresh: API가 새 연결 AAD로 암호화한 봉투.
-- *_expires: 검증한 공급자 수명. refresh/consent는 NULL 가능. 기존 연결을 덮어쓰지 않는다.
-- 연결·자격정보·요청 상태를 원자 저장한다. 실패 시 호출 transaction 전체를 rollback한다.
create function app_bank.finish_exchange(p_id uuid,p_session uuid,p_proof bytea,p_connection uuid,
  p_subject jsonb,p_access jsonb,p_refresh jsonb,p_access_expires timestamptz,p_refresh_expires timestamptz,p_consent_expires timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r app_bank.bank_connection_requests%rowtype; at_time timestamptz;
begin
  select * into r from app_bank.bank_connection_requests
    where id=p_id and user_id=nullif(current_setting('app.user_id',true),'')::uuid for update;
  if not found or r.session_id is distinct from p_session or r.proof_digest is distinct from p_proof or r.status<>'exchanging' then return false; end if;
  at_time := clock_timestamp();
  if r.expires_at<=at_time then
    update app_bank.bank_connection_requests set status='expired' where id=r.id;
    return false;
  end if;
  if p_consent_expires is not null and (not isfinite(p_consent_expires) or p_consent_expires<=at_time) then
    raise exception 'BANK_CONSENT_EXPIRED';
  end if;
  insert into app_bank.bank_connections(id,user_id,provider,environment,status,created_at,updated_at,consent_expires_at)
    values(p_connection,r.user_id,r.provider,r.environment,'active',at_time,at_time,p_consent_expires);
  insert into app_bank.bank_connection_credentials(connection_id,user_id,provider,environment,
    encrypted_provider_subject,encrypted_access_token,encrypted_refresh_token,access_expires_at,refresh_expires_at,created_at,updated_at)
    values(p_connection,r.user_id,r.provider,r.environment,p_subject,p_access,p_refresh,p_access_expires,p_refresh_expires,at_time,at_time);
  update app_bank.bank_connection_requests set status='connected',connection_id=p_connection where id=r.id;
  return true;
end $$;
revoke all on function app_bank.finish_exchange(uuid,uuid,bytea,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz) from public;
grant create on schema app_bank to app_bank_flow;
alter function app_bank.claim_exchange(uuid,uuid,bytea) owner to app_bank_flow;
alter function app_bank.finish_exchange(uuid,uuid,bytea,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz) owner to app_bank_flow;
revoke create on schema app_bank from app_bank_flow;
grant execute on function app_bank.claim_exchange(uuid,uuid,bytea),app_bank.finish_exchange(uuid,uuid,bytea,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz) to app_api;
commit;
