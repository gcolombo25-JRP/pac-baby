/**
 * Pac-Baby: 목숨 / 게임 오버 / 라운드 클리어 / 하이스코어 / 자동 일시정지 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import { Trap } from '../src/item.js';
import {
  ITEMS, PLAYER_LIVES, READY_COUNTDOWN_MS, ROUND_TARGET_SCORE, HISCORE_KEY,
  TRAP_COLORS, COLORS, SKILL_CRY,
} from '../src/constants.js';
import { scoreCapForRound } from '../src/validation.js';

/** 호출을 기록하는 최소 ctx 스텁 */
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

function createStubInput() {
  return {
    direction: null,
    pressed: new Set(),
    getDirection() { return this.direction; },
    isDown(code) { return this.pressed.has(code); },
    isJustPressed(code) { return this.pressed.has(code); },
    clearJustPressed() {},
  };
}

/** localStorage 스텁 */
function createStorage() {
  const map = new Map();
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function setup(options = {}) {
  const canvas = createStubCanvas();
  const input = createStubInput();
  const game = new Game(canvas, input, options);
  return { game, canvas, input };
}

/** 적을 베이비 타일에 붙여 강제 체포 (무적 시간 초기화) */
function forceCatch(game) {
  game.graceTimer = 0;
  game.enemies.forEach(enemy => { enemy.pinned = true; });
  const enemy = game.enemies[0];
  enemy.row = game.player.row;
  enemy.col = game.player.col;
  game._update(game.tickMs);
}

test('게임은 목숨 3 / 라운드 1 / 하이스코어 0 으로 시작한다', () => {
  const { game } = setup();

  assert.equal(game.lives, PLAYER_LIVES);
  assert.equal(game.round, 1);
  assert.equal(game.roundStartScore, 0);
  assert.equal(game.roundItemsEaten, 0);
  assert.equal(game.hiScore, 0);
  assert.equal(game.state, 'READY');
});

test('체포될 때마다 목숨이 1개씩 줄어든다', () => {
  const { game } = setup();
  const startScore = game.player.score;

  forceCatch(game);
  assert.equal(game.lives, PLAYER_LIVES - 1);
  assert.equal(game.player.score, startScore - 200);

  forceCatch(game);
  assert.equal(game.lives, PLAYER_LIVES - 2);
  assert.equal(game.catchCount, 2);
});

test('목숨이 0이 되면 GAME OVER 로 전환된다', () => {
  const { game } = setup();

  for (let i = 0; i < PLAYER_LIVES; i++) forceCatch(game);

  assert.equal(game.lives, 0);
  assert.equal(game.state, 'GAME_OVER');
  assert.equal(game.catchCount, PLAYER_LIVES);
});

test('마지막 체포에도 -200점이 적용된다', () => {
  const { game } = setup();
  game.player.score = 1000;

  for (let i = 0; i < PLAYER_LIVES; i++) forceCatch(game);

  assert.equal(game.player.score, 1000 - 200 * PLAYER_LIVES);
});

test('GAME OVER 에서 R 을 누르면 새 게임이 시작된다', () => {
  const { game, input } = setup();
  game.player.score = 500;
  for (let i = 0; i < PLAYER_LIVES; i++) forceCatch(game);
  assert.equal(game.state, 'GAME_OVER');

  input.pressed.add('KeyR');
  game._handleStateInput();

  assert.equal(game.state, 'READY');
  assert.equal(game.lives, PLAYER_LIVES);
  assert.equal(game.player.score, 0);
  assert.equal(game.round, 1);
  assert.equal(game.catchCount, 0);
  assert.equal(game.itemCount, 12, '아이템 12개 복구');
  assert.equal(game.traps.length, 0);
  assert.ok(game.graceTimer > 0, '재시작 직후 무적');
});

test('재도전해도 하이스코어는 유지된다', () => {
  const storage = createStorage();
  const { game } = setup({ storage });

  game.player.score = 800;
  game._updateHiScore();
  assert.equal(game.hiScore, 800);

  game.player.score = 0;
  game.resetAll();

  assert.equal(game.hiScore, 800);
  assert.equal(game.newRecord, false);
});

test('하이스코어는 storage 에 저장되고 다음 게임에서 로드된다', () => {
  const storage = createStorage();
  const { game } = setup({ storage });

  game.player.score = 900;
  game._updateHiScore();

  assert.equal(storage.getItem(HISCORE_KEY), '900');
  assert.equal(game.newRecord, true);

  const { game: next } = setup({ storage });
  assert.equal(next.hiScore, 900);
  assert.equal(next.newRecord, false);
});

test('아이템을 모두 섭취하면 STAGE CLEAR 로 전환된다', () => {
  const { game } = setup();
  game.state = 'PLAYING';
  game.roundItemsEaten = game.items.length;

  game._checkRoundProgress();

  assert.equal(game.state, 'STAGE_CLEAR');
});
test('ITEMS 클리어 모드에서는 점수만으로는 클리어되지 않는다', () => {
  const { game } = setup();
  game.state = 'PLAYING';
  game.player.score = ROUND_TARGET_SCORE + 500;

  game._checkRoundProgress();

  assert.equal(game.state, 'PLAYING');
});

// ===== 라운드별 점수 상한 (Score Cleared) =====

test('점수 획득은 라운드 상한(scoreCapForRound)에서 멈춘다', () => {
  const { game } = setup();
  const cap = scoreCapForRound(1);

  game.player.score = cap - 30;
  assert.equal(game._addScore(100), 30, '상한까지만 반영');
  assert.equal(game.player.score, cap);
  assert.equal(game.scoreCapReached, true);

  assert.equal(game._addScore(100), 0, '상한 상태에서는 더 오르지 않는다');
  assert.equal(game.player.score, cap);
});

test('아이템 섭취는 라운드 상한에서 멈추지만 아이템은 정상적으로 섭취된다', () => {
  const { game } = setup();
  game.enemies = [];
  const item = game.items.find(i => !i.collected);
  const cap = scoreCapForRound(1);

  game.player.row = item.row;
  game.player.col = item.col;
  game.player.score = cap - 10;

  game._updateItems(game.tickMs);

  assert.equal(game.player.score, cap);
  assert.equal(item.collected, true);
  assert.equal(game.roundItemsEaten, 1, '아이템 섭취 카운트는 그대로 진행');
  assert.equal(game.scoreCapReached, true);
});

test('보행기 넉백(+300)도 라운드 상한에서 멈춘다', () => {
  const { game } = setup();
  game.player.score = scoreCapForRound(1) - 100;

  game._knockEnemy(game.enemies[0]);

  assert.equal(game.player.score, scoreCapForRound(1));
  assert.equal(game.scoreCapReached, true);
});

test('트랩 적중(+100)도 라운드 상한에서 멈춘다', () => {
  const { game } = setup();
  const cap = scoreCapForRound(1);
  game.player.score = cap - 40;

  const enemy = game.enemies[0];
  const trap = new Trap(enemy.row, enemy.col, 'POOP', 0.3, 10000);
  game.traps.push(trap);

  game._updateTraps(game.tickMs);

  assert.equal(game.player.score, cap);
  assert.equal(game.scoreCapReached, true);
  assert.equal(game.stats.traps, 1);
});

test('울기(-100)·체포(-200) 감점은 상한에서도 적용되고 다시 상한까지 오른다', () => {
  const { game, input } = setup();
  const cap = scoreCapForRound(1);

  game.state = 'PLAYING';
  game.player.score = cap;
  game._refreshScoreCapState();
  assert.equal(game.scoreCapReached, true);

  // 울기 -100 → 상한 아래로 내려가면 배지도 해제된다
  input.pressed.add(SKILL_CRY.key);
  game._handleSkillInput();
  assert.equal(game.player.score, cap + SKILL_CRY.cost);
  assert.equal(game.scoreCapReached, false);

  // 다시 상한까지 획득 가능
  game._addScore(1000);
  assert.equal(game.player.score, cap);
  assert.equal(game.scoreCapReached, true);

  // 체포 -200 도 그대로 적용 (울기로 얼어붙은 악당과 무관하게 직접 체포 처리)
  game._catchPlayer();
  assert.equal(game.player.score, cap - 200);
  assert.equal(game.scoreCapReached, false);
});

test('Score Cleared 배지와 남은 아이템 안내가 HUD 에 표시된다', () => {
  const { game, canvas } = setup();
  game.player.score = scoreCapForRound(1);
  game._refreshScoreCapState();

  game._render(0.5);

  const texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));

  assert.ok(texts.some(t => t.includes('Score Cleared')));
  assert.ok(texts.some(t => t.includes('남은 아이템을 모아 다음 라운드로 가세요!')));
});

test('다음 라운드/새 게임에서는 Score Cleared 상태가 초기화된다', () => {
  const { game } = setup();
  const cap1 = scoreCapForRound(1);

  game.player.score = cap1;
  game._refreshScoreCapState();
  assert.equal(game.scoreCapReached, true);

  game._startRound(2);
  assert.equal(game.scoreCapReached, false, '다음 라운드에서 초기화');
  assert.equal(game.roundScoreCap, scoreCapForRound(2));

  game._addScore(1000);
  assert.equal(game.player.score, cap1 + 1000, '새 상한까지 다시 획득');
  assert.equal(game.scoreCapReached, false);
  assert.ok(game.player.score < scoreCapForRound(2));

  game.player.score = scoreCapForRound(2);
  game._refreshScoreCapState();
  assert.equal(game.scoreCapReached, true);

  game.resetAll();
  assert.equal(game.scoreCapReached, false);
  assert.equal(game.player.score, 0);
});

test('STAGE CLEAR 오버레이가 클리어 사유(Item Cleared / Score Cleared)를 표시한다', () => {
  const { game, canvas } = setup();
  game.state = 'STAGE_CLEAR';
  game.roundItemsEaten = game.items.length;

  game._render(0);
  let texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));
  assert.ok(texts.includes('Item Cleared'), '아이템 클리어 표시');

  // 점수 상한까지 도달한 클리어는 두 사유를 함께 표시한다
  canvas.ctx.calls.length = 0;
  game.player.score = scoreCapForRound(1);
  game._refreshScoreCapState();

  game._render(0);
  texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));
  assert.ok(texts.includes('Item Cleared · Score Cleared'));
});

test('STAGE CLEAR 에서 Space 를 누르면 다음 라운드가 시작된다', () => {
  const { game, input } = setup();
  game.state = 'PLAYING';
  game.player.score = 350;
  game.roundItemsEaten = game.items.length;
  game._checkRoundProgress();
  assert.equal(game.state, 'STAGE_CLEAR');

  input.pressed.add('Space');
  game._handleStateInput();

  assert.equal(game.round, 2);
  assert.equal(game.state, 'READY');
  assert.equal(game.readyTimer, READY_COUNTDOWN_MS);
  assert.equal(game.itemCount, 12, '아이템 복구');
  assert.equal(game.player.score, 350, '점수 유지');
});

test('클리어하면 목숨이 1개 회복된다 (최대 3)', () => {
  const { game } = setup();

  game.lives = 1;
  game.state = 'PLAYING';
  game._stageClear();
  assert.equal(game.lives, 2);

  game.lives = PLAYER_LIVES;
  game._stageClear();
  assert.equal(game.lives, PLAYER_LIVES, '최대 목숨을 넘지 않는다');
});

test('다음 라운드에서 속도 단계가 1 증가한다 (최대 10)', () => {
  const { game } = setup();

  game.speedLevel = 1;
  game._startRound(2);
  assert.equal(game.speedLevel, 2);

  game.speedLevel = 10;
  game._startRound(5);
  assert.equal(game.speedLevel, 10, '상한 10');
});

test('다음 라운드는 트랩/팝업/소화/스텔스를 초기화한다', () => {
  const { game } = setup();

  game.traps.push(new Trap(1, 9, 'POOP', 0.3, 10000));
  game._addPopup(1, 9, '+50', '#8bc34a');
  game.player.startDigestion(ITEMS.MILK);
  game.player.activateStealth(5000);
  game.map.highlightBed = { row: 13, col: 11 };

  game._startRound(2);

  assert.equal(game.traps.length, 0);
  assert.equal(game.scorePopups.length, 0);
  assert.equal(game.player.digesting.length, 0);
  assert.equal(game.player.isStealthed, false);
  assert.equal(game.player.stealthCooldown, 0);
  assert.equal(game.map.highlightBed, null);
});

test('탭이 숨겨지면 PLAYING 에서만 자동 일시정지된다', () => {
  const { game } = setup();

  game.state = 'PLAYING';
  game.handleVisibilityChange(true);
  assert.equal(game.state, 'PAUSED');

  game.handleVisibilityChange(false);
  assert.equal(game.state, 'PAUSED', '복귀해도 자동 재개하지 않는다');

  game.state = 'READY';
  game.handleVisibilityChange(true);
  assert.equal(game.state, 'READY', 'READY 에서는 무시');
});

test('STAGE CLEAR / GAME OVER 에서는 _tick 이 게임 로직을 진행하지 않는다', () => {
  const { game } = setup();
  game.state = 'STAGE_CLEAR';
  game.input.direction = 'RIGHT';
  const before = `${game.player.row},${game.player.col}`;

  game.lastTime = 0;
  game._tick(5000);

  assert.equal(`${game.player.row},${game.player.col}`, before);
  assert.equal(game.state, 'STAGE_CLEAR');
});

test('GAME OVER 오버레이에 최종 점수와 [R] 재도전이 표시된다', () => {
  const { game, canvas } = setup();
  game.state = 'GAME_OVER';
  game.player.score = 1234;

  game._render(0);

  const texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));

  assert.ok(texts.some(t => t.includes('GAME OVER')));
  assert.ok(texts.some(t => t.includes('1234')));
  assert.ok(texts.some(t => t.includes('[R] 재도전')));
});

test('STAGE CLEAR 오버레이가 다음 라운드 안내를 표시한다', () => {
  const { game, canvas } = setup();
  game.state = 'STAGE_CLEAR';
  game.roundItemsEaten = game.items.length;

  game._render(0);

  const texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));

  assert.ok(texts.some(t => t.includes('STAGE CLEAR')));
  assert.ok(texts.some(t => t.includes('다음 라운드')));
});

test('HUD 에 목숨 하트(벡터)와 하이스코어가 표시된다', () => {
  const { game, canvas } = setup();
  game.lives = 2;
  game.hiScore = 777;

  game._render(0.5);

  const texts = canvas.ctx.calls
    .filter(call => call.name === 'fillText')
    .map(call => String(call.args[0]));

  assert.ok(texts.some(t => t.includes('HI: 777')));
  assert.ok(
    texts.every(t => !t.includes('♥') && !t.includes('♡')),
    'OS 하트 문자 대신 Canvas 벡터로 그린다',
  );

  // HUD 첫 줄(y=14)에 하트 아이콘의 둥근 볼 arc 가 그려진다
  const heartLobeArcs = canvas.ctx.calls.filter(
    call => call.name === 'arc'
      && Math.abs(call.args[1] - 12.68) < 0.01
      && Math.abs(call.args[2] - 2.97) < 0.01,
  );
  assert.ok(heartLobeArcs.length >= 4, '목숨 하트를 Canvas 2D 벡터로 그린다');
});

// ===== 시각 효과 연동 =====

test('아이템 섭취 시 노란 반짝이 파티클이 생긴다', () => {
  const { game } = setup();
  game.enemies = [];
  const item = game.items[0];

  game.player.row = item.row;
  game.player.col = item.col;
  game._updateItems(game.tickMs);

  assert.ok(game.effects.particles.length > 0, '파티클 생성');
  assert.ok(game.effects.particles.every(p => p.kind === 'sparkle'), '반짝이 종류');
});

test('트랩 배출 시 트랩 색 물방울이 튄다', () => {
  const { game } = setup();

  game.player.startDigestion(ITEMS.MILK);
  game.player._updateDigestion(ITEMS.MILK.digestTime);
  game._expelTraps();

  assert.equal(game.traps.length, 1);
  assert.ok(game.effects.particles.length > 0, '물방울 생성');
  assert.ok(game.effects.particles.every(p => p.kind === 'drop'), '물방울 종류');
  assert.ok(
    game.effects.particles.every(p => p.color === TRAP_COLORS.PEE),
    '트랩 색과 동일',
  );
});

test('울기 발동 시 푸른 플래시와 눈물/얼음 파티클이 생긴다', () => {
  const { game, input } = setup();
  game.state = 'PLAYING';
  input.pressed.add(SKILL_CRY.key);

  game._handleSkillInput();

  assert.ok(game.effects.flash, '화면 플래시');
  assert.equal(game.effects.flash.color, COLORS.ENEMY_FROZEN);
  assert.ok(game.effects.particles.length > 0, '파티클');
  assert.ok(
    game.effects.particles.some(p => p.kind === 'ice'),
    '악당 위치에 얼음 파편',
  );
  assert.ok(
    game.effects.particles.some(p => p.kind === 'tear'),
    '베이비 위치에 눈물 파티클',
  );
  assert.ok(game.effects.rings.length > 0, '푸른 충격파 링');
});

test('체포되면 0.2초 카메라 셰이크가 발생한다', () => {
  const { game } = setup();

  forceCatch(game);

  assert.equal(game.catchCount, 1);
  assert.ok(game.effects.shakeTimer > 0, '셰이크 진행 중');
  assert.equal(game.effects.shakeDuration, 0.2);
});

test('재시작하면 진행 중인 효과가 초기화된다', () => {
  const { game } = setup();
  game.effects.burstSparkle(1, 1);
  game.effects.shake(0.2, 6);
  game.effects.flashScreen();

  game.resetAll();

  assert.equal(game.effects.particles.length, 0);
  assert.equal(game.effects.flash, null);
  assert.equal(game.effects.shakeTimer, 0);
});
