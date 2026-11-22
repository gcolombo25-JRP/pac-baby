/**
 * Pac-Baby: ProfileManager 테스트 (fake API/Store, 네트워크 없음)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import ProfileManager from '../src/profile.js';
import ProfileApi, { ProfileApiError, RPC_TIMEOUT_MS } from '../src/profileApi.js';

function createStore() {
  const data = {
    profile: null,
    prompt: { runEndCount: 0, snoozeUntilRun: 0 },
    cache: null,
    pending: null,
  };

  return {
    data,
    loadProfile: () => data.profile,
    saveProfile: (profile) => { data.profile = profile; },
    loadPromptState: () => ({ ...data.prompt }),
    savePromptState: (state) => { data.prompt = { ...state }; },
    loadLeaderboardCache: () => data.cache,
    saveLeaderboardCache: (entry) => { data.cache = entry; },
    clearLeaderboardCache: () => { data.cache = null; },
    loadPendingSubmission: () => data.pending,
    savePendingSubmission: (entry) => { data.pending = { ...entry }; return true; },
    clearPendingSubmission: () => { data.pending = null; },
  };
}

function createSession(overrides = {}) {
  return {
    user_id: 'u1',
    nickname: null,
    avatar_emoji_id: 1,
    high_score: 0,
    max_round: 1,
    access_count: 1,
    is_registered: false,
    ...overrides,
  };
}

function createApi(options = {}) {
  const calls = { beginRun: 0, submitRun: [], checkNickname: [], registerProfile: [], leaderboard: 0 };

  return {
    calls,
    async initSession() {
      return options.session === null ? null : createSession(options.session || {});
    },
    async beginRun() {
      calls.beginRun += 1;
      return 'run-1';
    },
    async submitRun(args) {
      calls.submitRun.push(args);
      return options.submitResult || { accepted: true, high_score: 600, max_round: 2, reason: null };
    },
    async checkNickname(name) {
      calls.checkNickname.push(name);
      return name === 'taken'
        ? { available: false, reason: 'NICKNAME_TAKEN' }
        : { available: true, reason: 'OK' };
    },
    async registerProfile(name, avatar) {
      calls.registerProfile.push([name, avatar]);
      return { nickname: name, avatar_emoji_id: avatar, is_registered: true };
    },
    async getLeaderboard() {
      calls.leaderboard += 1;
      return [{ rank: 1, nickname: 'baby', high_score: 500, max_round: 2 }];
    },
  };
}

function createManager(options = {}) {
  const store = options.store || createStore();
  const api = options.api || createApi(options.apiOptions || {});
  const manager = new ProfileManager({
    api,
    store,
    deviceType: 'PC',
    countryHint: 'KR',
    now: options.now,
    promptRule: options.promptRule,
    cacheMs: options.cacheMs,
    onPrompt: options.onPrompt,
  });
  return { manager, api, store };
}

test('초기화 시 서버 프로필과 로컬 최고 기록을 병합한다', async () => {
  const store = createStore();
  store.data.profile = { highScore: 300, maxRound: 1, avatarEmojiId: 2 };

  const { manager } = createManager({
    store,
    apiOptions: { session: { access_count: 2, high_score: 100, max_round: 1 } },
  });

  const snapshot = await manager.init();
  assert.equal(manager.isRemote, true);
  assert.equal(snapshot.accessCount, 2);
  assert.equal(snapshot.highScore, 300, '로컬 최고 기록 유지');
  assert.equal(snapshot.avatarEmojiId, 2);
  assert.equal(snapshot.country, 'KR');
});

test('등록 유도 조건은 접속 3회 / 500점 / 2라운드 중 하나면 충족한다', async () => {
  const cases = [
    { session: { access_count: 3 }, summary: { score: 0, round: 1 }, expected: true },
    { session: { access_count: 1 }, summary: { score: 500, round: 1 }, expected: true },
    { session: { access_count: 1 }, summary: { score: 0, round: 2 }, expected: true },
    { session: { access_count: 2 }, summary: { score: 499, round: 1 }, expected: false },
  ];

  for (const item of cases) {
    const { manager } = createManager({ apiOptions: { session: item.session } });
    await manager.init();
    assert.equal(manager.shouldPrompt(item.summary), item.expected, JSON.stringify(item));
  }
});

test('어시스트(DEMO/BOT/치트) 런은 제출하지 않고 프롬프트도 띄우지 않는다', async () => {
  const { manager, api } = createManager({ apiOptions: { session: { access_count: 9 } } });
  await manager.init();
  await manager.beginRun();

  const result = await manager.handleRunEnd({
    score: 5000, round: 3, durationMs: 60000, assisted: true,
  });

  assert.equal(result.submitted, false);
  assert.equal(result.reason, 'ASSISTED_RUN');
  assert.equal(result.prompted, false);
  assert.equal(api.calls.submitRun.length, 0);
});

test('게임 오버 시 run 토큰으로 점수를 제출하고 최고 기록을 갱신한다', async () => {
  const prompts = [];
  const { manager, api } = createManager({
    apiOptions: { session: { access_count: 2 } },
    onPrompt: summary => prompts.push(summary),
  });
  await manager.init();
  await manager.beginRun();

  const result = await manager.handleRunEnd({
    score: 600, round: 2, durationMs: 120000, assisted: false,
  });

  assert.equal(result.submitted, true);
  assert.equal(result.accepted, true);
  assert.equal(api.calls.submitRun.length, 1);
  assert.equal(api.calls.submitRun[0].runId, 'run-1');
  assert.equal(api.calls.submitRun[0].score, 600);
  assert.equal(result.prompted, true, '500점/2라운드 조건 충족');
  assert.equal(prompts.length, 1);
  assert.equal(manager.getSnapshot().highScore, 600);
  assert.equal(manager.getSnapshot().maxRound, 2);
});

test('원격을 쓸 수 없으면 LOCAL 모드로 동작하고 등록 유도도 하지 않는다', async () => {
  const { manager, api } = createManager({ apiOptions: { session: null } });
  await manager.init();

  assert.equal(manager.isRemote, false);
  assert.equal(await manager.beginRun(), null);

  const result = await manager.handleRunEnd({ score: 999, round: 2, durationMs: 120000 });
  assert.equal(result.reason, 'REMOTE_DISABLED');
  assert.equal(api.calls.submitRun.length, 0);
  assert.equal(manager.shouldPrompt({ score: 999, round: 2 }), false);
});

test('비정상 점수는 서버 호출 전에 차단된다', async () => {
  const { manager, api } = createManager();
  await manager.init();
  await manager.beginRun();

  const result = await manager.handleRunEnd({
    score: 999999, round: 1, durationMs: 60000,
  });

  assert.equal(result.submitted, false);
  assert.equal(result.reason, 'SCORE_EXCEEDS_CAP');
  assert.equal(api.calls.submitRun.length, 0);
});

test('닉네임 확인/등록이 스냅샷에 반영된다', async () => {
  const { manager, api } = createManager({ apiOptions: { session: { access_count: 3 } } });
  await manager.init();

  const taken = await manager.checkNickname('taken');
  assert.equal(taken.available, false);

  const invalid = await manager.checkNickname('a!');
  assert.equal(invalid.reason, 'INVALID_FORMAT');
  assert.equal(api.calls.checkNickname.length, 1, '형식 오류는 서버 호출 없음');

  const ok = await manager.checkNickname('baby');
  assert.equal(ok.available, true);

  const snapshot = await manager.register('baby', 3);
  assert.equal(snapshot.isRegistered, true);
  assert.equal(snapshot.nickname, 'baby');
  assert.equal(snapshot.avatarEmojiId, 3);
  assert.deepEqual(api.calls.registerProfile[0], ['baby', 3]);
  assert.equal(manager.shouldPrompt({ score: 9999, round: 9 }), false, '등록 후에는 묻지 않는다');
});

test('"나중에" 선택 시 3번의 게임 오버 동안 프롬프트를 쉰다', async () => {
  const { manager } = createManager({
    apiOptions: { session: { access_count: 3 } },
    onPrompt: () => {},
  });
  await manager.init();

  await manager.beginRun();
  let result = await manager.handleRunEnd({ score: 0, round: 1, durationMs: 60000 });
  assert.equal(result.prompted, true);

  manager.dismissPrompt();

  for (let i = 0; i < 3; i++) {
    await manager.beginRun();
    result = await manager.handleRunEnd({ score: 0, round: 1, durationMs: 60000 });
    assert.equal(result.prompted, false, `${i + 1}번째 쿨다운`);
  }

  await manager.beginRun();
  result = await manager.handleRunEnd({ score: 0, round: 1, durationMs: 60000 });
  assert.equal(result.prompted, true, '쿨다운 종료 후 다시 안내');
});

test('리더보드는 30초 캐시를 사용하고 force 시 갱신한다', async () => {
  let now = 1000;
  const { manager, api } = createManager({ now: () => now, cacheMs: 30000 });
  await manager.init();

  const first = await manager.fetchLeaderboard();
  assert.equal(first.rows.length, 1);
  assert.equal(api.calls.leaderboard, 1);

  now += 1000;
  const cached = await manager.fetchLeaderboard();
  assert.equal(cached.cached, true);
  assert.equal(api.calls.leaderboard, 1, '캐시 사용');

  await manager.fetchLeaderboard({ force: true });
  assert.equal(api.calls.leaderboard, 2);

  now += 31000;
  await manager.fetchLeaderboard();
  assert.equal(api.calls.leaderboard, 3, '캐시 만료 후 갱신');
});

test('게임 오버 직후 재도전해도 이전 제출이 새 런 토큰을 지우지 않는다', async () => {
  const { manager, api } = createManager({ apiOptions: { session: { access_count: 1 } } });

  let runNumber = 0;
  api.beginRun = async () => {
    runNumber += 1;
    return `run-${runNumber}`;
  };

  await manager.init();
  await manager.beginRun(); // run-1

  let releaseSubmit;
  const gate = new Promise((resolve) => { releaseSubmit = resolve; });
  api.submitRun = async () => {
    await gate;
    return { accepted: true, high_score: 600, max_round: 2, reason: null };
  };

  const finishing = manager.handleRunEnd({ score: 600, round: 2, durationMs: 120000 });
  await new Promise(resolve => setTimeout(resolve, 0));

  // 즉시 재도전: beginRun 은 이전 제출이 끝날 때까지 begin_run 을 미룬다.
  const restarting = manager.beginRun();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(runNumber, 1, '이전 제출이 끝나기 전에는 새 begin_run 을 호출하지 않는다');

  releaseSubmit();
  const result = await finishing;
  await restarting;
  assert.equal(manager.runId, 'run-2', '새 런 토큰이 유지된다');
  assert.equal(result.prompted, false, '이전 런의 팝업이 새 게임을 방해하지 않는다');
});

test('RPC 기본 타임아웃은 8초이며, 초과 시 TIMEOUT 오류를 던진다', async () => {
  assert.equal(RPC_TIMEOUT_MS, 8000);

  const api = new ProfileApi({
    clientProvider: () => ({ rpc: () => new Promise(() => {}) }),
    rpcTimeoutMs: 15,
  });

  await assert.rejects(
    api.checkNickname('baby'),
    err => err instanceof ProfileApiError && err.code === 'TIMEOUT',
  );
});

test('AbortController 지원 시 RPC 에 abortSignal 을 연결하고 타임아웃에 중단한다', async () => {
  let captured = null;
  const api = new ProfileApi({
    clientProvider: () => ({
      rpc: () => ({
        abortSignal(signal) {
          captured = signal;
          return new Promise(() => {});
        },
      }),
    }),
    rpcTimeoutMs: 10,
  });

  await assert.rejects(api.checkNickname('baby'), err => err.code === 'TIMEOUT');
  assert.ok(captured, 'abortSignal 이 전달되었다');
  assert.equal(captured.aborted, true, '타임아웃 시 요청이 중단된다');
});

test('초기화 실패 후 initPromise 에 고정되지 않고 다음 init()/force 로 재시도한다', async () => {
  const { manager, api } = createManager({ apiOptions: { session: { access_count: 1 } } });

  let attempts = 0;
  api.initSession = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return createSession({ access_count: 2 });
  };

  const first = await manager.init();
  assert.equal(first.remote, false);
  assert.equal(manager.isRemote, false);
  assert.equal(manager.initPromise, null, '실패한 초기화는 캐시하지 않는다');

  const second = await manager.init();
  assert.equal(attempts, 2, '다음 init() 호출이 재시도한다');
  assert.equal(manager.isRemote, true);
  assert.equal(second.accessCount, 2);

  await manager.init({ force: true });
  assert.equal(attempts, 3, 'force: true 는 성공 후에도 다시 시도한다');
});

test('일시 오류로 실패한 런은 보류 저장 후 다음 시작에서 재제출한다', async () => {
  const { manager, api, store } = createManager({ apiOptions: { session: { access_count: 1 } } });

  let runNumber = 0;
  api.beginRun = async () => {
    runNumber += 1;
    return `run-${runNumber}`;
  };

  await manager.init();
  await manager.beginRun(); // run-1

  let failOnce = true;
  api.submitRun = async (args) => {
    api.calls.submitRun.push(args);
    if (failOnce) {
      failOnce = false;
      const error = new Error('offline');
      error.code = 'NETWORK_ERROR';
      throw error;
    }
    return { accepted: true, high_score: 700, max_round: 2 };
  };

  const result = await manager.handleRunEnd({ score: 600, round: 2, durationMs: 120000 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'NETWORK_ERROR');
  assert.equal(result.pending, true, '보류 저장됨');
  assert.equal(store.data.pending.runId, 'run-1');
  assert.equal(store.data.pending.score, 600);
  assert.equal(manager.getSnapshot().lastSubmission.reason, 'NETWORK_ERROR');

  // 다음 시작: 보류 런을 새 begin_run 이전에 재제출한다
  await manager.beginRun();
  assert.equal(store.data.pending, null, '성공 후 보류 해제');
  assert.equal(api.calls.submitRun.length, 2);
  assert.equal(api.calls.submitRun[1].runId, 'run-1');
  assert.equal(manager.getSnapshot().lastSubmission.accepted, true);
  assert.equal(manager.runId, 'run-2');
});

test('보류 런이 영구 거절되면 저장을 비우고 사유를 남긴다', async () => {
  const { manager, api, store } = createManager({ apiOptions: { session: { access_count: 1 } } });
  store.data.pending = { runId: 'run-old', score: 500, round: 1, at: 1 };

  api.submitRun = async (args) => {
    api.calls.submitRun.push(args);
    return { accepted: false, reason: 'RUN_NOT_FOUND' };
  };

  await manager.init(); // init 직후 1회 재시도 → 영구 거절

  assert.equal(api.calls.submitRun.length, 1);
  assert.equal(store.data.pending, null, '영구 거절은 보류 해제');
  assert.equal(manager.getSnapshot().lastSubmission.accepted, false);
  assert.equal(manager.getSnapshot().lastSubmission.reason, 'RUN_NOT_FOUND');
});

test('보류 재제출이 다시 일시 오류면 보류를 유지하고 반복 호출하지 않는다', async () => {
  const { manager, api, store } = createManager({ apiOptions: { session: { access_count: 1 } } });
  store.data.pending = { runId: 'run-old', score: 450, round: 1, at: 1 };

  api.submitRun = async (args) => {
    api.calls.submitRun.push(args);
    const error = new Error('timeout');
    error.code = 'TIMEOUT';
    throw error;
  };

  await manager.init();
  assert.equal(api.calls.submitRun.length, 1);
  assert.equal(store.data.pending.runId, 'run-old', '일시 오류는 보류 유지');
  assert.equal(manager.getSnapshot().lastSubmission.reason, 'TIMEOUT');

  await manager.beginRun();
  assert.equal(api.calls.submitRun.length, 1, '같은 보류 항목은 한 번만 시도');
  assert.equal(store.data.pending.runId, 'run-old');
});

test('pagehide 시 미제출 매뉴얼 런을 보류 저장하고 assisted/0점은 제외한다', async () => {
  const { manager, store } = createManager({ apiOptions: { session: { access_count: 1 } } });
  await manager.init();
  await manager.beginRun();

  const saved = manager.capturePendingRun({ score: 300, round: 1, assisted: false });
  assert.equal(saved.runId, 'run-1');
  assert.equal(store.data.pending.score, 300);

  assert.equal(manager.capturePendingRun({ score: 200, round: 1, assisted: true }), null);
  assert.equal(manager.capturePendingRun({ score: 0, round: 1 }), null);
  assert.equal(store.data.pending.score, 300, '제외 대상은 기존 보류를 덮어쓰지 않는다');
});

test('등록 성공 직후 보류된 런을 다시 제출한다', async () => {
  const { manager, api, store } = createManager({ apiOptions: { session: { access_count: 1 } } });
  store.data.pending = { runId: 'run-guest', score: 600, round: 2, at: 1 };

  let attempts = 0;
  api.submitRun = async (args) => {
    api.calls.submitRun.push(args);
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('offline');
      error.code = 'NETWORK_ERROR';
      throw error;
    }
    return { accepted: true, high_score: 800, max_round: 3 };
  };

  await manager.init(); // 1차 시도 실패 → 보류 유지
  assert.equal(attempts, 1);
  assert.equal(store.data.pending.runId, 'run-guest');

  await manager.register('baby', 2); // 등록 직후 force 재시도
  assert.equal(attempts, 2);
  assert.equal(store.data.pending, null);
  assert.equal(manager.getSnapshot().lastSubmission.accepted, true);
  assert.equal(manager.getSnapshot().highScore, 800);
});

test('lastSubmission 스냅샷에 최근 제출 결과를 기록한다', async () => {
  let now = 5000;
  const { manager } = createManager({
    now: () => now,
    apiOptions: { session: { access_count: 1 } },
  });
  await manager.init();
  await manager.beginRun();

  const result = await manager.handleRunEnd({ score: 600, round: 2, durationMs: 120000 });
  assert.equal(result.accepted, true);

  const last = manager.getSnapshot().lastSubmission;
  assert.deepEqual(last, {
    accepted: true,
    reason: 'ACCEPTED',
    score: 600,
    round: 2,
    at: 5000,
  });

  now = 6000;
  await manager.beginRun();
  const failed = await manager.handleRunEnd({
    score: 0, round: 1, durationMs: 60000, assisted: true,
  });
  assert.equal(failed.reason, 'ASSISTED_RUN');
  assert.equal(manager.getSnapshot().lastSubmission.reason, 'ASSISTED_RUN');
  assert.equal(manager.getSnapshot().lastSubmission.at, 6000);
});


