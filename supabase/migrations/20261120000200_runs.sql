-- ============================================================
-- Pac-Baby: 서버 검증용 런(run) 토큰
--   - 게임 시작 시 1개 발급(OPEN), 게임 오버 시 1회만 제출 가능
--   - 같은 사용자에게 OPEN 런은 1개만 존재
-- ============================================================

create table if not exists public.runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  seed            bigint not null,
  client_build    text,
  status          text not null default 'OPEN'
                  check (status in ('OPEN', 'ACCEPTED', 'REJECTED', 'ABANDONED')),
  reported_score  integer,
  reported_round  integer,
  reject_reason   text,
  created_at      timestamptz not null default now()
);

create unique index if not exists runs_one_open_per_user
  on public.runs (user_id) where status = 'OPEN';

create index if not exists runs_user_finished_idx
  on public.runs (user_id, finished_at desc);
