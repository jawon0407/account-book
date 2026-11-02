-- 일반 입출금은 알림 수집 당시 참조가 없어도 저장한다. 기존 값은 추정/변환하지 않는다.
-- migration runner가 파일 전체를 단일 transaction으로 적용해야 한다.
alter table finance.transaction_history add column counterparty_name text;
alter table finance.transaction_history alter column account_id drop not null;
alter table finance.transaction_history drop constraint transactions_shape;
alter table finance.transaction_history add constraint transactions_shape check (
  (kind in ('income','expense') and transfer_id is null and opening_direction is null)
  or (kind in ('transfer_out','transfer_in') and account_id is not null and category_id is null
    and transfer_id is not null and opening_direction is null and deleted_at is null)
  or (kind='opening_balance' and account_id is not null and category_id is null and transfer_id is null
    and opening_direction is not null and opening_direction in ('asset','liability'))
);
-- API는 trim 후 UTF-16 길이 200까지 허용한다. DB는 유니코드 문자 수 기준으로 방어한다.
alter table finance.transaction_history add constraint transactions_counterparty_name check (
  counterparty_name is null or (length(btrim(counterparty_name)) between 1 and 200
    and counterparty_name=btrim(counterparty_name))
);

-- CREATE OR REPLACE로 함수 owner/ACL을 보존한다. NULL만 건너뛰고 타인/보관 참조 검사는 유지한다.
create or replace function finance.guard_transaction_reference() returns trigger
language plpgsql set search_path='' as $$
declare archived timestamptz;
begin
  if new.account_id is not null and (TG_OP='INSERT' or new.account_id is distinct from old.account_id) then
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
    perform 1 from finance.account_transfers where id=new.transfer_id and user_id=new.user_id;
    if not found then raise exception 'TRANSFER_REFERENCE_INVALID' using errcode='23503'; end if;
  end if;
  return new;
end $$;

-- SELECT는 기존 table 권한을 따른다. 쓰기는 새 열만 추가 허용하고 BFF/public 권한은 늘리지 않는다.
grant insert(counterparty_name), update(counterparty_name) on finance.transaction_history to app_api;
