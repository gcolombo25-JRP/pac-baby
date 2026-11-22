/**
 * Pac-Baby: 임팩트 연출(히트스톱 + 마이크로 줌) 회귀 테스트
 *  - 보모 날려버리기 75~90ms / 체포 55~75ms 프레임 정지
 *  - 베이비 중심 1.05~1.07배 줌인 후 원복
 *  - 줌 변환이 월드 레이어 안에서만 적용되고 save/restore 짝이 맞는지
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import { CAUGHT_STUN_MS } from '../src/constants.js';

/** 호출을 기록하는 최소 ctx 스텁 (scale 포함 → 줌 변환 검증 가능) */
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

function createCanvas(ctx = createStubCtx()) {
  return { width: 640, height: 640, ctx, getContext: () => ctx };
}

function createInput() {
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
  const game = new Game(createCanvas(ctx), createInput(), { demoDelayMs: 999999 });
  return { game, ctx };
}

test('보모를 날려버리면 75~90ms 히트스톱 + 1.05~1.07배 줌이 발동한다', () => {
  const { game } = setup();
  game._knockEnemy(game.enemies[0]);

  assert.ok(game.hitStopMs >= 75 && game.hitStopMs <= 90, `hitStopMs=${game.hitStopMs}`);
  assert.ok(game.zoomPeak >= 1.05 && game.zoomPeak <= 1.07, `zoomPeak=${game.zoomPeak}`);
  assert.equal(game.getZoomScale(), 1, '펄스 시작 시점은 원본 배율');
});

test('마이크로 줌은 최대치까지 당긴 뒤 1.0 배율로 부드럽게 복귀한다', () => {
  const { game } = setup();
  game._startImpact({ holdMs: 60, zoom: 1.05, durationMs: 200 });

  let peak = 1;
  for (let i = 0; i < 13; i++) {
    game._updateCameraZoom(16);
    peak = Math.max(peak, game.getZoomScale());
  }

  assert.ok(peak > 1.04 && peak <= 1.06, `peak=${peak}`);
  assert.equal(game.getZoomScale(), 1, '펄스 종료 후 원복');
  assert.equal(game.hitStopMs, 60, '줌 진행만으로 히트스톱이 줄지 않는다');
});

test('히트스톱 동안은 게임 로직이 멈추고 약 60ms 뒤 자동 해제된다', () => {
  const { game } = setup();
  game.state = 'PLAYING';
  game.lastTime = 0;
  game._startImpact({ holdMs: 60, zoom: 1.05 });

  const before = `${game.player.row},${game.player.col}`;

  game._tick(16);
  assert.equal(game.hitStopMs, 44);
  assert.equal(`${game.player.row},${game.player.col}`, before, '이동/충돌 판정 정지');
  assert.equal(game.tickAccumulator, 0, '히트스톱 중에는 tick 이 쌓이지 않는다');

  game._tick(48); // 경과 48ms
  assert.ok(game.hitStopMs > 0, '아직 프레임 정지 중');
  assert.equal(game.tickAccumulator, 0);

  game._tick(64); // 경과 64ms → 해제
  assert.equal(game.hitStopMs, 0);
  assert.equal(game.tickAccumulator, 0);
  assert.equal(`${game.player.row},${game.player.col}`, before, '정지 중에는 이동하지 않는다');
});

test('체포 순간에도 히트스톱이 걸리고 그동안 체포 타이머는 흐르지 않는다', () => {
  const { game } = setup();
  game.state = 'PLAYING';
  game.graceTimer = 0;
  game.lastTime = 0;

  game.enemies.forEach(enemy => { enemy.pinned = true; });
  const catcher = game.enemies[0];
  catcher.row = game.player.row;
  catcher.col = game.player.col;

  game._tick(game.tickMs); // 한 tick 진행 → 체포 연출 시작

  assert.equal(game.state, 'CAUGHT');
  assert.ok(game.hitStopMs >= 55 && game.hitStopMs <= 75, `hitStopMs=${game.hitStopMs}`);
  assert.equal(game.zoomPeak, 1.06);
  assert.equal(game.caughtTimer, CAUGHT_STUN_MS, '히트스톱 중에는 연출 타이머도 정지');

  const restedTimer = game.caughtTimer;
  game._tick(game.tickMs + 16); // 16ms 히트스톱

  assert.ok(game.hitStopMs > 0);
  assert.equal(game.caughtTimer, restedTimer, '히트스톱 동안 체포 타이머 불변');
});

test('줌 변환은 월드 레이어에서만 적용되고 화면 좌표 레이어 앞에서 원복된다', () => {
  const { game, ctx } = setup();
  game.state = 'PLAYING';
  game._startImpact({ holdMs: 0, zoom: 1.05, durationMs: 280 });
  game._updateCameraZoom(90); // 최대치 부근까지 진행

  const expected = game.getZoomScale();
  assert.ok(expected > 1.01, `zoom=${expected}`);

  ctx.calls.length = 0;
  game._render(0.5);

  const scales = ctx.calls.filter(c => c.name === 'scale');
  assert.equal(scales.length, 1, '월드 줌은 1회만 적용된다');
  assert.deepEqual(scales[0].args, [expected, expected]);

  // 줌 scale 은 카메라 셰이크용 첫 save/translate 뒤에 온다
  const scaleIndex = ctx.calls.findIndex(c => c.name === 'scale');
  const firstSave = ctx.calls.findIndex(c => c.name === 'save');
  const firstTranslate = ctx.calls.findIndex(c => c.name === 'translate');
  assert.ok(scaleIndex > firstSave && scaleIndex > firstTranslate, '셰이크 뒤 월드 줌');

  const saves = ctx.calls.filter(c => c.name === 'save').length;
  const restores = ctx.calls.filter(c => c.name === 'restore').length;
  assert.equal(saves, restores, 'save/restore 짝이 맞아야 한다');
});

test('라운드/재시작은 히트스톱과 줌을 초기화한다', () => {
  const { game } = setup();
  game._startImpact({ holdMs: 75, zoom: 1.06 });
  assert.ok(game.hitStopMs > 0 && game.zoomTimer > 0);

  game._startRound(2);

  assert.equal(game.hitStopMs, 0);
  assert.equal(game.zoomTimer, 0);
  assert.equal(game.getZoomScale(), 1);
});
