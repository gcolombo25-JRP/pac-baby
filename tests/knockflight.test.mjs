/**
 * Pac-Baby: 황금 보행기 넉백 비행 연출 회귀 테스트
 *  - 맞은 지점 → 스폰 지점 포물선(아치) 궤적
 *  - 정점에서 1.3~1.45배 확대 + 빠른 회전(빙글빙글)
 *  - 0.5~0.75초 뒤 착지 → 별가루 꼬리/착지 이펙트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import Enemy, { ENEMY_MODE, KNOCK_FLIGHT_MS } from '../src/enemy.js';
import { GOLDEN_SPAWN, TILE_SIZE } from '../src/constants.js';

/** 최소 CanvasRenderingContext2D 스텁 */
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

test('넉백 비행은 0.5~0.75초 동안 포물선 아치를 그린다', () => {
  const enemy = new Enemy({ row: 3, col: 6 }, 0, 0, ENEMY_MODE.CHASE);
  enemy.startKnockFlight(14, 14);

  assert.ok(KNOCK_FLIGHT_MS >= 500 && KNOCK_FLIGHT_MS <= 750, `duration=${KNOCK_FLIGHT_MS}`);

  const start = enemy.getFlightPose();
  assert.ok(Math.abs(start.x - (14 + 0.5) * TILE_SIZE) < 0.001, '맞은 지점에서 출발');
  assert.equal(start.scale, 1, '출발 시점은 원래 크기');

  // 중간(정점 부근)으로 진행
  enemy.advanceKnockFlight(KNOCK_FLIGHT_MS / 2);
  const apex = enemy.getFlightPose();

  assert.ok(apex.arc > 0.95, '정점 부근');
  assert.ok(apex.scale > 1.3 && apex.scale <= 1.45, `apex scale=${apex.scale}`);
  assert.ok(apex.y < apex.groundY - TILE_SIZE, '지면보다 위로 솟구친다');
  assert.ok(Math.abs(apex.rotation) > Math.PI, '빙글빙글 회전한다');

  // 착지
  const landedPose = enemy.advanceKnockFlight(KNOCK_FLIGHT_MS / 2);
  assert.equal(landedPose.landed, true, '착지 프레임 보고');
  assert.equal(enemy.knockFlight, null, '착지 후 연출 종료');
  assert.equal(landedPose.scale, 1, '착지 시 원래 크기로 복귀');
  assert.ok(Math.abs(landedPose.x - (enemy.col + 0.5) * TILE_SIZE) < 0.001);
  assert.ok(Math.abs(landedPose.y - (enemy.row + 0.5) * TILE_SIZE) < 0.001);
});

test('리스폰(resetToSpawn)은 진행 중인 비행 연출을 취소한다', () => {
  const enemy = new Enemy({ row: 3, col: 6 }, 0, 0, ENEMY_MODE.CHASE);
  enemy.startKnockFlight(14, 14);
  assert.ok(enemy.knockFlight);

  enemy.resetToSpawn();

  assert.equal(enemy.knockFlight, null);
  assert.equal(enemy.getFlightPose(), null);
});

test('보행기 넉백은 히트스톱/충격파/셰이크와 함께 비행 연출을 시작한다', () => {
  const { game } = setup();
  game._activateGoldenWalker();

  const enemy = game.enemies[0];
  enemy.row = GOLDEN_SPAWN.row;
  enemy.col = GOLDEN_SPAWN.col;
  game.player.row = GOLDEN_SPAWN.row;
  game.player.col = GOLDEN_SPAWN.col;

  game._resolveGoldenCollisions();

  assert.ok(enemy.knockFlight, '넉백 비행 상태 시작');
  assert.ok(game.hitStopMs >= 75 && game.hitStopMs <= 90, `hitStopMs=${game.hitStopMs}`);
  assert.ok(game.zoomPeak >= 1.05 && game.zoomPeak <= 1.07, `zoomPeak=${game.zoomPeak}`);
  assert.ok(game.effects.rings.length > 0, '충격파 링');
  assert.ok(game.effects.shakeTimer > 0, '카메라 셰이크');
  assert.ok(game.effects.particles.length > 0, '반짝이 파티클');
});

test('비행 중에는 별가루 꼬리가 남고 착지하면 연출이 끝난다', () => {
  const { game } = setup();

  const enemy = game.enemies[0];
  enemy.startKnockFlight(GOLDEN_SPAWN.row, GOLDEN_SPAWN.col);

  game._updateKnockFlights(30);
  const stars = game.effects.particles.filter(particle => particle.kind === 'star');
  assert.ok(stars.length > 0, '별가루 꼬리 파티클');
  assert.ok(enemy.knockFlight, '아직 비행 중');

  const ringsBefore = game.effects.rings.length;
  game._updateKnockFlights(KNOCK_FLIGHT_MS);
  assert.equal(enemy.knockFlight, null, '착지 후 정상 렌더로 복귀');
  assert.ok(game.effects.rings.length > ringsBefore, '착지 충격파');
});

test('비행 중 렌더는 회전/확대 변환을 사용하고 예외 없이 끝난다', () => {
  const { game, ctx } = setup();

  game.enemies[0].startKnockFlight(GOLDEN_SPAWN.row, GOLDEN_SPAWN.col);
  game._updateKnockFlights(KNOCK_FLIGHT_MS / 2);

  ctx.calls.length = 0;
  assert.doesNotThrow(() => game._render(0.5));

  const rotates = ctx.calls.filter(call => call.name === 'rotate');
  const scales = ctx.calls.filter(call => call.name === 'scale');
  assert.ok(rotates.length > 0, '빙글빙글 회전');
  assert.ok(scales.some(call => call.args[0] > 1.3), '정점 확대');

  const saves = ctx.calls.filter(call => call.name === 'save').length;
  const restores = ctx.calls.filter(call => call.name === 'restore').length;
  assert.equal(saves, restores, 'save/restore 짝이 맞아야 한다');
});
