/**
 * Pac-Baby: 특수 아이템 '가짜 젖꼭지(쪽쪽이)' 테스트
 *  - 클리어 카운트(12개)/소화·트랩 제외
 *  - 아기 획득: 5초 스텔스 + 30초 쿨타임 랜덤 리스폰
 *  - 보모 접촉: '치웠다!' 팝업 + 1.5초 뒤 다른 빈 타일 재등장
 *  - 더 긴 침대 스텔스 보호(Math.max)
 *  - 어둠 모드 발광 렌더링 + OS 이모지 미사용
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import { ENEMY_MODE } from '../src/enemy.js';
import {
  TILE_MAP, FAKE_PACIFIER, STEALTH_DURATION_MS, isWalkableTile,
} from '../src/constants.js';

/** 최소 CanvasRenderingContext2D 스텁 (모든 메서드 호출 기록) */
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
  return { width: 640, height: 640, ctx, getContext: () => ctx };
}

function createInput() {
  return {
    direction: null,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

function setup() {
  return new Game(createCanvas(), createInput());
}

/** 테스트용 결정론적 난수 (LCG) */
function seededRng(seed = 20261122) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const chebyshev = (a, b) => Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));

function assertValidPacifierSpot(game) {
  const pacifier = game.pacifier;
  assert.ok(pacifier, '쪽쪽이가 존재해야 한다');
  assert.ok(isWalkableTile(TILE_MAP, pacifier.row, pacifier.col), '이동 가능한 타일');
  assert.notEqual(TILE_MAP[pacifier.row][pacifier.col], 2, '침대 제외');
  assert.notEqual(TILE_MAP[pacifier.row][pacifier.col], 3, '보모 대기실 제외');
  assert.ok(
    !game.items.some(item => !item.collected
      && item.row === pacifier.row && item.col === pacifier.col),
    '기존 아이템과 겹치지 않는다',
  );
  assert.ok(
    !game.goldenBottle
      || game.goldenBottle.collected
      || game.goldenBottle.row !== pacifier.row
      || game.goldenBottle.col !== pacifier.col,
    '황금 젖병과 겹치지 않는다',
  );

  const actors = [game.player, ...game.enemies];
  for (const actor of actors) {
    assert.ok(
      chebyshev(actor, pacifier) > FAKE_PACIFIER.minSpawnDistanceTiles,
      `플레이어/보모 2타일 이내 스폰 금지 (${actor.row},${actor.col})`,
    );
  }
}

test('쪽쪽이는 일반 아이템 12개/클리어 카운트/소화·트랩에서 분리된다', () => {
  const game = setup();

  // ① 클리어 카운트: 일반 아이템 12개에 포함되지 않는다
  assert.equal(game.items.length, 12);
  assert.ok(!game.items.some(item => item.type === 'PACIFIER'));
  assert.equal(game.itemCount, 12);

  // ① 스폰 위치: 벽·침대·대기실·기존 아이템·플레이어/보모 2타일 이내 제외
  assertValidPacifierSpot(game);

  // ① 아기 획득: 5초 스텔스 + 소량 점수, 소화/트랩/클리어 카운트 없음
  const pacifier = game.pacifier;
  const scoreBefore = game.player.score;
  game.player.row = pacifier.row;
  game.player.col = pacifier.col;
  game.player.prevRow = pacifier.row;
  game.player.prevCol = pacifier.col;

  game._updatePacifier(game.tickMs);

  assert.equal(pacifier.collected, true, '획득하면 사라진다');
  assert.equal(game.player.stealthTimer, FAKE_PACIFIER.stealthDuration);
  assert.equal(game.player.stealthTotal, FAKE_PACIFIER.stealthDuration);
  assert.equal(game.player.score, scoreBefore + FAKE_PACIFIER.score);
  assert.equal(game.player.digesting.length, 0, '소화 게이지가 생기지 않는다');
  assert.equal(game.traps.length, 0, '트랩이 생기지 않는다');
  assert.equal(game.roundItemsEaten, 0, '클리어 카운트에 포함되지 않는다');
  assert.equal(game.stats.items, 0);
  assert.equal(game.itemCount, 12, '남은 일반 아이템 수는 그대로다');
});

test('아기 획득 후 30초 쿨타임 뒤 랜덤 빈 타일에 다시 등장한다', () => {
  const game = setup();
  const pacifier = game.pacifier;
  const oldSpot = { row: pacifier.row, col: pacifier.col };

  game.player.row = pacifier.row;
  game.player.col = pacifier.col;
  game._updatePacifier(game.tickMs);
  assert.equal(pacifier.collected, true);
  assert.equal(pacifier.respawnTimer, FAKE_PACIFIER.respawnMs, '30초 쿨타임');

  // 쿨타임 동안은 나타나지 않는다
  game.player.row = 14;
  game.player.col = 0;
  game.rng = seededRng(11);
  game._updatePacifier(FAKE_PACIFIER.respawnMs - 1);
  assert.equal(pacifier.collected, true, '29.999초에는 아직 없다');

  game._updatePacifier(1);
  assert.equal(pacifier.collected, false, '30초 뒤 재등장');
  assert.notEqual(
    `${pacifier.row},${pacifier.col}`,
    `${oldSpot.row},${oldSpot.col}`,
    '다른 빈 타일에 나타난다',
  );
  assertValidPacifierSpot(game);
  assert.equal(game.items.length, 12, '일반 아이템 목록은 변하지 않는다');
});

test('얼어붙지 않은 보모가 쪽쪽이를 치우면 1.5초 뒤 다른 빈 타일에 다시 나타난다', () => {
  const game = setup();
  const pacifier = game.pacifier;
  const oldSpot = { row: pacifier.row, col: pacifier.col };

  // 보모 한 마리만 남겨 재등장 위치 검증을 단순하게 만든다
  const enemy = game.enemies[0];
  game.enemies = [enemy];
  game.player.row = 14;
  game.player.col = 0;
  enemy.row = pacifier.row;
  enemy.col = pacifier.col;

  // 얼어붙은 보모는 쪽쪽이를 치우지 못한다
  enemy.isFrozen = true;
  game._updatePacifier(game.tickMs);
  assert.equal(pacifier.collected, false, '얼어붙은 보모는 치우지 못한다');

  // 얼음이 풀린 보모가 밟으면 '치웠다!' 팝업과 함께 짧은 딜레이 후 재등장
  enemy.isFrozen = false;
  game._updatePacifier(game.tickMs);
  assert.equal(pacifier.collected, true);
  assert.equal(pacifier.respawnTimer, FAKE_PACIFIER.enemyClearDelayMs);
  assert.ok(
    game.scorePopups.some(popup => popup.text === '치웠다!'),
    '작은 팝업 이펙트',
  );
  assert.equal(game.player.stealthTimer, 0, '보모가 찾은 것은 스텔스가 아니다');

  game.rng = seededRng(29);
  game._updatePacifier(FAKE_PACIFIER.enemyClearDelayMs - 1);
  assert.equal(pacifier.collected, true, '딜레이 전에는 아직 없다');

  game._updatePacifier(1);
  assert.equal(pacifier.collected, false, '짧은 딜레이 후 재등장');
  assert.notEqual(
    `${pacifier.row},${pacifier.col}`,
    `${oldSpot.row},${oldSpot.col}`,
    '다른 빈 타일에 나타난다',
  );
  assert.ok(
    chebyshev(enemy, pacifier) > FAKE_PACIFIER.minSpawnDistanceTiles,
    '보모 인접 타일은 피한다',
  );
  assertValidPacifierSpot(game);
});

test('더 긴 침대 스텔스 시간은 쪽쪽이로 덮어쓰지 않는다 (Math.max)', () => {
  const game = setup();
  const pacifier = game.pacifier;

  assert.equal(game.player.activateStealth(STEALTH_DURATION_MS), true);
  assert.equal(game.player.stealthTimer, STEALTH_DURATION_MS);

  game.player.row = pacifier.row;
  game.player.col = pacifier.col;
  game._updatePacifier(game.tickMs);

  assert.equal(pacifier.collected, true);
  assert.equal(
    game.player.stealthTimer,
    STEALTH_DURATION_MS,
    '10초 침대 스텔스가 5초로 줄지 않는다',
  );
  assert.equal(game.player.stealthTotal, STEALTH_DURATION_MS);

  // 추격 보모는 목표를 잃는다 (기존 스텔스 발동 로직과 동일)
  assert.ok(
    game.enemies.every(enemy => enemy.mode !== ENEMY_MODE.CHASE),
    '추격 보모가 순찰로 전환',
  );
});

test('쪽쪽이 점수도 라운드 상한 캡을 지킨다 (_addScore 경유)', () => {
  const game = setup();
  const pacifier = game.pacifier;

  game.player.score = game.roundScoreCap - 30;
  game.player.row = pacifier.row;
  game.player.col = pacifier.col;
  game._updatePacifier(game.tickMs);

  assert.equal(game.player.score, game.roundScoreCap, '상한까지만 반영');
  assert.equal(game.scoreCapReached, true);
  assert.ok(
    game.scorePopups.some(popup => popup.text === '+30'),
    '실제 반영된 소량 점수 팝업',
  );
});

test('쪽쪽이는 어둠 모드에서도 발광하며 OS 이모지 없이 Canvas 도형으로 그린다', () => {
  const game = setup();
  const pacifier = game.pacifier;
  const ctx = createStubCtx();

  assert.doesNotThrow(() => pacifier.render(ctx, 1234, { dark: true }));
  assert.equal(
    ctx.calls.some(call => call.name === 'fillText'),
    false,
    'OS 이모지(fillText)를 쓰지 않는다',
  );
  assert.ok(
    ctx.calls.some(call => call.name === 'quadraticCurveTo'),
    '방패판/실리콘 팁은 곡선 도형으로 그린다',
  );

  // 어둠 속 발광 링이 시간에 따라 맥동한다
  const glowSizes = new Set();
  for (let i = 0; i < 8; i++) {
    ctx.calls.length = 0;
    pacifier.render(ctx, i * 220, { dark: true });
    const arcs = ctx.calls
      .filter(call => call.name === 'arc')
      .map(call => call.args[2]);
    glowSizes.add(Math.max(...arcs).toFixed(3));
  }
  assert.ok(glowSizes.size > 1, '발광 링 크기가 시간에 따라 변한다');
});

test('게임 렌더링은 어둠 모드에서 쪽쪽이를 dark 옵션으로 다시 그린다', () => {
  const game = setup();
  game._startRound(8);
  assert.equal(game.darkMode, true);

  let captured = null;
  game.pacifier.render = (ctx, timeMs, options) => { captured = options; };

  assert.doesNotThrow(() => game._render(0));
  assert.equal(captured?.dark, true, '어둠 속 발광 렌더 옵션 전달');
});
