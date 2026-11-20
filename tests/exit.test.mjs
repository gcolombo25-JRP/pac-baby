/**
 * Pac-Baby: 전역 [게임 종료] 동작 테스트
 *   - 루프/사운드 즉시 정지
 *   - 종료 후 이전 rAF 프레임 무효화
 *   - [다시 시작] 시 READY 로비로 복귀
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import { CANVAS_WIDTH } from '../src/constants.js';

/** 최소 CanvasRenderingContext2D 스텁 */
function createStubCtx() {
  const record = () => () => {};
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: record(),
    strokeRect: record(),
    beginPath: record(),
    closePath: record(),
    moveTo: record(),
    lineTo: record(),
    arc: record(),
    ellipse: record(),
    fill: record(),
    stroke: record(),
    fillText: record(),
    save: record(),
    restore: record(),
    translate: record(),
    rotate: record(),
    clearRect: record(),
  };
}

/** 최소 Canvas 스텁 */
function createStubCanvas() {
  const ctx = createStubCtx();
  return { width: CANVAS_WIDTH, height: CANVAS_WIDTH, ctx, getContext: () => ctx };
}

/** 최소 InputManager 스텁 */
function createStubInput() {
  return {
    direction: null,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

function createGame() {
  const game = new Game(createStubCanvas(), createStubInput());
  const calls = [];

  // 실제 SoundFX 를 유지하되 호출 여부만 관찰한다 (Node 에서도 안전)
  const originalStopBgm = game.sound.stopBgm.bind(game.sound);
  const originalPlayStart = game.sound.playStart.bind(game.sound);
  game.sound.stopBgm = () => { calls.push('stopBgm'); originalStopBgm(); };
  game.sound.playStart = () => { calls.push('playStart'); originalPlayStart(); };

  return { game, calls };
}

test('[게임 종료] 루프와 BGM 을 즉시 멈추고 EXITED 상태로 전환한다', () => {
  const { game, calls } = createGame();
  game.running = true;
  game.state = 'PLAYING';
  const tokenBefore = game.loopToken;

  const state = game.exitGame();

  assert.equal(state, 'EXITED');
  assert.equal(game.state, 'EXITED');
  assert.equal(game.running, false);
  assert.ok(game.loopToken > tokenBefore, '대기 중인 rAF 프레임을 무효화한다');
  assert.ok(calls.includes('stopBgm'), 'BGM 을 정지한다');
});

test('[게임 종료] 종료 전에 예약된 루프 프레임은 실행되지 않는다', () => {
  const { game } = createGame();
  game.running = true;
  const staleToken = game.loopToken;

  game.exitGame();

  let ticks = 0;
  game._tick = () => { ticks += 1; };
  game._loop(performance.now(), staleToken);

  assert.equal(ticks, 0, '이전 토큰의 프레임은 무시된다');
});

test('[게임 종료] 다시 시작하면 READY 로비로 돌아가 루프가 재가동된다', () => {
  const { game, calls } = createGame();
  game.player.score = 1234;
  game.state = 'EXITED';
  game.running = false;

  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    const state = game.resumeFromExit();

    assert.equal(state, 'READY');
    assert.equal(game.state, 'READY');
    assert.equal(game.running, true);
    assert.equal(game.player.score, 0, '로비 복귀 시 점수는 초기화된다');
    assert.ok(calls.includes('playStart'), '재시작 효과음이 재생된다');
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

test('[게임 종료] EXITED 가 아니면 resumeFromExit 은 상태를 바꾸지 않는다', () => {
  const { game } = createGame();
  game.state = 'PLAYING';
  game.running = true;

  const result = game.resumeFromExit();

  assert.equal(result, 'PLAYING');
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.running, true);
});
