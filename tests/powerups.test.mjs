/**
 * Pac-Baby: 특수 메커니즘 테스트
 *  - 캔디(🍬) 슈가 러시: 3초 / +50% 속도
 *  - 황금 젖병(🍼): 맵 중앙 슈퍼 아이템 / 8초 무적 보행기 / 악당 도망 & +300점
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import Enemy, { ENEMY_MODE } from '../src/enemy.js';
import {
  TILE_MAP, ROWS, COLS, SPEED_LEVELS, SUGAR_RUSH, GOLDEN_BOTTLE, GOLDEN_SPAWN,
  isWalkableTile,
} from '../src/constants.js';

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

test('황금 젖병은 맵 정중앙의 이동 가능한 타일에 배치된다', () => {
  assert.equal(GOLDEN_SPAWN.row, Math.floor(ROWS / 2));
  assert.equal(GOLDEN_SPAWN.col, Math.floor(COLS / 2));
  assert.ok(isWalkableTile(TILE_MAP, GOLDEN_SPAWN.row, GOLDEN_SPAWN.col));

  const game = setup();
  assert.equal(game.goldenBottle.type, 'GOLDEN');
  assert.equal(game.goldenBottle.row, GOLDEN_SPAWN.row);
  assert.equal(game.goldenBottle.col, GOLDEN_SPAWN.col);
  assert.equal(game.goldenBottle.fixedSpawn, true);
});

test('황금 젖병은 일반 아이템 12개/클리어 카운트에 포함되지 않는다', () => {
  const game = setup();

  assert.equal(game.items.length, 12);
  assert.ok(!game.items.some(item => item.type === 'GOLDEN'));
  assert.equal(game.itemCount, 12);
});

test('캔디를 먹으면 3초 슈가 러시가 발동하고 이동 속도가 50% 빨라진다', () => {
  const game = setup();
  game.enemies = [];

  const candy = game.items.find(item => item.type === 'CANDY');
  assert.ok(candy, '캔디 아이템이 있어야 한다');

  const baseTickMs = game.tickMs;
  game.player.row = candy.row;
  game.player.col = candy.col;

  game._updateItems(game.tickMs);

  assert.equal(game.sugarRushTimer, SUGAR_RUSH.duration);
  assert.equal(game.tickMs, Math.round(baseTickMs / SUGAR_RUSH.speedMultiplier));
  assert.ok(game.tickMs < baseTickMs, 'tick 간격이 줄어 빨라진다');
  assert.equal(game.stats.sugar, 1);
});

test('슈가 러시가 끝나면 원래 속도로 돌아온다', () => {
  const game = setup();
  game.enemies = [];

  const baseTickMs = game.tickMs;
  game.player.row = 14;
  game.player.col = 0; // 아이템/침대가 없는 타일
  game._activateSugarRush();

  let elapsed = 0;
  while (game.sugarRushTimer > 0 && elapsed < 6000) {
    game._update(game.tickMs);
    elapsed += baseTickMs;
  }

  assert.equal(game.sugarRushTimer, 0);
  assert.equal(game.tickMs, baseTickMs);
});

test('황금 젖병을 먹으면 8초 무적 보행기 모드 + 모든 악당이 도망친다', () => {
  const game = setup();
  const baseTickMs = game.tickMs;

  game.player.row = GOLDEN_SPAWN.row;
  game.player.col = GOLDEN_SPAWN.col;
  game._updateGoldenBottle(game.tickMs);

  assert.equal(game.goldenTimer, GOLDEN_BOTTLE.duration);
  assert.equal(game.goldenBottle.collected, true);
  assert.equal(game.stats.golden, 1);
  assert.equal(game.tickMs, Math.round(baseTickMs / GOLDEN_BOTTLE.speedMultiplier));
  assert.ok(
    game.enemies.every(enemy => enemy.mode === ENEMY_MODE.FLEE),
    '모든 악당이 도망 모드여야 한다',
  );
  assert.ok(
    game.enemies.every(enemy => enemy.isFleeing),
    'isFleeing 상태여야 한다',
  );
});

test('보행기 모드에서 악당과 부딪히면 +300점, 악당은 스폰으로 날아간다', () => {
  const game = setup();
  game._activateGoldenWalker();

  const enemy = game.enemies[0];
  enemy.row = GOLDEN_SPAWN.row;
  enemy.col = GOLDEN_SPAWN.col;
  game.player.row = GOLDEN_SPAWN.row;
  game.player.col = GOLDEN_SPAWN.col;

  const scoreBefore = game.player.score;
  const hits = game._resolveGoldenCollisions();

  assert.equal(hits, 1);
  assert.equal(game.player.score, scoreBefore + GOLDEN_BOTTLE.knockScore);
  assert.equal(game.stats.knocks, 1);
  assert.equal(enemy.row, enemy.spawnRow, '스폰 행으로 복귀');
  assert.equal(enemy.col, enemy.spawnCol, '스폰 열로 복귀');
  assert.equal(enemy.mode, ENEMY_MODE.FLEE, '남은 시간 동안 다시 도망친다');
});

test('보행기 모드에서는 체포되지 않고 악당만 날아간다', () => {
  const game = setup();
  game._activateGoldenWalker();

  const enemy = game.enemies[0];
  game.enemies = [enemy];
  enemy.freeze(2000); // 같은 타일에 머무르게 한다 (얼어 있어도 날려버릴 수 있다)
  enemy.row = GOLDEN_SPAWN.row;
  enemy.col = GOLDEN_SPAWN.col;

  game.player.row = GOLDEN_SPAWN.row;
  game.player.col = GOLDEN_SPAWN.col;
  game.player.prevRow = GOLDEN_SPAWN.row;
  game.player.prevCol = GOLDEN_SPAWN.col;
  game.player.isMoving = false;

  const livesBefore = game.lives;
  const scoreBefore = game.player.score;

  game._update(game.tickMs);

  assert.equal(game.lives, livesBefore, '보행기 모드에서는 목숨을 잃지 않는다');
  assert.equal(game.catchCount, 0, '체포되지 않는다');
  assert.equal(game.player.score, scoreBefore + GOLDEN_BOTTLE.knockScore);
  assert.equal(enemy.row, enemy.spawnRow);
  assert.equal(enemy.col, enemy.spawnCol);
});

test('보행기 모드가 끝나면 악당이 원래 모드로 돌아온다', () => {
  const game = setup();
  const modesBefore = game.enemies.map(enemy => enemy.mode);

  game._activateGoldenWalker();
  game.player.row = 14;
  game.player.col = 0;

  let elapsed = 0;
  while (game.goldenTimer > 0 && elapsed < 12000) {
    game._update(game.tickMs);
    elapsed += game.tickMs;
  }

  assert.equal(game.goldenTimer, 0);
  game.enemies.forEach((enemy, index) => {
    assert.notEqual(enemy.mode, ENEMY_MODE.FLEE);
    assert.equal(enemy.mode, modesBefore[index], '원래 모드(추격/경비)로 복귀');
  });
  assert.equal(game.tickMs, SPEED_LEVELS[game.speedLevel - 1].babyTileMs);
});

test('황금 젖병은 20초 뒤 맵 중앙에 다시 나타난다', () => {
  const game = setup();
  game.enemies = [];

  game.player.row = GOLDEN_SPAWN.row;
  game.player.col = GOLDEN_SPAWN.col;
  game._updateGoldenBottle(game.tickMs);
  assert.equal(game.goldenBottle.collected, true);

  game.player.row = 14;
  game.player.col = 0;

  let elapsed = 0;
  while (game.goldenBottle.collected && elapsed < GOLDEN_BOTTLE.respawnMs + 2000) {
    game._updateGoldenBottle(game.tickMs);
    elapsed += game.tickMs;
  }

  assert.equal(game.goldenBottle.collected, false);
  assert.equal(game.goldenBottle.row, GOLDEN_SPAWN.row);
  assert.equal(game.goldenBottle.col, GOLDEN_SPAWN.col);
});

test('도망치는 악당은 베이비에게서 멀어지는 칸으로 이동한다', () => {
  const enemy = new Enemy({ row: 14, col: 10 }, 0, 0, ENEMY_MODE.CHASE);
  enemy.startFlee(5000);

  assert.equal(enemy.isFleeing, true);

  const distanceBefore = Math.abs(enemy.row - 14) + Math.abs(enemy.col - 14);
  enemy.update(enemy.getTileMs(), TILE_MAP, 14, 14);
  const distanceAfter = Math.abs(enemy.row - 14) + Math.abs(enemy.col - 14);

  assert.ok(distanceAfter > distanceBefore, `도망 실패: ${distanceBefore} → ${distanceAfter}`);
  assert.equal(enemy.col, 9, '베이비 반대쪽(왼쪽)으로 이동');
});

test('재시작하면 파워업이 모두 해제되고 황금 젖병이 중앙에 다시 놓인다', () => {
  const game = setup();

  game._activateSugarRush();
  game._activateGoldenWalker();
  assert.ok(game.tickMs < SPEED_LEVELS[game.speedLevel - 1].babyTileMs);

  game.resetAll();

  assert.equal(game.sugarRushTimer, 0);
  assert.equal(game.goldenTimer, 0);
  assert.ok(game.enemies.every(enemy => enemy.mode !== ENEMY_MODE.FLEE));
  assert.equal(game.goldenBottle.collected, false);
  assert.equal(game.goldenBottle.row, GOLDEN_SPAWN.row);
  assert.equal(game.tickMs, SPEED_LEVELS[game.speedLevel - 1].babyTileMs);
});

