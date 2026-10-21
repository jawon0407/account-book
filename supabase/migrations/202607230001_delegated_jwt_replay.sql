do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api' and (rolsuper or rolreplication or rolbypassrls)) then
    raise exception 'UNSAFE_APP_API_ROLE';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

-- 위험 속성은 위에서 거부한다. Hosted postgres로 SUPERUSER 속성을 다시 쓰지 않는다.
alter role app_api login nocreatedb nocreaterole noinherit;

do $$
declare
  parent_role name;
begin
  for parent_role in
    select parent_roles.rolname
    from pg_auth_members memberships
    join pg_roles parent_roles on parent_roles.oid = memberships.roleid
    join pg_roles member_roles on member_roles.oid = memberships.member
    where member_roles.rolname = 'app_api'
  loop
    execute format('revoke %I from app_api', parent_role);
  end loop;
end
$$;

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
