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
