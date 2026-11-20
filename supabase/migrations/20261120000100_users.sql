-- ============================================================
-- Pac-Baby: 글로벌 유저 테이블
--   - 게스트(익명 인증)도 auth.users 에 uid 가 생기므로 같은 테이블을 사용한다.
--   - 닉네임 등록 전에는 is_registered=false 이며 리더보드에 노출되지 않는다.
-- ============================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

create table if not exists public.users (
  id               uuid primary key references auth.users(id) on delete cascade,
  nickname         citext,                        -- UNIQUE (대소문자 무시, NULL 다수 허용)
  avatar_emoji_id  smallint not null default 1,
  high_score       integer  not null default 0,
  max_round        integer  not null default 1,
  access_count     integer  not null default 1,
  country          text,                          -- ISO-3166-1 alpha-2
  device_type      text     not null default 'PC',
  created_at       timestamptz not null default now(),
  last_login_at    timestamptz not null default now(),
  note             text,                          -- 관리자 전용 비고

  -- 안티치트 / 운영 확장
  is_registered    boolean  not null default false,
  is_public        boolean  not null default true,
  flagged          boolean  not null default false,
  risk_score       smallint not null default 0,
  submission_count integer  not null default 0,
  last_score_at    timestamptz,
  updated_at       timestamptz not null default now(),

  constraint users_nickname_format
    check (nickname is null or nickname ~ '^[A-Za-z0-9가-힣_]{2,12}$'),
  constraint users_avatar_range  check (avatar_emoji_id between 1 and 12),
  constraint users_score_nonneg  check (high_score >= 0),
  constraint users_round_range   check (max_round between 1 and 99),
  constraint users_access_pos    check (access_count >= 1),
  constraint users_country_fmt   check (country is null or country ~ '^[A-Z]{2}$'),
  constraint users_device_valid  check (device_type in ('PC', 'Mobile')),
  constraint users_registered_has_nickname
    check (not is_registered or nickname is not null)
);

-- 동명이인 원천 차단 (citext 이므로 대소문자도 동일 취급)
create unique index if not exists users_nickname_unique
  on public.users (nickname) where nickname is not null;

-- 리더보드 정렬용 부분 인덱스
create index if not exists users_leaderboard_idx
  on public.users (high_score desc, max_round desc, created_at asc)
  where is_registered and is_public and not flagged;

-- 예약어/금칙어 (API 로는 접근 불가, 관리자만 수정)
create table if not exists public.reserved_nicknames (
  nickname citext primary key,
  reason   text
);

insert into public.reserved_nicknames (nickname, reason) values
  ('admin',    'reserved'),
  ('관리자',   'reserved'),
  ('운영자',   'reserved'),
  ('pacbaby',  'reserved'),
  ('guest',    'reserved'),
  ('게스트',   'reserved')
on conflict do nothing;

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
before update on public.users
for each row execute function public.touch_updated_at();
