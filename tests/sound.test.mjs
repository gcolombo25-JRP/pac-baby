/**
 * Pac-Baby: 효과음 모듈 단위 테스트
 *
 * Node 환경에는 AudioContext 가 없으므로 "예외 없이 무시되는지"와
 * 음향 on/off 상태만 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import SoundFX from '../src/sound.js';

test('음향은 기본적으로 켜져 있고 토글로 꺼진다', () => {
  const sound = new SoundFX();

  assert.equal(sound.enabled, true);
  assert.equal(sound.toggleMute(), false);
  assert.equal(sound.enabled, false);
  assert.equal(sound.toggleMute(), true);
  assert.equal(sound.enabled, true);
});

test('오디오 장치가 없어도 모든 재생 함수가 예외 없이 동작한다', () => {
  const sound = new SoundFX();

  assert.doesNotThrow(() => {
    sound.playStart();
    sound.playStep();
    sound.playCaught();
    sound.playSpeedChange();
    sound.playToggle();
    sound.playItem();
    sound.playFreeze();
    sound.playTrap();
    sound.playTrapHit();
    sound.playStealth();
    sound.playClear();
    sound.playGameOver();
    sound.startBgm();
    sound.updateBgm();
    sound.stopBgm();
    sound.unlock();
    sound.destroy();
  });

  // 꺼진 상태에서도 예외가 없어야 한다
  sound.toggleMute();
  assert.doesNotThrow(() => sound.playCaught());
});

/** 최소 Web Audio 스텁 */
class FakeAudioParam {
  constructor() { this.value = 1; this.calls = []; }
  setValueAtTime(value, time) { this.calls.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); }
}

class FakeNode {
  constructor() { this.connections = []; }
  connect(node) { this.connections.push(node); }
}

class FakeGain extends FakeNode {
  constructor() { super(); this.gain = new FakeAudioParam(); }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new FakeAudioParam();
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(time) { this.startedAt = time; }
  stop(time) { this.stoppedAt = time; }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.gains = [];
    this.oscillators = [];
  }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createOscillator() { const osc = new FakeOscillator(); this.oscillators.push(osc); return osc; }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

test('오디오 장치가 있으면 실제로 노드가 생성·재생된다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const sound = new SoundFX();
    sound.playCaught();

    assert.ok(sound.ctx instanceof FakeAudioContext, 'AudioContext 가 생성되어야 한다');
    assert.equal(sound.master.gain.value, 0.4, '마스터 볼륨이 설정되어야 한다');
    assert.ok(sound.ctx.gains.length >= 2, '마스터 + 개별 게인이 생성된다');
    assert.ok(sound.ctx.oscillators.length >= 1, '오실레이터가 생성된다');

    const osc = sound.ctx.oscillators[0];
    assert.ok(osc.startedAt !== null, '재생이 시작되어야 한다');
    assert.ok(osc.stoppedAt > osc.startedAt, '재생 종료가 예약되어야 한다');
    assert.equal(osc.connections.length, 1, '게인에 연결되어야 한다');
    assert.ok(
      osc.frequency.calls.some(c => c[0] === 'ramp'),
      '주파수 슬라이드가 예약되어야 한다',
    );
  } finally {
    delete globalThis.window;
  }
});

test('unlock 은 오디오를 준비하고 확인음을 재생한다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const sound = new SoundFX();
    sound.unlock();

    assert.ok(sound.ctx instanceof FakeAudioContext);
    assert.ok(sound.ctx.oscillators.length >= 1, '확인음이 재생되어야 한다');
  } finally {
    delete globalThis.window;
  }
});

test('unlock 은 8비트 BGM 을 시작하고 updateBgm 이 음을 예약한다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const sound = new SoundFX();
    sound.unlock();

    assert.equal(sound.bgmRunning, true, 'BGM 시작');

    const before = sound.ctx.oscillators.length;
    sound.updateBgm();
    assert.ok(sound.ctx.oscillators.length > before, 'BGM 음이 예약된다');

    sound.ctx.currentTime = 1;
    const beforeNext = sound.ctx.oscillators.length;
    sound.updateBgm();
    assert.ok(sound.ctx.oscillators.length > beforeNext, '시간이 지나면 다음 음도 예약된다');

    sound.toggleMute();
    assert.equal(sound.bgmRunning, false, '음향 OFF 시 BGM 정지');

    sound.toggleMute();
    assert.equal(sound.bgmRunning, true, '음향 ON 시 BGM 재개');

    sound.destroy();
    assert.equal(sound.bgmRunning, false, '정리 시 BGM 정지');
  } finally {
    delete globalThis.window;
  }
});

test('destroy 는 오디오 장치를 닫고 참조를 정리한다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const sound = new SoundFX();
    sound.playCaught();
    assert.ok(sound.ctx, '재생 후 컨텍스트가 있다');

    sound.destroy();
    assert.equal(sound.ctx, null);
    assert.equal(sound.master, null);

    // 정리 후 재생을 시도해도 예외가 없다
    assert.doesNotThrow(() => sound.playCaught());
  } finally {
    delete globalThis.window;
  }
});
