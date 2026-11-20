/**
 * Pac-Baby: 간단한 토스트 알림
 */

let hideTimer = null;

/**
 * @param {string} message
 * @param {{ duration?: number, root?: Document|object|null }} options
 */
export function showToast(message, options = {}) {
  const root = options.root || (typeof document !== 'undefined' ? document : null);
  const element = root?.getElementById?.('toast');
  if (!element) return false;

  const duration = Number.isFinite(options.duration) ? options.duration : 2600;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  element.textContent = String(message ?? '');
  element.hidden = false;
  element.classList?.add?.('toast-visible');

  hideTimer = setTimeout(() => {
    element.classList?.remove?.('toast-visible');
    element.hidden = true;
    hideTimer = null;
  }, Math.max(600, duration));

  return true;
}

export default showToast;
