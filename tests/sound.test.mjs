/**
 * Pac-Baby: 효과음 모듈 단위 테스트
 *
 * Node 환경에는 AudioContext 가 없으므로 "예외 없이 무시되는지"와
 * 음향 on/off 상태만 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import SoundFX, { stereoPanFromTiles, SFX_MODES } from '../src/sound.js';
import { SOUND_MANIFEST, SOUND_KEYS } from '../src/soundManifest.js';
import Game from '../src/game.js';
import InputManager from '../src/input.js';

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

/** 마스터 버스/패닝까지 지원하는 확장 Web Audio 스텁 */
class RichAudioParam {
  constructor(value = 0) { this.value = value; this.calls = []; }
  setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); }
}

class RichNode {
  constructor() { this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
}

class RichGain extends RichNode {
  constructor() { super(); this.gain = new RichAudioParam(1); }
}

class RichOscillator extends RichNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new RichAudioParam(440);
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(time) { this.startedAt = time; }
  stop(time) { this.stoppedAt = time; }
}

class RichCompressor extends RichNode {
  constructor() {
    super();
    this.threshold = new RichAudioParam(-24);
    this.knee = new RichAudioParam(30);
    this.ratio = new RichAudioParam(12);
    this.attack = new RichAudioParam(0.003);
    this.release = new RichAudioParam(0.25);
  }
}

class RichFilter extends RichNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new RichAudioParam(350);
    this.Q = new RichAudioParam(1);
  }
}

class RichDelay extends RichNode {
  constructor() { super(); this.delayTime = new RichAudioParam(0); }
}

class RichPanner extends RichNode {
  constructor() { super(); this.pan = new RichAudioParam(0); }
}

class RichAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = new RichNode();
    this.gains = [];
    this.oscillators = [];
    this.compressors = [];
    this.filters = [];
    this.delays = [];
    this.panners = [];
  }
  createGain() { const node = new RichGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new RichOscillator(); this.oscillators.push(node); return node; }
  createDynamicsCompressor() { const node = new RichCompressor(); this.compressors.push(node); return node; }
  createBiquadFilter() { const node = new RichFilter(); this.filters.push(node); return node; }
  createDelay() { const node = new RichDelay(); this.delays.push(node); return node; }
  createStereoPanner() { const node = new RichPanner(); this.panners.push(node); return node; }
  resume() { return Promise.resolve(); }
}

test('stereoPanFromTiles 는 X 차이를 -0.8 ~ +0.8 패닝으로 변환한다', () => {
  assert.equal(stereoPanFromTiles(0), 0);
  assert.ok(stereoPanFromTiles(4) > 0, '오른쪽은 +');
  assert.equal(stereoPanFromTiles(100), 0.8, '최대 +0.8 로 제한');
  assert.equal(stereoPanFromTiles(-100), -0.8, '최대 -0.8 로 제한');
  assert.equal(stereoPanFromTiles(Number.NaN), 0, '잘못된 값은 중앙');
});

test('마스터 버스는 컴프레서 → 로우패스 → 슬랩백 딜레이로 연결된다', () => {
  globalThis.window = { AudioContext: RichAudioContext };

  try {
    const sound = new SoundFX();
    sound.playItem();

    assert.equal(sound.master.gain.value, 0.4, '마스터 볼륨 유지');
    assert.equal(sound.ctx.compressors.length, 1, '클리핑 방지 컴프레서');
    assert.equal(sound.ctx.filters.length, 1, '톤 로우패스 필터');
    assert.equal(sound.ctx.delays.length, 1, '슬랩백 딜레이');

    const [comp] = sound.ctx.compressors;
    const [filter] = sound.ctx.filters;
    const [delay] = sound.ctx.delays;

    assert.equal(filter.type, 'lowpass');
    assert.ok(
      filter.frequency.value >= 4200 && filter.frequency.value <= 5000,
      `로우패스는 4200~5000Hz (${filter.frequency.value})`,
    );
    assert.ok(
      delay.delayTime.value >= 0.045 && delay.delayTime.value <= 0.065,
      `슬랩백은 45~65ms (${delay.delayTime.value})`,
    );

    assert.equal(sound.master.connections[0], comp, 'master → 컴프레서');
    assert.ok(comp.connections.includes(filter), '컴프레서 → 필터');
    assert.ok(filter.connections.includes(sound.ctx.destination), '드라이 경로 유지');
    assert.ok(filter.connections.includes(delay), '에코 샌드');

    const { wet, feedback } = sound._echo;
    assert.ok(feedback.gain.value > 0 && feedback.gain.value <= 0.3, '낮은 피드백');
    assert.ok(delay.connections.includes(feedback));
    assert.ok(feedback.connections.includes(delay), '피드백 루프');
    assert.equal(wet.connections[0], sound.ctx.destination, '젖은 소리 → 출력');
  } finally {
    delete globalThis.window;
  }
});


test('아이템/파워업/BGM 은 삼각파·사인파 레이어만 사용한다', () => {
  globalThis.window = { AudioContext: RichAudioContext };

  try {
    const isWarm = osc => osc.type === 'triangle' || osc.type === 'sine';

    const item = new SoundFX();
    item.playItem();
    assert.ok(item.ctx.oscillators.length >= 3, '아이템: 여러 겹 레이어');
    assert.ok(item.ctx.oscillators.every(isWarm), '아이템: 쨍한 사각파 없음');

    const sugar = new SoundFX();
    sugar.playSugarRush();
    assert.ok(sugar.ctx.oscillators.length >= 3);
    assert.ok(sugar.ctx.oscillators.every(isWarm), '슈가 러시: 삼각+사인');

    const golden = new SoundFX();
    golden.playGolden();
    assert.ok(golden.ctx.oscillators.length >= 3);
    assert.ok(golden.ctx.oscillators.every(isWarm), '황금 젖병: 삼각+사인');

    const bgm = new SoundFX();
    bgm.startBgm();
    bgm.updateBgm();
    assert.ok(bgm.ctx.oscillators.length > 0, 'BGM 음이 예약된다');
    assert.ok(bgm.ctx.oscillators.every(isWarm), 'BGM 멜로디: 삼각+사인');
  } finally {
    delete globalThis.window;
  }
});

test('트랩 적중음과 심장박동은 보모 방향으로 패닝된다', () => {
  globalThis.window = { AudioContext: RichAudioContext };

  try {
    const trap = new SoundFX();
    trap.playTrapHit(0.8);
    assert.equal(trap.ctx.panners.length, 2, '두 겹 타격음 모두 패닝');
    assert.ok(trap.ctx.panners.every(p => Math.abs(p.pan.value - 0.8) < 1e-6));

    const center = new SoundFX();
    center.playTrapHit();
    assert.equal(center.ctx.panners.length, 0, '중앙(pan 0)은 모노로 재생');

    const heart = new SoundFX();
    assert.equal(heart.updateHeartbeat(1, 0, -0.8), true);
    assert.equal(heart.heartbeatPan, -0.8);
    assert.equal(heart.ctx.panners.length, 2, '쿵-덥 두 박자 모두 패닝');
    assert.ok(heart.ctx.panners.every(p => Math.abs(p.pan.value + 0.8) < 1e-6));

    heart.resetHeartbeat();
    assert.equal(heart.heartbeatPan, 0, '초기화하면 중앙');
  } finally {
    delete globalThis.window;
  }
});

/** 노이즈 버퍼까지 지원하는 스텁 — 먹는/싸는 소리의 필터·노이즈 노드를 확인한다 */
class FxBufferSource extends RichNode {
  constructor() {
    super();
    this.buffer = null;
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(time) { this.startedAt = time; }
  stop(time) { this.stoppedAt = time; }
}

class FxAudioContext extends RichAudioContext {
  constructor() {
    super();
    this.bufferSources = [];
  }
  createBuffer(channels, length, rate) {
    return { sampleRate: rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const node = new FxBufferSource();
    this.bufferSources.push(node);
    return node;
  }
}

test('playItem 은 아이템 종류별 코믹한 먹는 소리를 합성한다', () => {
  globalThis.window = { AudioContext: FxAudioContext };

  try {
    const isWarm = osc => osc.type === 'triangle' || osc.type === 'sine';

    // 인자가 없으면 기존 기본 소리로 폴백한다 (삼각+사인 3겹)
    const fallback = new SoundFX();
    fallback.playItem();
    assert.ok(fallback.ctx.oscillators.length >= 3, '기본: 여러 겹 레이어');
    assert.ok(fallback.ctx.oscillators.every(isWarm), '기본: 삼각파·사인파만');

    for (const type of ['MILK', 'CANDY', 'COOKIE']) {
      const sound = new SoundFX();
      assert.doesNotThrow(() => sound.playItem(type), `${type} 먹는 소리는 예외가 없다`);
      assert.ok(sound.ctx.oscillators.length >= 2, `${type}: 오실레이터가 생성된다`);
      assert.ok(sound.ctx.oscillators.every(isWarm), `${type}: 삼각파·사인파만 사용한다`);
      assert.ok(sound.ctx.filters.length > 1, `${type}: 먹는 소리 전용 필터를 쓴다`);
      assert.ok(sound.ctx.bufferSources.length >= 1, `${type}: 필터링된 노이즈 레이어가 있다`);
      assert.ok(
        sound.ctx.bufferSources.every(src => src.startedAt !== null),
        `${type}: 노이즈도 재생이 시작된다`,
      );
    }

    // 우유: 420→920Hz 뽀글 3연타(사인 3 + 삼각 3) — 좁은 밴드패스 없이 밝게
    const milk = new SoundFX();
    milk.playItem('MILK');
    assert.equal(milk.ctx.oscillators.length, 6, '우유: 뽀글 3연타(2겹)');
    assert.ok(
      milk.ctx.oscillators.every(osc => {
        const start = osc.frequency.calls[0][1];
        const ramp = osc.frequency.calls.find(c => c[0] === 'ramp');
        const netDuration = osc.stoppedAt - osc.startedAt - 0.03;
        return start >= 400 && start <= 500
          && ramp && ramp[1] >= 850 && ramp[1] <= 960
          && netDuration >= 0.06 && netDuration <= 0.1;
      }),
      '우유: 420 → 920Hz 대역에서 75~90ms 로 통통 튄다',
    );
    assert.ok(
      milk.ctx.oscillators.some(osc => osc.type === 'triangle'),
      '우유: 삼각파 몸통 레이어',
    );
    assert.ok(
      milk.ctx.filters.every(f => f.type !== 'bandpass' || f.Q.value <= 1),
      '우유: 좁은 밴드패스로 소리를 죽이지 않는다',
    );

    // 사탕: 상승 사인 팝 + 고주파 노이즈 스냅
    const candy = new SoundFX();
    candy.playItem('CANDY');
    const candyPop = candy.ctx.oscillators[0];
    assert.equal(candyPop.type, 'sine');
    assert.ok(candyPop.frequency.calls.some(c => c[0] === 'ramp' && c[1] >= 1100), '사탕: 상승 팝');
    assert.ok(
      candy.ctx.filters.some(f => f.type === 'bandpass' && f.frequency.value >= 4000),
      '사탕: 아작! 고주파 스냅',
    );

    // 쿠키: 900~2800Hz 넓은 바삭 노이즈 3타(60~75ms) + 550/780/640Hz 삼각파 타격
    const cookie = new SoundFX();
    cookie.playItem('COOKIE');
    assert.deepEqual(
      cookie.ctx.oscillators.map(osc => osc.frequency.calls[0][1]),
      [550, 780, 640],
      '쿠키: 550/780/640Hz 삼각파 타격',
    );
    assert.ok(
      cookie.ctx.oscillators.every(osc => osc.type === 'triangle'),
      '쿠키: 타격음은 삼각파',
    );
    const crunches = cookie.ctx.filters.filter(f => f.type === 'bandpass');
    assert.equal(crunches.length, 3, '쿠키: 바삭 노이즈 3타');
    assert.ok(
      crunches.every(f => f.frequency.value >= 900 && f.frequency.value <= 2800),
      '쿠키: 900~2800Hz 넓은 중역대',
    );
    assert.ok(
      crunches.every(f => f.Q.value > 0 && f.Q.value <= 1),
      '쿠키: 넓은 밴드(Q≈0.7)로 에너지를 살린다',
    );
    const crunchDurations = cookie.ctx.bufferSources.map(src => src.stoppedAt - src.startedAt - 0.02);
    assert.ok(
      crunchDurations.every(d => d >= 0.055 && d <= 0.08),
      '쿠키: 한 타 60~75ms',
    );
    const crunchStarts = crunches.map(f => f.frequency.calls[0][2]);
    for (let i = 1; i < crunchStarts.length; i++) {
      const gap = crunchStarts[i] - crunchStarts[i - 1];
      assert.ok(gap >= 0.06 && gap <= 0.1, `쿠키: 어긋난 3연타 간격 (${gap})`);
    }
  } finally {
    delete globalThis.window;
  }
});

test('playPacifier 는 침대 스텔스음과 구분되는 쪽쪽이 빠는 소리를 낸다', () => {
  globalThis.window = { AudioContext: FxAudioContext };

  try {
    const isWarm = osc => osc.type === 'triangle' || osc.type === 'sine';

    const sound = new SoundFX();
    assert.doesNotThrow(() => sound.playPacifier());
    assert.ok(sound.ctx.oscillators.length >= 3, '쪽! 3연타');
    assert.ok(sound.ctx.oscillators.every(isWarm), '쪽쪽이: 삼각파·사인파만 사용한다');
    assert.ok(sound.ctx.bufferSources.length >= 3, '빨아들이는 공기 노이즈가 있다');

    // 상승 사인 "쪽!" — 480Hz 부근에서 1220Hz 부근으로 시원하게 미끄러진다
    const glides = sound.ctx.oscillators
      .filter(osc => osc.type === 'sine')
      .map(osc => ({
        start: osc.frequency.calls[0][1],
        ramp: osc.frequency.calls.find(c => c[0] === 'ramp'),
        startedAt: osc.startedAt,
        duration: osc.stoppedAt - osc.startedAt - 0.03,
      }));
    assert.equal(glides.length, 3, '쪽! 사인 글라이드 3연타');
    assert.ok(
      glides.every(item => item.start >= 460 && item.start <= 520
        && item.ramp && item.ramp[1] >= 1180 && item.ramp[1] <= 1300
        && item.duration >= 0.07 && item.duration <= 0.095),
      '쪽쪽이: 480 → 1220Hz 상승 사인 75~90ms',
    );
    assert.ok(
      sound.ctx.oscillators.some(osc => osc.type === 'triangle'),
      '쪽쪽이: 삼각 배음 레이어',
    );
    // 0.15초 간격으로 연달아 난다
    const starts = glides.map(item => item.startedAt).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      assert.ok(gap >= 0.13 && gap <= 0.17, `쪽쪽이: ~0.15초 간격 (${gap})`);
    }

    // playItem('PACIFIER') 로도 같은 소리에 연결된다
    const viaItem = new SoundFX();
    viaItem.playItem('PACIFIER');
    assert.ok(viaItem.ctx.oscillators.length >= 3, "playItem('PACIFIER') 위임");
    assert.ok(viaItem.ctx.oscillators.every(isWarm));

    // 침대 스텔스(하강 톤)와 출발 피치가 달라 소리가 구분된다
    const stealth = new SoundFX();
    stealth.playStealth();
    const stealthStart = stealth.ctx.oscillators[0].frequency.calls[0][1];
    assert.ok(
      glides[0].start < stealthStart,
      `쪽쪽이(${glides[0].start}Hz)는 스텔스(${stealthStart}Hz)보다 낮게 시작`,
    );
  } finally {
    delete globalThis.window;
  }
});

test('playTrap 은 트랩 종류별 싸는 소리를 합성한다', () => {
  globalThis.window = { AudioContext: FxAudioContext };

  try {
    // 인자가 없으면 기존 기본 배출음으로 폴백한다
    const fallback = new SoundFX();
    fallback.playTrap();
    assert.equal(fallback.ctx.oscillators.length, 1, '기본: 짧은 하강 사인 1개');
    assert.equal(fallback.ctx.oscillators[0].type, 'sine');

    // 오줌: 520→1400Hz 맑은 물방울 6연타(55~75ms) + 부드러운 물줄기 노이즈
    const pee = new SoundFX();
    assert.doesNotThrow(() => pee.playTrap('PEE'));
    assert.ok(pee.ctx.oscillators.length >= 6, '오줌: 물방울 6연타');
    assert.ok(
      pee.ctx.oscillators.every(osc => {
        const start = osc.frequency.calls[0][1];
        const ramp = osc.frequency.calls.find(c => c[0] === 'ramp');
        const duration = osc.stoppedAt - osc.startedAt - 0.03;
        return start >= 500 && start <= 660
          && ramp && ramp[1] >= 1300 && ramp[1] <= 1420
          && duration >= 0.05 && duration <= 0.08;
      }),
      '오줌: 520~640Hz 에서 1400Hz 로 솟는 55~75ms 물방울',
    );
    assert.ok(pee.ctx.bufferSources.length >= 1, '오줌: 물줄기 노이즈');

    // 토사물: 380→145Hz 삼각+사인 하강 + 빠른 LFO + 넓은 로우패스(1400→450Hz)
    const vomit = new SoundFX();
    assert.doesNotThrow(() => vomit.playTrap('VOMIT'));
    assert.equal(vomit.ctx.oscillators.length, 2, '토사물: 두 겹 저중역');
    const vomitLead = vomit.ctx.oscillators[0];
    assert.ok(vomitLead.frequency.calls[0][1] >= 360
      && vomitLead.frequency.calls[0][1] <= 400, '토사물: 380Hz 부근에서 시작');
    assert.ok(
      vomitLead.frequency.calls.some(c => c[0] === 'ramp' && c[1] <= 155),
      '토사물: 145Hz 까지 축 처지는 글라이드',
    );
    assert.ok(vomitLead.frequency.calls.length > 5, '토사물: 빠른 LFO 떨림');
    const vomitFilters = vomit.ctx.filters.filter(
      f => f.type === 'lowpass' && f.frequency.calls.some(c => c[0] === 'ramp'),
    );
    assert.equal(vomitFilters.length, 2, '토사물: 두 겹 넓은 로우패스');
    assert.ok(
      vomitFilters.every(f => f.frequency.calls[0][1] >= 900 && f.frequency.calls[0][1] <= 1600),
      '토사물: 1400Hz 부근에서 시작하는 넓은 로우패스',
    );
    assert.ok(
      vomitFilters.some(f => f.frequency.calls.some(c => c[0] === 'ramp' && c[1] <= 500)),
      '토사물: 로우패스가 450Hz 로 내려간다',
    );

    // 똥: 낮은 톱니파(68→38Hz) + 빠른 떨림 + 하강 로우패스 + 노이즈 퍼프
    const poop = new SoundFX();
    assert.doesNotThrow(() => poop.playTrap('POOP'));
    assert.ok(poop.ctx.oscillators.length >= 2, '똥: 톱니파 + 배음');
    const poopLead = poop.ctx.oscillators[0];
    assert.equal(poopLead.type, 'sawtooth');
    assert.ok(
      poopLead.frequency.calls[0][1] >= 60 && poopLead.frequency.calls[0][1] <= 80,
      '똥: 68Hz 부근에서 시작',
    );
    assert.ok(
      poopLead.frequency.calls.some(c => c[0] === 'ramp' && c[1] <= 45),
      '똥: 38Hz 로 떨어지는 저음',
    );
    assert.ok(poopLead.frequency.calls.length > 5, '똥: 빠른 떨림(LFO)');
    const poopFilter = poop.ctx.filters.find(
      f => f.type === 'lowpass' && f.frequency.calls.some(c => c[0] === 'ramp'),
    );
    assert.ok(poopFilter, '똥: 하강 로우패스 스윕');
    assert.ok(
      poopFilter.frequency.calls.some(c => c[0] === 'ramp' && c[1] <= 200),
      '똥: 로우패스가 아래로 스윕한다',
    );
    assert.ok(poop.ctx.bufferSources.length >= 2, '똥: 퍼프 노이즈');
  } finally {
    delete globalThis.window;
  }
});

test('오디오 장치가 없어도 아이템/트랩 종류별 사운드는 조용히 무시된다', () => {
  const sound = new SoundFX();

  assert.doesNotThrow(() => {
    for (const type of ['MILK', 'CANDY', 'COOKIE', 'PACIFIER', null, undefined]) sound.playItem(type);
    sound.playPacifier();
    for (const type of ['PEE', 'VOMIT', 'POOP', null, undefined]) sound.playTrap(type);
  });

  assert.equal(sound.ctx, null, '오디오 장치가 없으면 컨텍스트를 만들지 않는다');
});

// ===== 2차 후속음 (1차 직관 효과음 뒤에 붙는 캐릭터/발진 레이어) =====

test('오디오 장치가 없어도 2차 후속음 4종은 조용히 무시된다', () => {
  const sound = new SoundFX();

  assert.doesNotThrow(() => {
    sound.playItemFollowUp('COOKIE');
    sound.playItemFollowUp('MILK');
    sound.playItemFollowUp('CANDY');
    sound.playItemFollowUp();
    sound.playPacifierFollowUp();
    sound.playGoldenFollowUp();
    sound.playFreezeFollowUp();
  });

  assert.equal(sound.ctx, null, '오디오 장치가 없으면 컨텍스트를 만들지 않는다');
});

test('아이템/쪽쪽이/황금젖병 후속음은 삼각·사인파로 1차 소리 뒤에 지연 재생된다', () => {
  globalThis.window = { AudioContext: FxAudioContext };

  try {
    const isWarm = osc => osc.type === 'triangle' || osc.type === 'sine';

    for (const type of ['COOKIE', 'MILK', 'CANDY']) {
      const sound = new SoundFX();
      assert.doesNotThrow(() => sound.playItemFollowUp(type), `${type} 후속음은 예외가 없다`);
      assert.ok(sound.ctx.oscillators.length >= 1, `${type}: 후속음 오실레이터가 생성된다`);
      assert.ok(sound.ctx.oscillators.every(isWarm), `${type}: 삼각파·사인파만 사용한다`);
      assert.ok(
        sound.ctx.oscillators.every(osc => osc.startedAt > 0),
        `${type}: 1차 먹는 소리가 끝난 뒤로 지연 시작한다`,
      );
      assert.ok(sound.ctx.bufferSources.length >= 1, `${type}: 노이즈 레이어가 덧붙는다`);
    }

    // 쿠키: 직후(0.24초) 부글거리는 저역 + 가청 배음
    const cookie = new SoundFX();
    cookie.playItemFollowUp('COOKIE');
    assert.equal(cookie.ctx.oscillators.length, 2, '쿠키 후속음: 배 부글 2겹');
    assert.ok(
      cookie.ctx.oscillators.every(osc => osc.startedAt >= 0.24),
      '쿠키: 바삭 3타 뒤에 시작',
    );
    assert.ok(
      cookie.ctx.filters.some(f => f.type === 'lowpass' && f.frequency.calls.some(c => c[0] === 'ramp')),
      '쿠키: 로우패스가 아래로 좁아지는 뱃속 울림',
    );

    // 우유: 꿀꺽(사인) → 만족(삼각)
    const milk = new SoundFX();
    milk.playItemFollowUp('MILK');
    assert.deepEqual(
      milk.ctx.oscillators.map(osc => osc.type),
      ['sine', 'triangle'],
      '우유 후속음: 꿀꺽 사인 + 만족 삼각',
    );
    assert.ok(
      milk.ctx.oscillators[0].frequency.calls.some(c => c[0] === 'ramp' && c[1] <= 200),
      '우유: 목구멍으로 떨어지는 하강',
    );
    assert.ok(milk.ctx.oscillators[1].startedAt > milk.ctx.oscillators[0].startedAt, '우유: 만족음은 뒤에 온다');

    // 캔디: 시동 상승음
    const candy = new SoundFX();
    candy.playItemFollowUp('CANDY');
    assert.equal(candy.ctx.oscillators.length, 2, '캔디 후속음: 삼각+사인 2겹');
    assert.ok(
      candy.ctx.oscillators.every(osc => osc.frequency.calls.some(c => c[0] === 'ramp' && c[1] >= 1300)),
      '캔디: 위로 솟는 슈가 러시 발진',
    );
    assert.ok(candy.ctx.oscillators.every(osc => osc.startedAt >= 0.13), '캔디: 아작! 직후');

    // 쪽쪽이: 스윽~ 퐁! 은신
    const pacifier = new SoundFX();
    assert.doesNotThrow(() => pacifier.playPacifierFollowUp());
    assert.equal(pacifier.ctx.oscillators.length, 2, '쪽쪽이 후속음: 사인 + 삼각');
    assert.ok(pacifier.ctx.oscillators.every(isWarm), '쪽쪽이 후속음: 삼각파·사인파만');
    assert.ok(pacifier.ctx.oscillators.every(osc => osc.startedAt >= 0.44), '쪽쪽이: 3연타 뒤에 시작');
    assert.ok(pacifier.ctx.bufferSources.length >= 1, '쪽쪽이: 빠져나가는 공기 노이즈');

    // 황금 젖병: 이히이~ 3음절 + 보행기 부스터 발진
    const golden = new SoundFX();
    assert.doesNotThrow(() => golden.playGoldenFollowUp());
    assert.equal(golden.ctx.oscillators.length, 4, '황금 후속음: 웃음 3음절 + 부스터');
    assert.ok(golden.ctx.oscillators.every(isWarm), '황금 후속음: 삼각파·사인파만');
    assert.ok(golden.ctx.oscillators.every(osc => osc.startedAt >= 0.18), '황금: 팡파르 뒤에 시작');
    const goldenStarts = golden.ctx.oscillators.map(osc => osc.startedAt);
    for (let i = 1; i < goldenStarts.length; i++) {
      assert.ok(goldenStarts[i] > goldenStarts[i - 1], '"이-히-이~" 음절이 순서대로 이어진다');
    }
    assert.ok(golden.ctx.bufferSources.length >= 1, '황금: 부스터 발진 노이즈');
  } finally {
    delete globalThis.window;
  }
});

test('playFreezeFollowUp 은 "뿌엥~" 뒤 지연된 얼음 빙결음을 예약한다', () => {
  globalThis.window = { AudioContext: FxAudioContext };

  try {
    const sound = new SoundFX();
    assert.doesNotThrow(() => sound.playFreezeFollowUp());

    assert.equal(sound.ctx.oscillators.length, 3, '샤라랑~ 짜장! 3연타');
    assert.ok(
      sound.ctx.oscillators.every(osc => osc.type === 'sine' || osc.type === 'triangle'),
      '빙결음: 사인·삼각파만 사용한다',
    );
    assert.deepEqual(
      sound.ctx.oscillators.map(osc => osc.frequency.calls[0][1]),
      [1760, 2349, 3136],
      '빙결음: 결정이 맺히듯 위로 올라간다',
    );
    assert.ok(
      sound.ctx.oscillators.every(osc => osc.startedAt >= 0.46),
      '울음이 끝난 뒤(0.46초) 지연 시작한다',
    );
    const starts = sound.ctx.oscillators.map(osc => osc.startedAt);
    for (let i = 1; i < starts.length; i++) {
      assert.ok(starts[i] > starts[i - 1], '반짝임이 순서대로 이어진다');
    }
    assert.ok(sound.ctx.bufferSources.length >= 1, '서리 결정 노이즈가 있다');
    assert.ok(
      sound.ctx.filters.some(f => f.type === 'highpass' && f.frequency.value === 3400),
      '서리 질감은 3400Hz 하이패스',
    );

    // "뿌-엥~" 본체도 예외 없이 짧게(0.5초 이내) 끝난다
    const cry = new SoundFX();
    assert.doesNotThrow(() => cry.playFreeze());
    assert.ok(cry.ctx.oscillators.length >= 2, '뿌-엥: 두 음절');
    assert.ok(
      cry.ctx.oscillators.every(osc => osc.stoppedAt - osc.startedAt <= 0.5),
      '뿌-엥: 답답하지 않게 0.5초 이내',
    );
  } finally {
    delete globalThis.window;
  }
});

// ===== 리얼 음성·폴리 오디오 샘플 재생 엔진 =====

class SampleBufferSource extends FxBufferSource {
  constructor() {
    super();
    this.playbackRate = new RichAudioParam(1);
    this.onended = null;
  }
}

class SampleAudioContext extends FxAudioContext {
  constructor() {
    super();
    this.decodedCount = 0;
  }
  createBufferSource() {
    const node = new SampleBufferSource();
    this.bufferSources.push(node);
    return node;
  }
  async decodeAudioData(arrayBuffer) {
    this.decodedCount += 1;
    const tag = arrayBuffer && arrayBuffer.__tag ? arrayBuffer.__tag : `buf-${this.decodedCount}`;
    return { duration: 0.5, sampleRate: 44100, tag };
  }
}

test('SOUND_MANIFEST 의 모든 음성·폴리 MP3 자산이 디스크에 존재하고 비어 있지 않다', () => {
  assert.ok(SOUND_KEYS.length >= 22, `최소 22개 리얼 효과음 자산 (${SOUND_KEYS.length})`);
  for (const key of SOUND_KEYS) {
    const entry = SOUND_MANIFEST[key];
    assert.ok(entry && typeof entry.url === 'string', `${key}: url 존재`);
    const filePath = fileURLToPath(entry.url);
    assert.ok(fs.existsSync(filePath), `${key}: 파일 존재 (${filePath})`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size >= 500, `${key}: 유효한 MP3 크기 (${stat.size} bytes)`);
  }
});

test('리얼 샘플이 프리로드되면 먹기·배출·베이비 행위가 신스 대신 AudioBuffer 로 재생된다', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.window = { AudioContext: SampleAudioContext };
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    async arrayBuffer() {
      const name = String(url).split('/').pop().replace('.mp3', '');
      return { __tag: name };
    },
  });

  try {
    const sound = new SoundFX();
    sound._sampleRng = () => 0.75; // 결정적 피치 지터 검증용
    await sound.preloadSamples();

    for (const key of SOUND_KEYS) {
      assert.equal(sound.hasSample(key), true, `${key} 샘플 디코딩 완료`);
    }

    const beforeOsc = sound.ctx.oscillators.length;
    const playedTags = () => sound.ctx.bufferSources.map(s => s.buffer && s.buffer.tag);

    // 1) 아이템 먹기 + 후속음
    sound.playItem('MILK');
    sound.playItemFollowUp('MILK');
    sound.playItem('CANDY');
    sound.playItemFollowUp('CANDY');
    sound.playItem('COOKIE');
    sound.playItemFollowUp('COOKIE');
    sound.playPacifier();
    sound.playPacifierFollowUp();
    sound.playGoldenFollowUp();

    // 2) 트랩 배출 (오줌·토사물·똥)
    sound.playTrap('PEE');
    sound.playTrap('VOMIT');
    sound.playTrap('POOP');

    // 3) 베이비 행위 (발걸음 좌/우·슈가·보행기 · 울기 · 빙결 · 침대 은신 · Oh No · 체포 · 트랩 적중)
    sound.playStep();
    sound.playStep();
    sound.playStep({ sugarRush: true });
    sound.playStep({ goldenWalker: true });
    sound.playFreeze();
    sound.playFreezeFollowUp();
    sound.playStealth();
    sound.playOhNo();
    sound.playCaught();
    sound.playTrapHit(0.6);

    // 위 호출 중 신스 오실레이터로 폴백한 것이 하나도 없어야 한다
    assert.equal(sound.ctx.oscillators.length, beforeOsc, '모든 리얼 효과음이 샘플로 재생됨');

    const tags = playedTags();
    for (const expected of [
      'eat_milk', 'eat_milk_followup',
      'eat_candy', 'eat_candy_followup',
      'eat_cookie', 'eat_cookie_followup',
      'eat_pacifier', 'eat_pacifier_followup',
      'eat_golden_followup',
      'trap_pee', 'trap_vomit', 'trap_poop',
      'step_normal_a', 'step_normal_b', 'step_sugar', 'step_walker',
      'baby_cry', 'fx_ice_freeze', 'baby_stealth', 'baby_ohno', 'baby_caught', 'trap_hit',
    ]) {
      assert.ok(tags.includes(expected), `${expected} 샘플이 재생되어야 한다`);
    }

    // 지연 후속음은 delay > 0 으로 예약된다
    const milkFollow = sound.ctx.bufferSources.find(s => s.buffer.tag === 'eat_milk_followup');
    assert.ok(milkFollow.startedAt > 0, '우유 후속음은 지연 시작');

    // 피치 지터가 playbackRate 에 반영된다 (rng=0.75 -> 1 + 0.5*jitter)
    const cookieSrc = sound.ctx.bufferSources.find(s => s.buffer.tag === 'eat_cookie');
    assert.ok(cookieSrc.playbackRate.value > 1.0, '자연스러운 피치 변동이 적용된다');

    // playTrapHit(0.6) 은 스테레오 패닝을 유지한다
    assert.ok(
      sound.ctx.panners.some(p => Math.abs(p.pan.value - 0.6) < 1e-6),
      '트랩 적중 샘플도 보모 방향 패닝 유지',
    );
  } finally {
    delete globalThis.window;
    globalThis.fetch = prevFetch;
  }
});

test('보이스 채널은 새 아기 음성이 시작될 때 이전 음성이 겹치지 않게 정리하고 음소거 시 중단한다', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.window = { AudioContext: SampleAudioContext };
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    async arrayBuffer() {
      const name = String(url).split('/').pop().replace('.mp3', '');
      return { __tag: name };
    },
  });

  try {
    const sound = new SoundFX();
    await sound.preloadSamples();

    sound.playOhNo(); // voice 채널 1
    const firstVoice = sound.ctx.bufferSources.at(-1);
    assert.equal(firstVoice.stoppedAt, null, '재생 직후에는 살아 있다');

    sound.playFreeze(); // voice 채널 2 → 이전 voice 정리
    const secondVoice = sound.ctx.bufferSources.at(-1);
    assert.ok(firstVoice.stoppedAt !== null, '새 아기 음성이 시작되면 이전 음성이 부드럽게 중단된다');
    assert.equal(secondVoice.stoppedAt, null, '새 음성은 정상 재생');

    // 폴리/발걸음 채널은 voice 채널을 끊지 않는다
    sound.playStep();
    assert.equal(secondVoice.stoppedAt, null, '발걸음은 진행 중인 아기 음성을 끊지 않는다');

    // 음소거 시 현재 활성 보이스도 중단된다
    sound.toggleMute();
    assert.ok(secondVoice.stoppedAt !== null, '음소거 시 진행 중인 음성이 중단된다');
  } finally {
    delete globalThis.window;
    globalThis.fetch = prevFetch;
  }
});

test('샘플 네트워크 로드에 실패하면 예외 없이 기존 Web Audio 합성음으로 폴백한다', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.window = { AudioContext: SampleAudioContext };
  globalThis.fetch = async () => { throw new Error('offline'); };

  try {
    const sound = new SoundFX();
    const res = await sound.loadSample('eat_cookie');
    assert.equal(res, null, '실패 시 null 반환');
    assert.equal(sound.hasSample('eat_cookie'), false);

    // 합성음 폴백으로 쿠키 먹는 소리가 예외 없이 재생되어야 한다
    assert.doesNotThrow(() => sound.playItem('COOKIE'));
    assert.ok(sound.ctx.oscillators.length >= 3, '미로드 시 쿠키 합성음으로 폴백');
  } finally {
    delete globalThis.window;
    globalThis.fetch = prevFetch;
  }
});

test('게임 중 효과음 모드(Voice ↔ FX)를 즉시 전환하면 샘플/신스가 바뀌고 진행 중인 음성이 정리된다', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.window = { AudioContext: SampleAudioContext };
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    async arrayBuffer() {
      const name = String(url).split('/').pop().replace('.mp3', '');
      return { __tag: name };
    },
  });

  try {
    const sound = new SoundFX();
    assert.deepEqual(SFX_MODES, ['voice', 'fx']);
    assert.equal(sound.sfxMode, 'voice', '기본값은 Voice 모드');
    assert.equal(sound.useSamples, true);

    const events = [];
    sound.onSfxModeChange = (mode) => events.push(mode);

    await sound.preloadSamples();

    // 1) Voice 모드에서는 샘플이 재생되고 오실레이터를 쓰지 않는다
    sound.playOhNo();
    const activeVoice = sound.ctx.bufferSources.at(-1);
    assert.equal(activeVoice.buffer.tag, 'baby_ohno');
    const oscBeforeFx = sound.ctx.oscillators.length;

    // 2) FX 모드로 전환 → 진행 중인 아기 음성 즉시 중단 + 이후 호출은 레트로 신스 재생
    assert.equal(sound.toggleSfxMode(), 'fx');
    assert.equal(sound.sfxMode, 'fx');
    assert.equal(sound.useSamples, false);
    assert.ok(activeVoice.stoppedAt !== null, 'FX 전환 시 진행 중이던 아기 음성이 정리된다');

    const bufBeforeFx = sound.ctx.bufferSources.length;
    sound.playItem('COOKIE');
    sound.playTrap('POOP');
    assert.ok(sound.ctx.oscillators.length > oscBeforeFx, 'FX 모드에서는 레트로 신스 오실레이터로 재생된다');
    assert.ok(
      sound.ctx.bufferSources.slice(bufBeforeFx).every(s => !s.buffer || !s.buffer.tag),
      'FX 모드에서는 MP3 샘플 버퍼를 재생하지 않는다',
    );

    // 3) 다시 Voice 모드로 전환 → 즉시 MP3 샘플 재생으로 복귀
    assert.equal(sound.toggleSfxMode(), 'voice');
    assert.equal(sound.useSamples, true);
    const oscBeforeVoice = sound.ctx.oscillators.length;
    sound.playTrap('POOP');
    assert.equal(sound.ctx.oscillators.length, oscBeforeVoice, 'Voice 복귀 시 오실레이터 없이 샘플 재생');
    assert.equal(sound.ctx.bufferSources.at(-1).buffer.tag, 'trap_poop');

    // 잘못된 값은 기본 'voice' 로 정규화
    assert.equal(sound.setSfxMode('unknown'), 'voice');
    assert.deepEqual(events, ['fx', 'voice'], '실제 변경 시에만 콜백이 호출된다');
  } finally {
    delete globalThis.window;
    globalThis.fetch = prevFetch;
  }
});

test('게임 중 키보드 V(KeyV) 단축키로 Voice ↔ FX 모드를 전환할 수 있고 UI 버튼이 존재한다', () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const fakeCanvas = { width: 640, height: 640, style: {}, getContext: () => ({}) };
    const input = new InputManager();
    const sound = new SoundFX();
    const game = new Game(fakeCanvas, input, { sound });

    assert.equal(sound.sfxMode, 'voice');
    input.press('KeyV');
    game._handleSystemInput();
    input.release('KeyV');
    input.clearJustPressed();
    assert.equal(sound.sfxMode, 'fx', 'V 키 1회 → FX 모드');

    input.press('KeyV');
    game._handleSystemInput();
    input.release('KeyV');
    input.clearJustPressed();
    assert.equal(sound.sfxMode, 'voice', 'V 키 2회 → Voice 모드 복귀');
    input.destroy();
  } finally {
    delete globalThis.window;
  }

  // PC·모바일 공통 상단 바 버튼 및 CSS 상태 규칙 확인
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(html, /id="btn-sfx-mode"[^>]*data-sfx-mode="voice"/);
  assert.match(css, /\.sfx-mode-btn\[data-sfx-mode="voice"\]/);
  assert.match(css, /\.sfx-mode-btn\[data-sfx-mode="fx"\]/);
});

