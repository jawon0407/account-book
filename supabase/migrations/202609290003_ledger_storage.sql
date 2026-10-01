-- 금융 원장 저장 구조. 서버가 UUID를 생성하고 KRW 정수만 저장한다. 잔액은 거래 합계로 계산한다.
create schema app_ledger;
revoke all on schema app_ledger from public,anon,authenticated,service_role,app_session_bff,app_api;
create table app_ledger.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null,
  name text not null,
  currency text not null default 'KRW',
  version bigint not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_binding unique(id,user_id),
  constraint accounts_kind check(kind in ('cash','bank','card')),
  constraint accounts_name check(name=btrim(name) and char_length(name) between 1 and 80),
  constraint accounts_currency check(currency='KRW'),
  constraint accounts_version check(version between 1 and 9007199254740991),
  constraint accounts_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at
    and (archived_at is null or (isfinite(archived_at) and archived_at>=created_at)))
);
create table app_ledger.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null,
  name text not null,
  sort_order integer not null default 0,
  version bigint not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_binding unique(id,user_id,kind),
  constraint categories_kind check(kind in ('income','expense')),
  constraint categories_name check(name=btrim(name) and char_length(name) between 1 and 50),
  constraint categories_sort check(sort_order between 0 and 10000),
  constraint categories_version check(version between 1 and 9007199254740991),
  constraint categories_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at
    and (archived_at is null or (isfinite(archived_at) and archived_at>=created_at)))
);
create table app_ledger.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  from_account_id uuid not null,
  to_account_id uuid not null,
  amount_krw bigint not null,
  occurred_on date not null,
  memo text,
  created_at timestamptz not null default now(),
  constraint transfers_binding unique(id,user_id),
  constraint transfers_from_fk foreign key(from_account_id,user_id) references app_ledger.accounts(id,user_id),
  constraint transfers_to_fk foreign key(to_account_id,user_id) references app_ledger.accounts(id,user_id),
  constraint transfers_accounts check(from_account_id<>to_account_id),
  constraint transfers_amount check(amount_krw between 1 and 9007199254740991),
  constraint transfers_date check(occurred_on between date '0001-01-01' and date '9999-12-31'),
  constraint transfers_memo check(memo is null or (memo=btrim(memo) and char_length(memo) between 1 and 500)),
  constraint transfers_time check(isfinite(created_at))
);
create table app_ledger.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  account_id uuid not null,
  kind text not null,
  amount_krw bigint not null,
  occurred_on date not null,
  memo text,
  category_id uuid,
  transfer_id uuid,
  opening_direction text,
  version bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_binding unique(id,user_id),
  constraint transactions_account_fk foreign key(account_id,user_id) references app_ledger.accounts(id,user_id),
  constraint transactions_category_fk foreign key(category_id,user_id,kind) references app_ledger.categories(id,user_id,kind),
  constraint transactions_transfer_fk foreign key(transfer_id,user_id) references app_ledger.transfers(id,user_id),
  constraint transactions_shape check(
    (kind in ('income','expense') and category_id is not null and transfer_id is null and opening_direction is null)
    or (kind in ('transfer_out','transfer_in') and category_id is null and transfer_id is not null and opening_direction is null and deleted_at is null)
    or (kind='opening_balance' and category_id is null and transfer_id is null and opening_direction is not null and opening_direction in ('asset','liability'))),
  constraint transactions_amount check(amount_krw between 1 and 9007199254740991),
  constraint transactions_date check(occurred_on between date '0001-01-01' and date '9999-12-31'),
  constraint transactions_memo check(memo is null or (memo=btrim(memo) and char_length(memo) between 1 and 500)),
  constraint transactions_version check(version between 1 and 9007199254740991),
  constraint transactions_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at
    and (deleted_at is null or (isfinite(deleted_at) and deleted_at>=created_at)))
);
create table app_ledger.idempotency_requests (
  user_id uuid not null references auth.users(id) on delete restrict,
  operation text not null,
  idempotency_key uuid not null,
  request_fingerprint bytea not null,
  response_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint idempotency_requests_pkey primary key(user_id,operation,idempotency_key),
  constraint idempotency_operation check(operation in ('create_account','set_opening_balance','create_category','create_transaction','create_transfer')),
  constraint idempotency_key_v4 check(idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint idempotency_fingerprint check(octet_length(request_fingerprint)=32),
  constraint idempotency_response check(jsonb_typeof(response_snapshot)='object' and octet_length(response_snapshot::text)<=16384),
  constraint idempotency_time check(isfinite(created_at))
);
create index accounts_owner_archive on app_ledger.accounts(user_id,archived_at);
create index categories_owner_sort on app_ledger.categories(user_id,archived_at,sort_order);
create index transfers_owner_time on app_ledger.transfers(user_id,created_at desc,id desc);
create unique index transactions_one_opening on app_ledger.transactions(account_id) where kind='opening_balance' and deleted_at is null;
create index transactions_owner_date on app_ledger.transactions(user_id,occurred_on desc,id desc) where deleted_at is null;
create index transactions_account_date on app_ledger.transactions(user_id,account_id,occurred_on desc,id desc) where deleted_at is null;
create index transactions_category_date on app_ledger.transactions(user_id,category_id,occurred_on desc,id desc) where deleted_at is null;
create index transactions_transfer on app_ledger.transactions(transfer_id);
-- 접근 정책이 설치되기 전에도 신규 데이터는 공개되지 않는다.
alter table app_ledger.accounts enable row level security;
alter table app_ledger.accounts force row level security;
alter table app_ledger.categories enable row level security;
alter table app_ledger.categories force row level security;
alter table app_ledger.transfers enable row level security;
alter table app_ledger.transfers force row level security;
alter table app_ledger.transactions enable row level security;
alter table app_ledger.transactions force row level security;
alter table app_ledger.idempotency_requests enable row level security;
alter table app_ledger.idempotency_requests force row level security;
revoke all on all tables in schema app_ledger from public,anon,authenticated,service_role,app_session_bff,app_api;
comment on table app_ledger.accounts is '개인 장부의 계좌. bank 종류만으로 실제 은행 연결이 완료된 것은 아니다.';
comment on table app_ledger.transactions is '계좌별 원장 한 행. 금액은 양수, 방향은 kind/opening_direction으로 표현한다.';
comment on table app_ledger.transfers is '내 계좌 간 이동의 공통 기록. 실제 은행 송금 기능이 아니다.';
comment on table app_ledger.idempotency_requests is '생성 요청의 첫 성공 결과. 금융 행과 같은 transaction에 저장하며 일반 거래 ID와 구분한다.';
