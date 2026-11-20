# Pac-Baby Supabase 설정 가이드

이 문서는 글로벌 유저/리더보드/게스트 선행 플레이를 위한 Supabase 구성 절차입니다.

## 1. 프로젝트 생성

1. https://supabase.com 에서 새 프로젝트를 만든다.
2. **Authentication → Providers → Anonymous sign-ins** 를 **켜기** (게스트 선행 플레이의 핵심).
3. (권장) Authentication → Rate Limits 에서 anonymous sign-in / OTP 요청 제한을 확인한다.
4. (선택) Abuse 방지를 위해 Turnstile/Captcha 를 켤 수 있다.

## 2. 마이그레이션 적용

### 방법 A: Supabase CLI (권장)

```bash
npx supabase init          # 최초 1회: supabase/config.toml 생성
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

### 방법 B: 대시보드 SQL Editor

아래 파일을 **순서대로** 실행한다.

1. `migrations/20261120000100_users.sql`
2. `migrations/20261120000200_runs.sql`
3. `migrations/20261120000300_functions_profile.sql`
4. `migrations/20261120000400_functions_runs.sql`
5. `migrations/20261120000500_rls.sql`
6. `migrations/20261120000600_leaderboard.sql`

## 3. 프론트엔드 환경 변수

프로젝트 루트에 `.env.local` 을 만들고 대시보드의 **Project URL / anon public key** 를 넣는다.

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- 값이 없으면 게임은 LOCAL 모드로 동작하며 등록/리더보드 CTA 가 숨겨진다.
- `service_role` 키는 **절대** 프론트엔드/저장소/CI 빌드에 넣지 않는다.

GitHub Pages 배포 시 저장소 Settings → Secrets and variables → Actions 에
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 를 등록한다.

## 4. 보안 모델 요약

- `users`, `runs` 테이블은 RLS 활성화 + `anon/authenticated` 권한 회수.
- INSERT/UPDATE/DELETE 정책 없음 → **클라이언트가 테이블을 직접 수정할 수 없다.**
- 모든 쓰기는 `SECURITY DEFINER` RPC 만 허용:
  - `begin_guest_session` (접속 횟수/프로필)
  - `begin_run` / `submit_run` (서버 검증 점수 제출)
  - `check_nickname` / `register_profile`
- `submit_run` 검증:
  - 서버 발급 run 토큰 + 1회성(OPEN → ACCEPTED/REJECTED)
  - `now() - started_at` 기반 최소 플레이 시간 / 최대 12시간
  - 라운드별 점수 상한 (`pacbaby_score_cap`)
  - `max_round` 는 최소 점수(`(round-1)*10`) 이상일 때만 갱신 → 라운드만 올리는 조작 방지
  - 60초당 제출 3회 rate limit
  - `high_score = greatest(...)` → 감소/덮어쓰기 불가
  - 위반 시 `risk_score` 누적, 3회면 `flagged = true` + `note` 자동 기록
- `get_leaderboard` 는 공개 컬럼만 반환하며 `flagged`/비공개 유저는 제외.

## 5. 운영(관리자) SQL 예시

```sql
-- 의심 계정 확인
select nickname, high_score, max_round, access_count, risk_score, flagged, note, last_score_at
from public.users
order by flagged desc, risk_score desc, high_score desc;

-- 오탐 플래그 해제 + 메모
update public.users
set flagged = false, risk_score = 0,
    note = coalesce(note || E'\n', '') || '[manual] 정상 확인 ' || now()
where nickname = 'baby';

-- 닉네임 강제 변경 (등록 후 변경 UI 는 MVP 범위 밖)
update public.users set nickname = 'new_name' where nickname = 'old_name';

-- 리더보드에서 숨기기
update public.users set is_public = false where nickname = 'baby';
```

## 6. 수동 검증 체크리스트

- [ ] F12 콘솔에서 `supabase.from('users').update({ high_score: 999999 })` → 권한 오류
- [ ] `submit_run` 에 상한 초과 점수 전송 → `accepted=false`, `flagged` 누적
- [ ] 같은 `run_id` 재제출 → `RUN_ALREADY_SUBMITTED`
- [ ] 새로고침 후 같은 uid 유지(익명 세션 persist) 및 `access_count` 증가 확인
- [ ] 게스트 500점 달성 → 게임 오버 시 등록 모달 → 등록 후 리더보드 노출
