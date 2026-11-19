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
import { TOUCH_TAP_MEMORY_MS } from '../src/constants.js';

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

test('터치 탭은 손을 뗀 직후에도 잠깐 방향을 기억한다', () => {
  const input = new InputManager();

  input.press('ArrowLeft', { touch: true });
  input.release('ArrowLeft');

  assert.equal(input.directionStack.length, 0, '손을 떼면 눌린 방향 스택은 비어 있다');
  assert.equal(input.getDirection(), 'LEFT', '짧은 탭도 다음 tick 에서 인식된다');

  // 메모리 시간이 지나면 사라진다
  input.touchDirectionAt = Date.now() - TOUCH_TAP_MEMORY_MS - 1;
  assert.equal(input.getDirection(), null);

  input.destroy();
});

test('키보드 방향 입력은 터치 탭 메모리를 무효화한다', () => {
  const input = new InputManager();

  input.press('ArrowRight', { touch: true });
  input.release('ArrowRight');
  assert.equal(input.getDirection(), 'RIGHT');

  input.press('ArrowUp'); // 키보드 입력
  input.release('ArrowUp');
  assert.equal(input.getDirection(), null, '키보드 입력 후에는 터치 메모리가 남지 않는다');

  input.destroy();
});

test('포커스를 잃으면 터치 탭 메모리도 초기화된다', () => {
  const input = new InputManager();

  input.press('ArrowDown', { touch: true });
  input.release('ArrowDown');
  assert.equal(input.getDirection(), 'DOWN');

  registered.blur();
  assert.equal(input.getDirection(), null);
  assert.equal(input.touchDirection, null);

  input.destroy();
});

test('다른 방향을 누르고 있어도 짧은 터치 탭이 우선한다', () => {
  const input = new InputManager();

  input.press('ArrowUp', { touch: true });   // 계속 누르는 중
  input.press('ArrowLeft', { touch: true }); // 짧은 탭
  input.release('ArrowLeft');

  assert.equal(input.directionStack[0], 'UP', 'UP 은 여전히 눌린 상태');
  assert.equal(input.getDirection(), 'LEFT', '방금 탭한 방향이 우선');

  // 탭 메모리가 만료되면 계속 누르고 있는 방향으로 돌아간다
  input.touchDirectionAt = Date.now() - TOUCH_TAP_MEMORY_MS - 1;
  assert.equal(input.getDirection(), 'UP');

  input.release('ArrowUp');
  input.destroy();
});

test('키/터치 활동은 activitySeq 를 증가시켜 자동 데모 종료 신호로 쓰인다', () => {
  const input = new InputManager();
  const before = input.activitySeq;

  input.press('ArrowRight', { touch: true });
  input.release('ArrowRight');
  assert.ok(input.activitySeq > before, '터치 입력도 활동으로 기록');
  assert.ok(input.lastActivityAt > 0);

  const afterTouch = input.activitySeq;
  press(input, 'Space');
  assert.ok(input.activitySeq > afterTouch, '키보드 입력도 활동으로 기록');

  input.destroy();
});

test('BOT 버튼에 포커스된 키 입력은 게임 입력으로 중복 처리하지 않는다', () => {
  const input = new InputManager();
  const before = input.activitySeq;
  let prevented = false;

  input._onKeyDown({
    code: 'Space',
    preventDefault() { prevented = true; },
    target: { closest: selector => (selector === '[data-bot-toggle]' ? {} : null) },
  });

  assert.equal(input.activitySeq, before);
  assert.equal(prevented, false);
  assert.equal(input.isDown('Space'), false);

  input.destroy();
});

test('설명서가 열려 있으면 게임 키 입력을 처리하지 않는다', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'help-overlay' ? { hidden: false } : null),
  };

  const input = new InputManager();
  const before = input.activitySeq;
  press(input, 'ArrowRight');

  assert.equal(input.activitySeq, before);
  assert.equal(input.getDirection(), null);

  input.destroy();
  globalThis.document = previousDocument;
});
