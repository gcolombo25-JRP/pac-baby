/**
 * Pac-Baby: 기록 등록 모달 테스트 (최소 DOM 스텁)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import RegisterModal from '../src/registerModal.js';

function createClassList() {
  const set = new Set();
  return {
    add: name => set.add(name),
    remove: name => set.delete(name),
    contains: name => set.has(name),
    toggle: (name, force) => {
      const on = force === undefined ? !set.has(name) : !!force;
      if (on) set.add(name); else set.delete(name);
      return on;
    },
    values: () => [...set],
  };
}

function createElement(label, attributes = {}) {
  const listeners = new Map();
  const attrs = { ...attributes };

  const element = {
    label,
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    focused: false,
    classList: createClassList(),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    setAttribute(name, value) {
      if (value === null || value === undefined) delete attrs[name];
      else attrs[name] = String(value);
    },
    removeAttribute(name) { delete attrs[name]; },
    getAttribute(name) { return attrs[name] ?? null; },
    focus() { element.focused = true; },
    dispatch(type, event = {}) {
      const list = listeners.get(type) || [];
      return list.map(handler => handler({ preventDefault() {}, ...event }));
    },
    click(event = {}) { return element.dispatch('click', event); },
  };

  return element;
}

function createDocument() {
  const overlay = createElement('overlay');
  overlay.hidden = true;

  const card = createElement('card');
  const input = createElement('input');
  const check = createElement('check');
  const submit = createElement('submit');
  submit.disabled = true;
  const status = createElement('status');
  const score = createElement('score');
  const round = createElement('round');
  const body = createElement('body');

  const avatars = Array.from({ length: 12 }, (_, index) => createElement(
    `avatar${index + 1}`,
    { 'data-avatar-id': String(index + 1) },
  ));
  const closeButtons = [createElement('backdrop'), createElement('close'), createElement('later')];

  const elements = {
    'register-overlay': overlay,
    'register-card': card,
    'register-nickname': input,
    'register-check': check,
    'register-submit': submit,
    'register-status': status,
    'register-score': score,
    'register-round': round,
  };

  const rootListeners = new Map();

  return {
    body,
    overlay,
    card,
    input,
    check,
    submit,
    status,
    score,
    round,
    avatars,
    closeButtons,
    getElementById(id) { return elements[id] || null; },
    querySelector(selector) { return selector === '#register-card' ? card : null; },
    querySelectorAll(selector) {
      if (selector === '[data-avatar-id]') return avatars;
      if (selector === '[data-register-close]') return closeButtons;
      return [];
    },
    addEventListener(type, handler) {
      if (!rootListeners.has(type)) rootListeners.set(type, []);
      rootListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = rootListeners.get(type) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event = {}) {
      const list = rootListeners.get(type) || [];
      return list.map(handler => handler({ preventDefault() {}, ...event }));
    },
  };
}

function createProfile(snapshot = {}) {
  const profile = {
    snapshot: {
      isRegistered: false,
      nickname: null,
      avatarEmojiId: 1,
      ...snapshot,
    },
    lastRunSummary: { score: 520, round: 2 },
    dismissCalls: 0,
    registerCalls: [],
    getSnapshot() { return { ...profile.snapshot }; },
    dismissPrompt() { profile.dismissCalls += 1; },
    async checkNickname(name) {
      if (name === 'taken') return { available: false, reason: 'NICKNAME_TAKEN' };
      return { available: true, reason: 'OK' };
    },
    async register(name, avatar) {
      profile.registerCalls.push([name, avatar]);
      profile.snapshot = {
        ...profile.snapshot,
        isRegistered: true,
        nickname: name,
        avatarEmojiId: avatar,
      };
      return profile.getSnapshot();
    },
  };
  return profile;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('조건 충족 시 모달을 열고 이번 기록/선택 이모지를 보여 준다', () => {
  const root = createDocument();
  const profile = createProfile();
  const modal = new RegisterModal({ profile, root });

  assert.equal(modal.open(), true);
  assert.equal(modal.isOpen, true);
  assert.equal(root.overlay.hidden, false);
  assert.equal(root.score.textContent, '520점');
  assert.equal(root.round.textContent, 'ROUND 2');
  assert.equal(root.submit.disabled, true, '중복 확인 전에는 등록 불가');
  assert.equal(root.avatars[0].getAttribute('aria-pressed'), 'true');
  assert.match(root.avatars[0].innerHTML, /^<svg class="ui-icon ui-avatar"/);
  assert.match(root.avatars[11].innerHTML, /^<svg class="ui-icon ui-avatar"/);
  assert.equal(root.avatars[0].classList.contains('is-selected'), true);
});

test('아바타 선택 버튼은 OS 이모지 대신 1~12 SVG 아바타로 렌더링된다', () => {
  const root = createDocument();
  const modal = new RegisterModal({ profile: createProfile(), root });
  modal.open();

  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  assert.equal(root.avatars.length, 12);
  for (const button of root.avatars) {
    assert.match(button.innerHTML, /^<svg class="ui-icon ui-avatar"/);
    assert.doesNotMatch(button.innerHTML, emojiRe);
    assert.match(button.getAttribute('aria-label'), /./, '아바타 이름이 접근성 라벨로 들어간다');
  }

  assert.equal(root.avatars[7].getAttribute('aria-pressed'), 'false');
  root.avatars[7].click(); // id 8
  assert.equal(modal.selectedAvatar, 8);
  assert.equal(root.avatars[0].getAttribute('aria-pressed'), 'false');
  assert.equal(root.avatars[7].getAttribute('aria-pressed'), 'true');
  assert.equal(root.avatars[7].classList.contains('is-selected'), true);
  assert.equal(root.avatars[0].classList.contains('is-selected'), false);
});

test('이미 등록된 유저에게는 모달을 열지 않는다', () => {
  const root = createDocument();
  const profile = createProfile({ isRegistered: true, nickname: 'baby' });
  const modal = new RegisterModal({ profile, root });

  assert.equal(modal.open(), false);
  assert.equal(modal.isOpen, false);
  assert.equal(root.overlay.hidden, true);
});

test('중복 확인 결과에 따라 등록 버튼이 활성화된다', async () => {
  const root = createDocument();
  const profile = createProfile();
  const modal = new RegisterModal({ profile, root });
  modal.open();

  root.input.value = 'taken';
  root.check.click();
  await flush();

  assert.equal(modal.nicknameAvailable, false);
  assert.match(root.status.textContent, /이미 사용 중/);
  assert.equal(root.submit.disabled, true);

  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();

  assert.equal(modal.nicknameAvailable, true);
  assert.match(root.status.textContent, /사용 가능/);
  assert.equal(root.submit.disabled, false);
});

test('등록하면 선택한 이모지와 닉네임으로 저장하고 모달을 닫는다', async () => {
  const root = createDocument();
  const profile = createProfile();
  const registered = [];
  let opened = 0;
  let closed = 0;
  const modal = new RegisterModal({
    profile,
    root,
    onOpen: () => { opened += 1; },
    onClose: () => { closed += 1; },
    onRegistered: snapshot => registered.push(snapshot),
  });
  modal.open();
  assert.equal(opened, 1);

  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();

  root.avatars[2].click(); // id 3
  root.submit.click();
  await flush();
  await flush();

  assert.deepEqual(profile.registerCalls[0], ['baby', 3]);
  assert.equal(modal.isOpen, false);
  assert.equal(closed, 1);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].nickname, 'baby');
  assert.equal(profile.dismissCalls, 0, '등록 성공은 스누즈하지 않는다');
});

test('"나중에" / Escape 로 닫으면 다음 안내를 잠시 미룬다', () => {
  const root = createDocument();
  const profile = createProfile();
  const modal = new RegisterModal({ profile, root });

  modal.open();
  root.closeButtons[2].click();
  assert.equal(modal.isOpen, false);
  assert.equal(profile.dismissCalls, 1);

  modal.open();
  root.dispatch('keydown', { code: 'Escape' });
  assert.equal(modal.isOpen, false);
  assert.equal(profile.dismissCalls, 2);
});

test('중복 확인 중에는 확인 버튼만 "확인 중..."으로 잠기고, 닫으면 늦은 응답을 무시한다', async () => {
  const root = createDocument();
  const profile = createProfile();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  profile.checkNickname = async () => {
    await gate;
    return { available: true, reason: 'OK' };
  };

  const modal = new RegisterModal({ profile, root });
  modal.open();
  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();

  assert.equal(modal.busy, true);
  assert.equal(root.check.disabled, true, '확인 중에는 확인 버튼이 잠긴다');
  assert.equal(root.check.textContent, '확인 중...');
  assert.equal(root.submit.textContent, '등록하기', '등록 버튼 문구는 유지된다');
  assert.equal(root.submit.disabled, true);

  modal.close({ dismiss: false });
  assert.equal(modal.busy, false, '닫으면 busy 가 풀린다');
  assert.equal(root.check.disabled, false);
  assert.equal(root.check.textContent, '중복 확인');

  release();
  await flush();

  assert.equal(modal.nicknameAvailable, false, '닫힌 뒤 늦은 응답은 무시된다');
  assert.equal(root.status.textContent, '', '닫힌 뒤 상태 문구를 덮어쓰지 않는다');
  assert.equal(modal.busy, false, 'busy 가 영구 고정되지 않는다');
});

test('등록 중에는 등록 버튼만 "등록 중..."으로 잠기고 완료 후 busy 가 풀린다', async () => {
  const root = createDocument();
  const profile = createProfile();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const register = profile.register;
  profile.register = async (name, avatar) => {
    await gate;
    return register(name, avatar);
  };

  const modal = new RegisterModal({ profile, root });
  modal.open();
  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();
  assert.equal(root.submit.disabled, false);

  root.submit.click();
  await flush();

  assert.equal(modal.busy, true);
  assert.equal(root.submit.textContent, '등록 중...');
  assert.equal(root.submit.disabled, true);
  assert.equal(root.check.textContent, '중복 확인', '확인 버튼 문구는 유지된다');
  assert.equal(root.check.disabled, true);

  release();
  await flush();
  await flush();

  assert.equal(modal.isOpen, false);
  assert.equal(modal.busy, false);
  assert.equal(root.submit.textContent, '등록하기');
  assert.equal(root.check.textContent, '중복 확인');
  assert.deepEqual(profile.registerCalls[0], ['baby', 1]);
});

test('TIMEOUT 오류는 한글 안내 문구로 표시하고 busy 를 해제한다', async () => {
  const root = createDocument();
  const profile = createProfile();
  profile.checkNickname = async () => {
    const error = new Error('timeout');
    error.code = 'TIMEOUT';
    throw error;
  };

  const modal = new RegisterModal({ profile, root });
  modal.open();
  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();

  assert.match(root.status.textContent, /서버 응답이 늦어지고/);
  assert.equal(modal.busy, false);
  assert.equal(root.check.disabled, false);
  assert.equal(root.check.textContent, '중복 확인');
});

test('원격 초기화가 실패한 상태면 중복 확인 전에 force 재초기화를 1회 시도한다', async () => {
  const root = createDocument();
  const profile = createProfile();
  profile.isRemote = false;
  const initCalls = [];
  profile.init = async (options = {}) => {
    initCalls.push(options);
    profile.isRemote = true;
    return profile.getSnapshot();
  };

  const modal = new RegisterModal({ profile, root });
  modal.open();
  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();

  assert.deepEqual(initCalls, [{ force: true }]);
  assert.equal(modal.nicknameAvailable, true);
  assert.match(root.status.textContent, /사용 가능/);
});

test('재초기화도 실패하면 연결 안내 문구를 보여 주고 busy 를 해제한다', async () => {
  const root = createDocument();
  const profile = createProfile();
  profile.isRemote = false;
  let initCalls = 0;
  profile.init = async () => {
    initCalls += 1;
    return profile.getSnapshot();
  };
  profile.checkNickname = async () => ({ available: false, reason: 'REMOTE_DISABLED' });

  const modal = new RegisterModal({ profile, root });
  modal.open();
  root.input.value = 'baby';
  root.input.dispatch('input');
  root.check.click();
  await flush();

  assert.equal(initCalls, 1, '재시도는 1회만 한다');
  assert.match(root.status.textContent, /서버에 연결할 수 없어요/);
  assert.equal(modal.busy, false);
});

test('등록 직전 원격이 아니면 force 재초기화 후 등록을 진행한다', async () => {
  const root = createDocument();
  const profile = createProfile();
  const initCalls = [];
  profile.init = async (options = {}) => {
    initCalls.push(options);
    profile.isRemote = true;
    return profile.getSnapshot();
  };

  const modal = new RegisterModal({ profile, root });
  modal.open();
  root.input.value = 'baby';
  modal.nicknameAvailable = true;
  modal.checkedNickname = 'baby';
  profile.isRemote = false;

  root.submit.click();
  await flush();
  await flush();

  assert.deepEqual(initCalls, [{ force: true }]);
  assert.deepEqual(profile.registerCalls[0], ['baby', 1]);
  assert.equal(modal.isOpen, false);
});
