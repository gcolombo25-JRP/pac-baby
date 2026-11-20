/**
 * Pac-Baby: 기록 등록 모달 (게스트 → 닉네임/이모지 등록)
 *
 * 조건을 만족한 게스트에게 게임 오버 시 부드럽게 노출된다.
 * - 강제 가입 없음: [나중에]로 닫으면 일정 횟수 동안 다시 묻지 않는다.
 * - 중복 확인은 UX 용이며, 최종 방어는 서버 UNIQUE 인덱스가 담당한다.
 */

import { AVATAR_EMOJIS, NICKNAME_RULE } from './constants.js';
import { showToast } from './toast.js';
import {
  avatarEmoji,
  isValidAvatarId,
  normalizeNickname,
  validateNickname,
} from './validation.js';

const REASON_TEXT = {
  EMPTY: `닉네임을 ${NICKNAME_RULE.minLength}~${NICKNAME_RULE.maxLength}자로 입력해 주세요.`,
  TOO_SHORT: `닉네임은 ${NICKNAME_RULE.minLength}자 이상이어야 해요.`,
  TOO_LONG: `닉네임은 ${NICKNAME_RULE.maxLength}자까지 쓸 수 있어요.`,
  INVALID_FORMAT: '한글/영문/숫자/밑줄(_)만 쓸 수 있어요.',
  RESERVED: '사용할 수 없는 닉네임이에요.',
  NICKNAME_TAKEN: '이미 사용 중인 닉네임이에요.',
  ALREADY_REGISTERED: '이미 등록된 프로필이에요.',
  INVALID_AVATAR: '이모지를 다시 선택해 주세요.',
  REMOTE_DISABLED: '지금은 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
  NETWORK_ERROR: '네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
  AUTH_RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
};

function reasonText(reason) {
  return REASON_TEXT[reason] || '등록에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

export default class RegisterModal {
  constructor(options = {}) {
    this.profile = options.profile || null;
    this.root = options.root || (typeof document !== 'undefined' ? document : null);
    this.onOpen = typeof options.onOpen === 'function' ? options.onOpen : null;
    this.onClose = typeof options.onClose === 'function' ? options.onClose : null;
    this.onRegistered = typeof options.onRegistered === 'function'
      ? options.onRegistered
      : null;

    this.opened = false;
    this.busy = false;
    this.nicknameAvailable = false;
    this.checkedNickname = '';
    this.selectedAvatar = 1;
    this.summary = null;
    this.handlers = [];

    this.overlay = this._byId('register-overlay');
    this.card = this._byId('register-card');
    this.input = this._byId('register-nickname');
    this.checkButton = this._byId('register-check');
    this.submitButton = this._byId('register-submit');
    this.status = this._byId('register-status');
    this.scoreLabel = this._byId('register-score');
    this.roundLabel = this._byId('register-round');
    this.avatarButtons = this._all('[data-avatar-id]');
    this.closeButtons = this._all('[data-register-close]');

    this._bind();
  }

  get isOpen() {
    return this.opened;
  }

  /**
   * @param {object} [summary] Game.getRunSummary() — 없으면 마지막 런 요약 사용
   */
  open(summary = null) {
    if (this.opened) return false;
    if (this.profile?.getSnapshot?.().isRegistered) return false;

    const snapshot = this.profile?.getSnapshot?.() || {};
    this.summary = summary || this.profile?.lastRunSummary || null;
    this.nicknameAvailable = false;
    this.checkedNickname = '';
    this.busy = false;
    this.selectedAvatar = isValidAvatarId(snapshot.avatarEmojiId)
      ? Number(snapshot.avatarEmojiId)
      : 1;

    if (this.input) this.input.value = snapshot.nickname || '';
    this._setStatus('', '');
    this._updateSummary(this.summary);
    this._renderAvatars();
    this._updateSubmit();

    this.opened = true;
    if (this.overlay) {
      this.overlay.hidden = false;
      this.overlay.removeAttribute?.('hidden');
      this.overlay.setAttribute?.('aria-hidden', 'false');
    }
    this.root?.body?.classList?.add?.('modal-visible');
    this.card?.focus?.();
    this.input?.focus?.();

    this.onOpen?.();
    return true;
  }

  /**
   * @param {{ dismiss?: boolean }} [options] dismiss=false 이면 스누즈하지 않는다(등록 성공)
   */
  close(options = {}) {
    if (!this.opened) return false;
    const dismiss = options.dismiss !== false;
    this.opened = false;

    if (this.overlay) {
      this.overlay.setAttribute?.('aria-hidden', 'true');
      this.overlay.hidden = true;
      this.overlay.setAttribute?.('hidden', '');
    }
    this.root?.body?.classList?.remove?.('modal-visible');
    this.onClose?.();

    if (dismiss && !this.profile?.getSnapshot?.().isRegistered) {
      this.profile?.dismissPrompt?.();
    }
    return true;
  }

  // ===== 내부 =====

  async _check() {
    if (this.busy || !this.profile) return false;

    const candidate = normalizeNickname(this.input?.value);
    const validated = validateNickname(candidate);
    this.nicknameAvailable = false;
    this.checkedNickname = '';
    this._setStatus('', '');
    this._updateSubmit();

    if (!validated.ok) {
      this._setStatus(reasonText(validated.reason), 'error');
      return false;
    }

    this._setBusy(true);
    try {
      const result = await this.profile.checkNickname(validated.value);
      this.nicknameAvailable = !!result?.available;
      this.checkedNickname = this.nicknameAvailable ? validated.value : '';
      this._setStatus(
        this.nicknameAvailable ? '사용 가능한 닉네임이에요!' : reasonText(result?.reason),
        this.nicknameAvailable ? 'ok' : 'error',
      );
    } catch (err) {
      this.nicknameAvailable = false;
      this.checkedNickname = '';
      this._setStatus(reasonText(err?.code), 'error');
    } finally {
      this._setBusy(false);
    }

    return this.nicknameAvailable;
  }

  async _submit() {
    if (this.busy || !this.profile) return;
    if (this.profile.getSnapshot?.().isRegistered) {
      this._setStatus(reasonText('ALREADY_REGISTERED'), 'error');
      return;
    }

    const candidate = normalizeNickname(this.input?.value);
    const changed = this.checkedNickname !== candidate;
    if (changed || !this.nicknameAvailable) {
      const ok = await this._check();
      if (!ok) return;
    }

    if (!isValidAvatarId(this.selectedAvatar)) {
      this._setStatus(reasonText('INVALID_AVATAR'), 'error');
      return;
    }

    this._setBusy(true);
    try {
      const snapshot = await this.profile.register(candidate, this.selectedAvatar);
      this._setStatus('등록 완료! 이제 리더보드에 기록돼요 🏆', 'ok');
      showToast(`${avatarEmoji(snapshot.avatarEmojiId)} ${snapshot.nickname} 등록 완료!`);
      this.close({ dismiss: false });
      this.onRegistered?.(snapshot);
    } catch (err) {
      if (err?.code === 'NICKNAME_TAKEN') {
        this.nicknameAvailable = false;
        this.checkedNickname = '';
      }
      this._setStatus(reasonText(err?.code), 'error');
    } finally {
      this._setBusy(false);
    }
  }

  _setBusy(busy) {
    this.busy = !!busy;
    if (this.checkButton) {
      this.checkButton.textContent = busy ? '확인 중...' : '중복 확인';
    }
    if (this.submitButton) {
      this.submitButton.textContent = busy ? '등록 중...' : '등록하기';
    }
    this._updateSubmit();
  }

  _updateSubmit() {
    if (!this.submitButton) return;
    const candidate = normalizeNickname(this.input?.value);
    const ready = this.nicknameAvailable
      && this.checkedNickname === candidate
      && isValidAvatarId(this.selectedAvatar)
      && !this.busy;
    this.submitButton.disabled = !ready;
  }

  _setStatus(text, tone) {
    if (!this.status) return;
    this.status.textContent = text || '';
    this.status.classList?.remove?.('is-ok');
    this.status.classList?.remove?.('is-error');
    if (tone === 'ok') this.status.classList?.add?.('is-ok');
    if (tone === 'error') this.status.classList?.add?.('is-error');
  }

  _updateSummary(summary) {
    if (this.scoreLabel) {
      this.scoreLabel.textContent = `${Math.max(0, Number(summary?.score) || 0).toLocaleString('ko-KR')}점`;
    }
    if (this.roundLabel) {
      this.roundLabel.textContent = `ROUND ${Math.max(1, Number(summary?.round) || 1)}`;
    }
  }

  _renderAvatars() {
    for (const button of this.avatarButtons) {
      const id = Number(button.getAttribute?.('data-avatar-id'));
      if (!isValidAvatarId(id)) continue;

      button.textContent = avatarEmoji(id);
      const selected = id === this.selectedAvatar;
      button.classList?.toggle?.('is-selected', selected);
      button.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
    }
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

    on(this.input, 'input', () => {
      this.nicknameAvailable = false;
      this.checkedNickname = '';
      this._setStatus('', '');
      this._updateSubmit();
    });

    on(this.checkButton, 'click', (event) => {
      event?.preventDefault?.();
      this._check();
    });

    on(this.submitButton, 'click', (event) => {
      event?.preventDefault?.();
      this._submit();
    });

    for (const button of this.avatarButtons) {
      on(button, 'click', (event) => {
        event?.preventDefault?.();
        const id = Number(button.getAttribute?.('data-avatar-id'));
        if (!isValidAvatarId(id)) return;
        this.selectedAvatar = id;
        this._renderAvatars();
        this._updateSubmit();
      });
    }

    for (const button of this.closeButtons) {
      on(button, 'click', (event) => {
        event?.preventDefault?.();
        this.close();
      });
    }

    on(this.root, 'keydown', (event) => {
      if (!this.opened) return;

      if (event?.code === 'Escape') {
        event.preventDefault?.();
        this.close();
        return;
      }

      // 입력 중 Enter → 중복 확인/등록 (버튼 클릭과 동일)
      if (event?.code === 'Enter' || event?.code === 'NumpadEnter') {
        event.preventDefault?.();
        this._submit();
      }
    });
  }

  destroy() {
    for (const { target, type, handler } of this.handlers) {
      target.removeEventListener?.(type, handler);
    }
    this.handlers = [];
    this.close({ dismiss: false });
  }
}
