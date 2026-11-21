/**
 * Pac-Baby: 체포 연출(Oh! No~) / 라운드 타이틀 카운트다운 / 새 효과음 회귀 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import SoundFX from '../src/sound.js';
import { CAUGHT_STUN_MS, PLAYER_LIVES, ROUND_TITLES, getRoundTitle } from '../src/constants.js';

/** 호출을 기록하는 최소 ctx 스텁 (scale/measureText 없음 → 가드 검증) */
function createStubCtx() {
  const calls = [];
  const record = (name) => (...args) => { calls.push({ name, args }); };
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    clearRect: record('clearRect'),
  };
}

function createStubCanvas(ctx = createStubCtx()) {
  return { width: 640, height: 640, ctx, getContext: () => ctx };
}

function createStubInput() {
  return {
    direction: null,
    activitySeq: 0,
    getDirection() { return null; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

function setup() {
  const ctx = createStubCtx();
  const game = new Game(createStubCanvas(ctx), createStubInput(), { demoDelayMs: 999999 });
  return { game, ctx };
}

/** 적을 베이비 위에 고정해 한 프레임(_tick) 안에 확실히 잡히게 만든다 */
function forceCaughtOnNextTicks(game) {
  game.state = 'PLAYING';
  game.graceTimer = 0;
  game.enemies.forEach(enemy => { enemy.pinned = true; });
  const enemy = game.enemies[0];
  enemy.row = game.player.row;
  enemy.col = game.player.col;
}

/** 프레임을 진행하며 원하는 상태가 될 때까지 돌린다 */
function runFrames(game, fromNow, { step = 16, maxFrames = 400, until } = {}) {
  let now = fromNow;
  let frames = 0;
  while (frames < maxFrames && until(game)) {
    now += step;
    game._tick(now);
    frames += 1;
  }
  return { now, frames };
}

test('라운드별 타이틀 문구가 기획대로 제공된다', () => {
  assert.equal(getRoundTitle(1), '베이비 탈출 ^^');
  assert.equal(getRoundTitle(2), '조금 빠르게~');
  assert.equal(getRoundTitle(3), '더 빨리 !');
  assert.equal(getRoundTitle(4), '추적 보모 한 명 더 왔다 *');
  assert.equal(getRoundTitle(5), '순찰 보모도 한명 더 왔네 **');
  assert.equal(getRoundTitle(6), '길이 막히기도 해 @');
  assert.equal(getRoundTitle(7), '정전인가 !!!');

  // 8라운드 이후도 재치 있는 문구 + 12라운드 초과는 폴백
  assert.equal(getRoundTitle(8), ROUND_TITLES[7]);
  assert.match(getRoundTitle(13), /ROUND 13/);
  assert.equal(getRoundTitle(0), ROUND_TITLES[0], '잘못된 값은 1라운드 문구');
});

test('READY 오버레이가 라운드 타이틀과 3·2·1 카운트다운을 그린다', () => {
  const { game, ctx } = setup();

  assert.equal(game.state, 'READY');
  assert.equal(game.readyTimer, 3000);

  assert.doesNotThrow(() => game._render(0));
  const firstTexts = ctx.calls.filter(call => call.name === 'fillText').map(call => call.args[0]);
  assert.ok(firstTexts.includes('베이비 탈출 ^^'), '1라운드 타이틀');
  assert.ok(firstTexts.includes('3'), '카운트다운 3');

  game._startRound(4);
  ctx.calls.length = 0;
  assert.doesNotThrow(() => game._render(0));
  const round4Texts = ctx.calls.filter(call => call.name === 'fillText').map(call => call.args[0]);
  assert.ok(round4Texts.includes('추적 보모 한 명 더 왔다 *'), '4라운드 타이틀');
});

test('실시간 루프에서 체포되면 CAUGHT 로 굳은 뒤 목숨이 줄고 재개된다', () => {
  const { game } = setup();
  forceCaughtOnNextTicks(game);
  game.lives = PLAYER_LIVES;

  game.lastTime = 0;
  const { now } = runFrames(game, 0, { step: 60, until: g => g.state === 'PLAYING' });

  assert.equal(game.state, 'CAUGHT', '체포 연출 상태로 전환');
  assert.equal(game.caughtTimer, CAUGHT_STUN_MS);
  assert.equal(game.lives, PLAYER_LIVES, '연출 중에는 목숨이 줄지 않는다');
  assert.equal(game.catchCount, 0, '연출 중에는 체포 카운트도 증가하지 않는다');
  assert.equal(game.player.isStunned, true, '베이비는 그 자리에 굳는다');
  assert.equal(game.player.isMoving, false);
  assert.doesNotThrow(() => game._render(0), 'CAUGHT 오버레이 렌더 예외 없음');

  const { frames } = runFrames(game, now, { step: 16, until: g => g.state === 'CAUGHT' });

  assert.ok(frames > 100, '약 2~3초 동안 대기한다');
  assert.equal(game.state, 'PLAYING', '목숨이 남으면 플레이 재개');
  assert.equal(game.lives, PLAYER_LIVES - 1);
  assert.equal(game.catchCount, 1);
  assert.equal(game.player.isStunned, false);
  assert.ok(game.graceTimer > 0, '재개 직후 무적 시간');
});

test('마지막 목숨을 잃으면 연출이 끝난 뒤 GAME_OVER 로 전환된다', () => {
  const { game } = setup();
  forceCaughtOnNextTicks(game);
  game.lives = 1;

  game.lastTime = 0;
  const { now } = runFrames(game, 0, { step: 60, until: g => g.state === 'PLAYING' });
  assert.equal(game.state, 'CAUGHT');

  runFrames(game, now, { step: 16, until: g => g.state === 'CAUGHT' });

  assert.equal(game.state, 'GAME_OVER');
  assert.equal(game.lives, 0);
  assert.equal(game.catchCount, 1);
});

/** 최소 Web Audio 스텁 (필터/노이즈 미지원 환경에서도 예외가 없어야 한다) */
class FakeAudioParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeNode {
  connect() {}
}

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = new FakeAudioParam();
    this.gain.value = 1;
  }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new FakeAudioParam();
    this.startedAt = null;
  }
  start(time) { this.startedAt = time; }
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.oscillators = [];
  }
  createGain() { return new FakeGain(); }
  createOscillator() { const osc = new FakeOscillator(); this.oscillators.push(osc); return osc; }
  resume() { return Promise.resolve(); }
}

test('playOhNo 는 오디오 장치 유무와 관계없이 안전하게 재생된다', () => {
  const silent = new SoundFX();
  assert.equal(typeof silent.playOhNo, 'function');
  assert.doesNotThrow(() => silent.playOhNo(), '오디오 장치가 없어도 예외 없음');

  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const sound = new SoundFX();
    assert.doesNotThrow(() => sound.playOhNo());
    assert.ok(sound.ctx.oscillators.length >= 4, '"Oh" / "No~" / 여운 음이 합성된다');
    assert.ok(sound.ctx.oscillators.every(osc => osc.startedAt !== null), '모든 음이 예약된다');

    // 개선된 이동/울음 소리도 같은 환경에서 예외가 없어야 한다
    assert.doesNotThrow(() => {
      sound.playStep();
      sound.playCry();
    });
  } finally {
    delete globalThis.window;
  }
});
