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
    sound.playUiClick();
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

test('슈가 러시 발자국은 일반 발자국보다 높고 짧은 소리를 낸다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const normal = new SoundFX();
    normal.playStep();

    const rush = new SoundFX();
    rush.playStep({ sugarRush: true });

    const normalOsc = normal.ctx.oscillators[0];
    const rushOsc = rush.ctx.oscillators[0];

    const normalFreq = normalOsc.frequency.calls[0][1];
    const rushFreq = rushOsc.frequency.calls[0][1];
    assert.ok(rushFreq > normalFreq, '슈가 러시 발자국은 더 높은 피치로 시작한다');

    assert.ok(rushFreq / normalFreq >= 1.35, `슈가 러시는 1.35배 이상 높다 (${rushFreq / normalFreq})`);

    const normalDuration = normalOsc.stoppedAt - normalOsc.startedAt;
    const rushDuration = rushOsc.stoppedAt - rushOsc.startedAt;
    assert.ok(rushDuration < normalDuration, '슈가 러시 발자국은 더 짧게 끝난다');

    // 황금 보행기(부스터) 상태도 별도로 전달되어 일반보다 확실히 높은 소리를 낸다
    const golden = new SoundFX();
    golden.playStep({ goldenWalker: true });
    const goldenFreq = golden.ctx.oscillators[0].frequency.calls[0][1];
    assert.ok(goldenFreq > normalFreq * 1.35, '보행기 발자국도 충분히 높다');
    assert.ok(goldenFreq < rushFreq, '슈가 러시가 가장 경쾌하다');
  } finally {
    delete globalThis.window;
  }
});

test('playUiClick 은 짧은 클릭음을 재생하고 연타는 제한한다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const sound = new SoundFX();

    sound.playUiClick();
    const firstCount = sound.ctx.oscillators.length;
    assert.ok(firstCount >= 1, '클릭음 오실레이터가 생성된다');
    assert.ok(
      sound.ctx.oscillators.every(osc => osc.stoppedAt - osc.startedAt <= 0.08),
      '클릭음은 80ms 이내로 매우 짧다',
    );

    // 30ms 이내 연타는 소리가 겹치지 않도록 무시된다
    sound.playUiClick();
    assert.equal(sound.ctx.oscillators.length, firstCount, '연타는 무시된다');

    // 간격이 지난 뒤에는 다시 재생된다
    sound._lastUiClickAt = 0;
    sound.playUiClick();
    assert.ok(sound.ctx.oscillators.length > firstCount, '간격이 지나면 다시 재생된다');
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

test('updateHeartbeat 는 위협이 없으면 조용하고, 가까우면 간격을 좁힌다', () => {
  const sound = new SoundFX();

  // 위협 없음 → 박동 없음
  assert.equal(sound.updateHeartbeat(0, 100), false);
  assert.equal(sound.heartbeatLevel, 0);

  // 첫 근접 → 즉시 한 번 박동
  assert.equal(sound.updateHeartbeat(1, 0), true);
  const nearInterval = sound.heartbeatTimer;
  assert.ok(nearInterval > 0);

  // 같은 간격 안에서는 다시 박동하지 않는다
  assert.equal(sound.updateHeartbeat(1, nearInterval - 1), false);
  assert.equal(sound.updateHeartbeat(1, 1), true);

  // 약한 위협은 더 느린 간격으로 박동한다
  sound.resetHeartbeat();
  assert.equal(sound.updateHeartbeat(0.2, 0), true);
  assert.ok(sound.heartbeatTimer > nearInterval, '약한 위협은 박동 간격이 더 길다');
});

test('playHeartbeat 는 오디오 장치가 없어도 예외 없이 무시된다', () => {
  const sound = new SoundFX();
  assert.doesNotThrow(() => sound.playHeartbeat(0.8));
});

test('playHeartbeat 는 두 박자 저음(쿵-덥)을 예약한다', () => {
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const sound = new SoundFX();
    sound.playHeartbeat(1);

    assert.equal(sound.ctx.oscillators.length, 2, '심장박동은 두 박자');
    const [first, second] = sound.ctx.oscillators;
    assert.ok(first.frequency.calls[0][1] < 200, '첫 박자는 저음');
    assert.ok(second.startedAt > first.startedAt, '두 번째 박자는 뒤에 온다');
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
