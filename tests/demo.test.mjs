/**
 * Pac-Baby: 데모 플레이 / 매뉴얼 격리 / 기기별 안내 단위 테스트
 *
 * 검증 항목
 *  1) 자동 데모는 접속 세션당 1회만 (매뉴얼 시작 후 재발동 없음)
 *  2) 데모 → 매뉴얼 전환 시 1라운드 · 0점 · 목숨 3 · assisted=false 로 새 런 시작
 *  3) 데모 중에는 onRunStart / onRunEnd / 하이스코어 저장을 호출하지 않음
 *  4) PC / 모바일(터치) 안내 문구 분기
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game, {
  DEMO_HINT_PC,
  DEMO_HINT_TOUCH,
  demoHintFor,
  detectTouchDevice,
} from '../src/game.js';
import Tester from '../src/tester.js';
import { DEMO_IDLE_MS, HISCORE_KEY, PLAYER_LIVES } from '../src/constants.js';

function createStubCtx() {
  const calls = [];
  return new Proxy({ calls }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { calls.push({ name: prop, args }); };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push({ name: `set:${String(prop)}`, args: [value] });
      return true;
    },
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
    clearTouchMemory() {},
  };
}

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

test('기본 데모 대기 시간은 5초이고 최초에는 자동 데모가 한 번 무장되어 있다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  assert.equal(DEMO_IDLE_MS, 5000);
  assert.equal(game.demoDelayMs, DEMO_IDLE_MS);
  assert.equal(game.demoArmed, true);
  assert.equal(game.autoDemoConsumed, false);
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
  assert.equal(game.autoDemoConsumed, true, '세션 플래그로 재무장 금지');
  // 데모 판은 항상 1라운드 · 0점 · 목숨 3으로 새로 구성
  assert.equal(game.round, 1);
  assert.equal(game.player.score, 0);
  assert.equal(game.lives, PLAYER_LIVES);
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

test('데모 중 사용자 입력이 들어오면 즉시 해제되고 1라운드 0점의 새 매뉴얼 런이 시작된다', () => {
  const input = createStubInput();
  const starts = [];
  const game = new Game(createStubCanvas(), input, {
    demoDelayMs: 100,
    onRunStart: event => starts.push(event),
  });

  game.state = 'PLAYING';
  game.lastTime = 0;
  game._tick(200);
  assert.equal(game.demoMode, true);
  assert.equal(starts.length, 1, '데모 시작은 새 런을 만들지 않는다');

  // 데모가 점수/라운드/목숨을 만들어도 매뉴얼 전환 시 이어받지 않는다
  game.player.score = 2500;
  game.round = 4;
  game.lives = 1;

  input.activitySeq += 1; // 키/터치 입력 발생
  game.lastTime = 0;
  game._tick(300);

  assert.equal(game.demoMode, false);
  assert.equal(game.isBotActive, false);
  assert.equal(game.demoArmed, false);
  assert.equal(game.autoDemoConsumed, true);
  assert.equal(game.round, 1, '1라운드부터 다시 시작');
  assert.equal(game.player.score, 0, '데모 점수를 이어받지 않는다');
  assert.equal(game.lives, PLAYER_LIVES, '목숨 3개로 재시작');
  assert.equal(game.runAssisted, false, '정식 매뉴얼 런');
  assert.equal(starts.length, 2, '전환 시 새 서버 런 시작');
});

test('매뉴얼 플레이를 시작한 뒤에는 5초를 멈춰 있어도 자동 데모가 다시 켜지지 않는다', () => {
  const input = createStubInput();
  const game = new Game(createStubCanvas(), input, { demoDelayMs: 100 });

  // 사용자가 직접 조작을 시작
  input.activitySeq += 1;
  game.lastTime = 0;
  game._tick(50);

  assert.equal(game.autoDemoConsumed, true);
  assert.equal(game.demoArmed, false);
  assert.equal(game.demoMode, false);

  // 5초(여기서는 20초) 동안 아무 입력이 없어도 데모는 켜지지 않는다
  game.state = 'PLAYING';
  game.lastTime = 0;
  game._tick(20000);
  assert.equal(game.demoMode, false, '세션 중 자동 데모 재발동 금지');

  // 재시작/로비 복귀 후에도 세션 플래그는 유지된다
  game.resetAll();
  game.state = 'PLAYING';
  game.lastTime = 0;
  game._tick(20000);
  assert.equal(game.demoMode, false, '재시작 후에도 재발동 금지');
  assert.equal(game.autoDemoConsumed, true);
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

test('도움말 [데모 실행]은 서버 런 없이 격리 데모를 시작하고 [게임 종료]는 일시정지한다', () => {
  const starts = [];
  const game = new Game(createStubCanvas(), createStubInput());
  game.onRunStart = event => starts.push(event);
  game.state = 'READY';

  assert.equal(game.handleHelpAction('demo'), true);
  assert.equal(game.demoMode, true);
  assert.equal(game.botMode, false);
  assert.equal(game.state, 'PLAYING');
  assert.equal(starts.length, 0, '데모는 onRunStart를 호출하지 않는다');

  assert.equal(game.handleHelpAction('exit'), 'PAUSED');
  assert.equal(game.demoMode, false);
  assert.equal(game.isBotActive, false);
  assert.equal(starts.length, 1, '데모를 떠나면 새 매뉴얼 런 시작');
});


test('메인 [데모 실행] 버튼은 데모 중이어도 1라운드 0점으로 새 데모를 시작한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());

  assert.equal(game.startDemo(), true);
  assert.equal(game.demoMode, true);
  assert.equal(game.state, 'PLAYING');

  game.player.score = 800;
  game.round = 3;
  game.lives = 2;

  game.startDemo();

  assert.equal(game.demoMode, true);
  assert.equal(game.round, 1);
  assert.equal(game.player.score, 0);
  assert.equal(game.lives, PLAYER_LIVES);
  assert.equal(game.runAssisted, true, '데모 런은 항상 assisted');
});

test('데모 중에는 런 시작/종료/하이스코어 저장을 절대 호출하지 않는다', () => {
  const storage = createStorage();
  const starts = [];
  const ends = [];
  const game = new Game(createStubCanvas(), createStubInput(), { storage });
  game.onRunStart = event => starts.push(event);
  game.onRunEnd = summary => ends.push(summary);

  game.startDemo();
  assert.equal(starts.length, 0, '데모 시작 시 onRunStart 금지');

  game.player.score = 4321;
  game._updateHiScore();

  assert.equal(game.hiScore, 0, '데모 점수는 하이스코어에 반영하지 않는다');
  assert.equal(storage.getItem(HISCORE_KEY), null, 'localStorage 저장 금지');
  assert.equal(game.newRecord, false);

  game._gameOver();

  assert.equal(ends.length, 0, '데모 종료 시 onRunEnd/submit 금지');
  assert.equal(game.state, 'GAME_OVER');
  assert.equal(game.runAssisted, true);
});

test('데모 중 데모를 끄면 새 매뉴얼 런으로 재시작한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.startDemo();
  game.player.score = 700;

  assert.equal(game.toggleBot(), false);
  assert.equal(game.demoMode, false);
  assert.equal(game.round, 1);
  assert.equal(game.player.score, 0);
  assert.equal(game.runAssisted, false);
});

test('데모 봇은 실제로 아이템을 먹으며 플레이한다', () => {
  const game = new Game(createStubCanvas(), createStubInput());
  game.state = 'PLAYING';
  game.demoMode = true;
  game.demoArmed = false;

  for (let i = 0; i < 400; i++) game._update(game.tickMs);

  assert.ok(game.stats.items > 0, `데모 봇이 아이템을 섭취해야 한다 (items=${game.stats.items})`);
});


test('데모 안내 문구는 PC/모바일(터치)에서 정확히 분기된다', () => {
  assert.equal(DEMO_HINT_PC, '게임 하시려면 아무 키나 누르세요');
  assert.equal(DEMO_HINT_TOUCH, '게임 하시려면 터치 하세요');
  assert.equal(demoHintFor(false), DEMO_HINT_PC);
  assert.equal(demoHintFor(true), DEMO_HINT_TOUCH);

  assert.equal(detectTouchDevice({ touch: true }), true);
  assert.equal(detectTouchDevice({ touch: false }), false);
  assert.equal(
    detectTouchDevice({ window: { matchMedia: () => ({ matches: true }) }, navigator: {} }),
    true,
    'coarse pointer 는 터치 기기',
  );
  assert.equal(
    detectTouchDevice({ window: {}, navigator: { maxTouchPoints: 5 } }),
    true,
    'maxTouchPoints > 0 은 터치 기기',
  );
  assert.equal(
    detectTouchDevice({ window: {}, navigator: { maxTouchPoints: 0 } }),
    false,
    '터치 신호가 없으면 PC',
  );

  const pcGame = new Game(createStubCanvas(), createStubInput(), { demoTouch: false });
  const touchGame = new Game(createStubCanvas(), createStubInput(), { demoTouch: true });
  assert.equal(pcGame.demoHint, DEMO_HINT_PC);
  assert.equal(touchGame.demoHint, DEMO_HINT_TOUCH);
});

test('데모 오버레이는 큰 DEMO 와 기기별 안내 문구를 그린다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput(), { demoTouch: false });
  game.state = 'PLAYING';
  game.demoMode = true;

  game._render(0);

  let texts = canvas.ctx.calls.filter(call => call.name === 'fillText').map(call => call.args[0]);
  assert.ok(texts.some(text => String(text) === 'DEMO'), '큰 DEMO 표시');
  assert.ok(texts.includes(DEMO_HINT_PC), 'PC 안내 문구');
  assert.ok(!texts.includes(DEMO_HINT_TOUCH));

  const mobileCanvas = createStubCanvas();
  const mobileGame = new Game(mobileCanvas, createStubInput(), { demoTouch: true });
  mobileGame.state = 'PLAYING';
  mobileGame.demoMode = true;

  mobileGame._render(0);

  texts = mobileCanvas.ctx.calls.filter(call => call.name === 'fillText').map(call => call.args[0]);
  assert.ok(texts.some(text => String(text) === 'DEMO'), '큰 DEMO 표시');
  assert.ok(texts.includes(DEMO_HINT_TOUCH), '모바일 안내 문구');
  assert.ok(!texts.includes(DEMO_HINT_PC));
});


test('데모 안내창은 반투명 배경으로 뒤 플레이 화면이 비쳐 보인다', () => {
  const canvas = createStubCanvas();
  const game = new Game(canvas, createStubInput(), { demoTouch: false });
  game.state = 'PLAYING';
  game.demoMode = true;

  game._render(0);

  const calls = canvas.ctx.calls;
  // 안내 패널: panelW=380, panelH=92
  const panelIndex = calls.findIndex(
    call => call.name === 'fillRect' && call.args[2] === 380 && call.args[3] === 92,
  );
  assert.ok(panelIndex > 0, '데모 안내 패널을 그려야 한다');

  let bg = null;
  for (let i = panelIndex - 1; i >= 0; i--) {
    if (calls[i].name === 'set:fillStyle') { bg = String(calls[i].args[0]); break; }
  }
  assert.ok(bg, '패널 배경색을 설정해야 한다');
  assert.match(bg, /^rgba\(3,\s*12,\s*26,/, `반투명 네이비 배경이어야 한다: ${bg}`);
  const bgAlpha = Number.parseFloat(bg.split(',')[3]);
  assert.ok(
    bgAlpha >= 0.42 && bgAlpha <= 0.55,
    `배경 불투명도가 반투명 범위(0.42~0.55)여야 한다: ${bgAlpha}`,
  );

  const borderIndex = calls.findIndex((call, index) => index > panelIndex && call.name === 'strokeRect');
  assert.ok(borderIndex > panelIndex, '패널 테두리를 그려야 한다');
  let border = null;
  for (let i = borderIndex - 1; i >= panelIndex; i--) {
    if (calls[i].name === 'set:strokeStyle') { border = String(calls[i].args[0]); break; }
  }
  assert.ok(border && border.startsWith('rgba(41, 182, 246'), `은은한 시안 테두리: ${border}`);
  const borderAlpha = Number.parseFloat(border.split(',')[3]);
  assert.ok(borderAlpha <= 0.5, `테두리도 은은해야 한다: ${borderAlpha}`);
});


test('데모 중 새 게임(resetAll)은 assisted=false 인 새 매뉴얼 런을 시작한다', () => {
  const starts = [];
  const game = new Game(createStubCanvas(), createStubInput(), {
    onRunStart: event => starts.push(event),
  });

  game.startDemo();
  const startCountInDemo = starts.length;

  game.resetAll();

  assert.equal(game.demoMode, false);
  assert.equal(game.runAssisted, false, '새 게임은 정식 매뉴얼 런');
  assert.equal(starts.length, startCountInDemo + 1, 'onRunStart로 새 런 시작');
  assert.equal(game.round, 1);
  assert.equal(game.player.score, 0);
  assert.equal(game.lives, PLAYER_LIVES);
});

