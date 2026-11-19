/**
 * Pac-Baby: 자동 데모 플레이 / 모바일 BOT 상태 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/game.js';
import Tester from '../src/tester.js';
import { DEMO_IDLE_MS } from '../src/constants.js';

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
    activitySeq: 0,
    direction: null,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

test('기본 데모 대기 시간은 5초이고 최초에는 자동 데모가 무장되어 있다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  assert.equal(DEMO_IDLE_MS, 5000);
  assert.equal(game.demoDelayMs, DEMO_IDLE_MS);
  assert.equal(game.demoArmed, true);
  assert.equal(game.demoMode, false);
  assert.equal(game.isBotActive, false);
});

test('READY/PLAYING 에서 5초 동안 입력이 없으면 데모가 시작된다', () => {
  const input = createStubInput();
  const game = new Game(createStubCanvas(), input, { demoDelayMs: 100 });
  game.state = 'PLAYING';
  game.lastTime = 0;

  game._tick(200);

  assert.equal(game.demoMode, true);
  assert.equal(game.isBotActive, true);
  assert.equal(game.demoArmed, false, '자동 데모는 한 번만 시작');
});

test('READY 중 데모가 시작되면 즉시 PLAYING 으로 전환된다', () => {
  const game = new Game(createStubCanvas(), createStubInput(), { demoDelayMs: 100 });
  game.lastTime = 0;

  assert.equal(game.state, 'READY');
  game._tick(200);

  assert.equal(game.demoMode, true);
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.readyTimer, 0);
});

test('사용자 입력이 들어오면 데모가 즉시 해제되고 수동 플레이로 전환된다', () => {
  const input = createStubInput();
  const game = new Game(createStubCanvas(), input, { demoDelayMs: 100 });
  game.state = 'PLAYING';
  game.lastTime = 0;

  game._tick(200);
  assert.equal(game.demoMode, true);

  input.activitySeq += 1; // 키/터치 입력 발생
  game._tick(300);

  assert.equal(game.demoMode, false);
  assert.equal(game.isBotActive, false);
  assert.equal(game.demoArmed, false);
});

test('명시적 BOT 토글은 사용자 입력으로 꺼지지 않고 버튼으로만 종료된다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';

  const states = [];
  game.setBotStateListener(state => states.push(state));

  assert.equal(game.toggleBot(), true);
  assert.equal(game.botMode, true);
  assert.equal(game.demoArmed, false);

  game.noteUserActivity();
  assert.equal(game.botMode, true, '명시적 BOT은 유지');

  assert.equal(game.toggleBot(), false);
  assert.equal(game.botMode, false);
  assert.ok(states.some(state => state.active === true));
  assert.equal(states[states.length - 1].active, false);
});

test('모바일 BOT 토글은 F2 테스터의 BOT 모드도 함께 종료한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  const tester = new Tester({ game, input: game.input, ui: false });

  tester.startBot();
  assert.equal(game.isBotActive, true);

  game.toggleBot();

  assert.equal(tester.mode, 'MANUAL');
  assert.equal(game.isBotActive, false);
});

test('설명서가 열려 있는 동안에는 데모가 시작되지 않고, 닫은 뒤 다시 대기한다', () => {
  const game = new Game(createStubCanvas(), createStubInput(), { demoDelayMs: 100 });
  game.state = 'PLAYING';

  game.setHelpOpen(true);
  game.lastTime = 0;
  game._tick(200);
  assert.equal(game.demoMode, false, '설명서를 읽는 동안은 데모 금지');

  game.setHelpOpen(false);
  game.lastTime = 0;
  game._tick(200);
  assert.equal(game.demoMode, true, '설명서를 닫은 뒤 대기 시간이 지나면 데모');
});

test('도움말 [게임 시작]은 일시정지/게임오버에서 READY/PLAYING으로 복귀시킨다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  game.state = 'PAUSED';
  assert.equal(game.handleHelpAction('start'), 'PLAYING');

  game.state = 'GAME_OVER';
  game.player.score = 500;
  assert.equal(game.handleHelpAction('start'), 'READY');
  assert.equal(game.player.score, 0, '새 게임으로 초기화');
});

test('도움말 [데모 실행]은 즉시 데모를 시작하고 [게임 종료]는 일시정지한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'READY';

  assert.equal(game.handleHelpAction('demo'), true);
  assert.equal(game.demoMode, true);
  assert.equal(game.botMode, false);
  assert.equal(game.state, 'PLAYING');

  assert.equal(game.handleHelpAction('exit'), 'PAUSED');
  assert.equal(game.demoMode, false);
  assert.equal(game.isBotActive, false);
});

test('데모 봇은 실제로 아이템을 먹으며 플레이한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.demoMode = true;
  game.demoArmed = false;

  for (let i = 0; i < 400; i++) game._update(game.tickMs);

  assert.ok(game.stats.items > 0, `데모 봇이 아이템을 섭취해야 한다 (items=${game.stats.items})`);
});

test('데모/봇 상태가 HUD 배지로 표시된다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput());
  game.state = 'PLAYING';
  game.demoMode = true;

  game._render(0);

  const texts = canvas.ctx.calls.filter(call => call.name === 'fillText');
  assert.ok(
    texts.some(call => String(call.args[0]).includes('DEMO PLAY')),
    'DEMO PLAY 배지가 그려져야 한다',
  );
});
