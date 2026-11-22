-- ============================================================
-- Pac-Baby: RPC 보완 (check_nickname / submit_run)
--   1) check_nickname: 익명 세션(auth.uid() is null)으로 호출하면
--      예외 대신 AUTH_REQUIRED 사유를 돌려준다 (모달에서 안내 문구 표시).
--   2) submit_run: 최근 60초 3회 rate limit 카운트에서
--      ABANDONED 런(새로고침/재도전으로 버려진 런)을 제외한다.
--   시그니처는 기존 마이그레이션과 동일하므로 create or replace 로 안전하게 덮어쓴다.
-- ============================================================

-- ------------------------------------------------------------
-- 닉네임 중복 확인 (UX 용) + AUTH_REQUIRED 반환
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
  -- 익명 로그인이 아직/실패한 상태: 예외 대신 사유를 반환해 모달이 안내한다.
  if v_uid is null then
    return query select false, 'AUTH_REQUIRED'::text;
    return;
  end if;

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
-- 게임 오버: 점수/라운드 제출
--   거부 사유: RATE_LIMITED / SCORE_OUT_OF_RANGE / ROUND_OUT_OF_RANGE /
--             SCORE_EXCEEDS_CAP / TOO_FAST / TOO_LONG
--   - rate limit 은 실제 제출 결과(ACCEPTED/REJECTED)만 센다.
--     begin_run 이 이전 OPEN 런을 ABANDONED 로 바꾸는 동작 때문에
--     정상적인 재도전까지 제한되지 않도록 한다.
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
         and r.finished_at > now() - interval '60 seconds'
         and r.status in ('ACCEPTED', 'REJECTED')) >= 3 then
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

-- create or replace 는 기존 권한을 유지하지만, 재적용해도 안전하도록 명시한다.
revoke all on function public.check_nickname(text) from public;
revoke all on function public.submit_run(uuid, integer, integer) from public;

grant execute on function public.check_nickname(text) to authenticated;
grant execute on function public.submit_run(uuid, integer, integer) to authenticated;
