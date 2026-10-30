-- OLD/NEW 행의 고정 식별자·종류를 보호하고 DB가 version/updated_at을 계산한다.
create function app_ledger.guard_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
    raise exception 'LEDGER_IMMUTABLE_FIELD' using errcode='23514';
  end if;
  if TG_TABLE_NAME='transactions' then
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
revoke all on function app_ledger.guard_update() from public,anon,authenticated,service_role,app_session_bff,app_api;
create trigger accounts_update before update on app_ledger.accounts for each row execute function app_ledger.guard_update();
create trigger categories_update before update on app_ledger.categories for each row execute function app_ledger.guard_update();
create trigger transactions_update before update on app_ledger.transactions for each row execute function app_ledger.guard_update();

-- 참조 행의 잠금을 가진 동안 활성 여부를 검사한다. 신규 참조가 아니면 과거 archive 연결을 유지한다.
-- 매개변수는 trigger NEW/OLD. 반환 NEW; 잘못된 참조는 FK와 같은 SQLSTATE로 구분한다.
create function app_ledger.guard_transaction_reference() returns trigger
language plpgsql set search_path='' as $$
declare archived timestamptz;
begin
  if TG_OP='INSERT' or new.account_id is distinct from old.account_id then
    select archived_at into archived from app_ledger.accounts where id=new.account_id and user_id=new.user_id for update;
    if not found then raise exception 'ACCOUNT_REFERENCE_INVALID' using errcode='23503'; end if;
    if archived is not null then raise exception 'ACCOUNT_ARCHIVED' using errcode='23514'; end if;
  end if;
  if new.category_id is not null and (TG_OP='INSERT' or new.category_id is distinct from old.category_id or new.kind is distinct from old.kind) then
    select archived_at into archived from app_ledger.categories where id=new.category_id and user_id=new.user_id and kind=new.kind for update;
    if not found then raise exception 'CATEGORY_REFERENCE_INVALID' using errcode='23503'; end if;
    if archived is not null then raise exception 'CATEGORY_ARCHIVED' using errcode='23514'; end if;
  end if;
  if new.transfer_id is not null then
    -- header는 런타임에서 불변이며 FK/commit 제약이 결속을 보장한다. 불필요한 UPDATE 권한을 요구하지 않는다.
    perform 1 from app_ledger.transfers where id=new.transfer_id and user_id=new.user_id;
    if not found then raise exception 'TRANSFER_REFERENCE_INVALID' using errcode='23503'; end if;
  end if;
  return new;
end $$;
revoke all on function app_ledger.guard_transaction_reference() from public,anon,authenticated,service_role,app_session_bff,app_api;
create trigger transactions_reference before insert or update on app_ledger.transactions for each row execute function app_ledger.guard_transaction_reference();

-- 한 이체의 두 계좌는 UUID 순서대로 잠근다. 반대 방향 동시 이체의 교착 위험을 줄인다.
create function app_ledger.guard_transfer() returns trigger
language plpgsql set search_path='' as $$
declare account record; matched integer:=0;
begin
  if TG_OP='UPDATE' then raise exception 'TRANSFER_IMMUTABLE' using errcode='23514'; end if;
  for account in select id,archived_at from app_ledger.accounts
    where id in (new.from_account_id,new.to_account_id) and user_id=new.user_id order by id for update loop
    matched := matched+1;
    if account.archived_at is not null then raise exception 'ACCOUNT_ARCHIVED' using errcode='23514'; end if;
  end loop;
  if new.from_account_id=new.to_account_id then raise exception 'TRANSFER_SAME_ACCOUNT' using errcode='23514'; end if;
  if matched<>2 then raise exception 'TRANSFER_ACCOUNTS_INVALID' using errcode='23503'; end if;
  return new;
end $$;
revoke all on function app_ledger.guard_transfer() from public,anon,authenticated,service_role,app_session_bff,app_api;
create trigger transfers_guard before insert or update on app_ledger.transfers for each row execute function app_ledger.guard_transfer();

-- COMMIT에서 이체 header와 정확히 2개 원장 행의 소유자·방향·금액·날짜·메모를 비교한다.
-- 보안 정의자 함수는 고정 테이블만 읽고 직접 실행 권한을 주지 않는다. 물리 정리 후 header가 없으면 FK가 orphan을 검증한다.
create function app_ledger.validate_transfer_pair() returns trigger
language plpgsql security definer set search_path='' as $$
declare transfer_key uuid; header app_ledger.transfers%rowtype; total integer; debits integer; credits integer;
begin
  if TG_TABLE_NAME='transfers' then
    transfer_key := case when TG_OP='DELETE' then old.id else new.id end;
  else
    transfer_key := case when TG_OP='DELETE' then old.transfer_id else new.transfer_id end;
  end if;
  if transfer_key is null then return null; end if;
  select * into header from app_ledger.transfers where id=transfer_key;
  if not found then return null; end if;
  select count(*),
    count(*) filter(where t.kind='transfer_out' and t.account_id=header.from_account_id
      and t.user_id=header.user_id and t.amount_krw=header.amount_krw and t.occurred_on=header.occurred_on and t.memo is not distinct from header.memo and t.deleted_at is null),
    count(*) filter(where t.kind='transfer_in' and t.account_id=header.to_account_id
      and t.user_id=header.user_id and t.amount_krw=header.amount_krw and t.occurred_on=header.occurred_on and t.memo is not distinct from header.memo and t.deleted_at is null)
    into total,debits,credits from app_ledger.transactions t where t.transfer_id=transfer_key;
  if total<>2 or debits<>1 or credits<>1 then raise exception 'TRANSFER_PAIR_INVALID' using errcode='23514'; end if;
  return null;
end $$;
revoke all on function app_ledger.validate_transfer_pair() from public,anon,authenticated,service_role,app_session_bff,app_api;
create constraint trigger transfers_pair after insert or update or delete on app_ledger.transfers
  deferrable initially deferred for each row execute function app_ledger.validate_transfer_pair();
create constraint trigger transactions_pair after insert or update or delete on app_ledger.transactions
  deferrable initially deferred for each row execute function app_ledger.validate_transfer_pair();
