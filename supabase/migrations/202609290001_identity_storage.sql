-- 회원 앱 데이터. 인증 계정은 auth.users에 그대로 두고 비밀번호/이메일/토큰을 복제하지 않는다.
-- 실행자는 승인된 migration owner여야 하며 전체 파일을 하나의 transaction으로 적용한다.
create schema app_identity;
revoke all on schema app_identity from public, anon, authenticated, service_role, app_session_bff, app_api;

create table app_identity.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_object_key text,
  signup_provider text not null default 'unknown',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_nickname check(nickname is null or (nickname=btrim(nickname) and char_length(nickname) between 1 and 50)),
  constraint profiles_avatar check(avatar_object_key is null or (
    char_length(avatar_object_key) between 38 and 512
    and left(avatar_object_key,37)=user_id::text||'/'
    and avatar_object_key !~ '[[:cntrl:]]'
    and position('..' in avatar_object_key)=0 and position(chr(92) in avatar_object_key)=0
    and position('://' in avatar_object_key)=0)),
  constraint profiles_provider check(signup_provider in ('email','google','kakao','naver','unknown')),
  constraint profiles_version check(version between 1 and 9007199254740991),
  constraint profiles_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at
    and (deleted_at is null or (isfinite(deleted_at) and deleted_at>=created_at)))
);
create table app_identity.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_role check(role in ('member','admin')),
  constraint user_roles_times check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
);
create table app_identity.role_change_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null,
  previous_role text,
  new_role text,
  db_actor text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint role_events_roles check((previous_role is null or previous_role in ('member','admin'))
    and (new_role is null or new_role in ('member','admin')) and previous_role is distinct from new_role),
  constraint role_events_reason check(reason in ('bootstrap','migration','role_change','role_revoke')),
  constraint role_events_time check(isfinite(created_at))
);
create index role_events_target_time on app_identity.role_change_events(target_user_id,created_at);
create index role_events_time on app_identity.role_change_events(created_at);
alter table app_identity.profiles enable row level security;
alter table app_identity.profiles force row level security;
alter table app_identity.user_roles enable row level security;
alter table app_identity.user_roles force row level security;
alter table app_identity.role_change_events enable row level security;
alter table app_identity.role_change_events force row level security;
revoke all on all tables in schema app_identity from public, anon, authenticated, service_role, app_session_bff, app_api;
comment on table app_identity.profiles is '앱 프로필. signup_provider는 최초 가입 경로, deleted_at은 탈퇴 표시이며 영구 삭제 완료가 아니다.';
comment on table app_identity.user_roles is '앱 서비스 권한. Supabase/PostgreSQL 역할과 다르며 최초 회원도 member다.';
comment on table app_identity.role_change_events is '권한 변경 감사. db_actor는 DB 세션 주체이지 실제 사람의 신원 증명이 아니다.';
