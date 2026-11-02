-- 날짜만 아는 행은 해당 날짜의 뒤로 정렬한다. 기존 date index/데이터는 삭제하지 않는다.
create index transactions_owner_time on finance.transaction_history
  (user_id,occurred_on desc,occurred_at desc nulls last,id desc) where deleted_at is null;

-- pg_timezone_names 전체 파일 열거를 행마다 반복하지 않는다. 단일 이름의 DB 변환을 검사한다.
-- p_zone은 문자열 인수이며 SQL/SET으로 실행하지 않는다. 기존 invoker/ACL은 유지한다.
create or replace function "user".is_ledger_time_zone(p_zone text) returns boolean
language plpgsql stable strict security invoker set search_path='' as $$
begin
  if char_length(p_zone) not between 1 and 128
    or p_zone !~ '^(UTC|[A-Za-z_]+/[A-Za-z0-9_+/-]+)$' then return false; end if;
  -- 숫자 포함 이름은 POSIX offset 구문으로 오인될 수 있어 실제 목록과 대조한다.
  if p_zone ~ '[0-9]' then
    return exists(select 1 from pg_catalog.pg_timezone_names where lower(name)=lower(p_zone));
  end if;
  perform pg_catalog.timezone(p_zone,timestamptz '2000-01-01 00:00:00+00');
  return true;
exception when invalid_parameter_value then return false;
end $$;
