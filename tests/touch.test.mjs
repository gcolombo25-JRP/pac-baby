/**
 * Pac-Baby: 터치 D-패드 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import TouchControls, { TouchSwipe, directionFromVector } from '../src/touch.js';

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

// ===== 방향 입력 방식 2종 (A안 4분할 / B안 스틱) =====

/** D-패드 방향 버튼 스텁 (is-active 클래스 추적) */
function createFakePadButton(key) {
  const classes = new Set();
  return {
    dataset: { key },
    classes,
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
    getAttribute: name => (name === 'data-key' ? key : null),
  };
}

/** .dpad 표면 스텁 (중심/반지름 + CSS 변수) */
function createFakeDpad({ width = 200, height = 200, left = 0, top = 0 } = {}) {
  const listeners = {};
  const vars = {};
  const buttons = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].map(createFakePadButton);

  return {
    listeners,
    vars,
    buttons,
    captured: null,
    style: {
      setProperty(name, value) { vars[name] = String(value); },
      removeProperty(name) { delete vars[name]; },
    },
    getBoundingClientRect: () => ({ width, height, left, top }),
    querySelectorAll: selector => (selector === '.pad-btn[data-key]' ? buttons : []),
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setPointerCapture(id) { this.captured = id; },
    dispatch(type, event = {}) {
      const handler = listeners[type];
      if (typeof handler !== 'function') return undefined;
      return handler({ preventDefault() {}, pointerId: 1, ...event });
    },
  };
}

/** 방향 입력 방식 전환 버튼 스텁 */
function createFakeToggle() {
  const listeners = {};
  return {
    textContent: '4분할',
    attrs: {},
    listeners,
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    click(event = {}) {
      const handler = listeners.click;
      if (typeof handler === 'function') {
        handler({ stopPropagation() {}, preventDefault() {}, ...event });
      }
    },
  };
}

/** .dpad / 전환 버튼을 돌려주는 root 스텁 */
function createPadRoot({ dpad = null, toggle = null, hand = null } = {}) {
  return {
    querySelectorAll: () => [],
    querySelector(selector) {
      if (selector === '.dpad') return dpad;
      if (selector === '[data-pad-toggle]') return toggle;
      if (selector === '[data-hand-toggle]') return hand;
      return null;
    },
  };
}

test('directionFromVector: 벡터를 4방향으로 변환하고 경계/deadzone/NaN 을 처리한다', () => {
  assert.equal(directionFromVector(0, -10), 'UP');
  assert.equal(directionFromVector(0, 10), 'DOWN');
  assert.equal(directionFromVector(-10, 0), 'LEFT');
  assert.equal(directionFromVector(10, 0), 'RIGHT');

  // 정확히 45° 경계는 |dx| >= |dy| 규칙으로 가로 방향 1개만 선택된다
  assert.equal(directionFromVector(10, -10), 'RIGHT');
  assert.equal(directionFromVector(-10, 10), 'LEFT');
  assert.equal(directionFromVector(9, -10), 'UP');

  // deadzone 내부는 null, 경계값은 허용
  assert.equal(directionFromVector(3, 4, { deadzone: 6 }), null);
  assert.equal(directionFromVector(3, 4, { deadzone: 5 }), 'DOWN');
  assert.equal(directionFromVector(0, 0), null, '중심 정확히 터치 → 방향 없음');

  // 유한하지 않은 값은 null
  assert.equal(directionFromVector(NaN, 0), null);
  assert.equal(directionFromVector(0, NaN), null);
  assert.equal(directionFromVector(Infinity, 0), null);
  assert.equal(directionFromVector(0, -Infinity), null);
});

test("'sector' 모드: .dpad 드래그로 사분면이 바뀌면 이전 키를 풀고 새 키를 누른다", () => {
  const dpad = createFakeDpad({ width: 200, height: 200, left: 0, top: 0 }); // 중심 (100,100), r=100
  const root = createPadRoot({ dpad });
  const input = createFakeInput();
  const clicks = [];
  const sound = { playUiClick: () => clicks.push('click') };

  const touch = new TouchControls(input, root, sound, { padMode: 'sector' });
  assert.equal(touch.padMode, 'sector');

  // 위쪽(12시) 터치 → ArrowUp
  dpad.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 20 });
  assert.deepEqual(input.pressed, ['ArrowUp']);
  assert.deepEqual(input.pressedMeta[0], { touch: true });
  assert.equal(clicks.length, 1, '새 방향이 눌릴 때만 클릭음');
  assert.equal(dpad.buttons[0].classes.has('is-active'), true, '위 버튼 하이라이트');
  assert.equal(dpad.captured, 1, '포인터 캡처를 요청한다');

  // 손가락을 떼지 않고 오른쪽(3시)으로 이동 → Up release + Right press
  dpad.dispatch('pointermove', { pointerId: 1, clientX: 180, clientY: 100 });
  assert.deepEqual(input.released, ['ArrowUp']);
  assert.deepEqual(input.pressed, ['ArrowUp', 'ArrowRight']);
  assert.equal(clicks.length, 2);
  assert.equal(dpad.buttons[0].classes.has('is-active'), false);
  assert.equal(dpad.buttons[1].classes.has('is-active'), true);

  // 같은 사분면 안의 미세한 움직임은 재입력하지 않는다
  dpad.dispatch('pointermove', { pointerId: 1, clientX: 190, clientY: 110 });
  assert.deepEqual(input.pressed, ['ArrowUp', 'ArrowRight']);
  assert.equal(clicks.length, 2);

  dpad.dispatch('pointerup', { pointerId: 1, clientX: 190, clientY: 110 });
  assert.deepEqual(input.released, ['ArrowUp', 'ArrowRight']);
  assert.equal(dpad.buttons[1].classes.has('is-active'), false, '손을 떼면 하이라이트 해제');

  // 중심(deadzone) 터치는 방향을 만들지 않는다
  dpad.dispatch('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 });
  assert.deepEqual(input.pressed, ['ArrowUp', 'ArrowRight']);
  dpad.dispatch('pointerup', { pointerId: 2, clientX: 100, clientY: 100 });

  touch.destroy();
});

test("'joystick' 모드: deadzone 안쪽은 무입력, 바깥 드래그는 방향/노브에 반영된다", () => {
  const dpad = createFakeDpad({ width: 200, height: 200, left: 0, top: 0 }); // r=100 → deadzone 22, maxTravel 54
  const root = createPadRoot({ dpad });
  const input = createFakeInput();

  const touch = new TouchControls(input, root, null, { padMode: 'joystick' });
  assert.equal(touch.padMode, 'joystick');

  // deadzone(22px) 안쪽 드래그: 방향 없음, 노브만 따라온다
  dpad.dispatch('pointerdown', { pointerId: 1, clientX: 110, clientY: 100 });
  assert.deepEqual(input.pressed, [], 'deadzone 내부는 무입력');
  assert.equal(dpad.vars['--knob-x'], '10px');
  assert.equal(dpad.vars['--knob-y'], '0px');

  // 아래로 80px: 방향 인식 + 노브는 maxTravel(54px)로 클램프
  dpad.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 180 });
  assert.deepEqual(input.pressed, ['ArrowDown']);
  assert.deepEqual(input.pressedMeta[0], { touch: true });
  assert.equal(dpad.vars['--knob-x'], '0px');
  assert.equal(dpad.vars['--knob-y'], '54px');
  assert.equal(dpad.buttons[2].classes.has('is-active'), true, '아래 버튼 하이라이트');

  // 왼쪽으로 이동 → 이전 키 해제 후 새 키 입력
  dpad.dispatch('pointermove', { pointerId: 1, clientX: 20, clientY: 100 });
  assert.deepEqual(input.released, ['ArrowDown']);
  assert.equal(input.pressed[input.pressed.length - 1], 'ArrowLeft');
  assert.equal(dpad.vars['--knob-x'], '-54px');
  assert.equal(dpad.vars['--knob-y'], '0px');

  // 손을 떼면 키 해제 + 노브 중앙 복귀
  dpad.dispatch('pointerup', { pointerId: 1, clientX: 20, clientY: 100 });
  assert.deepEqual(input.released, ['ArrowDown', 'ArrowLeft']);
  assert.equal(dpad.vars['--knob-x'], '0px');
  assert.equal(dpad.vars['--knob-y'], '0px');
  assert.equal(dpad.buttons[3].classes.has('is-active'), false);

  touch.destroy();
});

test("'buttons' 모드(기본값)에서는 .dpad 표면 제스처를 쓰지 않는다", () => {
  const dpad = createFakeDpad();
  const root = createPadRoot({ dpad });
  const input = createFakeInput();

  const touch = new TouchControls(input, root); // 기존 3인자 호출 호환
  assert.equal(touch.padMode, 'buttons', '기본값은 기존 십자 버튼');

  dpad.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 10 });
  dpad.dispatch('pointermove', { pointerId: 1, clientX: 190, clientY: 100 });
  assert.deepEqual(input.pressed, [], '표면 제스처는 동작하지 않는다');
  assert.equal(dpad.vars['--knob-x'], '0px', '노브는 중앙에 고정된다');
  assert.equal(dpad.vars['--knob-y'], '0px');

  touch.destroy();
});


test('togglePadMode: 4분할 ↔ 스틱 전환, 콜백/라벨/body.dataset 을 갱신한다', () => {
  const dpad = createFakeDpad({ width: 200, height: 200, left: 0, top: 0 });
  const toggle = createFakeToggle();
  const root = createPadRoot({ dpad, toggle });
  const input = createFakeInput();
  const changes = [];

  const originalDocument = globalThis.document;
  const dataset = {};
  globalThis.document = { body: { dataset } };

  try {
    const touch = new TouchControls(input, root, null, {
      padMode: 'sector',
      onPadModeChange: mode => changes.push(mode),
    });

    assert.equal(dataset.pad, 'sector', 'body[data-pad] 로 CSS 전환');
    assert.equal(toggle.textContent, '4분할');
    assert.equal(toggle.attrs['data-pad-mode'], 'sector');

    // 전환 버튼 탭 → 스틱 모드
    toggle.click();
    assert.equal(touch.padMode, 'joystick');
    assert.deepEqual(changes, ['joystick']);
    assert.equal(dataset.pad, 'joystick');
    assert.equal(toggle.textContent, '스틱');

    // 다시 탭 → 4분할 모드
    toggle.click();
    assert.equal(touch.padMode, 'sector');
    assert.deepEqual(changes, ['joystick', 'sector']);
    assert.equal(toggle.textContent, '4분할');

    // 'buttons' 에서 토글하면 'sector' 로 진입한다
    touch.setPadMode('buttons');
    assert.equal(toggle.textContent, '십자');
    toggle.click();
    assert.equal(touch.padMode, 'sector');

    // 모드를 바꾸면 눌려 있던 방향키는 먼저 해제된다
    dpad.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 10 });
    assert.deepEqual(input.pressed, ['ArrowUp']);
    touch.setPadMode('joystick');
    assert.deepEqual(input.released, ['ArrowUp']);

    touch.destroy();
    assert.equal(dataset.pad, undefined, 'destroy 시 body.dataset.pad 정리');
    assert.equal(toggle.listeners.click, undefined, '전환 버튼 리스너 해제');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('destroy 후에는 .dpad 포인터 입력을 무시하고 눌린 키/노브를 정리한다', () => {
  const dpad = createFakeDpad({ width: 200, height: 200, left: 0, top: 0 });
  const root = createPadRoot({ dpad, toggle: createFakeToggle() });
  const input = createFakeInput();

  const touch = new TouchControls(input, root, null, { padMode: 'joystick' });

  dpad.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 10 });
  assert.deepEqual(input.pressed, ['ArrowUp']);
  assert.equal(dpad.vars['--knob-y'], '-54px');

  touch.destroy();
  assert.deepEqual(input.released, ['ArrowUp'], 'destroy 시 눌린 키 해제');
  assert.equal(dpad.vars['--knob-x'], '0px');
  assert.equal(dpad.vars['--knob-y'], '0px');
  assert.equal(dpad.listeners.pointerdown, undefined, '.dpad 리스너 제거');
  assert.equal(dpad.listeners.pointermove, undefined);

  const pressedCount = input.pressed.length;
  dpad.dispatch('pointerdown', { pointerId: 2, clientX: 100, clientY: 190 });
  dpad.dispatch('pointermove', { pointerId: 2, clientX: 190, clientY: 100 });
  assert.equal(input.pressed.length, pressedCount, '정리 후에는 입력이 주입되지 않는다');
});

// ===== 가로 화면 좌우 배치 전환 (게임판 ↔ 터치패드) =====

/** [좌↔우] 전환 버튼 스텁 */
function createFakeHandButton() {
  const listeners = {};
  return {
    title: '',
    attrs: {},
    listeners,
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    click(event = {}) {
      const handler = listeners.click;
      if (typeof handler === 'function') {
        handler({ stopPropagation() {}, preventDefault() {}, ...event });
      }
    },
  };
}

test('setHandSide/toggleHandSide 가 상태·콜백·body[data-hand] 를 갱신한다', () => {
  const hand = createFakeHandButton();
  const root = createPadRoot({ hand });
  const input = createFakeInput();
  const changes = [];
  const clicks = [];
  const sound = { playUiClick: () => clicks.push('click') };

  const originalDocument = globalThis.document;
  const dataset = {};
  globalThis.document = { body: { dataset } };

  try {
    const touch = new TouchControls(input, root, sound, {
      handSide: 'left',
      onHandSideChange: side => changes.push(side),
    });

    // 생성 시 저장된 배치를 즉시 반영한다
    assert.equal(touch.handSide, 'left');
    assert.equal(dataset.hand, 'left', 'body[data-hand] 로 CSS 전환');
    assert.equal(hand.attrs['aria-pressed'], 'true', '스왑 상태는 눌림으로 표시');
    assert.equal(hand.attrs['data-hand'], 'left');
    assert.match(hand.title, /게임판 좌/);

    // 잘못된 값은 기본값 'right'(기존 배치)로 정규화된다
    assert.equal(touch.setHandSide('bogus'), 'right');
    assert.equal(touch.handSide, 'right');
    assert.equal(dataset.hand, 'right');
    assert.equal(hand.attrs['aria-pressed'], 'false');
    assert.match(hand.title, /터치패드 좌/);

    // setHandSide 는 콜백을 호출하지 않는다 (초기 반영/외부 동기화용)
    assert.deepEqual(changes, []);

    // toggleHandSide: 'right' → 'left' + 콜백 1회
    assert.equal(touch.toggleHandSide(), 'left');
    assert.equal(touch.handSide, 'left');
    assert.equal(dataset.hand, 'left');
    assert.deepEqual(changes, ['left']);

    // 버튼 탭: 'left' → 'right' + 클릭음 1회 + 이벤트 전파 중단
    let stopped = 0;
    hand.click({ stopPropagation: () => { stopped += 1; } });
    assert.equal(stopped, 1, '탭 이벤트가 게임 입력으로 전파되지 않는다');
    assert.equal(touch.handSide, 'right');
    assert.equal(dataset.hand, 'right');
    assert.deepEqual(changes, ['left', 'right']);
    assert.equal(clicks.length, 1, '전환 버튼 탭마다 클릭음 1회');

    // 콜백 예외가 전환을 막지 않는다
    const broken = new TouchControls(createFakeInput(), createPadRoot(), null, {
      onHandSideChange: () => { throw new Error('boom'); },
    });
    assert.equal(broken.toggleHandSide(), 'left');

    touch.destroy();
    assert.equal(dataset.hand, undefined, 'destroy 시 body.dataset.hand 정리');
    assert.equal(hand.listeners.click, undefined, '전환 버튼 리스너 해제');
    assert.equal(touch.onHandSideChange, null);
    broken.destroy();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('좌우 배치 기본값은 right(기존 배치)이며 destroy 후에는 탭을 무시한다', () => {
  const hand = createFakeHandButton();
  const root = createPadRoot({ hand });
  const changes = [];

  const originalDocument = globalThis.document;
  const dataset = {};
  globalThis.document = { body: { dataset } };

  try {
    // 기존 3인자 호출 호환 + 기본 handSide 'right'
    const touch = new TouchControls(createFakeInput(), root, null, {
      onHandSideChange: side => changes.push(side),
    });

    assert.equal(touch.handSide, 'right', '기본 배치는 기존 그대로');
    assert.equal(dataset.hand, 'right');
    assert.equal(hand.attrs['aria-pressed'], 'false');

    touch.destroy();

    const before = touch.handSide;
    hand.click();
    assert.equal(touch.handSide, before, 'destroy 후 탭은 무시된다');
    assert.deepEqual(changes, [], '콜백도 호출되지 않는다');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('index.html/style.css 에 가로 화면 [좌↔우] 전환 버튼과 스왑 규칙이 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  const tag = html.match(/<button[^>]*data-hand-toggle[^>]*>/);
  assert.ok(tag, '[data-hand-toggle] 버튼이 있다');
  assert.match(tag[0], /class="pad-btn pad-hand-btn"/);
  assert.doesNotMatch(tag[0], /data-key=/, '전환 버튼은 게임 입력(data-key)을 갖지 않는다');
  assert.match(html, /data-hand-toggle aria-label="가로 화면 좌우 전환">좌↔우</);

  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.pad-btn\.pad-hand-btn\s*\{\s*display:\s*none/, '세로 화면에서는 숨긴다');
  assert.match(
    css,
    /body\.touch-landscape \.pad-btn\.pad-hand-btn\s*\{[\s\S]*?display:\s*inline-flex/,
    '가로 모드에서만 노출한다',
  );
  assert.match(
    css,
    /body\.touch-landscape\[data-hand="left"\] #game-container\s*\{[\s\S]*?flex-direction:\s*row-reverse/,
    '좌우 스왑 배치 규칙',
  );
});

