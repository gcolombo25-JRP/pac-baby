/**
 * Pac-Baby: Supabase RPC 래퍼
 *
 * 모든 원격 쓰기는 SECURITY DEFINER RPC 를 통해서만 수행한다.
 * 테이블 직접 INSERT/UPDATE 는 RLS/GRANT 로 차단되어 있다.
 */

import { getSupabaseClient } from './supabaseClient.js';

/** RPC/네트워크 오류를 화면에서 다루기 쉬운 코드로 변환 */
export class ProfileApiError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ProfileApiError';
    this.code = code;
  }
}

const ERROR_PATTERNS = [
  ['NICKNAME_TAKEN', /NICKNAME_TAKEN/i],
  ['ALREADY_REGISTERED', /ALREADY_REGISTERED/i],
  ['INVALID_NICKNAME', /INVALID_NICKNAME/i],
  ['INVALID_AVATAR', /INVALID_AVATAR/i],
  ['AUTH_REQUIRED', /AUTH_REQUIRED/i],
  ['SESSION_REQUIRED', /SESSION_REQUIRED/i],
  ['RUN_NOT_FOUND', /RUN_NOT_FOUND/i],
  ['RUN_ALREADY_SUBMITTED', /RUN_ALREADY_SUBMITTED/i],
  ['RATE_LIMITED', /RATE_LIMITED/i],
  ['REMOTE_DISABLED', /REMOTE_DISABLED/i],
  ['AUTH_RATE_LIMITED', /rate limit|too many requests/i],
];

/** Supabase 오류 → ProfileApiError */
export function mapProfileError(error) {
  if (error instanceof ProfileApiError) return error;
  const message = String(error?.message || error || '');
  const found = ERROR_PATTERNS.find(([, pattern]) => pattern.test(message));
  return new ProfileApiError(found ? found[0] : 'NETWORK_ERROR', message || 'NETWORK_ERROR');
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export default class ProfileApi {
  constructor({ clientProvider = getSupabaseClient } = {}) {
    this.clientProvider = clientProvider;
  }

  async _client() {
    const client = this.clientProvider ? await this.clientProvider() : null;
    if (!client) throw new ProfileApiError('REMOTE_DISABLED');
    return client;
  }

  async _rpc(name, args = {}) {
    const client = await this._client();
    const { data, error } = await client.rpc(name, args);
    if (error) throw mapProfileError(error);
    return data;
  }

  /**
   * 익명 세션 확보 + 게스트 프로필/접속 횟수 갱신
   * @param {{ deviceType?: string, country?: string|null }} options
   * @returns {Promise<object|null>} 게스트 프로필 행
   */
  async initSession({ deviceType = 'PC', country = null } = {}) {
    const client = await this._client();

    let session = null;
    try {
      const result = await client.auth.getSession();
      session = result?.data?.session || null;
    } catch (err) {
      session = null;
    }

    if (!session) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw mapProfileError(error);
      session = data?.session || null;
    }
    if (!session) throw new ProfileApiError('AUTH_REQUIRED');

    const data = await this._rpc('begin_guest_session', {
      p_device_type: deviceType,
      p_country: country,
    });
    const row = firstRow(data);
    if (!row) throw new ProfileApiError('PROFILE_UNAVAILABLE');
    return row;
  }

  /** 게임 시작 시 서버 검증용 run 토큰 발급 */
  async beginRun({ seed, build = null } = {}) {
    const data = await this._rpc('begin_run', {
      p_seed: seed,
      p_client_build: build,
    });
    if (typeof data === 'string') return data;
    return data?.id ?? null;
  }

  /** 게임 오버 시 점수/라운드 제출 (서버가 상한/시간/1회성 검증) */
  async submitRun({ runId, score, round }) {
    const data = await this._rpc('submit_run', {
      p_run_id: runId,
      p_score: score,
      p_round: round,
    });
    return firstRow(data) || { accepted: false, reason: 'NO_RESPONSE' };
  }

  /** 닉네임 중복 확인 (UX 용, 최종 방어는 UNIQUE 인덱스) */
  async checkNickname(nickname) {
    const data = await this._rpc('check_nickname', { p_nickname: nickname });
    return firstRow(data) || { available: false, reason: 'UNKNOWN' };
  }

  /** 게스트 → 등록 프로필 전환 (같은 uid 의 기록 승계) */
  async registerProfile(nickname, avatarId) {
    const data = await this._rpc('register_profile', {
      p_nickname: nickname,
      p_avatar: avatarId,
    });
    return firstRow(data);
  }

  /** 리더보드 조회 (공개 컬럼만 반환) */
  async getLeaderboard(limit, offset = 0) {
    const data = await this._rpc('get_leaderboard', {
      p_limit: limit,
      p_offset: offset,
    });
    return Array.isArray(data) ? data : [];
  }
}
