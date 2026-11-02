-- 기존 객체를 재생성하지 않는다. 호출자는 전체 파일을 한 transaction으로 실행한다.
-- RLS·GRANT·FK·인덱스는 OID에 연결되어 유지된다. 함수 문자열 본문은 아래에서 갱신한다.
do $$ begin
  if to_regnamespace('user') is not null or to_regnamespace('finance') is not null
    or to_regnamespace('app_identity') is null or to_regnamespace('app_ledger') is null then
    raise exception 'SCHEMA_RENAME_STATE_INVALID';
  end if;
end $$;
-- 가입 트리거가 rename 중에 옛 테이블을 찾지 않도록 가입 쓰기도 잠근다.
lock table auth.users in share row exclusive mode;
alter schema app_identity rename to "user";
alter schema app_ledger rename to finance;
alter table "user".profiles rename to users;
alter table "user".user_roles rename to roles;
alter table "user".role_change_events rename to role_history;
alter table finance.categories rename to transaction_categories;
alter table finance.transactions rename to transaction_history;
alter table finance.transfers rename to account_transfers;
alter table finance.idempotency_requests rename to request_deduplication;

-- 매개변수 없는 활성 회원 검사와 trigger의 NEW/OLD/TG_OP 계약은 그대로 유지한다.
-- CREATE OR REPLACE는 함수 OID·owner·기존 EXECUTE 제한을 보존한다.
create or replace function "user".is_active_user() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from "user".users
    where user_id=nullif(current_setting('app.user_id',true),'')::uuid and deleted_at is null)
$$;

create or replace function "user".guard_profile_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at
    or (old.signup_provider<>'unknown' and new.signup_provider is distinct from old.signup_provider)
    or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at) then
    raise exception 'PROFILE_IMMUTABLE_FIELD' using errcode='23514';
  end if;
  new.version := old.version+1;
  new.updated_at := greatest(clock_timestamp(),old.updated_at);
  return new;
end $$;

create or replace function "user".guard_role_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
    raise exception 'ROLE_IMMUTABLE_FIELD' using errcode='23514';
  end if;
  new.updated_at := greatest(clock_timestamp(),old.updated_at);
  return new;
end $$;

create or replace function "user".audit_role_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' and new.role is not distinct from old.role then return null; end if;
  insert into "user".role_history(target_user_id,previous_role,new_role,db_actor,reason)
    values(case when TG_OP='DELETE' then old.user_id else new.user_id end,
      case when TG_OP='INSERT' then null else old.role end,
      case when TG_OP='DELETE' then null else new.role end,session_user,
      case when TG_OP='INSERT' then 'bootstrap' when TG_OP='DELETE' then 'role_revoke' else 'role_change' end);
  return null;
end $$;

create or replace function "user".bootstrap_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into "user".users(user_id,signup_provider) values(new.id,
    case new.raw_app_meta_data->>'provider' when 'email' then 'email' when 'google' then 'google'
      when 'kakao' then 'kakao' when 'custom:naver' then 'naver' else 'unknown' end)
    on conflict(user_id) do nothing;
  insert into "user".roles(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end $$;

create or replace function finance.guard_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
    raise exception 'LEDGER_IMMUTABLE_FIELD' using errcode='23514';
  end if;
  if TG_TABLE_NAME='transaction_history' then
    if old.kind not in ('income','expense') or new.kind not in ('income','expense') or old.deleted_at is not null then
      raise exception 'TRANSACTION_IMMUTABLE_KIND' using errcode='23514';
    end if;
  elsif new.kind is distinct from old.kind then
    raise exception 'LEDGER_IMMUTABLE_KIND' using errcode='23514';
  end if;
  new.version := old.version+1;
  new.updated_at := greatest(clock_timestamp(),old.updated_at);
  return new;
end $$;

create or replace function finance.guard_transaction_reference() returns trigger
language plpgsql set search_path='' as $$
declare archived timestamptz;
begin
  if TG_OP='INSERT' or new.account_id is distinct from old.account_id then
    select archived_at into archived from finance.accounts where id=new.account_id and user_id=new.user_id for update;
    if not found then raise exception 'ACCOUNT_REFERENCE_INVALID' using errcode='23503'; end if;
    if archived is not null then raise exception 'ACCOUNT_ARCHIVED' using errcode='23514'; end if;
  end if;
  if new.category_id is not null and (TG_OP='INSERT' or new.category_id is distinct from old.category_id or new.kind is distinct from old.kind) then
    select archived_at into archived from finance.transaction_categories where id=new.category_id and user_id=new.user_id and kind=new.kind for update;
    if not found then raise exception 'CATEGORY_REFERENCE_INVALID' using errcode='23503'; end if;
    if archived is not null then raise exception 'CATEGORY_ARCHIVED' using errcode='23514'; end if;
  end if;
  if new.transfer_id is not null then
    -- header는 런타임에서 불변이며 FK/commit 제약이 결속을 보장한다. 불필요한 UPDATE 권한을 요구하지 않는다.
    perform 1 from finance.account_transfers where id=new.transfer_id and user_id=new.user_id;
    if not found then raise exception 'TRANSFER_REFERENCE_INVALID' using errcode='23503'; end if;
  end if;
  return new;
end $$;

create or replace function finance.guard_transfer() returns trigger
language plpgsql set search_path='' as $$
declare account record; matched integer:=0;
begin
  if TG_OP='UPDATE' then raise exception 'TRANSFER_IMMUTABLE' using errcode='23514'; end if;
  for account in select id,archived_at from finance.accounts
    where id in (new.from_account_id,new.to_account_id) and user_id=new.user_id order by id for update loop
    matched := matched+1;
    if account.archived_at is not null then raise exception 'ACCOUNT_ARCHIVED' using errcode='23514'; end if;
  end loop;
  if new.from_account_id=new.to_account_id then raise exception 'TRANSFER_SAME_ACCOUNT' using errcode='23514'; end if;
  if matched<>2 then raise exception 'TRANSFER_ACCOUNTS_INVALID' using errcode='23503'; end if;
  return new;
end $$;

create or replace function finance.validate_transfer_pair() returns trigger
language plpgsql security definer set search_path='' as $$
declare transfer_key uuid; header finance.account_transfers%rowtype; total integer; debits integer; credits integer;
begin
  if TG_TABLE_NAME='account_transfers' then
    transfer_key := case when TG_OP='DELETE' then old.id else new.id end;
  else
    transfer_key := case when TG_OP='DELETE' then old.transfer_id else new.transfer_id end;
  end if;
  if transfer_key is null then return null; end if;
  select * into header from finance.account_transfers where id=transfer_key;
  if not found then return null; end if;
  select count(*),
    count(*) filter(where t.kind='transfer_out' and t.account_id=header.from_account_id
      and t.user_id=header.user_id and t.amount_krw=header.amount_krw and t.occurred_on=header.occurred_on and t.memo is not distinct from header.memo and t.deleted_at is null),
    count(*) filter(where t.kind='transfer_in' and t.account_id=header.to_account_id
      and t.user_id=header.user_id and t.amount_krw=header.amount_krw and t.occurred_on=header.occurred_on and t.memo is not distinct from header.memo and t.deleted_at is null)
    into total,debits,credits from finance.transaction_history t where t.transfer_id=transfer_key;
  if total<>2 or debits<>1 or credits<>1 then raise exception 'TRANSFER_PAIR_INVALID' using errcode='23514'; end if;
  return null;
end $$;
