/**
 * Pac-Baby: 사용 설명서(도움말) 단위 테스트
 *
 * 브라우저 없이 최소 DOM 스텁으로 open/close/자동표시/키보드/게임 정지 연동을 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import HelpOverlay from '../src/help.js';
import Game from '../src/game.js';
import { HELP_SEEN_KEY, CANVAS_WIDTH } from '../src/constants.js';
import {
  AVATAR_IDS,
  avatarName,
  avatarSvg,
  countryBadge,
  uiIcon,
} from '../src/uiIcons.js';

/** OS 이모지(이모지 프레젠테이션 문자) 감지 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

function createClassList() {
  const set = new Set();
  return {
    add: (name) => set.add(name),
    remove: (name) => set.delete(name),
    contains: (name) => set.has(name),
    toggle: (name) => (set.has(name) ? set.delete(name) : set.add(name)),
    values: () => [...set],
  };
}

function createElement(label) {
  const listeners = {};
  const attributes = {};
  const element = {
    label,
    listeners,
    attributes,
    hidden: label === 'overlay',
    focused: false,
    classList: createClassList(),
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setAttribute(name, value) { attributes[name] = String(value); },
    removeAttribute(name) { delete attributes[name]; },
    getAttribute(name) { return attributes[name]; },
    focus() { element.focused = true; },
    click(event = {}) { return listeners.click?.({ preventDefault() {}, ...event }); },
    dispatch(type, event = {}) { return listeners[type]?.({ preventDefault() {}, ...event }); },
  };
  return element;
}

function createDocument() {
  const overlay = createElement('overlay');
  const card = createElement('card');
  const openButtons = [createElement('fab'), createElement('pad')];
  const closeButtons = [createElement('close'), createElement('start'), createElement('backdrop')];
  const actionButtons = [createElement('startAction'), createElement('demoAction'), createElement('exitAction')];
  actionButtons[0].setAttribute('data-help-action', 'start');
  actionButtons[1].setAttribute('data-help-action', 'demo');
  actionButtons[2].setAttribute('data-help-action', 'exit');
  const body = createElement('body');
  const documentListeners = {};

  return {
    body,
    activeElement: null,
    overlay,
    card,
    openButtons,
    closeButtons,
    actionButtons,
    getElementById(id) {
      if (id === 'help-overlay') return overlay;
      if (id === 'help-card') return card;
      return null;
    },
    querySelector(selector) {
      if (selector === '#help-overlay') return overlay;
      if (selector === '#help-card') return card;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-help-open]') return openButtons;
      if (selector === '[data-help-close]') return closeButtons;
      if (selector === '[data-help-action]') return actionButtons;
      return [];
    },
    addEventListener(type, handler) { documentListeners[type] = handler; },
    removeEventListener(type) { delete documentListeners[type]; },
    dispatch(type, event = {}) { return documentListeners[type]?.({ preventDefault() {}, ...event }); },
  };
}

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

/** Game 일부만 흉내내는 스텁 */
function createGameStub() {
  const released = [];
  const game = {
    helpOpen: false,
    clearCount: 0,
    released,
    input: {
      keys: { ArrowUp: true, ArrowLeft: false },
      clearJustPressed() { game.clearCount += 1; },
      release(code) { released.push(code); },
    },
    setHelpOpen(open) { this.helpOpen = !!open; return this.helpOpen; },
  };
  return game;
}

test('도움말을 열면 오버레이가 보이고 게임이 정지된다', () => {
  const root = createDocument();
  const storage = createStorage();
  const game = createGameStub();
  const help = new HelpOverlay({ game, root, storage, autoShow: false });

  assert.equal(help.isOpen, false);
  assert.equal(root.overlay.hidden, true, '처음에는 숨겨져 있다');

  assert.equal(help.open(), true);
  assert.equal(help.isOpen, true);
  assert.equal(root.overlay.hidden, false);
  assert.equal(root.overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(game.helpOpen, true, '게임이 정지 상태가 된다');
  assert.equal(root.body.classList.contains('help-visible'), true);
  assert.equal(root.card.focused, true, '설명서 카드로 포커스 이동');
  assert.equal(storage.getItem(HELP_SEEN_KEY), '1', '봤다고 기록한다');
  assert.deepEqual(game.released, ['ArrowUp'], '눌려 있던 방향키를 풀어 준다');

  // 이미 열려 있으면 중복 호출은 무시된다
  assert.equal(help.open(), false);
});

test('도움말을 닫으면 오버레이가 숨고 게임이 재개된다', () => {
  const root = createDocument();
  const game = createGameStub();
  const help = new HelpOverlay({ game, root, storage: createStorage(), autoShow: false });

  help.open();
  const clearsBefore = game.clearCount;

  assert.equal(help.close(), true);
  assert.equal(help.isOpen, false);
  assert.equal(root.overlay.hidden, true);
  assert.equal(root.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(game.helpOpen, false, '게임이 다시 움직인다');
  assert.equal(root.body.classList.contains('help-visible'), false);
  assert.ok(game.clearCount > clearsBefore, '남은 키 입력을 비운다');

  // 이미 닫혀 있으면 아무 일도 하지 않는다
  assert.equal(help.close(), false);
});

test('도움말 모달의 게임 시작/데모/종료 버튼이 게임 액션을 호출하고 닫힌다', () => {
  const root = createDocument();
  const game = createGameStub();
  const actions = [];
  game.handleHelpAction = action => {
    actions.push(action);
    return 'PLAYING';
  };

  const help = new HelpOverlay({
    game,
    root,
    storage: createStorage(),
    autoShow: false,
  });

  const expected = ['start', 'demo', 'exit'];
  for (let i = 0; i < expected.length; i++) {
    if (!help.isOpen) help.open();
    root.actionButtons[i].click();
    assert.equal(actions.at(-1), expected[i]);
    assert.equal(help.isOpen, false, `${expected[i]} 액션 후 모달 닫힘`);
  }
});


test('toggle 은 열기/닫기를 번갈아 수행한다', () => {
  const help = new HelpOverlay({
    game: createGameStub(),
    root: createDocument(),
    storage: createStorage(),
    autoShow: false,
  });

  assert.equal(help.toggle(), true);
  assert.equal(help.isOpen, true);
  assert.equal(help.toggle(), false);
  assert.equal(help.isOpen, false);
});

test('첫 방문(기록 없음)에는 설명서가 자동으로 열린다', () => {
  const root = createDocument();
  const storage = createStorage();
  const help = new HelpOverlay({ game: createGameStub(), root, storage });

  assert.equal(help.isOpen, true, '처음 사용자에게 먼저 보여 준다');
  assert.equal(root.overlay.hidden, false);
  assert.equal(storage.getItem(HELP_SEEN_KEY), '1');
});

test('이미 본 사용자에게는 자동으로 열리지 않는다', () => {
  const storage = createStorage({ [HELP_SEEN_KEY]: '1' });
  const help = new HelpOverlay({ game: createGameStub(), root: createDocument(), storage });

  assert.equal(help.isOpen, false);
});

test('H / F1 로 열고 Escape / P 로 닫을 수 있다', () => {
  const root = createDocument();
  const help = new HelpOverlay({
    game: createGameStub(),
    root,
    storage: createStorage(),
    autoShow: false,
  });

  root.dispatch('keydown', { code: 'KeyH' });
  assert.equal(help.isOpen, true, 'H 로 열린다');

  root.dispatch('keydown', { code: 'Escape' });
  assert.equal(help.isOpen, false, 'Escape 로 닫힌다');

  root.dispatch('keydown', { code: 'F1' });
  assert.equal(help.isOpen, true, 'F1 로 열린다');

  root.dispatch('keydown', { code: 'KeyP' });
  assert.equal(help.isOpen, false, 'P 로 닫힌다');

  // 설명서가 닫혀 있을 때 Escape 는 설명서에 영향을 주지 않는다
  root.dispatch('keydown', { code: 'Escape' });
  assert.equal(help.isOpen, false);
});

test('도움말 버튼과 닫기 버튼 클릭이 동작한다', () => {
  const root = createDocument();
  const help = new HelpOverlay({
    game: createGameStub(),
    root,
    storage: createStorage(),
    autoShow: false,
  });

  root.openButtons[1].click();
  assert.equal(help.isOpen, true, 'D-패드 도움말 버튼');

  root.closeButtons[0].click();
  assert.equal(help.isOpen, false, '상단 ✕ 버튼');

  root.openButtons[0].click();
  assert.equal(help.isOpen, true, '도움말 열기 버튼');

  root.closeButtons[2].click();
  assert.equal(help.isOpen, false, '배경 클릭으로 닫기');
});

test('DOM 이 없는 환경에서도 생성/열기/닫기가 실패하지 않는다', () => {
  assert.doesNotThrow(() => new HelpOverlay({ root: null, storage: null, game: null }));

  // 첫 방문이므로 자동으로 열린 상태 — DOM 없이도 예외가 없다
  const help = new HelpOverlay({ root: null, storage: null });
  assert.equal(help.isOpen, true);
  assert.equal(help.close(), true);
  assert.equal(help.isOpen, false);
  assert.equal(help.open(), true);
});

test('게임은 설명서가 열려 있는 동안 로직과 입력을 멈춘다', () => {
  const canvas = {
    width: CANVAS_WIDTH,
    height: CANVAS_WIDTH,
    getContext: () => ({}),
  };
  const input = {
    getDirection: () => 'LEFT',
    isDown: () => false,
    isJustPressed: code => code === 'Escape',
    clearJustPressed() {},
  };

  const game = new Game(canvas, input);
  game._render = () => {}; // 렌더링은 이 테스트의 관심사가 아니다
  game.state = 'PLAYING';

  game.setHelpOpen(true);
  const before = game.enemies.map(enemy => ({ row: enemy.row, col: enemy.col }));
  game._tick(performance.now() + 5000);

  assert.equal(game.state, 'PLAYING', '설명서가 열린 동안 Escape 로 일시정지되지 않는다');
  assert.deepEqual(
    game.enemies.map(enemy => ({ row: enemy.row, col: enemy.col })),
    before,
    '악당이 움직이지 않는다 (게임 로직 정지)',
  );

  game.setHelpOpen(false);
  game.state = 'PLAYING';
  game._tick(performance.now() + 5000);

  assert.equal(game.state, 'PAUSED', '설명서를 닫으면 입력이 다시 동작한다');
});

test('아바타/UI 아이콘은 OS 이모지 없이 인라인 SVG 로 제공된다', () => {
  assert.equal(AVATAR_IDS.length, 12);

  for (const id of AVATAR_IDS) {
    const svg = avatarSvg(id);
    assert.match(svg, /^<svg class="ui-icon ui-avatar"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(svg, EMOJI_RE);
    assert.ok(avatarName(id).length > 0, `아바타 ${id} 이름이 있어야 한다`);
  }

  // 잘못된 ID 는 1번 아바타로 폴백
  assert.equal(avatarSvg(999), avatarSvg(1));

  for (const name of [
    'bottle', 'candy', 'cookie', 'goldenBottle', 'pacifier',
    'bed', 'tear', 'soundOn', 'soundOff', 'bot', 'trophy', 'help',
  ]) {
    assert.match(uiIcon(name), /<svg class="ui-icon"/, `${name} 아이콘이 있어야 한다`);
  }
  assert.equal(uiIcon('not-a-real-icon'), '');

  assert.match(countryBadge('kr'), /class="lb-flag"/);
  assert.match(countryBadge('kr'), />KR</);
  assert.doesNotMatch(countryBadge('kr'), EMOJI_RE);
  assert.match(countryBadge(''), /lb-country-none/);
});

test('index.html 상단/도움말 UI 는 OS 이모지 대신 인라인 SVG 를 쓴다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, EMOJI_RE, 'index.html 에 OS 이모지가 남아 있으면 안 된다');
  assert.match(html, /id="profile-badge-emoji"[\s\S]*?<svg class="ui-icon ui-avatar"/);
  assert.match(html, /id="help-title"[\s\S]*?<svg class="ui-icon"/);
  assert.match(html, /id="leaderboard-title"[\s\S]*?<svg class="ui-icon"/);
  assert.match(html, /data-help-action="demo"><svg class="ui-icon"/);
  assert.match(html, /data-avatar-id="12" aria-label="하트"/);
  assert.doesNotMatch(html, /class="avatar-btn" data-avatar-id="1">/);
});
