-- ============================================================
-- Pac-Baby: 게스트 세션 / 닉네임 / 등록 RPC
--   모든 함수는 SECURITY DEFINER 이며 search_path 를 고정한다.
-- ============================================================

-- 라운드별 점수 상한 (이론 최대: 아이템 1200 + 트랩 1200 + 넉백 여유)
create or replace function public.pacbaby_score_cap(p_round integer)
returns integer
language sql
immutable
as $$
  select 400 + greatest(1, least(coalesce(p_round, 1), 99)) * 5000;
$$;

-- 최소 플레이 시간 (즉시 제출/속도핵 방지)
create or replace function public.pacbaby_min_duration(p_round integer)
returns interval
language sql
immutable
as $$
  select make_interval(secs => 3 + greatest(1, least(coalesce(p_round, 1), 99)) * 10);
$$;

-- ------------------------------------------------------------
-- 게스트 세션 시작: 프로필 upsert + 접속 횟수(30분 세션 기준) 증가
-- ------------------------------------------------------------
create or replace function public.begin_guest_session(
  p_device_type text default 'PC',
  p_country     text default null
)
returns table (
  user_id uuid,
  nickname text,
  avatar_emoji_id smallint,
  high_score integer,
  max_round integer,
  access_count integer,
  is_registered boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_new_session boolean := true;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.users (id, device_type, country)
  values (
    v_uid,
    case when p_device_type in ('PC', 'Mobile') then p_device_type else 'PC' end,
    case when p_country ~ '^[A-Za-z]{2}$' then upper(p_country) else null end
  )
  on conflict (id) do nothing;

  select (now() - u.last_login_at) > interval '30 minutes'
    into v_new_session
    from public.users u
   where u.id = v_uid;

  update public.users u set
    access_count = u.access_count + case when v_new_session then 1 else 0 end,
    last_login_at = now(),
    device_type = case when p_device_type in ('PC', 'Mobile')
                       then p_device_type else u.device_type end,
    country = coalesce(
      u.country,
      case when p_country ~ '^[A-Za-z]{2}$' then upper(p_country) end
    )
  where u.id = v_uid;

  return query
    select u.id, u.nickname::text, u.avatar_emoji_id,
           u.high_score, u.max_round, u.access_count, u.is_registered
      from public.users u
     where u.id = v_uid;
end $$;

-- ------------------------------------------------------------
-- 닉네임 중복 확인 (UX 용)
-- ------------------------------------------------------------
create or replace function public.check_nickname(p_nickname text)
returns table (available boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_nickname is null or p_nickname !~ '^[A-Za-z0-9가-힣_]{2,12}$' then
    return query select false, 'INVALID_FORMAT'::text;
    return;
  end if;

  if exists (
    select 1 from public.reserved_nicknames r
     where r.nickname = p_nickname
  ) then
    return query select false, 'RESERVED'::text;
    return;
  end if;

  return query
    select not exists (
      select 1 from public.users u
       where u.nickname = p_nickname
         and u.id is distinct from v_uid
    ), 'OK'::text;
end $$;

-- ------------------------------------------------------------
-- 게스트 → 등록 프로필 전환 (같은 uid 의 기록 승계)
-- ------------------------------------------------------------
create or replace function public.register_profile(
  p_nickname text,
  p_avatar smallint
)
returns table (nickname text, avatar_emoji_id smallint, is_registered boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_avatar is null or p_avatar not between 1 and 12 then
    raise exception 'INVALID_AVATAR';
  end if;

  if p_nickname is null or p_nickname !~ '^[A-Za-z0-9가-힣_]{2,12}$' then
    raise exception 'INVALID_NICKNAME';
  end if;

  if exists (
    select 1 from public.reserved_nicknames r
     where r.nickname = p_nickname
  ) then
    raise exception 'RESERVED';
  end if;

  if exists (
    select 1 from public.users u
     where u.id = v_uid and u.is_registered
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  begin
    update public.users u set
      nickname = p_nickname,
      avatar_emoji_id = p_avatar,
      is_registered = true
    where u.id = v_uid;
  exception when unique_violation then
    raise exception 'NICKNAME_TAKEN';
  end;

  return query
    select u.nickname::text, u.avatar_emoji_id, u.is_registered
      from public.users u
     where u.id = v_uid;
end $$;

revoke all on function public.pacbaby_score_cap(integer) from public;
revoke all on function public.pacbaby_min_duration(integer) from public;
revoke all on function public.begin_guest_session(text, text) from public;
revoke all on function public.check_nickname(text) from public;
revoke all on function public.register_profile(text, smallint) from public;

grant execute on function public.begin_guest_session(text, text) to authenticated;
grant execute on function public.check_nickname(text) to authenticated;
grant execute on function public.register_profile(text, smallint) to authenticated;
