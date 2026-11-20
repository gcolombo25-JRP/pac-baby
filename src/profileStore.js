/**
 * Pac-Baby: 프로필 localStorage 미러
 *
 * 서버(Supabase)가 신뢰 원천이고, 이 스토어는 아래 용도로만 쓴다.
 * - 오프라인/로컬 모드에서도 게임을 그대로 즐길 수 있게 최고 기록 표시
 * - 등록 유도 팝업 스누즈 상태
 * - 리더보드 30초 캐시
 */

import { PROFILE_STORAGE_KEYS } from './constants.js';

/** localStorage 접근이 차단된 환경(사생활 보호 모드 등)에서도 안전하게 동작 */
export function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (err) { /* 접근 차단 */ }
  return null;
}

export default class ProfileStore {
  constructor(storage = safeStorage()) {
    this.storage = storage;
  }

  _read(key, fallback) {
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  _write(key, value) {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch (err) { /* 저장 실패 무시 */ }
  }

  loadProfile() {
    const value = this._read(PROFILE_STORAGE_KEYS.PROFILE, null);
    return value && typeof value === 'object' ? value : null;
  }

  saveProfile(profile) {
    this._write(PROFILE_STORAGE_KEYS.PROFILE, profile);
  }

  loadPromptState() {
    const value = this._read(PROFILE_STORAGE_KEYS.PROMPT, null);
    return {
      runEndCount: Math.max(0, Number(value?.runEndCount) || 0),
      snoozeUntilRun: Math.max(0, Number(value?.snoozeUntilRun) || 0),
    };
  }

  savePromptState(state) {
    this._write(PROFILE_STORAGE_KEYS.PROMPT, {
      runEndCount: Math.max(0, Number(state?.runEndCount) || 0),
      snoozeUntilRun: Math.max(0, Number(state?.snoozeUntilRun) || 0),
    });
  }

  loadLeaderboardCache() {
    const value = this._read(PROFILE_STORAGE_KEYS.LEADERBOARD, null);
    if (!value || !Array.isArray(value.rows)) return null;
    return value;
  }

  saveLeaderboardCache(entry) {
    this._write(PROFILE_STORAGE_KEYS.LEADERBOARD, entry);
  }

  clearLeaderboardCache() {
    try {
      this.storage?.removeItem(PROFILE_STORAGE_KEYS.LEADERBOARD);
    } catch (err) { /* 무시 */ }
  }

  clearProfile() {
    try {
      this.storage?.removeItem(PROFILE_STORAGE_KEYS.PROFILE);
      this.storage?.removeItem(PROFILE_STORAGE_KEYS.PROMPT);
    } catch (err) { /* 무시 */ }
  }
}
