do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

alter role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

create table app_private.api_jwt_replays (
  jti_digest bytea primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint api_jwt_replays_digest_length check (octet_length(jti_digest) = 32),
  constraint api_jwt_replays_expiry check (expires_at > created_at)
);

-- Revoke ambient and historical grants before adding the single runtime capability.
revoke all privileges on schema app_private from app_api;
revoke all privileges on all tables in schema app_private from app_api;
alter default privileges for role postgres in schema app_private revoke all privileges on tables from app_api;
revoke all privileges on table app_private.api_jwt_replays from public, anon, authenticated, service_role, app_session_bff, app_api;

grant usage on schema app_private to app_api;
grant insert on table app_private.api_jwt_replays to app_api;

do $$
declare
  existing_job bigint;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    for existing_job in
      select jobid
      from cron.job
      where jobname = 'account-book-api-jwt-replay-cleanup'
    loop
      perform cron.unschedule(existing_job);
    end loop;
    perform cron.schedule(
      'account-book-api-jwt-replay-cleanup',
      '* * * * *',
      'delete from app_private.api_jwt_replays where expires_at <= now()'
    );
  end if;
end
$$;
