/**
 * Pac-Baby: 런(run) 추적 훅 테스트
 *   - 게임 오버 시 요약이 정확히 전달되는지
 *   - DEMO/BOT/테스터 치트 런은 assisted 로 표시되는지
 *   - 콜백 예외가 게임 루프를 죽이지 않는지
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';

function createStubCtx() {
  const calls = [];
  return new Proxy({ calls }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { calls.push({ name: prop, args }); };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}

function createCanvas() {
  const ctx = createStubCtx();
  return { width: 640, height: 640, getContext: () => ctx };
}

function createInput() {
  return {
    direction: null,
    pressed: new Set(),
    activitySeq: 0,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
    clearTouchMemory() {},
  };
}

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function setup(options = {}) {
  return new Game(createCanvas(), createInput(), { storage: createStorage(), ...options });
}

test('생성/재도전 시 onRunStart 가 호출되고 런 시작 시각이 기록된다', () => {
  const starts = [];
  const game = setup({ onRunStart: event => starts.push(event) });

  assert.equal(starts.length, 1, '초기 런 시작');
  assert.ok(game.runStartedAt > 0);
  assert.equal(game.runAssisted, false);

  game.resetAll();
  assert.equal(starts.length, 2, '재도전 시 새 런 시작');
  assert.ok(starts[1].startedAt >= starts[0].startedAt);
});

test('게임 오버 시 점수/라운드 요약이 onRunEnd 로 전달된다', () => {
  const ends = [];
  const game = setup({ onRunEnd: summary => ends.push(summary) });

  game.player.score = 1234;
  game.round = 2;
  game.catchCount = 1;
  game._gameOver();

  assert.equal(ends.length, 1);
  assert.equal(ends[0].score, 1234);
  assert.equal(ends[0].round, 2);
  assert.equal(ends[0].catchCount, 1);
  assert.equal(ends[0].assisted, false);
  assert.ok(ends[0].durationMs >= 0);
  assert.equal(game.state, 'GAME_OVER');
});

test('DEMO / BOT / 테스터 치트 런은 assisted 로 표시된다', () => {
  const game = setup();

  game.demoMode = true;
  game._markAssistedIfNeeded();
  assert.equal(game.getRunSummary().assisted, true);

  game.demoMode = false;
  game.resetAll();
  assert.equal(game.runAssisted, false, '재도전 시 초기화');

  game.botMode = true;
  game._markAssistedIfNeeded();
  assert.equal(game.runAssisted, true);

  game.botMode = false;
  game.resetAll();
  game.tester = { mode: 'MANUAL', hasCheatFlags: () => true };
  game._markAssistedIfNeeded();
  assert.equal(game.runAssisted, true);

  game.tester = null;
  game.resetAll();
  game.tester = { mode: 'REPLAY', hasCheatFlags: () => false };
  game._markAssistedIfNeeded();
  assert.equal(game.runAssisted, true, '테스터 BOT/REPLAY 모드도 제외');
});

test('런 콜백에서 예외가 나도 게임 오버 처리는 계속된다', () => {
  const game = setup({ onRunEnd: () => { throw new Error('boom'); } });
  const originalError = console.error;
  console.error = () => {};

  try {
    assert.doesNotThrow(() => game._gameOver());
    assert.equal(game.state, 'GAME_OVER');
  } finally {
    console.error = originalError;
  }
});

test('setUiBlocked 는 도움말과 동일하게 게임을 멈춘다', () => {
  const game = setup();
  game.state = 'PLAYING';

  game.setUiBlocked(true);
  assert.equal(game.helpOpen, true);

  game.setUiBlocked(false);
  assert.equal(game.helpOpen, false);
});

test('[게임 종료]로 진행 중인 정식 매뉴얼 런의 점수를 제출한다 (중복 없음)', () => {
  const ends = [];
  const game = setup({ onRunEnd: summary => ends.push(summary) });

  game.state = 'PLAYING';
  game.player.score = 1234;
  game.round = 2;

  assert.equal(game.exitGame(), 'EXITED');
  assert.equal(ends.length, 1, '종료 시 현재 런을 제출');
  assert.equal(ends[0].score, 1234);
  assert.equal(ends[0].round, 2);
  assert.equal(ends[0].assisted, false);
  assert.equal(game.runEnded, true);

  game.exitGame();
  assert.equal(ends.length, 1, '같은 런을 두 번 제출하지 않는다');
});

test('중도 재시작 시 이전 런 점수를 먼저 제출한 뒤 새 런을 시작한다', () => {
  const events = [];
  const game = setup({
    onRunStart: () => events.push('start'),
    onRunEnd: summary => events.push(`end:${summary.score}`),
  });

  events.length = 0;
  game.state = 'PLAYING';
  game.player.score = 500;
  game.round = 2;

  game.resetAll();

  assert.deepEqual(events, ['end:500', 'start'], '제출 → 새 런 시작 순서');
  assert.equal(game.runEnded, false, '새 런은 미종료 상태');
  assert.equal(game.player.score, 0);
});

test('게임 오버 후 재도전/종료는 이미 제출한 런을 다시 제출하지 않는다', () => {
  const ends = [];
  const game = setup({ onRunEnd: summary => ends.push(summary) });

  game.state = 'PLAYING';
  game.player.score = 800;
  game._gameOver();
  assert.equal(ends.length, 1);
  assert.equal(game.runEnded, true);

  game.resetAll(); // 게임 오버 → 새 런
  assert.equal(ends.length, 1, '게임 오버에서 이미 제출됨');

  game.player.score = 120;
  game.exitGame(); // 새 런은 정식 매뉴얼 + 점수 > 0 → 제출
  assert.equal(ends.length, 2);
  assert.equal(ends[1].score, 120);
});

test('0점/어시스트/데모 런은 종료·재시작에서 제출하지 않는다', () => {
  const zero = setup({ onRunEnd: () => { throw new Error('제출되면 안 됨'); } });
  zero.state = 'PLAYING';
  zero.player.score = 0;
  zero.exitGame();

  const assistedEnds = [];
  const assisted = setup({ onRunEnd: summary => assistedEnds.push(summary) });
  assisted.state = 'PLAYING';
  assisted.runAssisted = true;
  assisted.player.score = 500;
  assisted.exitGame();
  assisted.resetAll();
  assert.equal(assistedEnds.length, 0);

  const demoEnds = [];
  const demo = setup({ onRunEnd: summary => demoEnds.push(summary) });
  demo.state = 'PLAYING';
  demo.demoMode = true;
  demo.runAssisted = true;
  demo.player.score = 500;
  demo.exitGame();
  demo.resetAll();
  assert.equal(demoEnds.length, 0);
});

test('[게임 종료] EXITED 로 멈춘 뒤 [다시 시작]에서만 새 런이 시작된다', () => {
  const events = [];
  const game = setup({
    onRunStart: () => events.push('start'),
    onRunEnd: summary => events.push(`end:${summary.score}`),
  });

  events.length = 0;
  game.state = 'PLAYING';
  game.player.score = 700;

  game.exitGame();
  assert.equal(game.state, 'EXITED');
  assert.equal(game.running, false);
  assert.equal(game.runEnded, true);
  assert.deepEqual(events, ['end:700'], '종료 시에만 제출하고 새 런은 시작하지 않는다');

  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  game._render = () => {}; // 렌더링은 이 테스트의 관심사가 아니다
  try {
    assert.equal(game.resetToLobby(), 'READY');
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }

  assert.equal(game.state, 'READY');
  assert.equal(game.running, true);
  assert.equal(game.runEnded, false);
  assert.deepEqual(events, ['end:700', 'start'], '재시작에서 새 런이 시작된다');
});
