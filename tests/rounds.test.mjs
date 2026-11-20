/**
 * Pac-Baby: 고라운드 난이도 테스트
 *  - 4/5라운드 악당 추가
 *  - 6라운드부터 철창문 (2라운드마다 +1, 최대 4개)
 *  - 8라운드부터 시야 제한 (8 → 최소 3타일) + 아이템/트랩 발광
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import { ENEMY_MODE, findNextStep, isCenterSpawnZone } from '../src/enemy.js';
import { Trap } from '../src/item.js';
import {
  TILE_MAP, TILE_SIZE, SPEED_LEVELS, CHASE_ENEMY_COUNT,
  GATE_OPEN_MS, GATE_MAX, GATE_POSITIONS,
  VISION_START_ROUND, VISION_START_TILES, VISION_MIN_TILES,
  GOLDEN_SPAWN, isWalkableTile,
  getBabySpawn, getEnemySpawns, getItemSpawns,
} from '../src/constants.js';

/** 최소 CanvasRenderingContext2D 스텁 */
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
    globalAlpha: 1,
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

test('1라운드는 보모 4마리(추격 2 + 순찰 2), 철창문/어둠 없음', () => {
  const game = setup();

  assert.equal(game.enemies.length, 4);
  assert.equal(game.enemies.filter(e => e.mode === ENEMY_MODE.CHASE).length, CHASE_ENEMY_COUNT);
  assert.equal(game.enemies.filter(e => e.mode === ENEMY_MODE.PATROL).length, 2);
  assert.equal(game.gates.length, 0);
  assert.equal(game.darkMode, false);
});

test('4라운드 시작 시 추격 보모가 1마리 추가된다 (총 5마리)', () => {
  const game = setup();
  game._startRound(4);

  assert.equal(game.round, 4);
  assert.equal(game.enemies.length, 5);

  const extra = game.enemies[game.enemies.length - 1];
  assert.equal(extra.mode, ENEMY_MODE.CHASE);
  assert.ok(isWalkableTile(TILE_MAP, extra.row, extra.col));
  assert.equal(
    isCenterSpawnZone(extra.row, extra.col, TILE_MAP.length, TILE_MAP[0].length),
    false,
    '중앙 구역에는 스폰하지 않는다',
  );
  for (const other of game.enemies.slice(0, -1)) {
    assert.ok(
      Math.abs(extra.row - other.row) + Math.abs(extra.col - other.col) >= 2,
      '악당끼리 최소 2칸 떨어져야 한다',
    );
  }
  assert.equal(
    game.enemies.filter(e => e.mode === ENEMY_MODE.CHASE).length,
    3,
    '추격 3 + 순찰 2',
  );
});

test('5라운드 시작 시 순찰 보모가 1마리 추가된다 (총 6마리)', () => {
  const game = setup();
  game._startRound(5);

  assert.equal(game.round, 5);
  assert.equal(game.enemies.length, 6);

  const extra = game.enemies[game.enemies.length - 1];
  assert.equal(extra.mode, ENEMY_MODE.PATROL);
  assert.ok(isWalkableTile(TILE_MAP, extra.row, extra.col));
  assert.equal(
    isCenterSpawnZone(extra.row, extra.col, TILE_MAP.length, TILE_MAP[0].length),
    false,
    '중앙 구역에는 스폰하지 않는다',
  );
  for (const other of game.enemies.slice(0, -1)) {
    assert.ok(
      Math.abs(extra.row - other.row) + Math.abs(extra.col - other.col) >= 2,
      '악당끼리 최소 2칸 떨어져야 한다',
    );
  }
  assert.equal(game.enemies.filter(e => e.mode === ENEMY_MODE.CHASE).length, 3);
  assert.equal(game.enemies.filter(e => e.mode === ENEMY_MODE.PATROL).length, 3);

  // 6라운드 이후에도 6마리 유지
  game._startRound(6);
  assert.equal(game.enemies.length, 6);
});

test('추가된 악당에게도 현재 속도 단계가 적용된다', () => {
  const game = setup();
  game._startRound(5);

  const expected = SPEED_LEVELS[game.speedLevel - 1].enemyTileMs;
  assert.ok(game.enemies.every(enemy => enemy.baseTileMs === expected));
  assert.ok(game.enemies.every(enemy => enemy.baseTileMs > game.tickMs));
});

test('철창문은 6라운드 1개, 2라운드마다 +1, 최대 4개', () => {
  const game = setup();
  const cases = [
    [5, 0],
    [6, 1],
    [7, 1],
    [8, 2],
    [10, 3],
    [12, 4],
    [14, 4],
  ];

  for (const [round, expected] of cases) {
    game._startRound(round);
    assert.equal(game.gates.length, expected, `ROUND ${round}`);
  }

  assert.equal(game.gates.length, GATE_MAX);
});

test('철창문 위치는 일반 통로이며 특수 타일과 겹치지 않는다', () => {
  const baby = getBabySpawn(TILE_MAP);
  const special = new Set([
    `${baby.row},${baby.col}`,
    ...getEnemySpawns(TILE_MAP).map(p => `${p.row},${p.col}`),
    ...getItemSpawns(TILE_MAP).map(p => `${p.row},${p.col}`),
    `${GOLDEN_SPAWN.row},${GOLDEN_SPAWN.col}`,
  ]);

  for (const gate of GATE_POSITIONS) {
    assert.ok(isWalkableTile(TILE_MAP, gate.row, gate.col));
    assert.equal(TILE_MAP[gate.row][gate.col], 0, '일반 바닥 타일이어야 한다');
    assert.ok(
      !special.has(`${gate.row},${gate.col}`),
      `철창문 (${gate.row},${gate.col}) 이 특수 타일과 겹친다`,
    );
  }
});

test('닫힌 철창문은 베이비가 통과할 수 없고, 열리면 통과한다', () => {
  const game = setup();
  game._startRound(6);

  const gate = game.gates[0];
  const player = game.player;

  // 철창문 바로 위 타일에서 아래로 이동 시도
  player.row = gate.row - 1;
  player.col = gate.col;
  player.x = player.col * TILE_SIZE;
  player.y = player.row * TILE_SIZE;
  player.prevRow = player.row;
  player.prevCol = player.col;
  player.direction = 'DOWN';
  player.nextDirection = null;
  player.isMoving = false;

  gate.closed = true;
  game._refreshNavMap();
  player.update(game.navMap, 220);

  assert.equal(player.row, gate.row - 1, '닫힌 문은 막는다');
  assert.equal(player.isMoving, false);

  gate.closed = false;
  game._refreshNavMap();
  player.update(game.navMap, 220);

  assert.equal(player.row, gate.row, '열린 문은 통과한다');
});

test('철창문 위에 베이비가 있으면 닫히지 않는다', () => {
  const game = setup();
  game._startRound(6);

  // 랜덤 스폰된 악당이 철창문 위에 있으면 문이 열린 채 유지되므로, 테스트에서는 멀리 치운다.
  game.enemies.forEach(enemy => {
    enemy.pinned = true;
    enemy.row = 1;
    enemy.col = 1;
  });

  const gate = game.gates[0];
  game.player.row = gate.row;
  game.player.col = gate.col;

  game.gateClock = GATE_OPEN_MS + 1; // 닫혀야 할 시간대
  game._updateGates(0);
  assert.equal(gate.closed, false, '사람이 위에 있으면 열린 상태 유지');

  game.player.row = 1;
  game.player.col = 0;
  game._updateGates(0);
  assert.equal(gate.closed, true, '사람이 떠나면 닫힌다');
});

test('닫힌 철창문은 악당 길찾기에서도 벽으로 처리된다', () => {
  const game = setup();
  game._startRound(6);

  const gate = game.gates[0];
  gate.closed = true;
  game._refreshNavMap();

  assert.equal(game.navMap[gate.row][gate.col], 1);

  const step = findNextStep(
    game.navMap,
    gate.row - 1, gate.col,
    gate.row + 1, gate.col,
    0,
  );

  assert.ok(step, '철창문을 피하는 우회 경로가 있어야 한다');
  assert.ok(
    !(step.row === gate.row && step.col === gate.col),
    '닫힌 철창문으로 들어가지 않는다',
  );

  gate.closed = false;
  game._refreshNavMap();
  assert.equal(game.navMap[gate.row][gate.col], 0);
});

test('8라운드부터 시야가 8타일에서 시작해 최소 3타일까지 줄어든다', () => {
  const game = setup();
  const cases = [
    [7, false, VISION_START_TILES],
    [8, true, 8],
    [9, true, 7],
    [10, true, 6],
    [13, true, 3],
    [20, true, 3],
  ];

  assert.equal(VISION_START_ROUND, 8);
  assert.equal(VISION_MIN_TILES, 3);

  for (const [round, dark, tiles] of cases) {
    game.round = round;
    assert.equal(game.darkMode, dark, `ROUND ${round} darkMode`);
    assert.equal(game.visionTiles, tiles, `ROUND ${round} visionTiles`);
  }
});

test('어둠 속에서 아이템과 트랩은 dark 발광 옵션으로 다시 그려진다', () => {
  const game = setup();
  game._startRound(8);

  const item = game.items.find(i => !i.collected);
  const trap = new Trap(item.row, item.col, 'POOP', 0.3, 10000);
  game.traps.push(trap);

  let itemOptions = null;
  let trapOptions = null;
  const renderItem = item.render.bind(item);
  const renderTrap = trap.render.bind(trap);

  item.render = (ctx, timeMs, options) => {
    itemOptions = options;
    renderItem(ctx, timeMs, options);
  };
  trap.render = (ctx, timeMs, options) => {
    trapOptions = options;
    renderTrap(ctx, timeMs, options);
  };

  game._render(0);

  assert.equal(itemOptions?.dark, true, '아이템 발광');
  assert.equal(trapOptions?.dark, true, '트랩 발광');
});

test('새 게임(resetAll)은 1라운드 상태로 돌아간다', () => {
  const game = setup();
  game._startRound(8);
  assert.equal(game.darkMode, true);
  assert.equal(game.gates.length, 2);

  game.resetAll();

  assert.equal(game.round, 1);
  assert.equal(game.enemies.length, 4);
  assert.equal(game.gates.length, 0);
  assert.equal(game.darkMode, false);
  assert.equal(
    game.navMap[9][12],
    TILE_MAP[9][12],
    '이전 라운드 철창문 흔적이 남지 않는다',
  );
});

