/**
 * Pac-Baby: 터치 D-패드 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import TouchControls, { TouchSwipe } from '../src/touch.js';

/** 최소 버튼 스텁 */
function createFakeButton(key) {
  const listeners = {};
  return {
    dataset: { key },
    listeners,
    capturedPointer: null,
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setPointerCapture(id) { this.capturedPointer = id; },
    releasePointerCapture() { this.capturedPointer = null; },
    dispatch(type, event = {}) {
      const handler = listeners[type];
      if (typeof handler !== 'function') return undefined;
      return handler({ preventDefault() {}, pointerId: 1, ...event });
    },
  };
}

/** 입력 스텁 */
function createFakeInput() {
  const pressed = [];
  const released = [];
  const pressedMeta = [];
  return {
    pressed,
    released,
    pressedMeta,
    press(code, meta) { pressed.push(code); pressedMeta.push(meta || {}); },
    release(code) { released.push(code); },
  };
}

test('D-패드 버튼을 누르면 입력이 주입되고, 떼면 해제된다', () => {
  const up = createFakeButton('ArrowUp');
  const skill = createFakeButton('Space');
  const root = { querySelectorAll: () => [up, skill] };
  const input = createFakeInput();

  const touch = new TouchControls(input, root);
  assert.equal(touch.buttonCount, 2);

  up.dispatch('pointerdown', { pointerId: 1 });
  assert.deepEqual(input.pressed, ['ArrowUp']);
  assert.deepEqual(input.pressedMeta[0], { touch: true }, '터치 입력임을 표시한다');
  assert.equal(up.capturedPointer, 1, '포인터 캡처를 요청한다');

  // 손가락이 버튼 경계를 살짝 벗어나도(pointerleave) 입력이 유지된다
  up.dispatch('pointerleave', { pointerId: 1 });
  assert.deepEqual(input.released, [], 'leave 로는 해제되지 않는다');

  // 중복 pointerdown 은 무시된다
  up.dispatch('pointerdown', { pointerId: 1 });
  assert.deepEqual(input.pressed, ['ArrowUp']);

  up.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(input.released, ['ArrowUp']);

  // up 이후의 lostpointercapture 는 중복 해제하지 않는다
  up.dispatch('lostpointercapture', { pointerId: 1 });
  assert.deepEqual(input.released, ['ArrowUp']);

  // pointercancel 도 해제로 처리된다
  skill.dispatch('pointerdown', { pointerId: 2 });
  skill.dispatch('pointercancel', { pointerId: 2 });
  assert.deepEqual(input.released, ['ArrowUp', 'Space']);

  touch.destroy();
  assert.equal(touch.buttonCount, 0);

  // 정리 후에는 더 이상 입력이 주입되지 않는다
  const pressedCount = input.pressed.length;
  up.dispatch('pointerdown', { pointerId: 3 });
  assert.equal(input.pressed.length, pressedCount);
});

test('D-패드를 누르면 UI 클릭음이 한 번 재생된다', () => {
  const up = createFakeButton('ArrowUp');
  const root = { querySelectorAll: () => [up] };
  const input = createFakeInput();

  const clicks = [];
  const sound = { playUiClick: () => clicks.push('click') };

  const touch = new TouchControls(input, root, sound);

  up.dispatch('pointerdown', { pointerId: 1 });
  assert.equal(clicks.length, 1, '누를 때 클릭음이 재생된다');

  // 같은 손가락이 유지되는 동안의 중복 pointerdown 은 클릭음도 중복 재생하지 않는다
  up.dispatch('pointerdown', { pointerId: 1 });
  assert.equal(clicks.length, 1);

  up.dispatch('pointerup', { pointerId: 1 });
  up.dispatch('pointerdown', { pointerId: 2 });
  assert.equal(clicks.length, 2, '다시 누르면 클릭음이 재생된다');

  // 사운드 객체를 넘기지 않아도 예외가 없다
  touch.destroy();
  assert.doesNotThrow(() => new TouchControls(createFakeInput(), root));
});

test('D-패드 외 UI 버튼도 클릭음을 재생하고 destroy 시 해제한다', () => {
  const listeners = [];
  const root = {
    querySelectorAll: () => [],
    addEventListener(type, handler, capture) { listeners.push({ type, handler, capture }); },
    removeEventListener(type, handler) {
      const index = listeners.findIndex(item => item.type === type && item.handler === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatch(type, target) {
      listeners.filter(item => item.type === type).forEach(item => item.handler({ target }));
    },
  };

  const clicks = [];
  const sound = { playUiClick: () => clicks.push('click') };
  const touch = new TouchControls(createFakeInput(), root, sound);

  const uiButton = { hasAttribute: () => false };
  const uiChild = { closest: selector => (selector === 'button' ? uiButton : null) };
  root.dispatch('pointerdown', uiChild);
  assert.equal(clicks.length, 1, 'UI 버튼 터치 시 클릭음이 재생된다');

  // D-패드([data-key])는 자체 pointerdown 에서 재생하므로 여기서는 건너뛴다
  const padButton = { hasAttribute: name => name === 'data-key' };
  const padChild = { closest: selector => (selector === 'button' ? padButton : null) };
  root.dispatch('pointerdown', padChild);
  assert.equal(clicks.length, 1, 'D-패드는 중복 재생하지 않는다');

  touch.destroy();
  root.dispatch('pointerdown', uiChild);
  assert.equal(clicks.length, 1, '정리 후에는 리스너가 해제된다');
});

test('DOM 이 없는 환경에서도 생성이 실패하지 않는다', () => {
  const input = createFakeInput();
  assert.doesNotThrow(() => new TouchControls(input, null));
});

test('BOT 치트 상태를 켜면 D-패드 자리 배지가 표시되고 body.bot-cheat 이 켜진다', () => {
  const classes = new Set();
  const body = {
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
    },
  };

  const originalDocument = globalThis.document;
  globalThis.document = { body };

  const attrs = {};
  const bar = {
    hidden: true,
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
  };
  const root = {
    querySelectorAll: () => [],
    querySelector: selector => (selector === '#bot-cheat-bar' ? bar : null),
  };

  try {
    const touch = new TouchControls(createFakeInput(), root);
    assert.equal(touch.cheatMode, false);

    assert.equal(touch.setCheatMode(true), true);
    assert.equal(touch.cheatMode, true);
    assert.equal(classes.has('bot-cheat'), true, 'body.bot-cheat 으로 CSS 전환');
    assert.equal(bar.hidden, false, '배지 표시');
    assert.equal(attrs['aria-hidden'], 'false');

    assert.equal(touch.setCheatMode(false), false);
    assert.equal(touch.cheatMode, false);
    assert.equal(classes.has('bot-cheat'), false);
    assert.equal(bar.hidden, true, '배지 숨김');
    assert.equal(attrs['aria-hidden'], 'true');

    // 정리(destroy) 후에도 body 클래스/배지가 남지 않는다
    touch.setCheatMode(true);
    touch.destroy();
    assert.equal(classes.has('bot-cheat'), false);
    assert.equal(bar.hidden, true);
    assert.equal(touch.cheatMode, false);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('index.html/style.css 에 D-패드 자리 BOT 치트 배지와 [BOT 종료] 가 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="touch-controls"[\s\S]*?id="bot-cheat-bar"/);
  assert.match(html, /id="bot-cheat-bar"[\s\S]*?BOT 치트 실행 중[\s\S]*?랭킹 제외/);
  assert.match(html, /id="bot-cheat-exit"[\s\S]*?BOT 종료/);

  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.bot-cheat-bar\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /body\.bot-cheat \.bot-cheat-bar\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /body\.bot-cheat #touch-controls \.dpad/);
});

/** 스와이프 대상(캔버스) 스텁 */
function createFakeTarget() {
  const listeners = {};
  return {
    listeners,
    captured: null,
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setPointerCapture(id) { this.captured = id; },
    dispatch(type, event = {}) {
      const handler = listeners[type];
      if (typeof handler !== 'function') return undefined;
      return handler({
        preventDefault() {},
        pointerId: 1,
        pointerType: 'touch',
        clientX: 0,
        clientY: 0,
        ...event,
      });
    },
  };
}

test('스와이프 위/왼쪽 제스처가 방향 입력으로 변환된다', () => {
  const target = createFakeTarget();
  const input = createFakeInput();
  const swipe = new TouchSwipe(input, target, { threshold: 24 });

  target.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  assert.equal(target.captured, 1, '포인터 캡처를 요청한다');

  target.dispatch('pointermove', { clientX: 100, clientY: 60 }); // 40px 위
  assert.deepEqual(input.pressed, ['ArrowUp']);
  assert.deepEqual(input.released, ['ArrowUp'], '짧은 press→release 로 주입');
  assert.deepEqual(input.pressedMeta[0], { touch: true });

  target.dispatch('pointermove', { clientX: 60, clientY: 60 }); // 40px 왼쪽
  assert.equal(input.pressed[input.pressed.length - 1], 'ArrowLeft');

  target.dispatch('pointerup', { clientX: 60, clientY: 60 });
  assert.equal(swipe.isSwiping, false);

  swipe.destroy();
});

test('작은 흔들림은 무시하고 마우스 드래그도 처리하지 않는다', () => {
  const target = createFakeTarget();
  const input = createFakeInput();
  const swipe = new TouchSwipe(input, target, { threshold: 24 });

  target.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  target.dispatch('pointermove', { clientX: 110, clientY: 105 }); // 10px
  assert.equal(input.pressed.length, 0, '임계값 미만은 무시');

  target.dispatch('pointerup', { clientX: 110, clientY: 105 });

  target.dispatch('pointerdown', { pointerType: 'mouse', clientX: 100, clientY: 100 });
  target.dispatch('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 40 });
  assert.equal(input.pressed.length, 0, '마우스는 무시한다');

  swipe.destroy();
});

test('pointermove 없이 빠르게 튕기고 떼도 방향을 인식한다', () => {
  const target = createFakeTarget();
  const input = createFakeInput();
  const swipe = new TouchSwipe(input, target, { threshold: 24 });

  target.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  target.dispatch('pointerup', { clientX: 100, clientY: 140 }); // 아래로 40px

  assert.deepEqual(input.pressed, ['ArrowDown']);

  swipe.destroy();
});

test('destroy 후에는 스와이프가 입력을 주입하지 않는다', () => {
  const target = createFakeTarget();
  const input = createFakeInput();
  const swipe = new TouchSwipe(input, target, { threshold: 24 });

  swipe.destroy();
  target.dispatch('pointerdown', { clientX: 0, clientY: 0 });
  target.dispatch('pointermove', { clientX: 0, clientY: -100 });

  assert.equal(input.pressed.length, 0);
});

test('게임 화면 첫 접촉은 마우스 클릭 포함해 콜백으로 알린다 (BOT 종료용)', () => {
  const target = createFakeTarget();
  const input = createFakeInput();
  const seen = [];
  const swipe = new TouchSwipe(input, target, {
    threshold: 24,
    onPointerDown: event => seen.push(event.pointerType),
  });

  target.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  target.dispatch('pointerup', { pointerType: 'touch', clientX: 10, clientY: 10 });
  target.dispatch('pointerdown', { pointerType: 'mouse', clientX: 30, clientY: 30 });

  assert.deepEqual(seen, ['touch', 'mouse'], '마우스 클릭도 알린다');
  assert.equal(input.pressed.length, 0, '짧은 클릭은 방향 입력을 만들지 않는다');

  // 콜백 예외가 스와이프 입력을 막지 않는다
  const broken = new TouchSwipe(createFakeInput(), target, {
    threshold: 24,
    onPointerDown: () => { throw new Error('boom'); },
  });
  const safeInput = broken.input;
  target.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  target.dispatch('pointermove', { clientX: 100, clientY: 60 });
  assert.deepEqual(safeInput.pressed, ['ArrowUp']);

  swipe.destroy();
  broken.destroy();
});

test('폰의 재시작 버튼(data-key=KeyR)이 입력으로 연결된다', () => {
  const restart = createFakeButton('KeyR');
  const root = { querySelectorAll: () => [restart] };
  const input = createFakeInput();

  const touch = new TouchControls(input, root);

  restart.dispatch('pointerdown', { pointerId: 7 });
  assert.deepEqual(input.pressed, ['KeyR'], 'R 키와 동일한 입력을 주입');
  assert.deepEqual(input.pressedMeta[0], { touch: true });

  restart.dispatch('pointerup', { pointerId: 7 });
  assert.deepEqual(input.released, ['KeyR']);

  touch.destroy();
});
