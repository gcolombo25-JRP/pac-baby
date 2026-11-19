/**
 * Pac-Baby: 터치 D-패드 (모바일 조작)
 *
 * index.html 의 [data-key] 버튼을 InputManager 에 연결한다.
 * 키보드와 동일한 press/release API 를 사용하므로 게임 쪽은 수정이 필요 없다.
 */

export default class TouchControls {
  /**
   * @param {import('./input.js').default} input
   * @param {Document|HTMLElement|null} root 버튼을 찾을 범위 (기본: document)
   */
  constructor(input, root = null) {
    this.input = input;
    this.root = root || (typeof document !== 'undefined' ? document : null);
    this.handlers = [];
    this.held = new Set(); // 현재 눌린 키 (중복 press/release 방지)

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
        this.input.press(code);
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
  }

  /** 연결된 버튼 수 */
  get buttonCount() {
    return this.handlers.length;
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
  }
}
