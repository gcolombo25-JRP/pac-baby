/**
 * Pac-Baby: 전역 [게임 종료] 동작 테스트
 *   - 루프/사운드 즉시 정지 + EXITED 상태 유지
 *   - 종료 후 이전 rAF 프레임 무효화
 *   - [다시 시작] 시 READY 로비로 복귀
 *   - index.html/style.css 의 종료 전용 오버레이 · 상단 액션 구조
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Game from '../src/game.js';
import { CANVAS_WIDTH } from '../src/constants.js';

/** 최소 CanvasRenderingContext2D 스텁 */
function createStubCtx() {
  const record = () => () => {};
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: record(),
    strokeRect: record(),
    beginPath: record(),
    closePath: record(),
    moveTo: record(),
    lineTo: record(),
    arc: record(),
    ellipse: record(),
    fill: record(),
    stroke: record(),
    fillText: record(),
    save: record(),
    restore: record(),
    translate: record(),
    rotate: record(),
    clearRect: record(),
  };
}

/** 최소 Canvas 스텁 */
function createStubCanvas() {
  const ctx = createStubCtx();
  return { width: CANVAS_WIDTH, height: CANVAS_WIDTH, ctx, getContext: () => ctx };
}

/** 최소 InputManager 스텁 */
function createStubInput() {
  return {
    direction: null,
    getDirection() { return this.direction; },
    isDown() { return false; },
    isJustPressed() { return false; },
    clearJustPressed() {},
  };
}

function createGame() {
  const game = new Game(createStubCanvas(), createStubInput());
  const calls = [];

  // 실제 SoundFX 를 유지하되 호출 여부만 관찰한다 (Node 에서도 안전)
  const originalStopBgm = game.sound.stopBgm.bind(game.sound);
  const originalPlayStart = game.sound.playStart.bind(game.sound);
  game.sound.stopBgm = () => { calls.push('stopBgm'); originalStopBgm(); };
  game.sound.playStart = () => { calls.push('playStart'); originalPlayStart(); };

  return { game, calls };
}

test('[게임 종료] 루프와 BGM 을 즉시 멈추고 EXITED 상태로 전환한다', () => {
  const { game, calls } = createGame();
  game.running = true;
  game.state = 'PLAYING';
  const tokenBefore = game.loopToken;

  const state = game.exitGame();

  assert.equal(state, 'EXITED');
  assert.equal(game.state, 'EXITED');
  assert.equal(game.running, false);
  assert.ok(game.loopToken > tokenBefore, '대기 중인 rAF 프레임을 무효화한다');
  assert.ok(calls.includes('stopBgm'), 'BGM 을 정지한다');
});

test('[게임 종료] 종료 전에 예약된 루프 프레임은 실행되지 않는다', () => {
  const { game } = createGame();
  game.running = true;
  const staleToken = game.loopToken;

  game.exitGame();

  let ticks = 0;
  game._tick = () => { ticks += 1; };
  game._loop(performance.now(), staleToken);

  assert.equal(ticks, 0, '이전 토큰의 프레임은 무시된다');
});

test('[게임 종료] 다시 시작하면 READY 로비로 돌아가 루프가 재가동된다', () => {
  const { game, calls } = createGame();
  game.player.score = 1234;
  game.state = 'EXITED';
  game.running = false;

  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    const state = game.resumeFromExit();

    assert.equal(state, 'READY');
    assert.equal(game.state, 'READY');
    assert.equal(game.running, true);
    assert.equal(game.player.score, 0, '로비 복귀 시 점수는 초기화된다');
    assert.ok(calls.includes('playStart'), '재시작 효과음이 재생된다');
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

test('[게임 종료] EXITED 가 아니면 resumeFromExit 은 상태를 바꾸지 않는다', () => {
  const { game } = createGame();
  game.state = 'PLAYING';
  game.running = true;

  const result = game.resumeFromExit();

  assert.equal(result, 'PLAYING');
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.running, true);
});

test('[게임 종료] EXITED 상태에서 [다시 시작](resetToLobby) 이 READY 로비로 되돌린다', () => {
  const { game, calls } = createGame();
  game.running = true;
  game.state = 'PLAYING';
  game.player.score = 900;

  game.exitGame();
  assert.equal(game.state, 'EXITED', '곧바로 로비로 되돌리지 않고 종료 상태로 멈춘다');
  assert.equal(game.running, false);

  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    const state = game.resetToLobby();

    assert.equal(state, 'READY');
    assert.equal(game.state, 'READY');
    assert.equal(game.running, true);
    assert.equal(game.player.score, 0, '새 게임은 0점으로 시작한다');
    assert.equal(game.runEnded, false, '다시 시작한 런은 미종료 상태');
    assert.ok(calls.includes('playStart'), '재시작 효과음이 재생된다');
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

test('index.html 은 [게임 종료] + [데모 실행] 을 우측 상단 한 줄로 묶는다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(html, /id="top-actions" class="top-actions"/);

  // #top-actions 블록 안에 두 버튼이 함께 있어야 한다 (겹침 방지)
  const start = html.indexOf('id="top-actions"');
  assert.ok(start > -1, '#top-actions 컨테이너가 있어야 한다');
  const block = html.slice(start, html.indexOf('id="game-canvas"'));
  assert.match(block, /id="exit-button"/);
  assert.match(block, /id="demo-button"/);
  assert.doesNotMatch(html, /data-demo-start/, '미사용 data-demo-start 속성은 제거한다');

  // 상단 액션은 모달(z-index 60~70) 아래에 둔다
  assert.match(css, /\.top-actions\s*\{[\s\S]*?z-index:\s*25/);
  assert.match(css, /\.top-actions \.exit-button,[\s\S]*?position:\s*static/);
  assert.doesNotMatch(css, /\.exit-button\s*\{[^}]*z-index:\s*9\d/);

  // 좁은 화면/가로 모드에서는 라벨을 숨겨 HUD 를 덮지 않게 압축한다
  assert.match(css, /@media \(max-width: 760px\)\s*\{\s*\.top-actions/);
  assert.match(css, /\.top-actions \.top-action-label\s*\{\s*display:\s*none/);
  assert.match(css, /body\.touch-landscape \.top-actions/);
});

test('index.html 은 종료 전용 오버레이([다시 시작]/[창 닫기])를 제공한다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(html, /id="exit-overlay" class="exit-overlay" hidden aria-hidden="true"/);
  assert.match(html, /게임이 안전하게 종료되었습니다/);
  assert.match(html, /id="exit-restart"[^>]*>다시 시작</);
  assert.match(html, /id="exit-close-window"[^>]*>창 닫기</);
  assert.match(html, /id="exit-note"[^>]*role="status"/);

  // 종료 상태에서는 캔버스/조작/프로필/상단 액션을 숨긴다
  assert.match(css, /body\.game-exited #game-canvas/);
  assert.match(css, /body\.game-exited #touch-controls/);
  assert.match(css, /body\.game-exited #profile-badge/);
  assert.match(css, /body\.game-exited #top-actions/);
  assert.match(css, /\.exit-overlay\[hidden\]\s*\{\s*display:\s*none/);

  // src/main.js 는 resetToLobby 가 아니라 exitGame 으로 실제 종료한다
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /game\.exitGame\(\)/);
  assert.match(main, /classList\.add\('game-exited'\)/);
  assert.match(main, /game\.resetToLobby\(\)/);
  assert.match(main, /window\.close\(\)/);
  assert.match(main, /브라우저 탭이나 앱을 직접 닫아 주세요/);
});
