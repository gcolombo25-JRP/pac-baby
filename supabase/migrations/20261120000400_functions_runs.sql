-- ============================================================
-- Pac-Baby: 런 토큰 발급 / 점수 제출 서버 검증
--   - 테이블 직접 UPDATE 는 RLS/GRANT 로 불가능하다.
--   - 점수는 greatest() 로만 증가하므로 "덮어쓰기" 가 불가능하다.
-- ============================================================

-- ------------------------------------------------------------
-- 게임 시작: run 토큰 발급 (이전 OPEN 런은 ABANDONED)
-- ------------------------------------------------------------
create or replace function public.begin_run(
  p_seed bigint,
  p_client_build text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'SESSION_REQUIRED';
  end if;

  -- 새 게임 시작 시 이전 미완료 런은 포기 처리 (새로고침/재도전 대응)
  update public.runs r
     set status = 'ABANDONED', finished_at = now()
   where r.user_id = v_uid and r.status = 'OPEN';

  insert into public.runs (user_id, seed, client_build)
  values (v_uid, p_seed, left(coalesce(p_client_build, ''), 40))
  returning id into v_run;

  return v_run;
end $$;

-- ------------------------------------------------------------
-- 게임 오버: 점수/라운드 제출
--   거부 사유: RATE_LIMITED / SCORE_OUT_OF_RANGE / ROUND_OUT_OF_RANGE /
--             SCORE_EXCEEDS_CAP / TOO_FAST / TOO_LONG
-- ------------------------------------------------------------
create or replace function public.submit_run(
  p_run_id uuid,
  p_score integer,
  p_round integer
)
returns table (accepted boolean, high_score integer, max_round integer, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.runs%rowtype;
  v_elapsed interval;
  v_reason text;
  v_hi integer;
  v_max integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_run
    from public.runs r
   where r.id = p_run_id and r.user_id = v_uid
   for update;

  if not found then
    raise exception 'RUN_NOT_FOUND';
  end if;
  if v_run.status <> 'OPEN' then
    raise exception 'RUN_ALREADY_SUBMITTED';
  end if;

  v_elapsed := now() - v_run.started_at;

  if (select count(*)
        from public.runs r
       where r.user_id = v_uid
         and r.finished_at > now() - interval '60 seconds') >= 3 then
    v_reason := 'RATE_LIMITED';
  elsif p_score is null or p_score < -100000 or p_score > 1000000 then
    v_reason := 'SCORE_OUT_OF_RANGE';
  elsif p_round is null or p_round < 1 or p_round > 99 then
    v_reason := 'ROUND_OUT_OF_RANGE';
  elsif p_score > public.pacbaby_score_cap(p_round) then
    v_reason := 'SCORE_EXCEEDS_CAP';
  elsif v_elapsed < public.pacbaby_min_duration(p_round) then
    v_reason := 'TOO_FAST';
  elsif v_elapsed > interval '12 hours' then
    v_reason := 'TOO_LONG';
  end if;

  if v_reason is not null then
    update public.runs r set
      status = 'REJECTED',
      finished_at = now(),
      reported_score = p_score,
      reported_round = p_round,
      reject_reason = v_reason
    where r.id = p_run_id;

    update public.users u set
      risk_score = least(100, u.risk_score + 1),
      flagged = (u.risk_score + 1) >= 3,
      note = case when (u.risk_score + 1) >= 3
                  then coalesce(u.note || E'\n', '')
                       || format('[auto] %s (score=%s, round=%s, %s)',
                                 v_reason, p_score, p_round, now())
                  else u.note
             end
    where u.id = v_uid;

    select u.high_score, u.max_round into v_hi, v_max
      from public.users u
     where u.id = v_uid;

    return query select false, v_hi, v_max, v_reason;
    return;
  end if;

  update public.runs r set
    status = 'ACCEPTED',
    finished_at = now(),
    reported_score = p_score,
    reported_round = p_round
  where r.id = p_run_id;

  update public.users u set
    high_score = greatest(u.high_score, p_score),   -- 감소/덮어쓰기 불가
    -- 라운드는 최소한의 점수 증가가 있을 때만 올린다 (max_round 만 조작하는 것 방지)
    max_round = greatest(
      u.max_round,
      case when p_score >= (p_round - 1) * 10 then p_round else u.max_round end
    ),
    submission_count = u.submission_count + 1,
    last_score_at = now(),
    risk_score = greatest(0, u.risk_score - 1)
  where u.id = v_uid
  returning u.high_score, u.max_round into v_hi, v_max;

  return query select true, v_hi, v_max, null::text;
end $$;

revoke all on function public.begin_run(bigint, text) from public;
revoke all on function public.submit_run(uuid, integer, integer) from public;

grant execute on function public.begin_run(bigint, text) to authenticated;
grant execute on function public.submit_run(uuid, integer, integer) to authenticated;
