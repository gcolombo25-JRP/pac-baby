/**
 * Pac-Baby: 리더보드 모달 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import LeaderboardModal from '../src/leaderboardModal.js';

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
  };
}

function createElement(label) {
  const listeners = new Map();
  const attrs = {};
  const element = {
    label,
    hidden: false,
    textContent: '',
    innerHTML: '',
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
    click(event = {}) {
      const list = listeners.get('click') || [];
      return list.map(handler => handler({ preventDefault() {}, ...event }));
    },
  };
  return element;
}

function createDocument() {
  const overlay = createElement('overlay');
  overlay.hidden = true;
  const card = createElement('card');
  const body = createElement('body');
  const status = createElement('status');
  const cta = createElement('cta');
  cta.hidden = true;
  const openButtons = [createElement('badge'), createElement('help')];
  const closeButtons = [createElement('backdrop'), createElement('x'), createElement('close')];
  const elements = {
    'leaderboard-overlay': overlay,
    'leaderboard-card': card,
    'leaderboard-body': body,
    'leaderboard-status': status,
    'leaderboard-register': cta,
  };
  const rootListeners = new Map();

  return {
    bodyElement: body,
    overlay,
    card,
    body,
    status,
    cta,
    openButtons,
    closeButtons,
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) {
      if (selector === '[data-leaderboard-open]') return openButtons;
      if (selector === '[data-leaderboard-close]') return closeButtons;
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

function createProfile({ registered = false, result } = {}) {
  const profile = {
    snapshot: { isRegistered: registered },
    lastRunSummary: { score: 600, round: 2 },
    calls: 0,
    fetchResult: result || {
      rows: [
        { rank: 1, nickname: 'baby', avatar_emoji_id: 1, high_score: 1234, max_round: 3, country: 'KR', is_me: false },
        { rank: 2, nickname: 'me', avatar_emoji_id: 2, high_score: 900, max_round: 2, country: null, is_me: true },
      ],
      offline: false,
    },
    subscribe(listener) {
      listener(profile.snapshot);
      return () => {};
    },
    getSnapshot() { return { ...profile.snapshot }; },
    async fetchLeaderboard() {
      profile.calls += 1;
      return profile.fetchResult;
    },
  };
  return profile;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('리더보드를 열면 순위/이모지/국기/내 기록이 렌더링된다', async () => {
  const root = createDocument();
  const profile = createProfile();
  const modal = new LeaderboardModal({ profile, root });

  assert.equal(modal.open(), true);
  assert.equal(root.overlay.hidden, false);
  await flush();

  assert.equal(profile.calls, 1);
  assert.match(root.body.innerHTML, /baby/);
  assert.match(root.body.innerHTML, /1,234/);
  assert.match(root.body.innerHTML, /R3/);
  assert.match(root.body.innerHTML, /🇰🇷/);
  assert.match(root.body.innerHTML, /is-me/);
  assert.equal(root.cta.hidden, false, '게스트에게는 등록 CTA 노출');
});

test('등록 유저에게는 등록 CTA 를 숨긴다', async () => {
  const root = createDocument();
  const profile = createProfile({ registered: true });
  const modal = new LeaderboardModal({ profile, root });

  modal.open();
  await flush();
  assert.equal(root.cta.hidden, true);
});

test('배경/닫기 버튼과 Escape 로 닫을 수 있다', async () => {
  const root = createDocument();
  const profile = createProfile();
  const modal = new LeaderboardModal({ profile, root });

  root.openButtons[0].click();
  await flush();
  assert.equal(modal.isOpen, true);

  root.closeButtons[2].click();
  assert.equal(modal.isOpen, false);
  assert.equal(root.overlay.hidden, true);

  root.openButtons[1].click();
  await flush();
  root.dispatch('keydown', { code: 'Escape' });
  assert.equal(modal.isOpen, false);
});

test('오프라인/빈 목록 상태 메시지를 보여 준다', async () => {
  const root = createDocument();
  const profile = createProfile({
    result: { rows: [], offline: true, cached: true },
  });
  const modal = new LeaderboardModal({ profile, root });

  modal.open();
  await flush();

  assert.match(root.status.textContent, /오프라인/);
  assert.equal(root.body.innerHTML, '');
});

test('최근 제출이 반영되지 않았으면 이유를 상태 줄에 표시한다', async () => {
  const root = createDocument();
  const profile = createProfile();
  profile.snapshot.lastSubmission = {
    accepted: false,
    reason: 'NETWORK_ERROR',
    score: 600,
    round: 2,
    at: 1,
  };
  const modal = new LeaderboardModal({ profile, root });

  modal.open();
  await flush();

  assert.match(root.status.textContent, /반영되지 않았어요/);
  assert.match(root.status.textContent, /네트워크 연결 오류/);
  assert.match(root.status.textContent, /600/);
  assert.ok(root.status.classList.contains('is-error'));
});

test('반영된 기록/어시스트/로컬 모드는 제출 실패 경고를 띄우지 않는다', async () => {
  const acceptedRoot = createDocument();
  const acceptedProfile = createProfile();
  acceptedProfile.snapshot.lastSubmission = {
    accepted: true,
    reason: 'ACCEPTED',
    score: 600,
    round: 2,
    at: 1,
  };
  const acceptedModal = new LeaderboardModal({ profile: acceptedProfile, root: acceptedRoot });
  acceptedModal.open();
  await flush();
  assert.equal(acceptedRoot.status.textContent, '');

  const assistedRoot = createDocument();
  const assistedProfile = createProfile();
  assistedProfile.snapshot.lastSubmission = {
    accepted: false,
    reason: 'ASSISTED_RUN',
    score: 600,
    round: 2,
    at: 1,
  };
  const assistedModal = new LeaderboardModal({ profile: assistedProfile, root: assistedRoot });
  assistedModal.open();
  await flush();
  assert.equal(assistedRoot.status.textContent, '');

  const localRoot = createDocument();
  const localProfile = createProfile();
  localProfile.snapshot.remote = false;
  localProfile.snapshot.lastSubmission = {
    accepted: false,
    reason: 'REMOTE_DISABLED',
    score: 600,
    round: 2,
    at: 1,
  };
  const localModal = new LeaderboardModal({ profile: localProfile, root: localRoot });
  localModal.open();
  await flush();
  assert.equal(localRoot.status.textContent, '');
});

