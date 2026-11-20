-- ============================================================
-- Pac-Baby: RLS 정책
--   - 클라이언트는 본인 행만 SELECT 할 수 있다.
--   - INSERT/UPDATE/DELETE 정책을 만들지 않고 GRANT 도 회수한다.
--     → F12/DevTools 로 users.high_score 를 직접 덮어쓰는 것이 불가능하다.
--   - 모든 쓰기는 SECURITY DEFINER RPC 를 통해서만 가능하다.
-- ============================================================

alter table public.users              enable row level security;
alter table public.runs               enable row level security;
alter table public.reserved_nicknames enable row level security;

-- 기본 권한 전부 회수 (anon/authenticated)
revoke all on table public.users              from anon, authenticated;
revoke all on table public.runs               from anon, authenticated;
revoke all on table public.reserved_nicknames from anon, authenticated;

drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists runs_select_self on public.runs;
create policy runs_select_self on public.runs
  for select to authenticated
  using (auth.uid() = user_id);

-- 읽기만 허용 (쓰기 정책 없음)
-- users: note/flagged/risk_score 같은 운영 컬럼은 본인에게도 노출하지 않는다(컬럼 단위 GRANT).
grant select (
  id, nickname, avatar_emoji_id, high_score, max_round, access_count,
  country, device_type, created_at, last_login_at,
  is_registered, is_public, updated_at
) on table public.users to authenticated;
grant select on table public.runs  to authenticated;

-- reserved_nicknames 는 API 로 읽을 필요도 없다 (관리자 SQL Editor 전용)
