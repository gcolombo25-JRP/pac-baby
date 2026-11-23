/**
 * Pac-Baby: 터치 D-패드 (모바일 조작)
 *
 * index.html 의 [data-key] 버튼을 InputManager 에 연결한다.
 * 키보드와 동일한 press/release API 를 사용하므로 게임 쪽은 수정이 필요 없다.
 */

import { TOUCH_SWIPE_THRESHOLD } from './constants.js';

/** 스와이프 방향 → 키 코드 */
const SWIPE_KEY_CODES = {
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
};

export default class TouchControls {
  /**
   * @param {import('./input.js').default} input
   * @param {Document|HTMLElement|null} root 버튼을 찾을 범위 (기본: document)
   * @param {{playUiClick?: () => void}|null} sound UI 클릭음용 SoundFX (선택)
   */
  constructor(input, root = null, sound = null) {
    this.input = input;
    this.root = root || (typeof document !== 'undefined' ? document : null);
    this.sound = sound;
    this.handlers = [];
    this.held = new Set(); // 현재 눌린 키 (중복 press/release 방지)

    // BOT 치트 상태 배지 (D-패드 자리 #bot-cheat-bar)
    this.cheatMode = false;
    this._cheatBar = typeof this.root?.querySelector === 'function'
      ? this.root.querySelector('#bot-cheat-bar')
      : null;

    // 게임 화면 최대화용 레이아웃 상태
    this._controlsEl = null;
    this._layoutObserver = null;
    this._layoutPending = false;
    this._onLayout = () => this._scheduleLayout();

    // D-패드 버튼이 없더라도 UI 버튼 클릭음은 연결한다
    this._setupUiClickSound();

    if (!this.root || typeof this.root.querySelectorAll !== 'function') return;

    const buttons = Array.from(this.root.querySelectorAll('[data-key]'));

    for (const button of buttons) {
      const code = button.dataset && button.dataset.key
        ? button.dataset.key
        : button.getAttribute('data-key');
      if (!code) continue;

      const onDown = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();

        // 포인터 캡처: 손가락이 버튼 경계를 살짝 벗어나도 입력이 끊기지 않는다
        if (event && event.pointerId !== undefined
          && typeof button.setPointerCapture === 'function') {
          try { button.setPointerCapture(event.pointerId); } catch (err) { /* 무시 */ }
        }

        if (this.held.has(code)) return;
        this.held.add(code);
        this._playUiClick(); // 손끝 반응: 짧은 틱 사운드
        this.input.press(code, { touch: true });
      };
      const onUp = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (!this.held.delete(code)) return;
        this.input.release(code);
      };

      button.addEventListener('pointerdown', onDown);
      button.addEventListener('pointerup', onUp);
      button.addEventListener('pointercancel', onUp);
      button.addEventListener('lostpointercapture', onUp);

      this.handlers.push({ button, onDown, onUp });
    }

    this._setupLayout();
  }

  /** 연결된 버튼 수 */
  get buttonCount() {
    return this.handlers.length;
  }

  /** SoundFX UI 클릭음을 안전하게 재생 (없는 환경/테스트 스텁에서도 무시) */
  _playUiClick() {
    const play = this.sound && this.sound.playUiClick;
    if (typeof play !== 'function') return;
    try {
      play.call(this.sound);
    } catch (err) {
      /* 오디오 오류가 입력을 막지 않게 무시 */
    }
  }

  /**
   * D-패드 외 UI 버튼(도움말/리더보드/종료/모달 등)도 터치/클릭 시 클릭음을 낸다.
   * - [data-key] 버튼은 위의 onDown 에서 이미 재생했으므로 제외한다.
   * - pointerdown 은 터치·마우스 모두 즉시 반응해 모바일에서도 지연이 없다.
   */
  _setupUiClickSound() {
    if (!this.root || typeof this.root.addEventListener !== 'function') return;

    this._onUiPointerDown = (event) => {
      const target = event && event.target;
      if (!target || typeof target.closest !== 'function') return;
      const button = target.closest('button');
      if (!button || button.hasAttribute('data-key')) return;
      this._playUiClick();
    };

    this.root.addEventListener('pointerdown', this._onUiPointerDown, true);
  }

  // ===== BOT 치트 상태 UI =====

  /**
   * BOT 치트 실행 중 표시/숨김.
   * - D-패드 자리(`#bot-cheat-bar`)에 `BOT 치트 실행 중 · 랭킹 제외` 배지와
   *   `[BOT 종료]` 버튼을 보여 준다.
   * - `body.bot-cheat` 클래스로 D-패드 대신 배지가 보이도록 CSS 를 전환한다.
   *   (PC 에서도 3연타로 치트를 켜면 종료 버튼이 즉시 보인다)
   * @param {boolean} active
   * @returns {boolean} 반영된 상태
   */
  setCheatMode(active) {
    const on = !!active;
    this.cheatMode = on;

    if (typeof document !== 'undefined' && document?.body?.classList) {
      document.body.classList.toggle('bot-cheat', on);
    }

    if (!this._cheatBar && typeof this.root?.querySelector === 'function') {
      this._cheatBar = this.root.querySelector('#bot-cheat-bar');
    }

    const bar = this._cheatBar;
    if (bar) {
      bar.hidden = !on;
      if (on) {
        bar.removeAttribute?.('hidden');
        bar.setAttribute?.('aria-hidden', 'false');
      } else {
        bar.setAttribute?.('hidden', '');
        bar.setAttribute?.('aria-hidden', 'true');
      }
    }

    // 배지 영역이 생기거나 사라지면 캔버스가 쓸 남은 높이를 다시 측정한다
    this._scheduleLayout();
    return on;
  }

  // ===== 게임 화면 최대화용 레이아웃 측정 =====

  /**
   * D-패드가 실제로 차지하는 크기를 CSS 변수로 노출한다.
   * style.css 가 이 값을 사용해 캔버스를 남은 공간에 최대한 크게 배치한다.
   */
  _setupLayout() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    this._controlsEl = typeof this.root?.querySelector === 'function'
      ? this.root.querySelector('.touch-controls')
      : null;

    window.addEventListener('resize', this._onLayout);
    window.addEventListener('orientationchange', this._onLayout);

    if (this._controlsEl && typeof ResizeObserver === 'function') {
      this._layoutObserver = new ResizeObserver(() => this._scheduleLayout());
      this._layoutObserver.observe(this._controlsEl);
    }

    // 첫 프레임부터 올바른 크기로 그리도록 즉시 한 번 반영하고,
    // 실제 레이아웃이 확정된 다음 프레임에 다시 측정한다.
    this._applyLayout();
    this._scheduleLayout();
  }

  /** 다음 프레임에 레이아웃을 한 번만 측정한다 (연속 이벤트 중복 방지) */
  _scheduleLayout() {
    if (this._layoutPending || typeof window === 'undefined') return;
    this._layoutPending = true;

    const run = () => {
      this._layoutPending = false;
      this._applyLayout();
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  /** 컨트롤 크기와 가로/세로 모드를 CSS 에 반영 */
  _applyLayout() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const body = document.body;
    let modeChanged = false;

    // 1) 먼저 가로/세로 모드 클래스를 적용한다
    if (body && body.classList) {
      const narrow = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 700px)').matches
        : window.innerWidth <= 700;
      const touchMode = body.classList.contains('touch-active') || narrow;
      const landscape = touchMode && window.innerWidth > window.innerHeight;

      if (body.classList.contains('touch-landscape') !== landscape) {
        body.classList.toggle('touch-landscape', landscape);
        modeChanged = true;
      }
    }

    // 2) 모드가 바뀐 뒤의 실제 레이아웃을 측정한다
    const controls = this._controlsEl;
    const rootStyle = document.documentElement?.style;
    if (controls && typeof controls.getBoundingClientRect === 'function' && rootStyle) {
      const rect = controls.getBoundingClientRect();
      if (rect.height > 0) {
        rootStyle.setProperty('--touch-controls-h', `${Math.ceil(rect.height)}px`);
      }
      if (rect.width > 0) {
        rootStyle.setProperty('--touch-controls-w', `${Math.ceil(rect.width)}px`);
      }
    }

    // 모드 전환 직후에는 레이아웃이 한 번 더 확정될 수 있으므로 재측정한다
    if (modeChanged) this._scheduleLayout();
  }

  /** 이벤트 정리 */
  destroy() {
    for (const { button, onDown, onUp } of this.handlers) {
      button.removeEventListener('pointerdown', onDown);
      button.removeEventListener('pointerup', onUp);
      button.removeEventListener('pointercancel', onUp);
      button.removeEventListener('lostpointercapture', onUp);
    }
    this.handlers = [];
    this.held.clear();

    if (this._onUiPointerDown && this.root && typeof this.root.removeEventListener === 'function') {
      this.root.removeEventListener('pointerdown', this._onUiPointerDown, true);
    }
    this._onUiPointerDown = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onLayout);
      window.removeEventListener('orientationchange', this._onLayout);
    }
    this._layoutObserver?.disconnect?.();
    this._layoutObserver = null;
    this._controlsEl = null;

    // BOT 치트 상태 UI 정리
    this.cheatMode = false;
    if (this._cheatBar) {
      this._cheatBar.hidden = true;
      this._cheatBar.setAttribute?.('aria-hidden', 'true');
    }
    this._cheatBar = null;

    if (typeof document !== 'undefined') {
      document.body?.classList?.remove?.('bot-cheat');
      document.body?.classList?.remove?.('touch-landscape');
      const rootStyle = document.documentElement?.style;
      rootStyle?.removeProperty?.('--touch-controls-h');
      rootStyle?.removeProperty?.('--touch-controls-w');
    }
  }
}

/**
 * 화면 스와이프/드래그로 방향을 바꾸는 제스처 컨트롤.
 * - 캔버스 위에서 손가락을 끌면 이동 방향이 바뀐다.
 * - 한 번의 드래그로 위 → 왼쪽처럼 여러 방향을 연속 지정할 수 있다.
 * - 마우스는 기본적으로 무시해 데스크톱 클릭(테스터 텔레포트)과 충돌하지 않는다.
 */
export class TouchSwipe {
  /**
   * @param {import('./input.js').default} input
   * @param {HTMLElement|null} target 스와이프를 감지할 요소 (보통 canvas)
   * @param {{threshold?: number, axisRatio?: number, pointerTypes?: string[]}} options
   */
  constructor(input, target = null, options = {}) {
    this.input = input;
    this.target = target || null;
    this.threshold = options.threshold || TOUCH_SWIPE_THRESHOLD;
    this.axisRatio = options.axisRatio || 1.2; // 대각선 흔들림 방지
    this.pointerTypes = options.pointerTypes || ['touch', 'pen'];
    // 게임 화면 첫 접촉 알림 (마우스 클릭 포함) — BOT 종료 같은 UI 전환용
    this.onPointerDown = typeof options.onPointerDown === 'function' ? options.onPointerDown : null;

    this.active = false;          // 현재 스와이프 중인지
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.anchorX = 0;             // 다음 방향 판정 기준점
    this.anchorY = 0;
    this.currentDirection = null;

    this._onDown = (event) => this._handleDown(event);
    this._onMove = (event) => this._handleMove(event);
    this._onUp = (event) => this._handleUp(event);

    if (this.target && typeof this.target.addEventListener === 'function') {
      this.target.addEventListener('pointerdown', this._onDown);
      this.target.addEventListener('pointermove', this._onMove, { passive: false });
      this.target.addEventListener('pointerup', this._onUp);
      this.target.addEventListener('pointercancel', this._onUp);
    }
  }

  /** 스와이프 감지 중인지 */
  get isSwiping() {
    return this.active;
  }

  _handleDown(event) {
    if (!event || this.active) return;

    // 첫 접촉을 외부에 알린다 (마우스도 포함 — BOT 치트 종료 등)
    if (typeof this.onPointerDown === 'function') {
      try {
        this.onPointerDown(event);
      } catch (err) {
        /* UI 콜백 오류가 스와이프 입력을 막지 않게 무시 */
      }
    }

    if (this.pointerTypes.length > 0 && !this.pointerTypes.includes(event.pointerType)) return;

    if (typeof event.preventDefault === 'function') event.preventDefault();

    this.active = true;
    this.pointerId = event.pointerId !== undefined ? event.pointerId : null;
    this.startX = this.anchorX = Number.isFinite(event.clientX) ? event.clientX : 0;
    this.startY = this.anchorY = Number.isFinite(event.clientY) ? event.clientY : 0;
    this.currentDirection = null;

    // 손가락이 캔버스 밖으로 나가도 드래그를 계속 추적한다
    if (this.pointerId !== null && typeof this.target.setPointerCapture === 'function') {
      try { this.target.setPointerCapture(this.pointerId); } catch (err) { /* 무시 */ }
    }
  }

  _handleMove(event) {
    if (!event || !this.active) return;
    if (!this._isSamePointer(event)) return;

    if (typeof event.preventDefault === 'function') event.preventDefault();

    const x = Number.isFinite(event.clientX) ? event.clientX : this.anchorX;
    const y = Number.isFinite(event.clientY) ? event.clientY : this.anchorY;
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;

    if (Math.abs(dx) < this.threshold && Math.abs(dy) < this.threshold) return;

    const direction = this._directionFromDelta(dx, dy);
    if (!direction || direction === this.currentDirection) return;

    this.currentDirection = direction;
    this.anchorX = x;
    this.anchorY = y;
    this._emit(direction);
  }

  _handleUp(event) {
    if (!event || !this.active) return;
    if (!this._isSamePointer(event)) return;

    if (typeof event.preventDefault === 'function') event.preventDefault();

    // pointermove 없이 빠르게 튕기고 뗀 경우(flick)도 방향을 인식한다
    if (!this.currentDirection) {
      const x = Number.isFinite(event.clientX) ? event.clientX : this.startX;
      const y = Number.isFinite(event.clientY) ? event.clientY : this.startY;
      const dx = x - this.startX;
      const dy = y - this.startY;

      if (Math.hypot(dx, dy) >= this.threshold) {
        const direction = this._directionFromDelta(dx, dy);
        if (direction) this._emit(direction);
      }
    }

    this.active = false;
    this.pointerId = null;
    this.currentDirection = null;
  }

  _isSamePointer(event) {
    if (event.pointerId === undefined || event.pointerId === null) return true;
    if (this.pointerId === null) return true;
    return event.pointerId === this.pointerId;
  }

  /** 이동 벡터 → 방향 (축 우세 판정, 대각선은 더 큰 축) */
  _directionFromDelta(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax === 0 && ay === 0) return null;

    if (ax >= ay * this.axisRatio) return dx > 0 ? 'RIGHT' : 'LEFT';
    if (ay >= ax * this.axisRatio) return dy > 0 ? 'DOWN' : 'UP';
    return ax > ay ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP');
  }

  /** 방향 주입: press→release + 터치 탭 메모리로 다음 tick 에서 인식 */
  _emit(direction) {
    const code = SWIPE_KEY_CODES[direction];
    if (!code) return;

    this.input.press(code, { touch: true });
    this.input.release(code);
  }

  /** 이벤트 정리 */
  destroy() {
    if (this.target && typeof this.target.removeEventListener === 'function') {
      this.target.removeEventListener('pointerdown', this._onDown);
      this.target.removeEventListener('pointermove', this._onMove);
      this.target.removeEventListener('pointerup', this._onUp);
      this.target.removeEventListener('pointercancel', this._onUp);
    }

    this.target = null;
    this.active = false;
    this.pointerId = null;
    this.currentDirection = null;
  }
}
