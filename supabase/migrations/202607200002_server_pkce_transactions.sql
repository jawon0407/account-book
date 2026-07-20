alter table app_private.oauth_transactions
  drop constraint if exists oauth_transactions_return_path_check;

alter table app_private.oauth_transactions
  drop constraint if exists oauth_transactions_return_path;

alter table app_private.oauth_transactions
  add constraint oauth_transactions_return_path
  check (return_path in ('/app', '/settings/security'));

alter table app_private.auth_recovery_transactions
  add column encrypted_pkce_verifier jsonb,
  add column exchange_claimed_at timestamptz,
  add column exchanged_at timestamptz,
  add column password_update_claimed_at timestamptz;

update app_private.auth_recovery_transactions
set
  exchange_claimed_at = created_at,
  exchanged_at = created_at,
  password_update_claimed_at = case when consumed_at is null then null else consumed_at end;

alter table app_private.auth_recovery_transactions
  alter column user_id drop not null,
  alter column encrypted_recovery_token drop not null;

alter table app_private.auth_recovery_transactions
  add constraint auth_recovery_transactions_stage check (
    (
      encrypted_pkce_verifier is not null
      and user_id is null
      and encrypted_recovery_token is null
      and exchanged_at is null
      and password_update_claimed_at is null
      and consumed_at is null
    )
    or
    (
      encrypted_pkce_verifier is null
      and user_id is not null
      and encrypted_recovery_token is not null
      and exchange_claimed_at is not null
      and exchanged_at is not null
      and (
        (password_update_claimed_at is null and consumed_at is null)
        or password_update_claimed_at is not null
      )
    )
  ),
  add constraint auth_recovery_transactions_stage_order check (
    (exchange_claimed_at is null or exchange_claimed_at >= created_at)
    and (exchanged_at is null or exchanged_at >= exchange_claimed_at)
    and (password_update_claimed_at is null or password_update_claimed_at >= exchanged_at)
    and (consumed_at is null or (password_update_claimed_at is not null and consumed_at >= password_update_claimed_at))
  );

create table app_private.email_confirmation_transactions (
  id uuid primary key,
  interaction_hash bytea not null unique check (octet_length(interaction_hash) = 32),
  encrypted_pkce_verifier jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

revoke all privileges on table app_private.email_confirmation_transactions from public, anon, authenticated, service_role, app_session_bff;
grant select, insert, update, delete on table app_private.email_confirmation_transactions to app_session_bff;
