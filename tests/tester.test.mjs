/**
 * Pac-Baby: 테스터 모드 단위 테스트 (DOM 없이 구동)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import Tester from '../src/tester.js';
import { TILE_MAP, TILE_SIZE, getBabySpawn, isWalkableTile } from '../src/constants.js';

/** 최소 CanvasRenderingContext2D 스텁 (모든 메서드 무시) */
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
  return { width: 640, height: 640, getContext: () => ctx };
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

function setup(direction = null) {
  const game = new Game(createStubCanvas(), createStubInput(direction));
  const tester = new Tester({ game, input: game.input, ui: false });
  return { game, tester };
}

test('테스터는 MANUAL 모드로 연결되고 실제 입력을 그대로 쓴다', () => {
  const { game, tester } = setup('RIGHT');

  assert.equal(tester.enabled, true);
  assert.equal(tester.mode, 'MANUAL');
  assert.equal(game.tester, tester);
  assert.equal(tester.resolveDirection(game), undefined);
});

test('무적 스위치를 켜면 체포되지 않는다', () => {
  const { game, tester } = setup();

  game.enemies.forEach(enemy => { enemy.pinned = true; });
  game.enemies[0].row = game.player.row;
  game.enemies[0].col = game.player.col;

  tester.toggleFlag('invincible');
  game._update(game.tickMs);
  assert.equal(game.catchCount, 0, '무적 중에는 체포 없음');

  tester.toggleFlag('invincible');
  game._update(game.tickMs);
  assert.equal(game.catchCount, 1, '무적 해제 후에는 체포된다');
});

test('무벽 스위치를 켜면 벽 타일로도 이동한다', () => {
  const { game, tester } = setup('LEFT');
  const spawn = getBabySpawn(TILE_MAP);

  assert.equal(isWalkableTile(TILE_MAP, spawn.row, spawn.col - 1), false, '왼쪽은 벽');

  tester.toggleFlag('noclip');
  assert.equal(typeof game.player.walkable, 'function');

  game._update(game.tickMs);
  assert.equal(game.player.col, spawn.col - 1, '벽으로 진입');
});

test('악당 정지 스위치는 모든 악당을 멈춘다', () => {
  const { game, tester } = setup();

  tester.toggleFlag('freezeAll');
  assert.ok(game.enemies.every(enemy => enemy.pinned));

  const before = game.enemies.map(e => `${e.row},${e.col}`).join('|');
  for (let i = 0; i < 12; i++) game._update(game.tickMs);

  assert.equal(game.enemies.map(e => `${e.row},${e.col}`).join('|'), before);
});

test('기록한 입력이 그대로 재생된다', () => {
  const { game, tester } = setup('RIGHT');

  tester.startRecording();
  assert.equal(tester.recording, true);

  for (let i = 0; i < 4; i++) game._update(game.tickMs);
  assert.deepEqual(tester.frames.slice(0, 4), ['RIGHT', 'RIGHT', 'RIGHT', 'RIGHT']);

  assert.equal(tester.startReplay(), true);
  assert.equal(tester.mode, 'REPLAY');
  assert.equal(tester.resolveDirection(game), 'RIGHT', '첫 프레임 재생');

  for (let i = 0; i < tester.frames.length; i++) tester.resolveDirection(game);
  assert.equal(tester.mode, 'MANUAL', '프레임 소진 후 MANUAL 복귀');
});

test('봇 모드는 아이템을 향해 이동하고 실제로 섭취한다', () => {
  const { game, tester } = setup();

  tester.startBot();
  assert.equal(tester.mode, 'BOT');

  const first = tester.resolveDirection(game);
  assert.ok(
    first === null || ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(first),
    `봇 방향이 유효해야 한다 (${first})`,
  );

  for (let i = 0; i < 300; i++) game._update(game.tickMs);

  assert.ok(tester.botTicks > 0, '봇이 틱마다 입력을 만들었다');
  assert.ok(game.stats.items > 0, `봇이 아이템을 섭취해야 한다 (items=${game.stats.items})`);
});

test('1틱 모드는 게임을 멈추고 step() 으로 한 틱 진행한다', () => {
  const { game, tester } = setup();

  tester.toggleFlag('step');
  assert.equal(game.state, 'PAUSED');

  game.input.direction = 'RIGHT';
  const before = `${game.player.row},${game.player.col}`;

  tester.step();
  assert.notEqual(`${game.player.row},${game.player.col}`, before, '한 칸 이동');
  assert.equal(game.state, 'PAUSED', '진행 후에도 정지 상태');
});

test('teleport 는 베이비를 지정 타일로 옮긴다', () => {
  const { game, tester } = setup();

  tester.teleport(1, 9);

  assert.equal(game.player.row, 1);
  assert.equal(game.player.col, 9);
  assert.equal(game.player.x, 9 * TILE_SIZE);
  assert.equal(game.player.y, 1 * TILE_SIZE);
});

test('테스터를 끄면 치트와 입력 개입이 모두 해제된다', () => {
  const { game, tester } = setup();

  tester.toggleFlag('noclip');
  tester.toggleFlag('invincible');
  tester.setEnabled(false);

  assert.equal(tester.flags.noclip, false);
  assert.equal(tester.flags.invincible, false);
  assert.equal(game.player.walkable, null);
  assert.equal(tester.resolveDirection(game), undefined);
});

test('상태 라벨 오버레이가 예외 없이 그려진다', () => {
  const { game, tester } = setup();

  assert.doesNotThrow(() => game._render(0.5));

  tester.flags.labels = false;
  assert.doesNotThrow(() => game._render(0.5));
});
