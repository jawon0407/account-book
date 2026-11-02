-- 서버 접수 근거만 저장한다. 전체 알림, 계좌번호, 금액/상대명 사본은 보관하지 않는다.
create table finance.notification_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  event_id uuid not null,
  transaction_id uuid not null,
  request_fingerprint bytea not null,
  source_app text not null,
  parser_version text not null,
  received_at timestamptz not null,
  time_needs_review boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,event_id),
  constraint notification_receipts_transaction_fk foreign key(transaction_id,user_id)
    references finance.transaction_history(id,user_id) on delete restrict,
  constraint notification_receipts_event_v4 check(event_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint notification_receipts_fingerprint check(octet_length(request_fingerprint)=32),
  constraint notification_receipts_parser check(source_app='com.kbstar.kbbank' and parser_version='kb-v1'),
  constraint notification_receipts_time check(isfinite(created_at) and isfinite(received_at)
    and received_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00'
    and received_at=date_trunc('milliseconds',received_at,'UTC'))
);
create index notification_receipts_transaction on finance.notification_receipts(transaction_id,user_id);
alter table finance.notification_receipts enable row level security;
alter table finance.notification_receipts force row level security;
revoke all on finance.notification_receipts from public,anon,authenticated,service_role,app_session_bff,app_api;
grant select on finance.notification_receipts to app_api;
grant insert(user_id,event_id,transaction_id,request_fingerprint,source_app,parser_version,received_at,time_needs_review)
  on finance.notification_receipts to app_api;
create policy notification_receipts_read on finance.notification_receipts for select to app_api
  using(user_id=nullif(current_setting('app.user_id',true),'')::uuid and "user".is_active_user());
create policy notification_receipts_add on finance.notification_receipts for insert to app_api
  with check(user_id=nullif(current_setting('app.user_id',true),'')::uuid and "user".is_active_user());
-- runtime UPDATE/DELETE 권한 없음. 원장 soft-delete 이후에도 동일 접수로 부활시키지 않는다.
-- 물리 삭제/재접수 방지 표식 수명은 후속 삭제 정책과 함께 적용한다. 이번 migration은 기존 행을 변경하지 않는다.
