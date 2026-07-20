do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_session_bff') then
    create role app_session_bff nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

alter role app_session_bff nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

create schema if not exists app_private;
revoke all privileges on schema app_private from public, anon, authenticated, service_role, app_session_bff;

create table app_private.auth_sessions (
  id uuid primary key,
  selector_hash bytea not null unique check (octet_length(selector_hash) = 32),
  user_id uuid not null,
  supabase_session_id uuid not null,
  encrypted_access_token jsonb not null,
  encrypted_refresh_token jsonb not null,
  access_token_expires_at timestamptz not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_pending_at timestamptz,
  rotation_version integer not null default 0 check (rotation_version >= 0),
  check (absolute_expires_at > created_at)
);

create unique index auth_sessions_provider_session_unique
  on app_private.auth_sessions (supabase_session_id)
  where revoked_at is null;

create table app_private.oauth_transactions (
  id uuid primary key,
  state_hash bytea not null unique check (octet_length(state_hash) = 32),
  interaction_hash bytea not null unique check (octet_length(interaction_hash) = 32),
  provider text not null check (provider in ('google', 'kakao', 'naver')),
  encrypted_pkce_verifier jsonb not null,
  return_path text not null check (
    char_length(return_path) between 1 and 2048
    and return_path like '/%'
    and return_path not like '//%'
    and position(chr(92) in return_path) = 0
  ),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create table app_private.auth_recovery_transactions (
  id uuid primary key,
  interaction_hash bytea not null unique check (octet_length(interaction_hash) = 32),
  user_id uuid not null,
  encrypted_recovery_token jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create table app_private.auth_rate_limits (
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  kind text not null check (kind in ('sign_in', 'sign_up', 'password_reset', 'oauth_start')),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  count integer not null check (count >= 0),
  blocked_until timestamptz,
  primary key (fingerprint, kind, window_started_at)
);

revoke all privileges on all tables in schema app_private from public, anon, authenticated, service_role, app_session_bff;

-- Supabase migrations execute as the postgres owner, which owns app_private tables.
alter default privileges for role postgres in schema app_private revoke all privileges on tables from public, anon, authenticated, service_role, app_session_bff;

grant usage on schema app_private to app_session_bff;
grant select, insert, update, delete on table
  app_private.auth_sessions,
  app_private.oauth_transactions,
  app_private.auth_recovery_transactions,
  app_private.auth_rate_limits
to app_session_bff;
