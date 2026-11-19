/**
 * Pac-Baby: 터치 D-패드 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import TouchControls from '../src/touch.js';

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
  return {
    pressed,
    released,
    press(code) { pressed.push(code); },
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

test('DOM 이 없는 환경에서도 생성이 실패하지 않는다', () => {
  const input = createFakeInput();
  assert.doesNotThrow(() => new TouchControls(input, null));
});
