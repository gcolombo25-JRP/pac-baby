/**
 * Pac-Baby: 글로벌 프로필 / 게스트 선행 플레이 오케스트레이션
 *
 * - 첫 방문: 닉네임 없이 Anonymous Auth 로 게스트 시작
 * - 플레이: 게임 오버마다 run 토큰으로 점수 제출 (등록 유저만 리더보드 노출)
 * - 조건 충족: 등록 모달을 부드럽게 안내 (강제 가입 없음)
 * - 원격 불가: LOCAL 모드로 게임은 그대로 동작
 */

import {
  LEADERBOARD_CACHE_MS,
  LEADERBOARD_LIMIT,
  REGISTER_PROMPT_RULE,
} from './constants.js';
import ProfileApi, { ProfileApiError } from './profileApi.js';
import ProfileStore from './profileStore.js';
import {
  isPlausibleScore,
  isValidAvatarId,
  validateNickname,
} from './validation.js';

/** 클라이언트 측 프로필 오류 (서버 오류와 동일한 code 체계) */
export class ProfileError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

function safeInt(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function defaultSnapshot(deviceType) {
  return {
    userId: null,
    nickname: null,
    avatarEmojiId: 1,
    highScore: 0,
    maxRound: 1,
    accessCount: 0,
    isRegistered: false,
    deviceType,
    country: null,
    remote: false,
    syncedAt: 0,
  };
}

export default class ProfileManager {
  /**
   * @param {object} options
   * @param {ProfileApi} [options.api]
   * @param {ProfileStore} [options.store]
   * @param {(summary: object) => void} [options.onPrompt]
   * @param {string} [options.deviceType]
   * @param {string|null} [options.countryHint]
   * @param {() => number} [options.now]
   * @param {object} [options.promptRule]
   * @param {number} [options.cacheMs]
   */
  constructor(options = {}) {
    this.api = options.api || new ProfileApi();
    this.store = options.store || new ProfileStore();
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.promptRule = { ...REGISTER_PROMPT_RULE, ...(options.promptRule || {}) };
    this.cacheMs = Number.isFinite(options.cacheMs)
      ? options.cacheMs
      : LEADERBOARD_CACHE_MS;
    // 모바일 네트워크에서 RPC 가 끝없이 매달리지 않도록 조회에 상한을 둔다.
    this.leaderboardTimeoutMs = Number.isFinite(options.leaderboardTimeoutMs)
      ? options.leaderboardTimeoutMs
      : 8000;
    this.deviceType = options.deviceType === 'Mobile' ? 'Mobile' : 'PC';
    this.countryHint = options.countryHint || null;

    this.onPrompt = typeof options.onPrompt === 'function' ? options.onPrompt : null;

    const saved = this.store.loadProfile();
    this.snapshot = { ...defaultSnapshot(this.deviceType) };
    if (saved && typeof saved === 'object') {
      this.snapshot = {
        ...this.snapshot,
        userId: saved.userId || null,
        nickname: typeof saved.nickname === 'string' ? saved.nickname : null,
        avatarEmojiId: isValidAvatarId(saved.avatarEmojiId) ? Number(saved.avatarEmojiId) : 1,
        highScore: safeInt(saved.highScore, 0),
        maxRound: Math.max(1, safeInt(saved.maxRound, 1)),
        accessCount: safeInt(saved.accessCount, 0),
        isRegistered: !!saved.isRegistered,
        deviceType: saved.deviceType === 'Mobile' ? 'Mobile' : this.deviceType,
        country: saved.country || null,
        syncedAt: safeInt(saved.syncedAt, 0),
      };
    }
    this.snapshot.deviceType = this.deviceType;
    this.snapshot.country = this.countryHint || this.snapshot.country;

    this.promptState = this.store.loadPromptState();
    this.remote = false;
    this.initPromise = null;
    this.runSeq = 0;
    this.runId = null;
    this.runPromise = null;
    this.runStartedAt = 0;
    this.lastRunSummary = null;
    this.listeners = new Set();
  }

  /** 상태 변화 구독 (즉시 현재 스냅샷 1회 전달) */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    try { listener(this.getSnapshot()); } catch (err) { /* 무시 */ }
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return { ...this.snapshot };
  }

  /** 원격(서버) 모드 사용 가능 여부 */
  get isRemote() {
    return this.remote;
  }

  /** 익명 세션 초기화 + 게스트 프로필 동기화 */
  init() {
    if (!this.initPromise) this.initPromise = this._init();
    return this.initPromise;
  }

  async _init() {
    try {
      const row = await this.api.initSession({
        deviceType: this.deviceType,
        country: this.countryHint,
      });

      if (row) {
        this.remote = true;
        this._mergeServerProfile(row);
      }
    } catch (err) {
      // env 없음/네트워크 오류/익명 로그인 비활성 → LOCAL 모드
      this.remote = false;
      this.snapshot.remote = false;
    }

    this.store.saveProfile(this.snapshot);
    this._emit();
    return this.getSnapshot();
  }

  _mergeServerProfile(row) {
    const accessCount = safeInt(row?.access_count, 0);
    this.snapshot = {
      ...this.snapshot,
      userId: row?.user_id || this.snapshot.userId,
      nickname: typeof row?.nickname === 'string' && row.nickname ? row.nickname : null,
      // 등록된 프로필의 이모지는 서버가 우선. 게스트가 고른 이모지는 로컬 값을 유지한다.
      avatarEmojiId: (row?.is_registered && isValidAvatarId(row?.avatar_emoji_id))
        ? Number(row.avatar_emoji_id)
        : this.snapshot.avatarEmojiId,
      highScore: Math.max(this.snapshot.highScore, safeInt(row?.high_score, 0)),
      maxRound: Math.max(this.snapshot.maxRound, safeInt(row?.max_round, 1)),
      accessCount,
      isRegistered: !!row?.is_registered,
      remote: true,
      syncedAt: this.now(),
    };
  }

  /**
   * 새 게임(재도전) 시작 시 run 토큰을 발급한다.
   * 원격 초기화가 아직 끝나지 않았으면 init 을 기다린다.
   */
  beginRun() {
    this.runSeq += 1;
    const seq = this.runSeq;

    this.runStartedAt = this.now();
    this.runId = null;

    const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
    this.runPromise = (async () => {
      await this.init();
      if (!this.remote || seq !== this.runSeq) return null;

      try {
        const runId = await this.api.beginRun({ seed, build: 'pacbaby-web' });
        if (seq !== this.runSeq) return null; // 그 사이 새 런이 시작됨
        this.runId = runId;
      } catch (err) {
        if (seq === this.runSeq) this.runId = null;
      }
      return seq === this.runSeq ? this.runId : null;
    })();

    return this.runPromise;
  }

  /**
   * 게임 오버 요약을 서버에 제출하고, 필요하면 등록 모달을 연다.
   * @param {object} summary Game.getRunSummary()
   * @returns {Promise<object>} 제출/프롬프트 결과
   */
  async handleRunEnd(summary = {}) {
    const seq = this.runSeq;
    const subject = summary && typeof summary === 'object' ? summary : {};
    const score = Math.max(0, Math.floor(Number(subject.score) || 0));
    const round = Math.max(1, Math.floor(Number(subject.round) || 1));
    const durationMs = Number.isFinite(subject.durationMs) ? subject.durationMs : null;

    this.lastRunSummary = { ...subject, score, round };

    // 로컬 최고 기록 미러 (오프라인 표시용, 서버 판정과 무관)
    this.snapshot.highScore = Math.max(this.snapshot.highScore, score);
    this.snapshot.maxRound = Math.max(this.snapshot.maxRound, round);

    // 게임 오버 횟수는 어시스트 런도 포함해 센다 (프롬프트 스누즈 기준)
    this.promptState.runEndCount += 1;

    const submission = {
      submitted: false,
      accepted: false,
      reason: 'LOCAL_ONLY',
    };

    if (subject.assisted) {
      submission.reason = 'ASSISTED_RUN';
    } else {
      const runId = await this._awaitRun(seq);

      if (!this.remote) {
        submission.reason = 'REMOTE_DISABLED';
      } else if (!runId) {
        submission.reason = 'RUN_NOT_READY';
      } else {
        const plausible = isPlausibleScore({ score, round, durationMs });
        if (!plausible.ok) {
          // 서버도 거부하지만, 불필요한 요청을 줄이고 사유를 남긴다
          submission.reason = plausible.reason;
        } else {
          try {
            const result = await this.api.submitRun({ runId, score, round });
            submission.submitted = true;
            submission.accepted = !!result?.accepted;
            submission.reason = result?.reason || (submission.accepted ? 'ACCEPTED' : 'REJECTED');

            if (submission.accepted) {
              this.snapshot.highScore = Math.max(
                this.snapshot.highScore,
                safeInt(result.high_score, 0),
              );
              this.snapshot.maxRound = Math.max(
                this.snapshot.maxRound,
                safeInt(result.max_round, 1),
              );
            }
          } catch (err) {
            submission.reason = err?.code || 'NETWORK_ERROR';
          }
        }
      }
    }

    // 이 런은 종료됐다 (그 사이 새 런이 시작됐다면 그 런의 토큰을 건드리지 않는다)
    const isCurrentRun = this.runSeq === seq;
    if (isCurrentRun) {
      this.runId = null;
      this.runPromise = null;
    }

    this.store.saveProfile(this.snapshot);
    this.store.savePromptState(this.promptState);
    // 점수가 갱신됐을 수 있으므로 다음 리더보드 조회는 새로 가져온다.
    this.store.clearLeaderboardCache?.();
    this._emit();

    let prompted = false;
    if (isCurrentRun
        && this.shouldPrompt(this.lastRunSummary)
        && typeof this.onPrompt === 'function') {
      prompted = true;
      try { this.onPrompt(this.lastRunSummary); } catch (err) { /* 무시 */ }
    }

    return { ...submission, prompted };
  }

  async _awaitRun(seq = this.runSeq) {
    if (this.runPromise) {
      try { await this.runPromise; } catch (err) { /* 무시 */ }
    }
    return seq === this.runSeq ? this.runId : null;
  }

  /**
   * 등록 유도 조건 판정 (OR)
   * - 서버 접속 횟수 3회 이상
   * - 최고 점수 500점 이상 (이번 런 포함)
   * - 2라운드 이상 (이번 런 포함)
   */
  shouldPrompt(summary = this.lastRunSummary) {
    if (!this.remote) return false;
    if (this.snapshot.isRegistered) return false;
    if (summary?.assisted) return false;

    // "나중에" 이후 쿨다운 (다음 N번의 게임 오버 동안 쉰다)
    if (this.promptState.snoozeUntilRun > 0
        && this.promptState.runEndCount <= this.promptState.snoozeUntilRun) return false;

    const access = this.snapshot.accessCount || 0;
    const bestScore = Math.max(this.snapshot.highScore || 0, Number(summary?.score) || 0);
    const bestRound = Math.max(this.snapshot.maxRound || 1, Number(summary?.round) || 1);

    return access >= this.promptRule.minAccessCount
      || bestScore >= this.promptRule.minHighScore
      || bestRound >= this.promptRule.minRound;
  }

  /** "나중에" — 일정 횟수의 게임 오버 동안 다시 묻지 않는다 */
  dismissPrompt() {
    this.promptState.snoozeUntilRun = this.promptState.runEndCount
      + Math.max(1, this.promptRule.dismissCooldownRuns);
    this.store.savePromptState(this.promptState);
    return this.promptState;
  }

  /** 닉네임 중복 확인 (형식 오류는 서버 왕복 없이 즉시 반환) */
  async checkNickname(rawNickname) {
    const validated = validateNickname(rawNickname);
    if (!validated.ok) {
      return { available: false, reason: validated.reason };
    }
    if (!this.remote) {
      return { available: false, reason: 'REMOTE_DISABLED' };
    }
    return this.api.checkNickname(validated.value);
  }

  /** 게스트 → 등록 프로필 전환 */
  async register(rawNickname, avatarId) {
    const validated = validateNickname(rawNickname);
    if (!validated.ok) throw new ProfileError(validated.reason);
    if (!isValidAvatarId(avatarId)) throw new ProfileError('INVALID_AVATAR');
    if (!this.remote) throw new ProfileError('REMOTE_DISABLED');

    const row = await this.api.registerProfile(validated.value, Number(avatarId));
    if (!row) throw new ProfileApiError('PROFILE_UNAVAILABLE');

    this.snapshot.nickname = row.nickname || validated.value;
    this.snapshot.avatarEmojiId = isValidAvatarId(row.avatar_emoji_id)
      ? Number(row.avatar_emoji_id)
      : Number(avatarId);
    this.snapshot.isRegistered = true;
    this.snapshot.syncedAt = this.now();

    // 등록 후에는 다시 묻지 않는다
    this.promptState.snoozeUntilRun = this.promptState.runEndCount;

    this.store.saveProfile(this.snapshot);
    this.store.savePromptState(this.promptState);
    this.store.clearLeaderboardCache?.();
    this._emit();
    return this.getSnapshot();
  }

  /**
   * 리더보드 조회 (캐시 우선)
   * @param {{ force?: boolean, limit?: number, timeoutMs?: number }} options
   */
  async fetchLeaderboard({ force = false, limit = LEADERBOARD_LIMIT, timeoutMs } = {}) {
    const cache = this.store.loadLeaderboardCache();
    const cacheFresh = cache && (this.now() - safeInt(cache.at, 0)) < this.cacheMs;

    if (!force && cacheFresh) {
      return { rows: cache.rows, cached: true, offline: false, at: cache.at };
    }

    const waitMs = Number.isFinite(timeoutMs) ? timeoutMs : this.leaderboardTimeoutMs;

    // 초기화(익명 로그인)가 끝나기 전에 호출되면 remote=false 로 오판하지 않도록 잠시 기다린다.
    if (!this.remote && this.initPromise) {
      await this._withTimeout(this.initPromise, waitMs).catch(() => null);
    }

    if (!this.remote) {
      return {
        rows: cache?.rows || [],
        cached: !!cache,
        offline: true,
        at: cache?.at || 0,
      };
    }

    try {
      const rows = await this._withTimeout(this.api.getLeaderboard(limit, 0), waitMs);
      const at = this.now();
      this.store.saveLeaderboardCache({ rows, at });
      return { rows, cached: false, offline: false, at };
    } catch (err) {
      return {
        rows: cache?.rows || [],
        cached: !!cache,
        offline: true,
        reason: err?.code || 'NETWORK_ERROR',
        at: cache?.at || 0,
      };
    }
  }

  /** Promise 가 너무 오래 걸리면 TIMEOUT 코드로 거절한다 (모바일 네트워크 대비) */
  _withTimeout(promise, ms) {
    if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(promise);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error('LEADERBOARD_TIMEOUT');
        error.code = 'TIMEOUT';
        reject(error);
      }, ms);
      Promise.resolve(promise).then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  _emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch (err) { /* 무시 */ }
    }
  }
}
