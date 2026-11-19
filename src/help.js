/**
 * Pac-Baby: 사용 설명서(도움말) 오버레이
 *
 * - 처음 방문한 사용자에게 자동으로 한 번 열린다 (localStorage 로 기억)
 * - 언제든 H / F1 키 또는 화면의 "❔ 도움말" 버튼으로 열고 닫을 수 있다
 * - 열려 있는 동안 game.helpOpen = true → 게임 루프가 로직/입력을 멈춘다
 */

import { HELP_SEEN_KEY } from './constants.js';

/** localStorage 접근이 차단된 환경(사생활 보호 모드 등)에서도 안전하게 동작 */
function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (err) { /* 접근 차단 → 저장 없이 동작 */ }
  return null;
}

export default class HelpOverlay {
  /**
   * @param {object} options
   * @param {import('./game.js').default|null} options.game
   * @param {Document|object|null} options.root DOM 루트 (테스트 주입용)
   * @param {Storage|null} options.storage
   * @param {string} options.storageKey
   * @param {boolean} options.autoShow 첫 방문 자동 표시 (기본 true)
   */
  constructor(options = {}) {
    this.game = options.game || null;
    this.root = options.root || (typeof document !== 'undefined' ? document : null);
    this.storage = options.storage !== undefined ? options.storage : safeStorage();
    this.storageKey = options.storageKey || HELP_SEEN_KEY;
    this.autoShow = options.autoShow !== false;

    this.opened = false;
    this.lastFocused = null;
    this.handlers = [];

    this.overlay = this._byId('help-overlay');
    this.card = this._byId('help-card');
    this.openButtons = this._all('[data-help-open]');
    this.closeButtons = this._all('[data-help-close]');

    this._bind();

    // 첫 방문이라면 설명서를 먼저 보여 준다 (한 번만)
    if (this.autoShow && !this.hasSeen()) this.open();
  }

  /** 현재 열려 있는지 */
  get isOpen() {
    return this.opened;
  }

  /** 설명서 열기 */
  open() {
    if (this.opened) return false;

    this.lastFocused = this.root && this.root.activeElement ? this.root.activeElement : null;
    this.opened = true;

    if (this.overlay) {
      this.overlay.hidden = false;
      this.overlay.removeAttribute?.('hidden');
      this.overlay.setAttribute?.('aria-hidden', 'false');
    }
    this.root?.body?.classList?.add?.('help-visible');
    this.card?.focus?.();

    // 열려 있는 동안 게임 정지 + 눌린 키 상태 초기화
    this.game?.setHelpOpen?.(true);
    this._resetGameInput();
    this.markSeen();
    return true;
  }

  /** 설명서 닫기 */
  close() {
    if (!this.opened) return false;
    this.opened = false;

    if (this.overlay) {
      this.overlay.setAttribute?.('aria-hidden', 'true');
      this.overlay.hidden = true;
      this.overlay.setAttribute?.('hidden', '');
    }
    this.root?.body?.classList?.remove?.('help-visible');

    this.game?.setHelpOpen?.(false);
    this._resetGameInput();

    // 닫은 키(Escape 등)가 게임에 전달되는 것을 막고 포커스를 되돌린다
    this.game?.input?.clearJustPressed?.();
    try { this.lastFocused?.focus?.(); } catch (err) { /* 무시 */ }
    this.lastFocused = null;
    return true;
  }

  /** 열기/닫기 토글 — 토글 후의 열림 상태를 반환한다 */
  toggle() {
    if (this.opened) this.close();
    else this.open();
    return this.opened;
  }

  /** 이미 설명서를 본 적이 있는지 (localStorage) */
  hasSeen() {
    try {
      return this.storage?.getItem(this.storageKey) === '1';
    } catch (err) {
      return false;
    }
  }

  /** 설명서를 봤다고 기록 */
  markSeen() {
    try {
      this.storage?.setItem(this.storageKey, '1');
    } catch (err) { /* 저장 불가 환경 무시 */ }
  }

  /** 이벤트 정리 */
  destroy() {
    for (const { target, type, handler } of this.handlers) {
      target.removeEventListener?.(type, handler);
    }
    this.handlers = [];
    this.close();
  }

  // ===== 내부 유틸 =====

  _byId(id) {
    if (!this.root) return null;
    if (typeof this.root.getElementById === 'function') return this.root.getElementById(id);
    if (typeof this.root.querySelector === 'function') return this.root.querySelector(`#${id}`);
    return null;
  }

  _all(selector) {
    if (!this.root || typeof this.root.querySelectorAll !== 'function') return [];
    try {
      return Array.from(this.root.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  _bind() {
    if (!this.root) return;

    const on = (target, type, handler) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler);
      this.handlers.push({ target, type, handler });
    };

    const stopAndClose = (event) => {
      event?.preventDefault?.();
      this.close();
    };

    for (const button of this.openButtons) {
      on(button, 'click', (event) => {
        event?.preventDefault?.();
        this.open();
      });
    }
    for (const button of this.closeButtons) {
      on(button, 'click', stopAndClose);
    }
    on(this.root, 'keydown', (event) => this._onKeyDown(event));
  }

  /** H / F1 열기, Escape / H / F1 / P 닫기 */
  _onKeyDown(event) {
    const code = event?.code;
    if (!code) return;

    const isHelpKey = code === 'KeyH' || code === 'F1';

    if (this.opened) {
      if (isHelpKey || code === 'Escape' || code === 'KeyP') {
        event.preventDefault?.();
        this.close();
      }
      return;
    }

    if (isHelpKey) {
      event.preventDefault?.();
      this.open();
    }
  }

  /** 도움말을 여닫을 때 게임 입력(눌린 키/방향 버퍼)을 비워 조작이 새지 않게 한다 */
  _resetGameInput() {
    const input = this.game?.input;
    if (!input) return;
    this.input?.clearJustPressed?.();
    input.clearJustPressed?.();
    input.clearTouchMemory?.();
    if (input.keys) {
      for (const code of Object.keys(input.keys)) {
        if (input.keys[code]) input.release?.(code);
      }
    }
  }
}
