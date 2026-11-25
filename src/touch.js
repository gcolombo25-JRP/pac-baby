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

/** 방향 → 키 코드 (D-패드 표면 제스처용) */
const DIRECTION_KEY_CODES = {
  UP: 'ArrowUp',
  RIGHT: 'ArrowRight',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
};

/** 지원하는 방향 입력 방식 */
const PAD_MODES = ['buttons', 'sector', 'joystick'];

/** 모드별 전환 버튼 라벨 */
const PAD_MODE_LABELS = {
  buttons: '십자',
  sector: '4분할',
  joystick: '스틱',
};

/** 레이아웃 측정 실패 시 D-패드 반지름 기본값(px) */
const PAD_FALLBACK_RADIUS = 64;

/**
 * 이동 벡터를 4방향 중 하나로 변환한다 (순수 함수).
 *
 * 12시 기준 ±45° 구역 판정이므로 11·12·1시=UP, 2·3·4시=RIGHT,
 * 5·6·7시=DOWN, 8·9·10시=LEFT 가 되며 경계(정확히 45°)에서는
 * |dx| >= |dy| 규칙으로 가로 방향 1개만 자동 선택된다.
 *
 * @param {number} dx 중심에서 오른쪽이 +인 x 오프셋
 * @param {number} dy 중심에서 아래쪽이 +인 y 오프셋
 * @param {{deadzone?: number}} [options] 중심 무시 반경(px)
 * @returns {'UP'|'RIGHT'|'DOWN'|'LEFT'|null}
 */
export function directionFromVector(dx, dy, { deadzone = 0 } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;

  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) return null;
  if (length < deadzone) return null;
  if (length === 0) return null; // 중심을 정확히 눌렀을 때는 방향 없음

  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'RIGHT' : 'LEFT';
  return dy > 0 ? 'DOWN' : 'UP';
}

export default class TouchControls {
  /**
   * @param {import('./input.js').default} input
   * @param {Document|HTMLElement|null} root 버튼을 찾을 범위 (기본: document)
   * @param {{playUiClick?: () => void}|null} sound UI 클릭음용 SoundFX (선택)
   * @param {{padMode?: 'buttons'|'sector'|'joystick', onPadModeChange?: ((mode: string) => void)|null}} [options]
   */
  constructor(input, root = null, sound = null, options = {}) {
    const { padMode = 'buttons', onPadModeChange = null } = options || {};

    this.input = input;
    this.root = root || (typeof document !== 'undefined' ? document : null);
    this.sound = sound;
    this.handlers = [];
    this.held = new Set(); // 현재 눌린 키 (중복 press/release 방지)

    // 방향 입력 방식: 'buttons'(기존 십자) | 'sector'(A안 4분할 파이) | 'joystick'(B안 스틱)
    this.padMode = PAD_MODES.includes(padMode) ? padMode : 'buttons';
    this.onPadModeChange = typeof onPadModeChange === 'function' ? onPadModeChange : null;

    // .dpad 표면 제스처 상태 (한 번에 손가락 1개만 추적)
    this._dpad = null;
    this._padActive = false;
    this._activePointerId = null;
    this._padDirection = null; // 현재 제스처로 눌려 있는 방향
    this._onPadDown = null;
    this._onPadMove = null;
    this._onPadUp = null;

    // 방향 입력 방식 전환 버튼
    this._toggleButton = null;
    this._onToggleClick = null;

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

    // .dpad 표면 제스처(A안 4분할 / B안 스틱) + 방식 전환 버튼
    this._setupPadSurface();
    this._setupPadToggle();
    this.setPadMode(this.padMode);

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
      // 방향 입력 방식 전환 버튼은 자체 click 핸들러에서 클릭음을 재생한다 (중복 방지)
      if (button.hasAttribute?.('data-pad-toggle')) return;
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

  // ===== 방향 입력 방식 (A안 4분할 / B안 스틱) =====

  /**
   * 방향 입력 방식을 적용한다.
   * - 눌려 있던 방향 입력을 먼저 해제해 모드 전환 중 키가 남지 않게 한다.
   * - body[data-pad] 로 CSS 를 전환하고, 전환 버튼 라벨/aria 상태를 갱신한다.
   * @param {'buttons'|'sector'|'joystick'} mode
   * @returns {'buttons'|'sector'|'joystick'} 적용된 모드
   */
  setPadMode(mode) {
    const next = PAD_MODES.includes(mode) ? mode : 'buttons';

    this._endPadGesture();
    this.padMode = next;

    if (typeof document !== 'undefined' && document?.body?.dataset) {
      document.body.dataset.pad = next;
    }

    this._syncPadToggleLabel();
    return next;
  }

  /**
   * 'sector'(A안) ↔ 'joystick'(B안) 전환.
   * 기존 'buttons'(십자) 상태에서 누르면 'sector' 로 진입한다.
   * @returns {'sector'|'joystick'} 전환된 모드
   */
  togglePadMode() {
    const next = this.padMode === 'sector' ? 'joystick' : 'sector';
    this.setPadMode(next);

    if (this.onPadModeChange) {
      try {
        this.onPadModeChange(next);
      } catch (err) {
        /* 콜백 오류가 입력을 막지 않게 무시 */
      }
    }

    return next;
  }

  /** 제스처 모드('sector' | 'joystick')에서만 .dpad 표면 입력을 받는다 */
  _isPadGestureMode() {
    return this.padMode === 'sector' || this.padMode === 'joystick';
  }

  /** .dpad 표면 제스처 리스너 연결 */
  _setupPadSurface() {
    if (!this.root || typeof this.root.querySelector !== 'function') return;

    const dpad = this.root.querySelector('.dpad');
    if (!dpad || typeof dpad.addEventListener !== 'function') return;

    this._dpad = dpad;
    this._onPadDown = (event) => this._handlePadDown(event);
    this._onPadMove = (event) => this._handlePadMove(event);
    this._onPadUp = (event) => this._handlePadUp(event);

    dpad.addEventListener('pointerdown', this._onPadDown);
    dpad.addEventListener('pointermove', this._onPadMove);
    dpad.addEventListener('pointerup', this._onPadUp);
    dpad.addEventListener('pointercancel', this._onPadUp);
    dpad.addEventListener('lostpointercapture', this._onPadUp);
  }

  /** 방향 입력 방식 전환 버튼 연결 (data-key 없음 → 게임 입력과 분리) */
  _setupPadToggle() {
    if (!this.root || typeof this.root.querySelector !== 'function') return;

    const button = this.root.querySelector('[data-pad-toggle]');
    if (!button || typeof button.addEventListener !== 'function') return;

    this._toggleButton = button;
    this._onToggleClick = (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      this._playUiClick();
      this.togglePadMode();
    };

    button.addEventListener('click', this._onToggleClick);
  }

  /** 전환 버튼 라벨/aria 상태를 현재 모드에 맞춘다 */
  _syncPadToggleLabel() {
    const button = this._toggleButton
      || (typeof this.root?.querySelector === 'function'
        ? this.root.querySelector('[data-pad-toggle]')
        : null);
    if (!button) return;

    this._toggleButton = button;
    const label = PAD_MODE_LABELS[this.padMode] || PAD_MODE_LABELS.buttons;

    button.textContent = label;
    button.setAttribute?.('data-pad-mode', this.padMode);
    button.setAttribute?.('aria-label', `방향 입력 방식 전환 (현재: ${label})`);
  }

  _handlePadDown(event) {
    if (!this._isPadGestureMode()) return;
    if (this._padActive) return; // 한 번에 손가락 1개만 추적

    if (event && typeof event.preventDefault === 'function') event.preventDefault();

    this._padActive = true;
    this._activePointerId = Number.isFinite(event?.pointerId) ? event.pointerId : null;

    // 손가락이 D-패드 원 밖으로 나가도 드래그를 계속 추적한다
    if (this._activePointerId !== null && typeof this._dpad?.setPointerCapture === 'function') {
      try { this._dpad.setPointerCapture(this._activePointerId); } catch (err) { /* 무시 */ }
    }

    this._updatePadFromPoint(event);
  }

  _handlePadMove(event) {
    if (!this._padActive || !this._isPadGestureMode()) return;
    if (!this._isSamePadPointer(event)) return;

    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    this._updatePadFromPoint(event);
  }

  _handlePadUp(event) {
    if (!this._padActive) return;
    if (!this._isSamePadPointer(event)) return;

    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    this._endPadGesture();
  }

  /** 추적 중인 손가락(pointerId)과 같은 이벤트인지 */
  _isSamePadPointer(event) {
    const id = event?.pointerId;
    if (!Number.isFinite(id) || this._activePointerId === null) return true;
    return id === this._activePointerId;
  }

  /** .dpad 중심/반지름 계산 (측정 실패 시 반지름 64px 로 폴백) */
  _padGeometry() {
    const rect = typeof this._dpad?.getBoundingClientRect === 'function'
      ? this._dpad.getBoundingClientRect()
      : null;

    const fallbackSize = PAD_FALLBACK_RADIUS * 2;
    const width = Number.isFinite(rect?.width) && rect.width > 0 ? rect.width : fallbackSize;
    const height = Number.isFinite(rect?.height) && rect.height > 0 ? rect.height : fallbackSize;
    const left = Number.isFinite(rect?.left) ? rect.left : 0;
    const top = Number.isFinite(rect?.top) ? rect.top : 0;

    return {
      cx: left + width / 2,
      cy: top + height / 2,
      r: Math.min(width, height) / 2 || PAD_FALLBACK_RADIUS,
    };
  }

  /** 터치 좌표 → 방향/노브 반영 (모드별 규칙) */
  _updatePadFromPoint(event) {
    const { cx, cy, r } = this._padGeometry();
    const x = Number.isFinite(event?.clientX) ? event.clientX : cx;
    const y = Number.isFinite(event?.clientY) ? event.clientY : cy;
    const dx = x - cx;
    const dy = y - cy;

    if (this.padMode === 'joystick') {
      // B안: 노브는 최대 이동 거리로 클램프, 방향은 deadzone 밖에서만 인식
      const maxTravel = r * 0.54;
      const length = Math.hypot(dx, dy);
      let knobX = dx;
      let knobY = dy;

      if (length > maxTravel && length > 0) {
        const scale = maxTravel / length;
        knobX = dx * scale;
        knobY = dy * scale;
      }

      this._setKnob(knobX, knobY);
      this._applyPadDirection(directionFromVector(dx, dy, { deadzone: r * 0.22 }));
      return;
    }

    // A안: 원형 4분할 파이 — 중심의 아주 작은 오차만 무시하고 즉시 반응
    this._applyPadDirection(directionFromVector(dx, dy, { deadzone: r * 0.08 }));
  }

  /** 인식된 방향을 키 입력으로 반영 (이전 키 release → 새 키 press) */
  _applyPadDirection(direction) {
    const next = direction || null;
    if (next === this._padDirection) return;

    const prevCode = this._padDirection ? DIRECTION_KEY_CODES[this._padDirection] : null;
    const nextCode = next ? DIRECTION_KEY_CODES[next] : null;

    if (prevCode) this.input?.release?.(prevCode);

    this._padDirection = next;
    this._setPadActiveKey(nextCode);

    if (nextCode) {
      this._playUiClick(); // 새 방향이 눌릴 때만 짧은 틱
      this.input?.press?.(nextCode, { touch: true });
    }
  }

  /** 눌려 있는 방향 입력을 모두 해제 (모드 전환/destroy 공용) */
  _releasePadKeys() {
    if (this._padDirection) {
      const code = DIRECTION_KEY_CODES[this._padDirection];
      this._padDirection = null;
      if (code) this.input?.release?.(code);
    }

    for (const code of Object.values(DIRECTION_KEY_CODES)) {
      if (this.held.delete(code)) this.input?.release?.(code);
    }

    this._setPadActiveKey(null);
  }

  /** 제스처 종료: 눌린 키/노브/포인터 추적 초기화 */
  _endPadGesture() {
    this._padActive = false;
    this._activePointerId = null;
    this._releasePadKeys();
    this._resetKnob();
  }

  /** 인식된 방향의 .pad-btn 에만 is-active 를 켜 시각적 피드백을 준다 */
  _setPadActiveKey(code) {
    const dpad = this._dpad;
    if (!dpad || typeof dpad.querySelectorAll !== 'function') return;

    const buttons = Array.from(dpad.querySelectorAll('.pad-btn[data-key]') || []);
    for (const button of buttons) {
      const key = button?.dataset?.key || button?.getAttribute?.('data-key');
      const active = !!code && key === code;
      const classList = button?.classList;

      if (classList && typeof classList.toggle === 'function') {
        classList.toggle('is-active', active);
      } else if (active) {
        classList?.add?.('is-active');
      } else {
        classList?.remove?.('is-active');
      }
    }
  }

  /** 조이스틱 노브 위치를 CSS 변수로 반영 */
  _setKnob(x, y) {
    const style = this._dpad?.style;
    if (!style || typeof style.setProperty !== 'function') return;

    const round = (value) => Math.round(value * 100) / 100;
    style.setProperty('--knob-x', `${round(x)}px`);
    style.setProperty('--knob-y', `${round(y)}px`);
  }

  /** 노브를 중앙으로 복귀 */
  _resetKnob() {
    const style = this._dpad?.style;
    if (!style || typeof style.setProperty !== 'function') return;

    style.setProperty('--knob-x', '0px');
    style.setProperty('--knob-y', '0px');
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

    // .dpad 표면 제스처 정리 (눌린 키/노브/포인터 추적 포함)
    this._endPadGesture();
    if (this._dpad && typeof this._dpad.removeEventListener === 'function') {
      this._dpad.removeEventListener('pointerdown', this._onPadDown);
      this._dpad.removeEventListener('pointermove', this._onPadMove);
      this._dpad.removeEventListener('pointerup', this._onPadUp);
      this._dpad.removeEventListener('pointercancel', this._onPadUp);
      this._dpad.removeEventListener('lostpointercapture', this._onPadUp);
    }
    this._dpad = null;
    this._onPadDown = null;
    this._onPadMove = null;
    this._onPadUp = null;

    // 방향 입력 방식 전환 버튼 정리
    if (this._toggleButton && typeof this._toggleButton.removeEventListener === 'function') {
      this._toggleButton.removeEventListener('click', this._onToggleClick);
    }
    this._toggleButton = null;
    this._onToggleClick = null;
    this.onPadModeChange = null;

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
      if (document.body?.dataset) delete document.body.dataset.pad;
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
