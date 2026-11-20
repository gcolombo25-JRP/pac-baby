/**
 * Pac-Baby: 글로벌 리더보드 모달
 *
 * - 공개 RPC(get_leaderboard)만 사용하고 note/access_count 같은 운영 컬럼은 노출하지 않는다.
 * - 30초 캐시 + 오프라인 폴백
 * - 게스트에게는 "기록 등록" CTA 1개만 부드럽게 노출한다.
 */

import { avatarEmoji, countryToFlag } from './validation.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default class LeaderboardModal {
  constructor(options = {}) {
    this.profile = options.profile || null;
    this.root = options.root || (typeof document !== 'undefined' ? document : null);
    this.onOpen = typeof options.onOpen === 'function' ? options.onOpen : null;
    this.onClose = typeof options.onClose === 'function' ? options.onClose : null;
    this.onRegisterRequest = typeof options.onRegisterRequest === 'function'
      ? options.onRegisterRequest
      : null;
    // 등록 모달이 위에 떠 있을 때는 Escape 로 리더보드까지 함께 닫지 않는다.
    this.isCovered = typeof options.isCovered === 'function' ? options.isCovered : null;
    this.formatScore = typeof options.formatScore === 'function'
      ? options.formatScore
      : (value) => Number(value || 0).toLocaleString('ko-KR');
    // 프로필 쪽 timeout(8s)보다 살짝 길게 두어 마지막 안전장치 역할을 한다.
    this.loadTimeoutMs = Number.isFinite(options.loadTimeoutMs)
      ? options.loadTimeoutMs
      : 12000;

    this.opened = false;
    this.loading = false;
    this.handlers = [];
    this.unsubscribe = null;

    this.overlay = this._byId('leaderboard-overlay');
    this.card = this._byId('leaderboard-card');
    this.body = this._byId('leaderboard-body');
    this.status = this._byId('leaderboard-status');
    this.cta = this._byId('leaderboard-register');
    this.openButtons = this._all('[data-leaderboard-open]');
    this.closeButtons = this._all('[data-leaderboard-close]');

    this._bind();

    if (this.profile?.subscribe) {
      this.unsubscribe = this.profile.subscribe(snapshot => this._syncCta(snapshot));
    }
  }

  get isOpen() {
    return this.opened;
  }

  open() {
    if (this.opened) return false;
    this.opened = true;

    if (this.overlay) {
      this.overlay.hidden = false;
      this.overlay.removeAttribute?.('hidden');
      this.overlay.setAttribute?.('aria-hidden', 'false');
    }
    this.root?.body?.classList?.add?.('modal-visible');
    this.card?.focus?.();

    this.onOpen?.();
    this._syncCta(this.profile?.getSnapshot?.());
    this.load(false);
    return true;
  }

  close() {
    if (!this.opened) return false;
    this.opened = false;

    if (this.overlay) {
      this.overlay.setAttribute?.('aria-hidden', 'true');
      this.overlay.hidden = true;
      this.overlay.setAttribute?.('hidden', '');
    }
    this.root?.body?.classList?.remove?.('modal-visible');
    this.onClose?.();
    return true;
  }

  /** 등록 직후처럼 즉시 최신 순위가 필요할 때 */
  refresh() {
    if (!this.opened) return Promise.resolve(false);
    return this.load(true);
  }

  async load(force = false) {
    if (!this.profile || this.loading) return false;
    this.loading = true;
    this._setStatus('순위를 불러오는 중...', '');

    // 모바일에서 네트워크가 매달려도 로딩 상태에 갇히지 않도록 감시 타이머를 둔다.
    let watchdog = null;
    const timeout = new Promise(resolve => {
      watchdog = setTimeout(() => resolve(null), this.loadTimeoutMs);
    });

    try {
      const result = await Promise.race([this.profile.fetchLeaderboard({ force }), timeout]);
      if (result === null) {
        this._setStatus('순위를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
      } else {
        this._render(result);
      }
    } catch (err) {
      this._setStatus('순위를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
    } finally {
      if (watchdog) clearTimeout(watchdog);
      this.loading = false;
    }
    return true;
  }

  destroy() {
    for (const { target, type, handler } of this.handlers) {
      target.removeEventListener?.(type, handler);
    }
    this.handlers = [];
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.close();
  }

  // ===== 내부 =====

  _render(result = {}) {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const offline = !!result.offline;

    if (!rows.length) {
      if (this.body) this.body.innerHTML = '';
      this._setStatus(
        offline
          ? '오프라인이에요. 저장된 순위가 아직 없어요.'
          : '아직 등록된 기록이 없어요. 첫 번째 주인공이 되어 보세요! 🏆',
        offline ? 'error' : '',
      );
      return;
    }

    if (this.body) {
      this.body.innerHTML = rows.map((row, index) => {
        const rank = Number(row.rank) || index + 1;
        const nickname = escapeHtml(row.nickname || '익명');
        const emoji = avatarEmoji(row.avatar_emoji_id);
        const flag = countryToFlag(row.country);
        const score = this.formatScore(row.high_score);
        const round = Math.max(1, Number(row.max_round) || 1);
        const meClass = row.is_me ? ' is-me' : '';

        return `<tr class="lb-row${meClass}">`
          + `<td class="lb-rank">${rank}</td>`
          + `<td class="lb-player"><span class="lb-emoji">${emoji}</span> ${nickname}</td>`
          + `<td class="lb-score">${score}</td>`
          + `<td class="lb-round">R${round}</td>`
          + `<td class="lb-country">${flag || '·'}</td>`
          + '</tr>';
      }).join('');
    }

    this._setStatus(
      offline ? '오프라인이에요 — 저장된 순위를 보여 드려요.' : '',
      offline ? 'error' : '',
    );
  }

  _syncCta(snapshot) {
    if (!this.cta) return;
    // 오프라인/로컬 모드에서는 등록할 수 없으므로 CTA 를 숨긴다.
    const hidden = !!snapshot?.isRegistered || snapshot?.remote === false;
    this.cta.hidden = hidden;
    if (hidden) this.cta.setAttribute?.('hidden', '');
    else this.cta.removeAttribute?.('hidden');
  }

  _setStatus(text, tone) {
    if (!this.status) return;
    this.status.textContent = text || '';
    this.status.classList?.remove?.('is-ok');
    this.status.classList?.remove?.('is-error');
    if (tone === 'ok') this.status.classList?.add?.('is-ok');
    if (tone === 'error') this.status.classList?.add?.('is-error');
  }

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

    for (const button of this.openButtons) {
      on(button, 'click', (event) => {
        event?.preventDefault?.();
        // 이미 열려 있으면 다시 눌렀을 때 재조회(재시도)로 동작한다.
        if (this.opened) {
          this.load(true);
          return;
        }
        this.open();
      });
    }

    for (const button of this.closeButtons) {
      on(button, 'click', (event) => {
        event?.preventDefault?.();
        this.close();
      });
    }

    if (this.cta) {
      on(this.cta, 'click', (event) => {
        event?.preventDefault?.();
        this.onRegisterRequest?.(this.profile?.lastRunSummary || null);
      });
    }

    on(this.root, 'keydown', (event) => {
      if (!this.opened) return;
      if (this.isCovered?.()) return;
      if (event?.code === 'Escape') {
        event.preventDefault?.();
        this.close();
      }
    });
  }
}
