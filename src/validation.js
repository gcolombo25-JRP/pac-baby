/**
 * Pac-Baby: 프로필/점수 검증 (순수 함수)
 *
 * - 브라우저와 Node 테스트에서 모두 안전하게 import 할 수 있어야 한다.
 * - 닉네임 규칙은 Supabase users_nickname_format CHECK 제약과 동일하게 유지한다.
 * - 점수 상한/최소 시간은 서버 RPC 와 동일한 값을 미러링한 사전 안내용이다.
 */

import { NICKNAME_RULE, SCORE_RULES } from './constants.js';
import { AVATAR_IDS } from './uiIcons.js';

/** 앞뒤 공백 제거 + 유니코드 NFC 정규화 (한글 자모 분리 입력 대응) */
export function normalizeNickname(raw) {
  return String(raw ?? '').normalize('NFC').trim();
}

/**
 * 닉네임 검증
 * @param {string} raw
 * @returns {{ ok: boolean, value: string, reason: string }}
 *   reason: OK | EMPTY | TOO_SHORT | TOO_LONG | INVALID_FORMAT
 */
export function validateNickname(raw) {
  const value = normalizeNickname(raw);

  if (!value) return { ok: false, value, reason: 'EMPTY' };
  if (value.length < NICKNAME_RULE.minLength) {
    return { ok: false, value, reason: 'TOO_SHORT' };
  }
  if (value.length > NICKNAME_RULE.maxLength) {
    return { ok: false, value, reason: 'TOO_LONG' };
  }
  if (!NICKNAME_RULE.pattern.test(value)) {
    return { ok: false, value, reason: 'INVALID_FORMAT' };
  }
  return { ok: true, value, reason: 'OK' };
}

/** 아바타 id(1~12)가 유효한지 */
export function isValidAvatarId(id) {
  const value = Number(id);
  return Number.isInteger(value) && value >= 1 && value <= AVATAR_IDS.length;
}

/** 라운드별 점수 상한 (서버 pacbaby_score_cap 과 동일) */
export function scoreCapForRound(round) {
  const safeRound = Math.min(
    SCORE_RULES.maxRound,
    Math.max(1, Math.floor(Number(round) || 1)),
  );
  return SCORE_RULES.scoreBase + safeRound * SCORE_RULES.scorePerRound;
}

/** 라운드별 최소 플레이 시간(ms) (서버 pacbaby_min_duration 과 동일) */
export function minRunDurationMs(round) {
  const safeRound = Math.min(
    SCORE_RULES.maxRound,
    Math.max(1, Math.floor(Number(round) || 1)),
  );
  return (SCORE_RULES.minBaseSeconds + safeRound * SCORE_RULES.minSecondsPerRound) * 1000;
}

/**
 * 점수가 물리적으로 가능한 범위인지 사전 검사 (UI 안내용, 최종 판정은 서버)
 * @param {{ score: number, round: number, durationMs?: number }} summary
 * @returns {{ ok: boolean, reason: string }}
 */
export function isPlausibleScore({ score, round, durationMs } = {}) {
  const value = Math.floor(Number(score));
  const safeRound = Math.floor(Number(round));

  if (!Number.isFinite(value) || value < SCORE_RULES.minScore) {
    return { ok: false, reason: 'SCORE_OUT_OF_RANGE' };
  }
  if (value > SCORE_RULES.maxScore) return { ok: false, reason: 'SCORE_OUT_OF_RANGE' };
  if (!Number.isFinite(safeRound) || safeRound < 1 || safeRound > SCORE_RULES.maxRound) {
    return { ok: false, reason: 'ROUND_OUT_OF_RANGE' };
  }
  if (value > scoreCapForRound(safeRound)) return { ok: false, reason: 'SCORE_EXCEEDS_CAP' };

  if (Number.isFinite(durationMs) && durationMs >= 0
      && durationMs < minRunDurationMs(safeRound)) {
    return { ok: false, reason: 'TOO_FAST' };
  }
  return { ok: true, reason: 'OK' };
}

/** 'kr' / 'ko-KR' 같은 힌트를 ISO alpha-2 로 정규화 (없으면 null) */
export function normalizeCountryHint(hint) {
  const raw = String(hint ?? '').trim();
  const region = raw.match(/^[A-Za-z]{2,3}[-_]([A-Za-z]{2})$/);
  const code = region ? region[1] : raw;
  return /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}
