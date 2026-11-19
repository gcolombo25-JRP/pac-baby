/**
 * Pac-Baby: 봇 AI / 자동 울기 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import BotBrain from '../src/bot.js';
import Game from '../src/game.js';
import Tester from '../src/tester.js';
import { SKILL_CRY } from '../src/constants.js';

/** 모든 타일이 이동 가능한 작은 아레나 */
function createArena(size = 5) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

/** BotBrain 이 필요로 하는 최소 게임 오브젝트 */
function createBrainGame(options = {}) {
  const navMap = options.map || createArena(options.size || 5);
  return {
    navMap,
    map: { map: navMap },
    state: 'PLAYING',
    goldenTimer: 0,
    sugarRushTimer: 0,
    cryCooldown: 0,
    tester: null,
    player: { row: 2, col: 2, isStealthed: false },
    enemies: [],
    items: [],
    goldenBottle: { row: 4, col: 4, collected: true },
    ...options,
    player: {
      row: 2,
      col: 2,
      isStealthed: false,
      ...(options.player || {}),
    },
  };
}

/** 샌드박스용 최소 Canvas/Input */
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

function createStubCanvas() {
  const ctx = createStubCtx();
  return { width: 640, height: 640, ctx, getContext: () => ctx };
}

function createStubInput(direction = null) {
  return {
    direction,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

test('봇은 얼어붙은 악당을 위협에서 제외하고 그 타일을 안전하게 통과한다', () => {
  const game = createBrainGame({
    enemies: [{ row: 2, col: 3, isFrozen: true }],
    items: [{ row: 2, col: 4, type: 'CANDY', collected: false }],
  });
  const brain = new BotBrain();

  assert.equal(brain.shouldCry(game), false, '얼어붙은 악당에게 울기를 낭비하지 않는다');
  assert.equal(brain.decide(game), 'RIGHT', '얼어붙은 악당 타일을 지나 아이템으로 이동');
});

test('봇은 3타일 안의 위협에 울기를 사용하고, 얼음/쿨다운/스텔스 중에는 쓰지 않는다', () => {
  const brain = new BotBrain();
  const game = createBrainGame({
    enemies: [{ row: 2, col: 4, isFrozen: false }],
  });

  assert.equal(brain.shouldCry(game), true);

  game.enemies[0].isFrozen = true;
  assert.equal(brain.shouldCry(game), false, '얼어붙은 악당은 위협이 아니다');

  game.enemies[0].isFrozen = false;
  game.cryCooldown = SKILL_CRY.cooldown;
  assert.equal(brain.shouldCry(game), false, '쿨다운 중에는 쓰지 않는다');

  game.cryCooldown = 0;
  game.player.isStealthed = true;
  assert.equal(brain.shouldCry(game), false, '스텔스 중에는 쓰지 않는다');
});

test('봇은 황금 젖병을 일반 아이템보다 먼저 노린다', () => {
  const brain = new BotBrain();
  const game = createBrainGame({
    goldenBottle: { row: 2, col: 0, collected: false },
    items: [{ row: 2, col: 3, type: 'MILK', collected: false }],
  });

  assert.equal(brain.decide(game), 'LEFT');
  assert.equal(brain.lastMode, 'GOLDEN');
});

test('보행기 모드에서는 도망치지 않고 가장 가까운 악당에게 돌진한다', () => {
  const brain = new BotBrain();
  const game = createBrainGame({
    goldenTimer: 1000,
    goldenBottle: { row: 4, col: 4, collected: true },
    enemies: [{ row: 2, col: 0, isFrozen: false }],
    items: [{ row: 2, col: 3, type: 'CANDY', collected: false }],
  });

  assert.equal(brain.decide(game), 'LEFT', '아이템이 아니라 악당 방향으로 돌진');
  assert.equal(brain.lastMode, 'CHARGE');
});

test('캔디/쿠키가 가까우면 일반 아이템보다 우선한다', () => {
  const brain = new BotBrain();
  const game = createBrainGame({
    items: [
      { row: 2, col: 3, type: 'MILK', collected: false },
      { row: 2, col: 4, type: 'CANDY', collected: false },
    ],
  });

  assert.equal(brain.decide(game), 'RIGHT');
  assert.equal(brain.lastTarget.type, 'CANDY');
});

test('봇은 위협에서 멀어지는 방향으로 회피한다', () => {
  const brain = new BotBrain();
  const game = createBrainGame({
    enemies: [{ row: 2, col: 3, isFrozen: false }],
  });

  const dir = brain.decide(game);
  assert.ok(['UP', 'DOWN', 'LEFT'].includes(dir), `위협 반대 방향이어야 한다 (${dir})`);
  assert.equal(brain.lastMode, 'ESCAPE');
});

test('Game 봇 모드는 위기 시 키 입력 없이 실제 울기를 발동한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.botMode = true;
  game.demoArmed = false;

  const enemy = game.enemies[0];
  enemy.row = game.player.row;
  enemy.col = game.player.col;

  const before = game.player.score;
  game._update(game.tickMs);

  assert.equal(game.stats.cries, 1, '봇 울기 1회');
  assert.equal(game.player.score, before + SKILL_CRY.cost, '-100점');
  assert.ok(enemy.isFrozen, '위협 악당이 얼어붙는다');
  assert.ok(game.cryCooldown > 0, '울기 쿨다운 적용');
});

test('테스터 BOT 모드도 위기 시 자동으로 울기를 사용한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  const tester = new Tester({ game, input: game.input, ui: false });
  tester.startBot();

  const enemy = game.enemies[0];
  enemy.row = game.player.row;
  enemy.col = game.player.col;

  const before = game.player.score;
  tester.resolveDirection(game);

  assert.equal(tester.mode, 'BOT');
  assert.equal(game.stats.cries, 1);
  assert.equal(game.player.score, before + SKILL_CRY.cost);
  assert.ok(enemy.isFrozen);
});
