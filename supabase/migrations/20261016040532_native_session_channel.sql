-- Add before deploying BFF code that selects these columns. Existing sessions remain web.
-- This installation identifier is not proof of a physical device or a collector lease.
begin;

alter table app_private.auth_sessions
  add column client_channel text not null default 'web',
  add column device_id uuid,
  add constraint auth_sessions_client_context check (
    (client_channel = 'web' and device_id is null)
    or (client_channel = 'android' and device_id is not null)
  );

comment on column app_private.auth_sessions.client_channel is
  'Server-selected session boundary. A client-supplied mobile header cannot promote a web session.';
comment on column app_private.auth_sessions.device_id is
  'Random Android installation UUID; not a hardware identifier, ownership proof, or collection permission.';

-- Existing private-table ACLs remain unchanged: BFF only, no Data API grants.
commit;
