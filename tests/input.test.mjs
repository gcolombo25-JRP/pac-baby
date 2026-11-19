/**
 * Pac-Baby: 키보드 입력 처리 단위 테스트
 *
 * InputManager 는 생성자에서 window 이벤트를 등록하므로 스텁 window 를 사용한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const registered = {};
globalThis.window = {
  addEventListener(type, handler) { registered[type] = handler; },
  removeEventListener(type) { delete registered[type]; },
};

const { default: InputManager } = await import('../src/input.js');

function press(input, code) {
  input._onKeyDown({ code, preventDefault() {} });
}

function release(input, code) {
  input._onKeyUp({ code });
}

test('가장 최근에 누른 방향이 우선한다', () => {
  const input = new InputManager();

  press(input, 'ArrowUp');
  assert.equal(input.getDirection(), 'UP');

  press(input, 'ArrowUp'); // 키 반복 입력은 중복되지 않는다
  assert.deepEqual(input.directionStack, ['UP']);

  press(input, 'ArrowRight');
  assert.equal(input.getDirection(), 'RIGHT', '↑ 를 누른 채 → 를 누르면 → 가 우선');

  release(input, 'ArrowRight');
  assert.equal(input.getDirection(), 'UP', '최근 키를 떼면 이전 키로 복귀');

  release(input, 'ArrowUp');
  assert.equal(input.getDirection(), null);

  input.destroy();
});

test('키를 누르고 있으면 isDown 이 true 다', () => {
  const input = new InputManager();

  press(input, 'ArrowLeft');
  assert.equal(input.isDown('ArrowLeft'), true);
  assert.equal(input.isJustPressed('ArrowLeft'), true);

  input.clearJustPressed();
  assert.equal(input.isJustPressed('ArrowLeft'), false);

  release(input, 'ArrowLeft');
  assert.equal(input.isDown('ArrowLeft'), false);

  input.destroy();
});

test('창 포커스를 잃으면 입력 상태가 초기화된다', () => {
  const input = new InputManager();

  press(input, 'ArrowDown');
  assert.equal(input.getDirection(), 'DOWN');

  registered.blur();

  assert.equal(input.getDirection(), null);
  assert.equal(input.isDown('ArrowDown'), false);

  input.destroy();
});

test('터치용 press/release API 로도 방향과 스킬이 동작한다', () => {
  const input = new InputManager();

  input.press('ArrowRight');
  assert.equal(input.isDown('ArrowRight'), true);
  assert.equal(input.isJustPressed('ArrowRight'), true);
  assert.equal(input.getDirection(), 'RIGHT');

  input.press('ArrowUp');
  assert.equal(input.getDirection(), 'UP', '나중에 누른 방향 우선');

  input.release('ArrowUp');
  assert.equal(input.getDirection(), 'RIGHT');

  input.release('ArrowRight');
  assert.equal(input.getDirection(), null);

  input.press('Space');
  assert.equal(input.isJustPressed('Space'), true, '울기 버튼 주입');
  input.release('Space');
  assert.equal(input.isDown('Space'), false);

  input.destroy();
});
