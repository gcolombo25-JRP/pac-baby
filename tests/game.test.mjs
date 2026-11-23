/**
 * Pac-Baby: 게임 루프/렌더링 통합 스모크 테스트
 *
 * 실제 브라우저 없이 스텁 Canvas/Input 으로 Game 을 구동해
 * 업데이트·렌더링 경로에서 예외가 발생하지 않는지 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game, { isTouchUiActive } from '../src/game.js';
import {
  TILE_MAP, TILE_SIZE, CANVAS_WIDTH, TICK_RATE,
  SPEED_LEVELS, DEFAULT_SPEED_LEVEL, CHASE_ENEMY_COUNT, ITEM_RESPAWN_MS,
  TRAP_LIFE_MS, TRAP_HIT_SCORE,
  STEALTH_DURATION_MS, ENEMY_CONFUSE_MS, SKILL_CRY,
  PLAYER_LIVES,
  TRAP_FREEZE_MS,
  READY_COUNTDOWN_MS, SCORE_POPUP_MS,
  ITEMS,
  isWalkableTile,
  getBabySpawn, getEnemySpawns, getItemSpawns,
} from '../src/constants.js';
import { ENEMY_MODE } from '../src/enemy.js';
import { Trap } from '../src/item.js';
import SoundFX from '../src/sound.js';

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
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
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

/** 최소 Canvas 스텁 */
function createStubCanvas() {
  const ctx = createStubCtx();
  return { width: CANVAS_WIDTH, height: CANVAS_WIDTH, ctx, getContext: () => ctx };
}

/** 방사형 그라디언트의 색상 정지점(stop)을 기록하는 스텁 */
function createGradientCtx() {
  const gradients = [];
  return {
    gradients,
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    createRadialGradient(...args) {
      const gradient = {
        args,
        stops: [],
        addColorStop(offset, color) { this.stops.push([offset, color]); },
      };
      gradients.push(gradient);
      return gradient;
    },
    fillRect() {},
  };
}

const alphaOf = (rgba) => Number.parseFloat(String(rgba).split(',')[3]);

/** 최소 InputManager 스텁 */
function createStubInput(direction = null) {
  return {
    direction,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

test('Game 생성 시 플레이어/악당/아이템이 스폰 위치에 배치된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const spawn = getBabySpawn(TILE_MAP);

  assert.equal(game.player.row, spawn.row);
  assert.equal(game.player.col, spawn.col);
  assert.equal(game.enemies.length, getEnemySpawns(TILE_MAP).length);
  assert.equal(game.items.length, getItemSpawns(TILE_MAP).length);
  assert.equal(game.traps.length, 0);
  assert.equal(game.running, false);
});

test('입력이 있으면 tick 마다 베이비가 이동한다', () => {
  const input = createStubInput('RIGHT');
  const game = new Game(createStubCanvas(), input);
  game.enemies = []; // 이동 로직만 검증 (악당 추격/체포 제외)
  const startCol = game.player.col;

  game._update(TICK_RATE);
  assert.equal(game.player.col, startCol + 1);

  game._update(TICK_RATE);
  assert.equal(game.player.col, startCol + 2);

  // 입력이 사라져도 진행 방향으로 계속 이동한다
  input.direction = null;
  game._update(TICK_RATE);
  assert.equal(game.player.col, startCol + 3);
});

test('렌더링 파이프라인이 예외 없이 실행되고 HUD 에 점수를 그린다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput());

  assert.doesNotThrow(() => game._render(0));

  const fillRects = canvas.ctx.calls.filter(c => c.name === 'fillRect');
  assert.ok(fillRects.length > 0, '배경/맵이 그려져야 한다');

  const texts = canvas.ctx.calls.filter(c => c.name === 'fillText');
  assert.ok(
    texts.some(t => String(t.args[0]).includes('SCORE')),
    'HUD 에 SCORE 가 표시되어야 한다',
  );

  const arcs = canvas.ctx.calls.filter(c => c.name === 'arc');
  assert.ok(
    arcs.some(a => a.args[2] === TILE_SIZE / 2 - 2),
    '베이비/악당 원이 그려져야 한다',
  );
});

test('PC 데스크톱에서는 하단 HUD 에 키보드 단축키 안내를 표시한다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput(), { touchUi: false });

  game._render(0);

  const texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));
  const hint = texts.find(text => text.includes('체포'));

  assert.ok(hint, '하단 게임 정보 줄이 그려져야 한다');
  assert.ok(hint.includes('아이템') && hint.includes('트랩'), '게임 정보는 유지');
  assert.ok(hint.includes('←↑↓→'), 'PC 에서는 방향키 안내를 표시한다');
  assert.ok(hint.includes('SPACE'), 'PC 에서는 SPACE 안내를 표시한다');
  assert.ok(hint.includes('P R M'), 'PC 에서는 P R M 안내를 표시한다');
  assert.ok(hint.includes('H:도움말'), 'PC 에서는 H:도움말 안내를 표시한다');
});

test('터치 D-패드가 화면에 표시 중일 때만 하단 HUD 키보드 안내를 숨긴다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput(), { touchUi: true });

  game._render(0);

  const texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));
  const hint = texts.find(text => text.includes('체포'));

  assert.ok(hint, '하단 게임 정보 줄이 그려져야 한다');
  assert.ok(hint.includes('아이템') && hint.includes('트랩'), '게임 정보는 유지');
  assert.equal(hint.includes('←↑↓→'), false, 'D-패드 표시 중에는 방향키 안내를 숨긴다');
  assert.equal(hint.includes('SPACE'), false, 'D-패드 표시 중에는 키보드 안내를 숨긴다');
  assert.equal(hint.includes('H:도움말'), false, 'D-패드 표시 중에는 H:도움말 안내를 숨긴다');
});

test('하단 키 안내 분기는 body.touch-active(D-패드 표시)만 본다', () => {
  // Windows 터치스크린 PC: maxTouchPoints/ontouchstart 신호만 있고 D-패드는 숨김 → 안내 유지
  assert.equal(
    isTouchUiActive({ document: { body: { classList: { contains: () => false } } } }),
    false,
    'D-패드가 표시되지 않으면 PC 로 취급',
  );
  assert.equal(
    isTouchUiActive({
      document: { body: { classList: { contains: name => name === 'touch-active' } } },
    }),
    true,
    'body.touch-active 는 D-패드 표시 중',
  );
  assert.equal(isTouchUiActive({ touchUi: true }), true);
  assert.equal(isTouchUiActive({ touchUi: false }), false);
});

test('게임 캔버스의 HUD/오버레이는 OS 이모지 없이 벡터 아이콘만 쓴다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput());

  // 아이콘이 필요한 상태를 한 번에 켠다
  game.lives = 2;
  game.player.score = game.roundScoreCap;
  game._refreshScoreCapState();
  game.enemies.forEach(enemy => enemy.freeze(3000));
  game.sugarRushTimer = 2000;
  game.goldenTimer = 3000;
  game.player.startDigestion(ITEMS.MILK);

  // OS 이모지/픽토그램 영역 (하트 ♥♡ 포함)
  const osEmoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

  for (const state of ['PLAYING', 'READY', 'CAUGHT', 'PAUSED', 'STAGE_CLEAR', 'GAME_OVER']) {
    game.state = state;
    canvas.ctx.calls.length = 0;

    assert.doesNotThrow(() => game._render(0), `${state} 렌더 예외 없음`);

    const texts = canvas.ctx.calls
      .filter(call => call.name === 'fillText')
      .map(call => String(call.args[0]));

    for (const text of texts) {
      assert.equal(
        osEmoji.test(text),
        false,
        `${state} 상태 HUD 에 OS 이모지가 남아 있습니다: ${text}`,
      );
    }
  }
});

test('devicePixelRatio 만큼 캔버스 내부 해상도를 키운다 (레티나)', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput());

  game.applyPixelRatio(2);
  assert.equal(game.dpr, 2);
  assert.equal(canvas.width, CANVAS_WIDTH * 2);
  assert.equal(canvas.height, CANVAS_WIDTH * 2);
  assert.equal(game.map.pixelRatio, 2, '맵 캐시도 같은 배율을 쓴다');

  game.applyPixelRatio(1); // 다른 테스트에 영향을 주지 않도록 복원
  assert.equal(game.dpr, 1);
  assert.equal(canvas.width, CANVAS_WIDTH);
  assert.equal(game.map.pixelRatio, 1);
});

test('보간 계수를 바꿔도 렌더링이 안전하다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput('RIGHT'));
  game._update(100);

  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    assert.doesNotThrow(() => game._render(alpha));
  }
});

test('일반 라운드 조명은 수유등처럼 은은하고, 어둠 모드 시야 가시성은 유지된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  // 일반 라운드: 가산 합성 조명의 코어 알파가 낮아 아기 얼굴/벽 테두리가 날아가지 않는다
  game.round = 1;
  assert.equal(game.darkMode, false);
  const softCtx = createGradientCtx();
  game._renderLighting(softCtx, 0);

  const softGlow = softCtx.gradients[softCtx.gradients.length - 1];
  assert.ok(softGlow, '따뜻한 수유등 그라디언트를 그린다');
  const softCore = alphaOf(softGlow.stops[0][1]);
  assert.ok(softCore > 0, '조명은 완전히 사라지지 않는다');
  assert.ok(softCore <= 0.12, `일반 라운드 조명이 은은해야 한다 (core=${softCore})`);
  assert.equal(softCtx.globalCompositeOperation, 'source-over', '합성 모드를 원복한다');

  // 8라운드 이후 어둠 모드: 시야 확보를 위해 기존 광량을 유지한다
  game.round = 8;
  assert.equal(game.darkMode, true);
  const darkCtx = createGradientCtx();
  game._renderLighting(darkCtx, 0);

  const darkGlow = darkCtx.gradients[darkCtx.gradients.length - 1];
  assert.ok(darkGlow, '어둠 모드에서도 조명을 그린다');
  const darkCore = alphaOf(darkGlow.stops[0][1]);
  assert.ok(darkCore >= 0.2, `어둠 모드 조명은 가시성을 유지해야 한다 (core=${darkCore})`);
  assert.ok(darkCore > softCore * 1.5, '일반 라운드보다 밝아야 한다');
});

test('맵 렌더러는 모든 타일을 그린다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput());

  game.map.render(canvas.ctx);

  // 침대(2) 타일은 바닥 + 침대 사각형으로 2번 그려진다
  let bedTiles = 0;
  for (const row of TILE_MAP) {
    for (const tile of row) {
      if (tile === 2) bedTiles++;
    }
  }

  const rects = canvas.ctx.calls.filter(c => c.name === 'fillRect');
  assert.equal(
    rects.length, TILE_MAP.length * TILE_MAP[0].length + bedTiles,
    '28x28 모든 타일이 fillRect 로 그려져야 한다',
  );
});

test('베이비는 중앙 방 밖으로 나갈 수 있다', () => {
  const input = createStubInput('RIGHT');
  const game = new Game(createStubCanvas(), input);
  game.enemies = []; // 순수 이동 경로만 검증
  const spawn = getBabySpawn(TILE_MAP);

  game._update(TICK_RATE);   // → (13, 12)
  input.direction = 'UP';
  game._update(TICK_RATE);   // → (12, 12) 방 출구
  game._update(TICK_RATE);   // → (11, 12) 방 밖 복도

  assert.equal(game.player.col, spawn.col + 1);
  assert.equal(game.player.row, 11, '방 밖(11행 복도)으로 나와야 한다');
  assert.ok(isWalkableTile(TILE_MAP, game.player.row, game.player.col));
});

test('악당에게 잡히면 -200점을 잃고 침대로 귀환한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const spawn = getBabySpawn(TILE_MAP);
  const startScore = game.player.score;

  // 악당을 고정(pinned)해 이동하지 못하게 한 뒤 베이비와 같은 타일에 배치
  // (freeze 는 이제 '무해' 효과라 정지 용도로는 pinned 를 사용한다)
  game.enemies.forEach(e => { e.pinned = true; });
  const catcher = game.enemies[0];
  catcher.row = game.player.row;
  catcher.col = game.player.col;

  game._update(TICK_RATE);

  assert.equal(game.player.score, startScore - 200);
  assert.equal(game.player.row, spawn.row);
  assert.equal(game.player.col, spawn.col);
  assert.equal(game.catchCount, 1);
  assert.ok(game.graceTimer > 0, '체포 직후에는 무적 시간이 있어야 한다');
  assert.deepEqual(
    [catcher.row, catcher.col], [catcher.spawnRow, catcher.spawnCol],
    '악당은 대기실로 돌아가야 한다',
  );
});

test('무적 시간 동안에는 중복 페널티가 없다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.enemies.forEach(e => { e.pinned = true; });

  game.enemies[0].row = game.player.row;
  game.enemies[0].col = game.player.col;
  game._update(TICK_RATE);

  const scoreAfterFirstCatch = game.player.score;
  assert.equal(game.catchCount, 1);

  // 무적 시간 중에 다시 같은 타일에 악당을 배치
  game.enemies[0].row = game.player.row;
  game.enemies[0].col = game.player.col;
  game._update(TICK_RATE);

  assert.equal(game.player.score, scoreAfterFirstCatch, '추가 감점이 없어야 한다');
  assert.equal(game.catchCount, 1);
});

test('기본 속도 단계는 1(가장 느림)이고 1~10 범위로 조절된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  assert.equal(game.speedLevel, DEFAULT_SPEED_LEVEL);
  assert.equal(game.tickMs, SPEED_LEVELS[0].babyTileMs);
  assert.equal(game.enemies[0].baseTileMs, SPEED_LEVELS[0].enemyTileMs);

  assert.equal(game.setSpeedLevel(10), 10);
  assert.equal(game.tickMs, SPEED_LEVELS[9].babyTileMs);
  assert.equal(game.enemies[0].baseTileMs, SPEED_LEVELS[9].enemyTileMs);

  assert.equal(game.setSpeedLevel(0), 1, '최소 1단계로 보정된다');
  assert.equal(game.setSpeedLevel(99), 10, '최대 10단계로 보정된다');
});

test('악당 2마리는 추격, 나머지 2마리는 경비 모드다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const chase = game.enemies.filter(e => e.mode === ENEMY_MODE.CHASE);
  const patrol = game.enemies.filter(e => e.mode === ENEMY_MODE.PATROL);

  assert.equal(chase.length, CHASE_ENEMY_COUNT);
  assert.equal(patrol.length, game.enemies.length - CHASE_ENEMY_COUNT);
});

test('속도 단계를 바꿔도 게임 로직은 계속 동작한다', () => {
  const input = createStubInput('RIGHT');
  const game = new Game(createStubCanvas(), input);
  game.enemies = [];
  game.setSpeedLevel(1);

  const startCol = game.player.col;
  for (let i = 0; i < 3; i++) {
    game._update(game.tickMs);
  }
  assert.equal(game.player.col, startCol + 3);

  game.setSpeedLevel(10);
  game._update(game.tickMs);
  assert.equal(game.player.col, startCol + 4);
});

test('아이템에 도달하면 점수가 오르고 아이템이 사라진다', () => {
  const input = createStubInput('LEFT');
  const game = new Game(createStubCanvas(), input);
  game.enemies = [];

  const item = game.items.find(i => !i.collected);
  // 아이템 바로 오른쪽 타일에서 왼쪽으로 이동해 아이템을 밟는다
  game.player.row = item.row;
  game.player.col = item.col + 1;
  game.player.x = game.player.col * TILE_SIZE;
  game.player.y = game.player.row * TILE_SIZE;

  const beforeScore = game.player.score;
  const beforeCount = game.itemCount;
  const expectedScore = item.config.score;

  game._update(game.tickMs);

  assert.equal(game.player.col, item.col, '아이템 타일로 이동해야 한다');
  assert.equal(game.player.score, beforeScore + expectedScore);
  assert.equal(item.collected, true, '섭취한 아이템은 사라진다');
  assert.equal(game.itemCount, beforeCount - 1);
});

test('섭취한 아이템은 15초 뒤 임의의 위치에 다시 나타난다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.enemies = [];
  game.rng = () => 0.5; // 리스폰 위치 고정

  const item = game.items.find(i => !i.collected);
  item.collect();

  const ticks = Math.ceil(ITEM_RESPAWN_MS / game.tickMs);
  for (let i = 0; i < ticks - 1; i++) {
    game._update(game.tickMs);
  }
  assert.equal(item.collected, true, '15초 전에는 다시 나타나지 않는다');

  game._update(game.tickMs);
  assert.equal(item.collected, false, '15초가 지나면 다시 나타난다');
  assert.ok(isWalkableTile(TILE_MAP, item.row, item.col));
});

test('경비 악당은 베이비 타일로 이동하지 않는다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const patrols = game.enemies.filter(e => e.mode === ENEMY_MODE.PATROL);

  assert.ok(patrols.length > 0, '경비 악당이 존재해야 한다');

  for (let i = 0; i < 60; i++) {
    game._update(game.tickMs);
  }

  for (const enemy of patrols) {
    const distance = Math.abs(enemy.row - game.player.row)
      + Math.abs(enemy.col - game.player.col);
    assert.ok(distance > 0, `경비 악당이 베이비와 같은 타일에 있다: (${enemy.row},${enemy.col})`);
  }
});

test('모든 속도 단계에서 악당은 베이비보다 느리다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  for (let level = 1; level <= SPEED_LEVELS.length; level++) {
    const config = SPEED_LEVELS[level - 1];
    assert.ok(
      config.enemyTileMs > config.babyTileMs,
      `${level}단계 설정값: 악당이 베이비보다 빠르다`,
    );

    game.setSpeedLevel(level);
    assert.ok(
      game.enemies[0].baseTileMs > game.tickMs,
      `${level}단계 적용값: 악당(${game.enemies[0].baseTileMs}ms) <= 베이비(${game.tickMs}ms)`,
    );
  }
});

test('아이템 섭취 → 소화 → 트랩 배출 → 악당 감속까지 이어진다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.enemies.forEach(e => { e.pinned = true; }); // 소화 중 체포되지 않도록 정지
  const item = game.items[0];
  const config = item.config;

  // 아이템 타일에서 섭취 처리
  game.player.row = item.row;
  game.player.col = item.col;
  game._updateItems(game.tickMs);

  assert.equal(item.collected, true);
  assert.equal(game.player.digesting.length, 1, '소화가 시작된다');

  // 소화 완료까지 진행
  const ticks = Math.ceil(config.digestTime / game.tickMs);
  for (let i = 0; i < ticks; i++) game._update(game.tickMs);

  assert.equal(game.traps.length, 1, '트랩이 배출된다');
  const trap = game.traps[0];
  assert.equal(trap.trapType, config.trapType);
  assert.equal(trap.row, game.player.row);
  assert.equal(trap.col, game.player.col);

  // 베이비를 옆 칸으로 옮기고(체포 방지) 악당을 트랩 타일로 이동
  // (랜덤 스폰된 다른 악당이 베이비 타일에 겹쳐 체포→리셋되는 것을 막기 위해 모두 안전한 곳으로 옮긴다)
  game.player.col = item.col + 1;
  game.enemies.forEach(e => {
    e.pinned = true;
    e.row = 1;
    e.col = 1;
  });
  const enemy = game.enemies[0];
  enemy.row = trap.row;
  enemy.col = trap.col;

  const scoreBefore = game.player.score;
  game._update(game.tickMs);

  assert.equal(enemy.slowEffect, config.slowEffect, '악당이 감속된다');
  assert.ok(enemy.slowTimer > 0);
  assert.equal(game.player.score, scoreBefore + TRAP_HIT_SCORE);
  assert.equal(game.traps.length, 0, '밟힌 트랩은 사라진다');
});

test('트랩을 밟은 악당은 종류별로 얼고 감속도 유지된다', () => {
  const cases = [
    { type: 'PEE', freezeMs: TRAP_FREEZE_MS.PEE, slow: 0.10 },
    { type: 'VOMIT', freezeMs: TRAP_FREEZE_MS.VOMIT, slow: 0.20 },
    { type: 'POOP', freezeMs: TRAP_FREEZE_MS.POOP, slow: 0.30 },
  ];

  for (const item of cases) {
    const game = new Game(createStubCanvas(), createStubInput());
    const enemy = game.enemies[0];
    game.traps.push(new Trap(enemy.row, enemy.col, item.type, item.slow, 10000));

    game._updateTraps(game.tickMs);

    assert.equal(enemy.isFrozen, true, `${item.type} 적중 시 얼림`);
    assert.equal(enemy.frozenTimer, item.freezeMs, `${item.type} 얼림 ${item.freezeMs}ms`);
    assert.equal(enemy.frozenTotal, item.freezeMs);
    assert.equal(enemy.slowEffect, item.slow, '기존 감속 효과 유지');
    assert.ok(enemy.slowTimer > 0);
    assert.equal(game.traps.length, 0, '트랩 소모');
    assert.equal(game.player.score, TRAP_HIT_SCORE);
  }
});

test('트랩은 수명이 끝나면 사라진다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.enemies = [];
  game.traps.push(new Trap(1, 9, 'POOP', 0.3, 10000));

  const ticks = Math.ceil(TRAP_LIFE_MS / game.tickMs);
  for (let i = 0; i < ticks - 1; i++) {
    game._update(game.tickMs);
  }
  assert.equal(game.traps.length, 1, '수명 전에는 남아 있다');

  game._update(game.tickMs);
  assert.equal(game.traps.length, 0, '수명이 끝나면 사라진다');
});

test('스페이스바 울기: 악당 전체 3초 얼림과 -100점', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.input.isJustPressed = code => code === SKILL_CRY.key;

  const before = game.player.score;
  game._handleSkillInput();

  assert.equal(game.player.score, before + SKILL_CRY.cost, '-100점');
  assert.ok(game.enemies.every(e => e.isFrozen), '모든 악당이 얼어붙는다');
  assert.ok(game.enemies.every(e => e.frozenTimer === SKILL_CRY.freezeDuration));

  // 비상 탈출용: 얼어 있는 상태에서도 사용 가능하지만, 3초 쿨다운 동안은 무시된다
  game._handleSkillInput();
  assert.equal(game.player.score, before + SKILL_CRY.cost, '쿨다운 중에는 비용이 나가지 않는다');
  assert.ok(
    game.enemies.every(e => e.frozenTimer === SKILL_CRY.freezeDuration),
    '쿨다운 중에는 연장되지 않는다',
  );

  // 쿨다운이 끝나면 재사용 + 3초 연장
  game.cryCooldown = 0;
  game._handleSkillInput();
  assert.equal(game.player.score, before + SKILL_CRY.cost * 2);
  assert.ok(
    game.enemies.every(e => e.frozenTimer === SKILL_CRY.freezeDuration * 2),
    '얼림이 +3초 연장된다',
  );
});

test('울기는 3초 쿨다운 동안 연사할 수 없다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.input.isJustPressed = code => code === SKILL_CRY.key;
  game.enemies.forEach(enemy => { enemy.pinned = true; });

  game._handleSkillInput();
  assert.equal(game.cryCooldown, SKILL_CRY.cooldown, '사용 즉시 3초 쿨다운');
  const scoreAfterFirst = game.player.score;

  // 연타해도 비용이 나가지 않는다
  game._handleSkillInput();
  game._handleSkillInput();
  assert.equal(game.player.score, scoreAfterFirst);

  // 3초 경과 후 재사용 가능
  const ticks = Math.ceil(SKILL_CRY.cooldown / game.tickMs);
  for (let i = 0; i < ticks; i++) game._update(game.tickMs);
  assert.equal(game.cryCooldown, 0, '쿨다운 종료');

  game._handleSkillInput();
  assert.equal(game.player.score, scoreAfterFirst + SKILL_CRY.cost, '재사용 가능');

  // 새 게임에서는 쿨다운이 초기화된다
  game.resetAll();
  assert.equal(game.cryCooldown, 0);
});

test('트랩으로 얼어붙은 악당에게 울기를 쓰면 +3초 연장된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.input.isJustPressed = code => code === SKILL_CRY.key;

  const trapped = game.enemies[0];
  trapped.freeze(TRAP_FREEZE_MS.POOP); // 트랩(대변)으로 10초 얼음
  assert.equal(trapped.frozenTimer, 10000);

  const before = game.player.score;
  game._handleSkillInput();

  assert.equal(game.player.score, before + SKILL_CRY.cost, '얼어 있어도 사용 가능(비상 탈출)');
  assert.equal(trapped.frozenTimer, 10000 + SKILL_CRY.freezeDuration, '얼음 +3초 연장');
  assert.equal(trapped.frozenTotal, trapped.frozenTimer, '색 보간 기준도 갱신');

  // 얼지 않았던 악당은 새로 3초 얼림
  assert.ok(
    game.enemies.slice(1).every(e => e.isFrozen && e.frozenTimer === SKILL_CRY.freezeDuration),
    '나머지는 새로 얼림',
  );
});

test('얼어붙은 악당은 무해해서 밟아도 체포되지 않는다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.input.isJustPressed = code => code === SKILL_CRY.key;
  game._handleSkillInput();
  assert.ok(game.enemies.every(enemy => enemy.isFrozen));

  const enemy = game.enemies[0];
  enemy.row = game.player.row;
  enemy.col = game.player.col;

  const scoreBefore = game.player.score;
  game._update(game.tickMs);

  assert.equal(game.catchCount, 0, '얼음 중에는 체포되지 않는다');
  assert.equal(game.player.score, scoreBefore, '추가 감점 없음');
  assert.equal(game.lives, PLAYER_LIVES);
});

test('얼음이 풀린 뒤 같은 타일에 있으면 다시 체포된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.input.isJustPressed = code => code === SKILL_CRY.key;
  game._handleSkillInput();

  const enemy = game.enemies[0];
  enemy.row = game.player.row;
  enemy.col = game.player.col;

  // 얼음이 곧 풀리도록 만료 직전으로 만들고 한 틱 진행
  game.enemies.forEach(e => { e.frozenTimer = 1; });
  game._update(2);

  assert.equal(game.catchCount, 1, '얼음이 풀리면 다시 위험해진다');
});

test('얼어붙은 악당과 교차 통과해도 체포되지 않는다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.enemies.forEach(enemy => enemy.freeze(5000));

  const player = game.player;
  const enemy = game.enemies[0];

  player.prevRow = 14; player.prevCol = 10;
  player.row = 14; player.col = 11;
  player.isMoving = true;
  enemy.prevRow = 14; enemy.prevCol = 11;
  enemy.row = 14; enemy.col = 10;
  enemy.movedThisTick = true;

  assert.equal(game._isCaught(), false);
});

test('얼지 않은 악당과의 교차는 그대로 체포된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const player = game.player;
  const enemy = game.enemies[0];

  player.prevRow = 14; player.prevCol = 10;
  player.row = 14; player.col = 11;
  player.isMoving = true;
  enemy.prevRow = 14; enemy.prevCol = 11;
  enemy.row = 14; enemy.col = 10;
  enemy.movedThisTick = true;

  assert.equal(game._isCaught(), true);
});

test('침대에 새로 들어가면 10초 스텔스 + 추격 악당은 5초 목표 상실', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const spawn = getBabySpawn(TILE_MAP);

  // 시작 위치가 침대여도 자동 발동되지 않는다
  game._updateStealth();
  assert.equal(game.player.isStealthed, false);

  // 침대 밖으로 나갔다가 다시 들어온다
  game.player.col = spawn.col + 1;
  game._updateStealth();
  assert.equal(game.player.isStealthed, false);

  game.player.col = spawn.col;
  game._updateStealth();

  assert.equal(game.player.isStealthed, true, '스텔스 발동');
  assert.equal(game.player.stealthTimer, STEALTH_DURATION_MS);
  assert.deepEqual(game.map.highlightBed, { row: spawn.row, col: spawn.col });

  const chasers = game.enemies.slice(0, CHASE_ENEMY_COUNT);
  assert.ok(chasers.every(e => e.mode === ENEMY_MODE.PATROL), '추격 악당이 목표를 잃는다');
  assert.ok(chasers.every(e => e.confuseTimer === ENEMY_CONFUSE_MS));

  const guards = game.enemies.slice(CHASE_ENEMY_COUNT);
  assert.ok(guards.every(e => e.confuseTimer === 0), '경비 악당은 영향 없음');
});

test('스텔스 5초 뒤 악당은 추격으로 복귀하고, 스텔스는 10초 유지된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const spawn = getBabySpawn(TILE_MAP);

  game.player.col = spawn.col + 1;
  game._updateStealth();
  game.player.col = spawn.col;
  game._updateStealth();
  assert.equal(game.player.isStealthed, true);

  const ticks = Math.ceil(ENEMY_CONFUSE_MS / game.tickMs);
  for (let i = 0; i < ticks; i++) {
    game._update(game.tickMs);
  }

  const chasers = game.enemies.slice(0, CHASE_ENEMY_COUNT);
  assert.ok(chasers.every(e => e.mode === ENEMY_MODE.CHASE), '5초 뒤 추격 복귀');
  assert.equal(game.player.isStealthed, true, '스텔스는 10초 지속');
});

test('스텔스 중에는 악당과 같은 타일에 있어도 잡히지 않는다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  assert.equal(game.player.activateStealth(STEALTH_DURATION_MS), true);
  game.enemies.forEach(e => { e.pinned = true; });
  game.enemies[0].row = game.player.row;
  game.enemies[0].col = game.player.col;

  const scoreBefore = game.player.score;
  game._update(game.tickMs);

  assert.equal(game.catchCount, 0, '스텔스 중에는 체포되지 않는다');
  assert.equal(game.player.score, scoreBefore);
});

test('점수 팝업이 있어도 렌더링이 예외 없이 동작한다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput());

  game._addPopup(13, 11, '+50', '#8bc34a');
  assert.doesNotThrow(() => game._render(0.5), 'TILE_SIZE 미정의 같은 렌더 예외가 없어야 한다');
});

test('게임은 READY 로 시작해 카운트다운 후 PLAYING 이 된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  assert.equal(game.state, 'READY');
  assert.equal(game.readyTimer, READY_COUNTDOWN_MS);

  assert.equal(game._updateReady(READY_COUNTDOWN_MS / 2), false);
  assert.equal(game.state, 'READY');

  assert.equal(game._updateReady(READY_COUNTDOWN_MS / 2), true);
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.readyTimer, 0);
});

test('P 키로 일시정지/재개가 토글된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.input.isJustPressed = code => code === 'KeyP';

  game._togglePauseInput();
  assert.equal(game.state, 'PAUSED');

  game._togglePauseInput();
  assert.equal(game.state, 'PLAYING');

  // READY 상태에서는 일시정지되지 않는다
  game.state = 'READY';
  game._togglePauseInput();
  assert.equal(game.state, 'READY');
});

test('아이템 섭취 시 점수 팝업이 생기고 시간이 지나면 사라진다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.enemies = [];

  const item = game.items[0];
  game.player.row = item.row;
  game.player.col = item.col + 1;
  game.player.x = game.player.col * TILE_SIZE;
  game.player.y = game.player.row * TILE_SIZE;
  game.input.direction = 'LEFT';

  game._update(game.tickMs); // 아이템 타일로 이동 + 섭취

  assert.equal(game.stats.items, 1, '아이템 섭취 횟수 기록');
  assert.equal(game.scorePopups.length, 1, '점수 팝업 생성');
  assert.equal(game.scorePopups[0].text, `+${item.config.score}`);

  // 이동을 멈추고 팝업이 사라질 때까지 진행
  game.input.direction = null;
  game.player.direction = null;
  game.player.nextDirection = null;

  const ticks = Math.ceil(SCORE_POPUP_MS / game.tickMs) + 1;
  for (let i = 0; i < ticks; i++) {
    game._update(game.tickMs);
  }
  assert.equal(game.scorePopups.length, 0, '시간이 지나면 팝업이 사라진다');
});

test('적과 서로의 타일을 맞바꿔 지나가도 체포된다 (교차 판정)', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  const enemy = game.enemies[0];
  const player = game.player;

  // 1) 같은 타일
  player.prevRow = 14; player.prevCol = 10;
  player.row = 14; player.col = 10;
  enemy.prevRow = 14; enemy.prevCol = 10;
  enemy.row = 14; enemy.col = 10;
  enemy.movedThisTick = false;
  assert.equal(game._isCaught(), true, '같은 타일이면 체포');

  // 2) 교차 통과: 베이비 (14,10)->(14,11), 적 (14,11)->(14,10)
  player.prevRow = 14; player.prevCol = 10;
  player.row = 14; player.col = 11;
  player.isMoving = true;
  enemy.prevRow = 14; enemy.prevCol = 11;
  enemy.row = 14; enemy.col = 10;
  enemy.movedThisTick = true;
  assert.equal(game._isCaught(), true, '서로 자리를 바꿔도 체포');

  // 3) 적이 이번 틱에 움직이지 않았다면 교차가 아니다
  enemy.movedThisTick = false;
  assert.equal(game._isCaught(), false);
});

test('SoundFX 를 넘기면 게임 인스턴스들이 같은 사운드를 공유한다', () => {
  const sound = new SoundFX();
  const gameA = new Game(createStubCanvas(), createStubInput(), { sound });
  const gameB = new Game(createStubCanvas(), createStubInput(), { sound });

  assert.equal(gameA.sound, sound);
  assert.equal(gameB.sound, sound, '재시작해도 AudioContext 가 늘지 않는다');

  // 옵션을 주지 않으면 각자 새 인스턴스를 만든다
  const solo = new Game(createStubCanvas(), createStubInput());
  assert.notEqual(solo.sound, sound);
});

