-- ============================================================
-- Pac-Baby: 공개 리더보드 RPC
--   - note / access_count / device_type / id 등 민감 컬럼은 반환하지 않는다.
--   - flagged / is_public=false 유저는 제외한다.
-- ============================================================

create or replace function public.get_leaderboard(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  rank bigint,
  nickname text,
  avatar_emoji_id smallint,
  high_score integer,
  max_round integer,
  country text,
  is_me boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select
      u.id,
      u.nickname::text as nickname,
      u.avatar_emoji_id,
      u.high_score,
      u.max_round,
      u.country,
      row_number() over (
        order by u.high_score desc, u.max_round desc, u.created_at asc
      ) as rank
    from public.users u
    where u.is_registered
      and u.is_public
      and not u.flagged
      and u.nickname is not null
  )
  select
    r.rank,
    r.nickname,
    r.avatar_emoji_id,
    r.high_score,
    r.max_round,
    r.country,
    (r.id = auth.uid()) as is_me
  from ranked r
  order by r.rank
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_leaderboard(integer, integer) from public;
grant execute on function public.get_leaderboard(integer, integer) to anon, authenticated;
