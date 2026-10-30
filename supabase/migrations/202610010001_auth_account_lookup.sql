-- 이메일 존재 여부 공개는 2026-10-01 사용자 승인 정책이다.
-- BFF에 auth.users SELECT를 주지 않고, 단일 이메일의 존재/제한 상태만 반환한다.
-- p_email: 검증된 이메일; p_kind: 가입/복구; 나머지는 서버 HMAC 32바이트 지문이다.
create function app_private.check_email_account(
  p_email text, p_kind text, p_email_fingerprint bytea, p_browser_fingerprint bytea
) returns text
language plpgsql security definer set search_path='' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp())/600)*600);
  v_fingerprint bytea;
  v_count integer;
  v_index integer := 0;
  v_limit integer;
begin
  if p_email is null or length(p_email) not between 3 and 254 or p_email<>btrim(p_email)
    or position('@' in p_email)<2 or p_kind is null or p_kind not in ('sign_up','password_reset')
    or p_email_fingerprint is null or octet_length(p_email_fingerprint)<>32
    or p_browser_fingerprint is null or octet_length(p_browser_fingerprint)<>32 then
    raise exception 'AUTH_ACCOUNT_LOOKUP_INPUT_INVALID' using errcode='22023';
  end if;
  -- 전역→이메일→브라우저의 동일 잠금 순서로 동시 요청을 합산한다.
  -- 제한 상태도 반환하므로 counter가 rollback되어 제한이 풀리는 오류를 피한다.
  foreach v_fingerprint in array array[decode(repeat('00',32),'hex'),p_email_fingerprint,p_browser_fingerprint] loop
    v_index := v_index+1;
    v_limit := case v_index when 1 then 120 when 2 then 5 else 20 end;
    insert into app_private.auth_rate_limits(fingerprint,kind,window_started_at,window_seconds,count)
      values(v_fingerprint,p_kind,v_window,600,1)
    on conflict(fingerprint,kind,window_started_at) do update
      set count=least(app_private.auth_rate_limits.count+1,v_limit+1)
    returning count into v_count;
    if v_count>v_limit then return 'rate_limited'; end if;
  end loop;
  if exists(select 1 from auth.users where lower(email)=lower(p_email)) then return 'present'; end if;
  return 'absent';
end $$;

revoke all on function app_private.check_email_account(text,text,bytea,bytea)
  from public,anon,authenticated,service_role,app_api,app_session_bff;
grant execute on function app_private.check_email_account(text,text,bytea,bytea) to app_session_bff;
comment on function app_private.check_email_account(text,text,bytea,bytea)
  is 'BFF-only account presence. Owner-approved enumeration exception; 10-minute global/email/browser budgets.';
