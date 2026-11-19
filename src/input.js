/**
 * Pac-Baby: 키보드 입력 처리 모듈
 */

import { TOUCH_TAP_MEMORY_MS } from './constants.js';

/** 방향키 → 게임 방향 매핑 */
const KEY_DIRECTIONS = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
};

export default class InputManager {
  constructor() {
    this.keys = {};
    this.justPressed = {};
    // 눌린 순서대로 보관하여 "가장 최근에 누른 방향"을 우선한다
    this.directionStack = [];

    // 터치 전용 탭 메모리: 손가락을 아주 짧게 튕겨도 다음 tick 이 방향을 인식한다
    this.touchDirection = null;
    this.touchDirectionAt = 0;

    this._onKeyDown = (e) => {
      // 방향키/스페이스로 인한 페이지 스크롤 방지
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.press(e.code);
    };

    this._onKeyUp = (e) => {
      this.release(e.code);
    };

    // 창 포커스를 잃으면 눌린 키 상태를 초기화 (키가 눌린 채 고정되는 현상 방지)
    this._onBlur = () => {
      this.keys = {};
      this.justPressed = {};
      this.directionStack = [];
      this.clearTouchMemory();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** 현재 시각 (테스트에서 주입 가능) */
  _now() {
    return Date.now();
  }

  /**
   * 키 입력 주입 (키보드/터치 공용)
   * @param {string} code KeyboardEvent.code 형식 ('ArrowUp', 'Space' …)
   * @param {{touch?: boolean}} [meta] 터치 입력이면 touch: true
   */
  press(code, meta = {}) {
    if (!code) return;
    if (!this.keys[code]) {
      this.justPressed[code] = true;
    }
    this.keys[code] = true;

    const dir = KEY_DIRECTIONS[code];
    if (!dir) return;

    if (meta.touch) {
      // 짧은 탭이 tick 사이에 묻히지 않도록 잠깐 방향을 기억한다
      this.touchDirection = dir;
      this.touchDirectionAt = this._now();
    } else {
      // 키보드 입력이 들어오면 터치 메모리는 즉시 무효화 (키보드 우선)
      this.touchDirection = null;
      this.touchDirectionAt = 0;
    }

    if (!this.directionStack.includes(dir)) {
      this.directionStack.push(dir);
    }
  }

  /** 키 입력 해제 (키보드/터치 공용) */
  release(code) {
    if (!code) return;
    this.keys[code] = false;

    const dir = KEY_DIRECTIONS[code];
    if (dir) {
      const index = this.directionStack.indexOf(dir);
      if (index >= 0) this.directionStack.splice(index, 1);
    }
  }

  /** 터치 탭 메모리 초기화 (도움말/포커스 전환 시) */
  clearTouchMemory() {
    this.touchDirection = null;
    this.touchDirectionAt = 0;
  }

  /** 특정 키가 눌려 있는지 확인 */
  isDown(code) {
    return !!this.keys[code];
  }

  /** 특정 키가 이번 프레임에 막 눌렸는지 확인 */
  isJustPressed(code) {
    return !!this.justPressed[code];
  }

  /** 매 틱(프레임) 시작 시 호출하여 'justPressed' 상태 리셋 */
  clearJustPressed() {
    this.justPressed = {};
  }

  /** 방향키 → 방향 문자열 반환 (가장 최근에 누른 방향 우선) */
  getDirection() {
    const top = this.directionStack.length > 0
      ? this.directionStack[this.directionStack.length - 1]
      : null;

    const remembered = this.touchDirection
      && this._now() - this.touchDirectionAt <= TOUCH_TAP_MEMORY_MS
      ? this.touchDirection
      : null;

    // 방금 탭한 터치 방향은 오래 누르고 있던 다른 방향보다 우선한다
    if (remembered && remembered !== top) return remembered;

    return top;
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}