-- A2.1 저장 구조만 만든다. 실행 주체는 승인된 migration owner이며 앱 시작 시 실행하지 않는다.
begin;
create schema app_bank;
revoke all privileges on schema app_bank from public, anon, authenticated, service_role, app_session_bff, app_api;

-- value: base64url 문자열, minimum/maximum: 허용 바이트 길이.
-- 표준 인코딩으로 왕복 가능한지 확인하고 NULL/잘못된 형식은 false로 닫는다.
create function app_bank.valid_base64url(value text, minimum integer, maximum integer)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare decoded bytea;
begin
  if value is null or length(value) > 87382 or value !~ '^[A-Za-z0-9_-]+$' then return false; end if;
  decoded := decode(translate(value, '-_', '+/') || repeat('=', (4-length(value)%4)%4), 'base64');
  return octet_length(decoded) between minimum and maximum
    and translate(replace(rtrim(encode(decoded, 'base64'), '='), chr(10), ''), '+/', '-_') = value;
exception when others then return false;
end $$;
revoke all privileges on function app_bank.valid_base64url(text,integer,integer) from public;

-- envelope: API의 AES-GCM 봉투 JSON. 형식만 검사하며 키/태그/AAD 인증은 API가 담당한다.
create function app_bank.valid_token_envelope(envelope jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare field text;
begin
  if jsonb_typeof(envelope) is distinct from 'object' or length(envelope::text) > 90000 then return false; end if;
  if (select count(*) from jsonb_object_keys(envelope)) <> 5 or envelope->'version' is distinct from '1'::jsonb then return false; end if;
  foreach field in array array['kid','nonce','ciphertext','tag'] loop
    if jsonb_typeof(envelope->field) is distinct from 'string' then return false; end if;
  end loop;
  return coalesce((envelope->>'kid') ~ '^[A-Za-z0-9._-]{1,128}$'
    and app_bank.valid_base64url(envelope->>'nonce',12,12)
    and app_bank.valid_base64url(envelope->>'ciphertext',1,65536)
    and app_bank.valid_base64url(envelope->>'tag',16,16), false);
exception when others then return false;
end $$;
revoke all privileges on function app_bank.valid_token_envelope(jsonb) from public;

create table app_bank.bank_connections (
  id uuid primary key,
  user_id uuid not null,
  provider text not null,
  environment text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consent_expires_at timestamptz,
  constraint bank_connections_binding unique(id,user_id,provider,environment),
  constraint bank_connections_provider check(provider='kftc'),
  constraint bank_connections_environment check(environment in ('fake','test','live')),
  constraint bank_connections_status check(status in ('active','revoked','reauth_required')),
  constraint bank_connections_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at and (consent_expires_at is null or isfinite(consent_expires_at)))
);

create table app_bank.bank_connection_requests (
  id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  provider text not null,
  environment text not null,
  channel text not null,
  state_digest bytea not null unique,
  proof_digest bytea not null unique,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  callback_received_at timestamptz,
  code_expires_at timestamptz,
  encrypted_code jsonb,
  connection_id uuid,
  constraint bank_requests_provider check(provider='kftc'),
  constraint bank_requests_environment check(environment in ('fake','test','live')),
  constraint bank_requests_channel check(channel='web'),
  constraint bank_requests_digests check(octet_length(state_digest)=32 and octet_length(proof_digest)=32),
  constraint bank_requests_status check(status in ('awaiting_callback','awaiting_completion','exchanging','connected','cancelled','expired','failed')),
  constraint bank_requests_ttl check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '300 seconds'),
  constraint bank_requests_callback check(
    (callback_received_at is null or (isfinite(callback_received_at) and callback_received_at>=created_at and callback_received_at<expires_at))
    and (status<>'awaiting_callback' or callback_received_at is null)
    and (status not in ('awaiting_completion','exchanging','connected') or callback_received_at is not null)),
  constraint bank_requests_code check(
    (status='awaiting_completion' and encrypted_code is not null and app_bank.valid_token_envelope(encrypted_code)
      and code_expires_at is not null and isfinite(code_expires_at) and callback_received_at is not null
      and code_expires_at>callback_received_at and code_expires_at<=callback_received_at+interval '60 seconds' and code_expires_at<=expires_at)
    or (status<>'awaiting_completion' and encrypted_code is null and code_expires_at is null)),
  constraint bank_requests_result check((status='connected')=(connection_id is not null)),
  constraint bank_requests_connection_fk foreign key(connection_id,user_id,provider,environment)
    references app_bank.bank_connections(id,user_id,provider,environment)
);
-- NULL인 종료 시각을 계산하는 대신 실제 미완료 상태에만 유일성을 적용한다.
create unique index bank_requests_one_pending_session on app_bank.bank_connection_requests(user_id,session_id)
  where status in ('awaiting_callback','awaiting_completion','exchanging');

create table app_bank.bank_connection_credentials (
  connection_id uuid primary key,
  user_id uuid not null,
  provider text not null,
  environment text not null,
  encrypted_provider_subject jsonb not null,
  encrypted_access_token jsonb not null,
  encrypted_refresh_token jsonb,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_credentials_provider check(provider='kftc'),
  constraint bank_credentials_environment check(environment in ('fake','test','live')),
  constraint bank_credentials_envelopes check(app_bank.valid_token_envelope(encrypted_provider_subject) and app_bank.valid_token_envelope(encrypted_access_token) and (encrypted_refresh_token is null or app_bank.valid_token_envelope(encrypted_refresh_token))),
  constraint bank_credentials_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at and isfinite(access_expires_at) and access_expires_at>created_at
    and (refresh_expires_at is null or (isfinite(refresh_expires_at) and refresh_expires_at>created_at and encrypted_refresh_token is not null))),
  constraint bank_credentials_connection_fk foreign key(connection_id,user_id,provider,environment)
    references app_bank.bank_connections(id,user_id,provider,environment)
);
revoke all privileges on all tables in schema app_bank from public, anon, authenticated, service_role, app_session_bff, app_api;
commit;
