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

/** 일시 오류 — 다음 접속/재시작 때 재제출할 수 있게 보류 저장한다 */
const RETRYABLE_SUBMISSION_REASONS = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'NO_RESPONSE',
]);

/** 영구 거절 — 보류 저장을 비운다 */
const PERMANENT_SUBMISSION_REJECTIONS = new Set([
  'REJECTED',
  'RUN_NOT_FOUND',
  'RUN_ALREADY_SUBMITTED',
]);

/** 제출 실패 사유를 사용자 안내 문구로 변환 (토스트/리더보드 공용) */
export function describeSubmissionReason(reason) {
  switch (reason) {
    case 'ACCEPTED': return '반영 완료';
    case 'ASSISTED_RUN': return '데모·봇 플레이는 순위에 반영되지 않아요';
    case 'REMOTE_DISABLED': return '서버에 연결할 수 없음(로컬 모드)';
    case 'RUN_NOT_READY': return '게임 시작 정보가 없어 제출하지 못함';
    case 'RUN_NOT_FOUND': return '게임 기록이 만료됨';
    case 'RUN_ALREADY_SUBMITTED': return '이미 제출된 기록';
    case 'NETWORK_ERROR': return '네트워크 연결 오류';
    case 'TIMEOUT': return '서버 응답 시간 초과';
    case 'RATE_LIMITED': return '요청이 너무 많음';
    case 'REJECTED': return '서버 검증에서 거절됨';
    case 'SCORE_OUT_OF_RANGE': return '점수 범위를 벗어남';
    case 'SCORE_EXCEEDS_CAP': return '라운드별 점수 상한을 초과함';
    case 'ROUND_OUT_OF_RANGE': return '라운드 범위를 벗어남';
    case 'TOO_FAST': return '플레이 시간이 너무 짧음';
    default: return reason ? `알 수 없는 오류(${reason})` : '알 수 없는 오류';
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
    // 전체 1위 기록 (리더보드 캐시/조회로 채운다 — 없으면 null → 화면 '-')
    topScore: null,
    topRound: null,
    topUpdatedAt: 0,
    accessCount: 0,
    isRegistered: false,
    deviceType,
    country: null,
    remote: false,
    syncedAt: 0,
    // 최근 점수 제출 결과 (조용한 실패 방지용 UI 안내)
    lastSubmission: null,
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

    // 저장된 리더보드 캐시가 있으면 전체 1위를 즉시 보여 준다 (오프라인 폴백).
    const cachedBoard = this.store.loadLeaderboardCache?.();
    const cachedTop = Array.isArray(cachedBoard?.rows) ? cachedBoard.rows[0] : null;
    if (cachedTop) {
      this.snapshot.topScore = safeInt(cachedTop.high_score, 0);
      this.snapshot.topRound = Math.max(1, safeInt(cachedTop.max_round, 1));
      this.snapshot.topUpdatedAt = safeInt(cachedBoard.at, 0);
    }

    this.promptState = this.store.loadPromptState();
    this.remote = false;
    this.initPromise = null;
    this.initSeq = 0;
    this.runSeq = 0;
    this.runId = null;
    this.runPromise = null;
    this.runTokens = new Map();     // seq → { runId, ready, resolveReady }
    this.endedRunId = null;         // 가장 최근에 종료된 런의 토큰 (pagehide 보류 저장용)
    this.runStartedAt = 0;
    this.lastRunSummary = null;

    // 점수 제출(handleRunEnd / 보류 재제출) 진행 상태
    this.submissionPromise = null;
    this.pendingRecoveryPromise = null;
    this.recoveryKey = null;
    this.recoveryResult = null;
    this.lastSubmission = null;

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

  /**
   * 익명 세션 초기화 + 게스트 프로필 동기화
   * - env 없음/네트워크 실패(LOCAL 모드)면 initPromise 를 비워 다음 호출에서 재시도한다.
   * - force: true 이면 이전 성공/실패와 무관하게 새로 시도한다.
   */
  init({ force = false } = {}) {
    if (force) this.initPromise = null;
    if (this.initPromise) return this.initPromise;

    const seq = this.initSeq + 1;
    this.initSeq = seq;
    const promise = this._init(seq);
    this.initPromise = promise;

    promise.then(
      () => {
        // 최신 시도가 LOCAL 모드로 끝났다면 캐시를 비워 다음 init() 에서 재시도한다.
        if (this.initSeq === seq && !this.remote) this.initPromise = null;
      },
      () => {
        if (this.initSeq === seq) this.initPromise = null;
      },
    );

    return promise;
  }

  async _init(seq = this.initSeq) {
    const isCurrent = () => seq === this.initSeq;

    try {
      const row = await this.api.initSession({
        deviceType: this.deviceType,
        country: this.countryHint,
      });

      // 더 새로운 초기화가 시작됐다면 이 결과는 버린다 (force 재시도 경쟁 대비).
      if (!isCurrent()) return this.getSnapshot();

      if (row) {
        this.remote = true;
        this._mergeServerProfile(row);
        // init 완료 직후: 이전 세션에서 보류된 미제출 런을 새 begin_run 이전에 1회 재제출한다.
        await this._recoverPendingSubmission();
        if (!isCurrent()) return this.getSnapshot();
      }
    } catch (err) {
      // env 없음/네트워크 오류/익명 로그인 비활성 → LOCAL 모드
      if (!isCurrent()) return this.getSnapshot();
      this.remote = false;
      this.snapshot.remote = false;
    }

    if (isCurrent()) {
      this.store.saveProfile(this.snapshot);
      this._emit();
    }
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
   * - 진행 중인 이전 런 제출이 끝날 때까지 기다린 뒤 begin_run 을 호출한다.
   *   (게임 오버 직후 빠른 재시작 시 서버가 이전 런을 ABANDONED 로 덮어쓰는 현상 방지)
   * - 원격 초기화가 아직 끝나지 않았으면 init 을 기다린다.
   */
  beginRun() {
    this.runSeq += 1;
    const seq = this.runSeq;

    this.runStartedAt = this.now();
    this.runId = null;
    this.endedRunId = null;

    // 새 begin_run 보다 먼저 끝나야 하는 제출 (호출 시점 기준으로 고정)
    const previousSubmission = this.submissionPromise;

    // handleRunEnd 는 begin_run 결과(runId)만 기다리면 되도록,
    // 제출 대기(barrier)와 분리된 ready 프라미스를 둔다 (교착 방지).
    const token = { runId: null, ready: null, resolveReady: null };
    token.ready = new Promise(resolve => { token.resolveReady = resolve; });
    this.runTokens.set(seq, token);
    // 늦게 도착하는 이전 런 정리를 위해 최근 토큰만 유지한다.
    for (const key of this.runTokens.keys()) {
      if (key <= seq - 3) this.runTokens.delete(key);
    }

    const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
    this.runPromise = (async () => {
      try {
        // 1) 이전 런 점수 제출 완료 대기 → 서버 ABANDONED 덮어쓰기 방지
        await this._settle(previousSubmission);

        // 2) 원격 초기화 (완료 직후 보류된 미제출 런을 1회 재제출한다)
        await this.init();
        if (!this.remote || seq !== this.runSeq) return null;

        // init 사이에 새로 시작된 제출이 있으면 begin_run 전에 마저 기다린다.
        if (this.submissionPromise && this.submissionPromise !== previousSubmission) {
          await this._settle(this.submissionPromise);
        }
        if (seq !== this.runSeq) return null;

        // 3) 오프라인/일시 오류로 남은 보류 런도 새 begin_run 이전에 재제출 시도
        await this._recoverPendingSubmission();
        if (seq !== this.runSeq) return null;

        try {
          const runId = await this.api.beginRun({ seed, build: 'pacbaby-web' });
          if (seq !== this.runSeq) return null; // 그 사이 새 런이 시작됨
          this.runId = runId;
          token.runId = runId;
        } catch (err) {
          if (seq === this.runSeq) this.runId = null;
        }
        return seq === this.runSeq ? this.runId : null;
      } finally {
        token.resolveReady?.(token.runId);
      }
    })();

    return this.runPromise;
  }

  /**
   * 게임 오버 요약을 서버에 제출하고, 필요하면 등록 모달을 연다.
   * 진행 중인 제출은 `submissionPromise` 로 추적해 다음 beginRun 이 기다린다.
   * @param {object} summary Game.getRunSummary()
   * @returns {Promise<object>} 제출/프롬프트 결과
   */
  handleRunEnd(summary = {}) {
    const task = this._handleRunEnd(summary);
    this.submissionPromise = task;

    const clear = () => {
      if (this.submissionPromise === task) this.submissionPromise = null;
    };
    task.then(clear, clear);
    return task;
  }

  async _handleRunEnd(summary = {}) {
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
      pending: false,
    };

    if (subject.assisted) {
      submission.reason = 'ASSISTED_RUN';
    } else {
      const runId = await this._awaitRun(seq);
      if (runId) this.endedRunId = runId; // pagehide 보류 저장용

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

          // 일시 오류/오프라인: 점수를 버리지 않고 다음 접속/재시작 때 재제출한다.
          if (submission.accepted) {
            this._clearPendingSubmissionFor(runId);
          } else if (RETRYABLE_SUBMISSION_REASONS.has(submission.reason)) {
            submission.pending = !!this._savePendingSubmission({ runId, score, round });
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

    // 조용한 실패 방지: 최근 제출 결과를 스냅샷/구독자에게 남긴다.
    this._recordSubmission({
      accepted: submission.accepted,
      reason: submission.reason,
      score,
      round,
    });

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

  /** 진행 중인 제출 프라미스를 안전하게 기다린다 (실패는 결과 객체에 이미 기록됨) */
  async _settle(promise) {
    if (!promise) return;
    try { await promise; } catch (err) { /* 무시 */ }
  }

  /**
   * 해당 seq 런의 begin_run 결과(runId)를 기다린다.
   * beginRun 의 제출 대기(barrier)가 아니라 ready 프라미스만 기다리므로 교착이 없다.
   */
  async _awaitRun(seq = this.runSeq) {
    const token = this.runTokens.get(seq);
    if (token) {
      try { await token.ready; } catch (err) { /* 무시 */ }
      if (token.runId) return token.runId;
    }
    return seq === this.runSeq ? this.runId : null;
  }

  /** 최근 제출 결과를 스냅샷에 기록 (토스트/리더보드 안내용) */
  _recordSubmission({ accepted = false, reason = 'LOCAL_ONLY', score = 0, round = 1 } = {}) {
    const entry = {
      accepted: !!accepted,
      reason: reason || (accepted ? 'ACCEPTED' : 'REJECTED'),
      score: Math.max(0, Math.floor(Number(score) || 0)),
      round: Math.max(1, Math.floor(Number(round) || 1)),
      at: this.now(),
    };
    this.lastSubmission = entry;
    this.snapshot.lastSubmission = entry;
    return entry;
  }

  /** 오프라인/일시 오류로 제출하지 못한 런을 임시 보관한다 */
  _savePendingSubmission({ runId, score, round }) {
    if (!runId || !(Number(score) > 0)) return null;
    if (!this.store.savePendingSubmission) return null;

    const entry = {
      runId,
      score: Math.max(0, Math.floor(Number(score) || 0)),
      round: Math.max(1, Math.floor(Number(round) || 1)),
      at: this.now(),
    };
    return this.store.savePendingSubmission(entry) === false ? null : entry;
  }

  /** 같은 런의 보류 항목만 비운다 (다른 런의 보류 점수를 지우지 않는다) */
  _clearPendingSubmissionFor(runId) {
    if (!runId) return;
    const pending = this.store.loadPendingSubmission?.();
    if (!pending || pending.runId === runId) {
      this.store.clearPendingSubmission?.();
    }
  }

  /**
   * pagehide 등으로 페이지를 떠날 때 아직 서버에 제출되지 않은 정식 매뉴얼 런을 보류 저장한다.
   * (다음 접속의 init 직후 1회 재제출)
   * @param {object} summary Game.getRunSummary()
   * @param {{ ended?: boolean }} [options] ended=true 면 이미 끝난 런의 토큰을 사용한다
   */
  capturePendingRun(summary = {}, { ended = false } = {}) {
    const subject = summary && typeof summary === 'object' ? summary : {};
    const score = Math.max(0, Math.floor(Number(subject.score) || 0));
    const round = Math.max(1, Math.floor(Number(subject.round) || 1));

    if (subject.assisted) return null;
    if (score <= 0 || !this.remote) return null;

    const runId = ended ? (this.endedRunId || this.runId) : this.runId;
    if (!runId) return null;

    // 이미 서버에 반영된 동일 기록은 보류 저장하지 않는다.
    const last = this.snapshot.lastSubmission;
    if (last?.accepted && last.score === score && last.round === round) return null;

    return this._savePendingSubmission({ runId, score, round });
  }
  /**
   * 보류된 미제출 런을 1회 재제출한다.
   * - 성공 또는 영구 거절(REJECTED/RUN_NOT_FOUND/RUN_ALREADY_SUBMITTED)이면 보류를 비운다.
   * - 같은 보류 항목은 한 번만 시도한다 (force 로 재시도).
   */
  _recoverPendingSubmission({ force = false } = {}) {
    if (!this.remote) return Promise.resolve(null);
    if (this.pendingRecoveryPromise) return this.pendingRecoveryPromise;

    const pending = this.store.loadPendingSubmission?.() || null;
    if (!pending?.runId) {
      this.recoveryKey = null;
      this.recoveryResult = null;
      return Promise.resolve(null);
    }

    const key = `${pending.runId}:${pending.score}:${pending.round}`;
    if (!force && this.recoveryKey === key) {
      return Promise.resolve(this.recoveryResult || null);
    }
    this.recoveryKey = key;

    const task = (async () => {
      let accepted = false;
      let reason = 'NETWORK_ERROR';

      try {
        const result = await this.api.submitRun({
          runId: pending.runId,
          score: pending.score,
          round: pending.round,
        });
        accepted = !!result?.accepted;
        reason = result?.reason || (accepted ? 'ACCEPTED' : 'REJECTED');

        if (accepted) {
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
        reason = err?.code || 'NETWORK_ERROR';
      }

      if (accepted || PERMANENT_SUBMISSION_REJECTIONS.has(reason)) {
        this.store.clearPendingSubmission?.();
      }

      const outcome = {
        accepted,
        reason,
        score: pending.score,
        round: pending.round,
        recovered: true,
      };
      this._recordSubmission(outcome);
      this.recoveryResult = outcome;

      this.store.saveProfile?.(this.snapshot);
      this.store.clearLeaderboardCache?.();
      this._emit();
      return outcome;
    })();

    this.pendingRecoveryPromise = task;
    const clear = () => {
      if (this.pendingRecoveryPromise === task) this.pendingRecoveryPromise = null;
    };
    task.then(clear, clear);
    return task;
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

    // 신규 등록 성공 직후: 보류된 미제출 런을 1회 재제출한다.
    await this._recoverPendingSubmission({ force: true });

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
      return this._leaderboardResult({
        rows: cache.rows,
        cached: true,
        offline: false,
        at: cache.at,
      });
    }

    const waitMs = Number.isFinite(timeoutMs) ? timeoutMs : this.leaderboardTimeoutMs;

    // 초기화(익명 로그인)가 끝나기 전에 호출되면 remote=false 로 오판하지 않도록 잠시 기다린다.
    if (!this.remote && this.initPromise) {
      await this._withTimeout(this.initPromise, waitMs).catch(() => null);
    }

    if (!this.remote) {
      return this._leaderboardResult({
        rows: cache?.rows || [],
        cached: !!cache,
        offline: true,
        at: cache?.at || 0,
      });
    }

    try {
      const rows = await this._withTimeout(this.api.getLeaderboard(limit, 0), waitMs);
      const at = this.now();
      this.store.saveLeaderboardCache({ rows, at });
      return this._leaderboardResult({ rows, cached: false, offline: false, at });
    } catch (err) {
      return this._leaderboardResult({
        rows: cache?.rows || [],
        cached: !!cache,
        offline: true,
        reason: err?.code || 'NETWORK_ERROR',
        at: cache?.at || 0,
      });
    }
  }

  /**
   * 리더보드 1위 기록을 스냅샷(topScore/topRound)에 채운다.
   * - 내 최고/전체 1위 헤더 표시용. 기존 30초 캐시를 그대로 활용한다.
   * - 오프라인/미설정/조회 실패에도 절대 throw 하지 않아 게임 시작을 막지 않는다.
   * @param {{ force?: boolean, limit?: number, timeoutMs?: number }} options
   */
  async loadLeaderboard({ force = false, limit, timeoutMs } = {}) {
    try {
      await this.fetchLeaderboard({ force, limit, timeoutMs });
    } catch (err) {
      // 예상 밖 오류: 표시용 1위 기록만 비우고 게임 흐름은 유지한다.
      this._applyLeaderboardTop([], 0);
    }
    return this.getSnapshot();
  }

  /** 리더보드 응답을 표시용 결과로 감싸고 1위 기록을 스냅샷에 반영한다 */
  _leaderboardResult({ rows = [], cached = false, offline = false, at = 0, reason } = {}) {
    this._applyLeaderboardTop(rows, at);
    const result = { rows, cached, offline, at };
    if (reason) result.reason = reason;
    return result;
  }

  /** 첫 번째(1위) 행의 점수/라운드를 스냅샷에 반영 (변화 시에만 구독자 알림) */
  _applyLeaderboardTop(rows, at = 0) {
    const list = Array.isArray(rows) ? rows : [];
    const top = list.find(row => row && Number.isFinite(Number(row.high_score))) || null;
    const score = top ? safeInt(top.high_score, 0) : null;
    const round = top ? Math.max(1, safeInt(top.max_round, 1)) : null;
    const changed = score !== this.snapshot.topScore || round !== this.snapshot.topRound;

    this.snapshot.topScore = score;
    this.snapshot.topRound = round;
    this.snapshot.topUpdatedAt = safeInt(at, 0);

    if (changed) this._emit();
    return this.snapshot;
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
