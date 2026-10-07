-- 기존 진행 중 트랜잭션은 원래 로그인 동작을 유지한다.
-- 콜백 요청값이 아닌 서버 레코드의 의도로 세션 발급 여부를 정한다.
alter table app_private.oauth_transactions
  add column intent text not null default 'sign_in',
  add constraint oauth_transactions_intent check (intent in ('sign_in', 'sign_up'));

comment on column app_private.oauth_transactions.intent is
  'Server-owned OAuth intent; sign_up completes provider verification without an app session.';
