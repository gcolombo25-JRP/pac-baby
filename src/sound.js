/**
 * Pac-Baby: 효과음 모듈 (Web Audio API 합성음)
 *
 * - 외부 오디오 파일 없이 오실레이터로 소리를 만든다.
 * - AudioContext 는 브라우저 정책상 "사용자 입력" 이후에만 재생되므로,
 *   매 재생 시 _ensure() 에서 생성/재개를 시도한다.
 * - 오디오가 없는 환경(Node 테스트 등)에서는 조용히 무시된다.
 */

// ===== BGM 설정 (삼각파 + 사인 레이어링으로 따뜻하게) =====
const BGM_STEP_SEC = 0.24;   // 8분음표 길이(초)
const BGM_LOOKAHEAD = 0.3;   // 미리 예약해 둘 시간(초)

const NOTE_FREQ = {
  C3: 130.81, F3: 174.61, G3: 196.00, A3: 220.00,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25,
};

/** 멜로디 (8분음표 16개 = 1마디 루프) */
const BGM_MELODY = [
  'C5', 'E5', 'G5', 'E5',
  'A4', 'C5', 'E5', 'C5',
  'F4', 'A4', 'C5', 'A4',
  'G4', 'B4', 'D5', 'B4',
];

/** 4분음표마다 깔리는 베이스 (4개) */
const BGM_BASS = ['C3', 'A3', 'F3', 'G3'];

// ===== 어둠 모드 근접 경고 (심장박동) =====
const HEARTBEAT_MAX_MS = 1100; // 시야 경계에 막 들어왔을 때의 박동 간격(ms)
const HEARTBEAT_MIN_MS = 430;  // 바로 옆에 붙었을 때의 박동 간격(ms)

// ===== 마스터 버스 (쨍한 기계음을 줄이고 입체감을 주는 출력단) =====
const MASTER_VOLUME = 0.4;         // 전체 볼륨
const TONE_LOWPASS_HZ = 4600;      // 4200~5000Hz: 날카로운 고음 완화
const SLAPBACK_DELAY_SEC = 0.055;  // 45~65ms 아주 짧은 슬랩백(가벼운 공간감)
const SLAPBACK_FEEDBACK = 0.17;    // 낮은 피드백 — 에코가 뭉개지지 않게
const SLAPBACK_WET = 0.2;          // 에코(젖은 소리) 비중
const PAN_RANGE_TILES = 8;         // 좌우 패닝 기준 타일 거리
const PAN_MAX = 0.8;               // 최대 패닝 (-0.8 ~ +0.8)

/**
 * 보모와 베이비의 X(열) 차이를 스테레오 패닝 값으로 변환한다.
 * - 화면 오른쪽(열이 더 큰 쪽)의 보모는 +, 왼쪽은 -.
 * - PAN_RANGE_TILES 이상 떨어지면 최대치(PAN_MAX = ±0.8)로 고정한다.
 * @param {number} deltaTiles 보모 열 - 베이비 열
 * @param {number} [maxPan=PAN_MAX] 최대 패닝 절댓값
 * @param {number} [rangeTiles=PAN_RANGE_TILES] 최대치에 도달하는 타일 거리
 * @returns {number} -maxPan ~ +maxPan
 */
export function stereoPanFromTiles(deltaTiles, maxPan = PAN_MAX, rangeTiles = PAN_RANGE_TILES) {
  const delta = Number.isFinite(deltaTiles) ? deltaTiles : 0;
  const limit = Number.isFinite(maxPan) ? Math.min(1, Math.abs(maxPan)) : PAN_MAX;
  const range = Number.isFinite(rangeTiles) && rangeTiles > 0 ? rangeTiles : PAN_RANGE_TILES;
  const ratio = Math.max(-1, Math.min(1, delta / range));
  return ratio * limit;
}

export default class SoundFX {
  constructor() {
    this.enabled = true;   // 음향 on/off
    this.ctx = null;
    this.master = null;
    this.stepToggle = false; // 발걸음 소리 음높이 번갈아 재생
    this._noiseBuffer = null; // 효과음용 노이즈 원본 (한 번만 생성)
    this._lastUiClickAt = 0;  // UI 클릭음 연타 제한용 타임스탬프(ms)
    this._bus = null;         // 마스터 버스 노드 참조 (컴프레서/필터/딜레이 등)
    this._echo = null;        // 슬랩백 딜레이 노드 묶음

    // BGM 루프 상태
    this.bgmRunning = false;
    this.bgmStep = 0;
    this.bgmNextTime = 0;

    // 어둠 모드 근접 경고(심장박동) 상태
    this.heartbeatTimer = 0;  // 다음 박동까지 남은 시간(ms)
    this.heartbeatLevel = 0;  // 0(안전) ~ 1(바로 옆)
    this.heartbeatPan = 0;    // 가장 가까운 보모 방향 (-1 왼쪽 ~ +1 오른쪽)
  }

  /** 음향 켜기/끄기 토글 후 현재 상태 반환 (BGM 도 함께) */
  toggleMute() {
    this.enabled = !this.enabled;
    if (this.enabled) this.startBgm();
    else this.stopBgm();
    return this.enabled;
  }

  /**
   * 첫 사용자 입력 시 호출: 오디오 장치를 깨우고 확인음을 재생한다.
   * (브라우저는 사용자 제스처 없이는 소리를 막는다)
   */
  unlock() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;
    this._beep({ freq: 660, toFreq: 990, duration: 0.09, type: 'triangle', volume: 0.8 });
    this.startBgm(); // 첫 사용자 입력에서 BGM 시작
  }

  // ===== BGM 루프 =====

  /** BGM 시작 (AudioContext 가 없으면 무시) */
  startBgm() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;

    this.bgmRunning = true;
    if (this.bgmNextTime < ctx.currentTime) {
      this.bgmNextTime = ctx.currentTime + 0.08;
    }
  }

  /** BGM 정지 */
  stopBgm() {
    this.bgmRunning = false;
  }

  /**
   * 매 프레임 호출: 앞으로 BGM_LOOKAHEAD 만큼 음을 미리 예약한다.
   * (타이머 없이 게임 루프에서 구동 → 테스트/헤드리스에서도 안전)
   */
  updateBgm() {
    if (!this.bgmRunning || !this.enabled) return;
    const ctx = this.ctx;
    if (!ctx) return;

    // 탭 전환 등으로 시간이 크게 밀리면 현재 시각으로 보정
    if (this.bgmNextTime < ctx.currentTime) this.bgmNextTime = ctx.currentTime;

    while (this.bgmNextTime < ctx.currentTime + BGM_LOOKAHEAD) {
      this._scheduleBgmStep(this.bgmStep, this.bgmNextTime);
      this.bgmStep = (this.bgmStep + 1) % BGM_MELODY.length;
      this.bgmNextTime += BGM_STEP_SEC;
    }
  }

  /** 한 스텝(멜로디 + 4분음표 베이스) 예약 */
  _scheduleBgmStep(step, when) {
    const note = BGM_MELODY[step % BGM_MELODY.length];
    const freq = NOTE_FREQ[note];
    if (freq) {
      // 삼각파 몸통 + 한 옥타브 위 사인 배음 → 사각파의 쨍함 없이 따뜻하고 둥근 멜로디
      this._beepAt(freq, when, BGM_STEP_SEC * 0.9, 'triangle', 0.16);
      this._beepAt(freq * 2, when + 0.004, BGM_STEP_SEC * 0.55, 'sine', 0.045);
    }

    if (step % 4 === 0) {
      const bass = NOTE_FREQ[BGM_BASS[Math.floor(step / 4) % BGM_BASS.length]];
      if (bass) {
        // 베이스도 삼각파 + 한 옥타브 아래 사인 서브로 두껍고 부드럽게
        this._beepAt(bass, when, BGM_STEP_SEC * 1.75, 'triangle', 0.13);
        this._beepAt(bass * 0.5, when, BGM_STEP_SEC * 1.6, 'sine', 0.07);
      }
    }
  }

  /**
   * 절대 시각(when)에 한 음 예약
   * @param {number} freq 주파수
   * @param {number} when 재생 시각(AudioContext 시간)
   * @param {number} duration 초
   * @param {OscillatorType} type 파형
   * @param {number} volume 0~1
   * @param {number} attack 어택(초) — 조금 길면 부드럽게 스며든다
   */
  _beepAt(freq, when, duration, type = 'square', volume = 0.4, attack = 0.01) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  /** AudioContext 준비 (없으면 null) */
  _ensure() {
    if (!this.enabled) return null;

    const AC = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    if (!AC) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this._setAudioParam(this.master.gain, MASTER_VOLUME); // 전체 볼륨
        this._buildMasterBus(this.ctx);
      } catch (err) {
        this.enabled = false; // 오디오를 만들 수 없는 환경
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** AudioParam 값을 안전하게 설정 (없는 스텁/읽기 전용이면 조용히 무시) */
  _setAudioParam(param, value) {
    if (!param || typeof param !== 'object' || !('value' in param)) return;
    try { param.value = value; } catch (err) { /* 무시 */ }
  }

  /**
   * 마스터 버스 구성: master → (컴프레서) → (로우패스) ─┬→ destination (드라이)
   *                                                     └→ (슬랩백 딜레이) → destination
   * - 컴프레서: 효과음이 겹칠 때 찌그러지지 않게 살짝 눌러 준다(클리핑 방지).
   * - 로우패스(TONE_LOWPASS_HZ): 날카로운 고음을 부드럽게 다듬는다.
   * - 슬랩백 딜레이(55ms, 낮은 피드백): 아주 가벼운 공간감만 더한다.
   * - 테스트 스텁/구형 브라우저에 노드 생성 메서드가 없으면 조용히 건너뛴다.
   * @param {AudioContext} ctx
   */
  _buildMasterBus(ctx) {
    let output = this.master;
    const chain = [];

    // 1) 클리핑 방지 컴프레서
    if (typeof ctx.createDynamicsCompressor === 'function') {
      try {
        const comp = ctx.createDynamicsCompressor();
        // 효과음이 BGM 위에서도 또렷하게 들리도록 문턱을 높게 둔다 (순간 피크만 살짝 누름)
        this._setAudioParam(comp.threshold, -8);
        this._setAudioParam(comp.knee, 16);
        this._setAudioParam(comp.ratio, 2.5);
        this._setAudioParam(comp.attack, 0.004);
        this._setAudioParam(comp.release, 0.2);
        output.connect(comp);
        output = comp;
        chain.push(comp);
      } catch (err) { /* 컴프레서 없이 진행 */ }
    }

    // 2) 로우패스 톤 필터 (날카로운 고음 완화)
    if (typeof ctx.createBiquadFilter === 'function') {
      try {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        this._setAudioParam(filter.frequency, TONE_LOWPASS_HZ);
        this._setAudioParam(filter.Q, 0.7);
        output.connect(filter);
        output = filter;
        chain.push(filter);
      } catch (err) { /* 필터 없이 진행 */ }
    }

    // 3) 드라이 경로 (원음 그대로)
    output.connect(ctx.destination);

    // 4) 슬랩백 에코 (젖은 소리만 보조로 더한다)
    if (typeof ctx.createDelay === 'function') {
      try {
        const delay = ctx.createDelay(0.5);
        const wet = ctx.createGain();
        const feedback = ctx.createGain();
        this._setAudioParam(delay.delayTime, SLAPBACK_DELAY_SEC);
        this._setAudioParam(wet.gain, SLAPBACK_WET);
        this._setAudioParam(feedback.gain, SLAPBACK_FEEDBACK);

        output.connect(delay);
        delay.connect(wet);
        wet.connect(ctx.destination);
        delay.connect(feedback);
        feedback.connect(delay); // 짧고 옅은 되울림

        chain.push(delay, wet, feedback);
        this._echo = { delay, wet, feedback };
      } catch (err) {
        this._echo = null; // 에코 없이 진행
      }
    }

    this._bus = chain;
  }

  /**
   * StereoPannerNode 생성 (pan 이 0 이거나 미지원 환경이면 null).
   * @param {AudioContext} ctx
   * @param {number} pan -1(왼쪽) ~ +1(오른쪽)
   * @returns {StereoPannerNode|null}
   */
  _createPanner(ctx, pan) {
    const value = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
    if (Math.abs(value) < 0.01) return null;
    if (typeof ctx.createStereoPanner !== 'function') return null;
    try {
      const panner = ctx.createStereoPanner();
      this._setAudioParam(panner.pan, value);
      return panner;
    } catch (err) {
      return null; // 패닝 미지원 → 모노로 재생
    }
  }

  /**
   * 짧은 효과음 하나를 재생
   * @param {object} options
   * @param {number} options.freq 시작 주파수
   * @param {number|null} options.toFreq 끝 주파수 (슬라이드)
   * @param {number} options.duration 초
   * @param {OscillatorType} options.type 파형
   * @param {number} options.volume 0~1
   * @param {number} options.delay 시작 지연(초)
   * @param {string|null} options.filterType 'lowpass' | 'bandpass' | 'highpass' (있으면 포먼트/톤 보정)
   * @param {number} options.filterFreq 필터 컷오프/중심 주파수(Hz)
   * @param {number} options.filterToFreq 필터 스윕 목표 주파수(Hz) — 주면 duration 동안 미끄러진다
   * @param {number} options.filterQ 필터 Q (포먼트 날카로움)
   * @param {{hz: number, depth: number}|null} options.vibrato 비브라토(떨림) — 아기 목소리 느낌
   * @param {number} options.attack 어택(초) — 조금 길면 부드럽게 스며든다
   * @param {number|null} options.sustainLevel 중간 감쇠 레벨(0~1) — 주면 벨/마림바형 ADSR
   * @param {number} options.pan -1(왼쪽) ~ +1(오른쪽) 스테레오 패닝
   */
  _beep({
    freq = 440, toFreq = null, duration = 0.12, type = 'square', volume = 1, delay = 0,
    filterType = null, filterFreq = 0, filterToFreq = 0, filterQ = 1, vibrato = null,
    attack = 0.012, sustainLevel = null, pan = 0,
  }) {
    const ctx = this._ensure();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (toFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), start + duration);
    }

    // 비브라토: 목표 주파수 곡선 위에 사인파만큼 미세하게 흔든다 (8비트 '울먹임')
    if (vibrato && vibrato.depth > 0 && vibrato.hz > 0) {
      const steps = Math.max(2, Math.round(duration * 60));
      const stepSec = duration / steps;
      for (let i = 1; i < steps; i++) {
        const ratio = i / steps;
        const base = toFreq !== null ? freq + (toFreq - freq) * ratio : freq;
        const wobble = 1 + Math.sin(i * Math.PI * 2 * vibrato.hz * stepSec) * vibrato.depth;
        osc.frequency.setValueAtTime(Math.max(1, base * wobble), start + i * stepSec);
      }
    }

    // 필터(포먼트) — 지원하지 않는 환경(테스트 스텁 등)에서는 조용히 건너뛴다
    let filter = null;
    if (filterType && filterFreq > 0 && typeof ctx.createBiquadFilter === 'function') {
      filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(Math.max(20, filterFreq), start);
      // 필터 스윕(예: 방귀의 하강 로우패스) — 지원하는 환경에서만
      if (filterToFreq > 0 && typeof filter.frequency.exponentialRampToValueAtTime === 'function') {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, filterToFreq), start + duration);
      }
      if (filter.Q && typeof filter.Q.setValueAtTime === 'function') {
        filter.Q.setValueAtTime(Math.max(0.0001, filterQ), start);
      }
    }

    // 빠른 어택 → 지수 감쇠: 짧아도 '톡' 하고 때리는 느낌을 만든다.
    // sustainLevel 을 주면 벨/마림바처럼 부드럽게 감쇠하는 ADSR 곡선이 된다.
    const attackSec = Math.max(0.002, Math.min(attack, duration * 0.5));
    const sustainAt = start + Math.max(attackSec + 0.006, duration * 0.34);
    const canSustain = sustainLevel !== null && sustainLevel > 0
      && sustainAt < start + duration * 0.9;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attackSec);
    if (canSustain) {
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume * Math.min(1, sustainLevel)),
        sustainAt,
      );
    } else if (duration > 0.16) {
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.62), start + duration * 0.55);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    if (filter) {
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }

    // 보모 위치 기반 좌우 패닝 (미지원 환경은 모노로)
    const panner = this._createPanner(ctx, pan);
    if (panner) {
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  /**
   * 짧은 노이즈(숨소리/발자국/타격) 재생 — BufferSource + 필터
   * - 브라우저가 지원하지 않거나 테스트 스텁이면 조용히 무시한다.
   * @param {object} options
   * @param {number} options.duration 초
   * @param {number} options.volume 0~1
   * @param {number} options.delay 시작 지연(초)
   * @param {string} options.filterType
   * @param {number} options.filterFreq
   * @param {number} options.Q
   * @param {number} options.pan -1(왼쪽) ~ +1(오른쪽)
   */
  _noise({
    duration = 0.08, volume = 0.2, delay = 0, filterType = 'bandpass', filterFreq = 1200, Q = 1,
    pan = 0,
  }) {
    const ctx = this._ensure();
    if (!ctx) return;
    if (typeof ctx.createBuffer !== 'function' || typeof ctx.createBufferSource !== 'function') return;

    if (!this._noiseBuffer) {
      try {
        const rate = ctx.sampleRate || 44100;
        const buffer = ctx.createBuffer(1, rate, rate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this._noiseBuffer = buffer;
      } catch (err) {
        return; // 노이즈를 만들 수 없는 환경
      }
    }

    const start = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    // 짧은 노이즈도 '사각' 하고 들리도록 어택 후 35% 지점까지 볼륨을 유지한다.
    const attack = Math.min(0.008, duration * 0.4);
    const holdAt = start + Math.max(attack + 0.004, duration * 0.35);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
    if (holdAt < start + duration * 0.9) {
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.55), holdAt);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    let filter = null;
    if (filterType && filterFreq > 0 && typeof ctx.createBiquadFilter === 'function') {
      filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(Math.max(20, filterFreq), start);
      if (filter.Q && typeof filter.Q.setValueAtTime === 'function') {
        filter.Q.setValueAtTime(Math.max(0.0001, Q), start);
      }
    }

    if (filter) {
      src.connect(filter);
      filter.connect(gain);
    } else {
      src.connect(gain);
    }

    const panner = this._createPanner(ctx, pan);
    if (panner) {
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }

    src.start(start);
    if (typeof src.stop === 'function') src.stop(start + duration + 0.02);
  }

  /** 게임 시작: 두 음 상승 차임 */
  playStart() {
    this._beep({ freq: 523, toFreq: 784, duration: 0.16, type: 'triangle', delay: 0 });
    this._beep({ freq: 784, toFreq: 1046, duration: 0.18, type: 'triangle', delay: 0.13 });
  }

  /**
   * 한 타일 이동: 아기 운동화 삑삑 소리
   * - 일반: 낮고 부드러운 triangle '톡톡' (lowpass 로 고역을 눌러 폰 스피커에서도 편안하게)
   * - 슈가 러시: 1.8배 높은 square '삑삑' — 일반보다 확실히 경쾌하고 짧다
   * - 황금 보행기: 1.65배 높은 반짝이는 톤 (보행기 특유의 금속성 느낌)
   * - 음높이를 번갈아 재생해 걸음걸이 리듬을 만든다.
   * @param {{sugarRush?: boolean, goldenWalker?: boolean, booster?: boolean}|boolean} [state]
   *   베이비 상태 (true 만 넘기면 슈가 러시로 동작)
   */
  playStep(state = {}) {
    // 호환: playStep(true) 로도 슈가 러시 상태를 전달할 수 있다
    const sugarRush = typeof state === 'boolean'
      ? state
      : !!(state && state.sugarRush);
    const goldenWalker = typeof state === 'object' && state !== null
      ? !!(state.goldenWalker || state.booster)
      : false;
    const boosted = sugarRush || goldenWalker;

    this.stepToggle = !this.stepToggle;

    // 일반은 낮고 둥근 C5/B4, 파워업은 확실히 높은 대역으로 튄다
    const base = this.stepToggle ? 523.25 : 493.88;
    let pitch = 1;
    if (goldenWalker && sugarRush) pitch = 1.95;
    else if (sugarRush) pitch = 1.8;
    else if (goldenWalker) pitch = 1.65;

    const duration = sugarRush ? 0.03 : (goldenWalker ? 0.036 : 0.06);

    // 1) "삑-" 고무가 미끄러지는 주음
    this._beep({
      freq: base * pitch,
      toFreq: base * pitch * (boosted ? 1.32 : 1.18),
      duration,
      type: boosted ? 'square' : 'triangle',
      volume: sugarRush ? 0.42 : (goldenWalker ? 0.46 : 0.34),
      // 파워업은 저역만 살짝 덜어내고(고역 컷오프 아님) 기본음을 살려 폰 스피커에서도 또렷하게
      filterType: boosted ? 'highpass' : 'lowpass',
      filterFreq: sugarRush ? 650 : (goldenWalker ? 800 : 1800),
    });

    // 2) 살짝 낮은 화음 — 소리가 얇지 않게 두께를 준다
    this._beep({
      freq: base * pitch * 0.5,
      toFreq: base * pitch * 0.6,
      duration: duration + 0.01,
      type: boosted ? 'triangle' : 'sine',
      volume: sugarRush ? 0.16 : (goldenWalker ? 0.18 : 0.13),
      delay: 0.004,
    });

    // 3) 바닥을 스치는 짧은 '사각' 노이즈 (파워업은 더 높고 짧은 대역)
    this._noise({
      duration: sugarRush ? 0.018 : (goldenWalker ? 0.022 : 0.03),
      volume: sugarRush ? 0.075 : (goldenWalker ? 0.085 : 0.055),
      delay: 0.002,
      filterType: 'highpass',
      filterFreq: sugarRush ? 4800 : (goldenWalker ? 5600 : 2200),
    });
  }

  /**
   * UI 클릭/터치: 짧고 가벼운 '톡-삑' 팝
   * - D-패드/시작/일시정지/모달 버튼 등에 손끝 반응을 주는 아주 짧은 소리.
   * - 연타로 소리가 겹쳐 시끄러워지지 않도록 30ms 이내 재호출은 무시한다.
   */
  playUiClick() {
    if (!this.enabled) return;

    const now = Date.now();
    if (now - (this._lastUiClickAt || 0) < 30) return;
    this._lastUiClickAt = now;

    // 1) 짧게 튀는 고음 블립
    this._beep({ freq: 1320, toFreq: 1760, duration: 0.026, type: 'sine', volume: 0.38 });
    // 2) 살짝 낮은 삼각파 — '톡' 하는 몸통
    this._beep({ freq: 660, toFreq: 520, duration: 0.034, type: 'triangle', volume: 0.18, delay: 0.004 });
    // 3) 손끝이 닿는 아주 짧은 고역 틱 노이즈
    this._noise({ duration: 0.01, volume: 0.045, filterType: 'highpass', filterFreq: 3800 });
  }

  /** 체포: 하강하는 경고음 + 둔탁한 충격 노이즈 */
  playCaught() {
    this._beep({
      freq: 420,
      toFreq: 90,
      duration: 0.5,
      type: 'sawtooth',
      volume: 0.9,
      filterType: 'lowpass',
      filterFreq: 1600,
      vibrato: { hz: 7, depth: 0.03 },
    });
    this._beep({ freq: 210, toFreq: 70, duration: 0.5, type: 'square', volume: 0.5, delay: 0.05 });
    this._noise({ duration: 0.18, volume: 0.16, filterType: 'lowpass', filterFreq: 700 });
  }

  /**
   * 체포 순간의 "Oh! No~" — 낮고 서글픈 레트로 칩튠 음성
   * - 톱니파 + 밴드패스 포먼트로 '오' / '노' 음절을 흉내 낸다.
   * - 'No~' 는 긴 하강 글라이드 + 비브라토로 한숨처럼 처진다.
   * - 마지막에 낮은 사인/삼각파가 '흐엥...' 하고 남아 여운을 준다.
   */
  playOhNo() {
    // "Oh" — 턱 떨어지는 짧은 감탄 (포먼트 600Hz)
    this._beep({
      freq: 196,
      toFreq: 147,
      duration: 0.26,
      type: 'sawtooth',
      volume: 0.5,
      filterType: 'bandpass',
      filterFreq: 620,
      filterQ: 4,
      vibrato: { hz: 9, depth: 0.02 },
    });
    // "Oh" 의 낮은 배음 — 목소리 두께
    this._beep({ freq: 98, toFreq: 73, duration: 0.26, type: 'square', volume: 0.16, delay: 0.006 });

    // "No~" — 한숨 섞인 긴 하강 (포먼트를 조금 더 밝게)
    this._beep({
      freq: 233,
      toFreq: 110,
      duration: 0.62,
      type: 'sawtooth',
      volume: 0.46,
      delay: 0.3,
      filterType: 'bandpass',
      filterFreq: 720,
      filterQ: 3,
      vibrato: { hz: 6.5, depth: 0.035 },
    });
    // 살짝 어긋난 2번째 성대(디튠) → 칩튠 특유의 두께
    this._beep({
      freq: 236,
      toFreq: 112,
      duration: 0.6,
      type: 'square',
      volume: 0.14,
      delay: 0.305,
      filterType: 'lowpass',
      filterFreq: 1800,
    });
    // 숨 들이키는 소리
    this._noise({ duration: 0.16, volume: 0.055, delay: 0.3, filterType: 'bandpass', filterFreq: 900, Q: 1.2 });

    // 마지막 "흐엥..." — 낙담한 저음 여운
    this._beep({
      freq: 147,
      toFreq: 82,
      duration: 0.5,
      type: 'triangle',
      volume: 0.22,
      delay: 0.88,
      vibrato: { hz: 5, depth: 0.03 },
    });
  }

  /** 속도 단계 변경: 짧은 블립 */
  playSpeedChange() {
    this._beep({ freq: 660, toFreq: 880, duration: 0.07, type: 'square', volume: 0.6 });
  }

  /** 음향 on/off 알림 */
  playToggle() {
    this._beep({ freq: 880, toFreq: 440, duration: 0.08, type: 'triangle', volume: 0.7 });
  }

  /** 오디오 장치 정리 (페이지 종료/테스트 종료 시) */
  destroy() {
    this.stopBgm();
    this._noiseBuffer = null;
    this._bus = null;
    this._echo = null;
    this.heartbeatPan = 0;
    if (!this.ctx) return;
    try {
      if (typeof this.ctx.close === 'function') this.ctx.close();
    } catch (err) { /* 무시 */ }
    this.ctx = null;
    this.master = null;
  }

  /**
   * 아이템 섭취 사운드.
   * - 종류를 주면 그 아이템 전용 코믹한 '먹는' 소리를 낸다.
   * - 인자가 없으면 기존 기본 아이템 소리(마림바/벨 느낌의 두 겹 상승 톤)로 폴백한다.
   * - 'PACIFIER'(쪽쪽이)는 playPacifier 로 연결해 침대 스텔스음과 구분한다.
   * - 삼각파·사인파 레이어 + 필터링된 노이즈(_noise)만 사용해 쨍한 사각파가 없다.
   * @param {'MILK'|'CANDY'|'COOKIE'|'PACIFIER'|null} [type] 먹은 아이템 종류
   */
  playItem(type = null) {
    const kind = typeof type === 'string' ? type.toUpperCase() : null;
    if (kind === 'PACIFIER') { this.playPacifier(); return; }
    if (kind === 'MILK') { this._playMilk(); return; }
    if (kind === 'CANDY') { this._playCandy(); return; }
    if (kind === 'COOKIE') { this._playCookie(); return; }

    // 몸통: 부드럽게 감쇠하는 삼각파 (C5 → E5)
    this._beep({
      freq: 523.25, toFreq: 659.25, duration: 0.34, type: 'triangle', volume: 0.46,
      attack: 0.008, sustainLevel: 0.42, pan: -0.14,
    });
    // 반짝임: 한 옥타브 위 사인 배음
    this._beep({
      freq: 1567.98, duration: 0.26, type: 'sine', volume: 0.16,
      attack: 0.006, sustainLevel: 0.25, pan: 0.16, delay: 0.012,
    });
    // 온기: 낮은 사인 서브
    this._beep({ freq: 261.63, duration: 0.22, type: 'sine', volume: 0.14, delay: 0.004 });
  }

  /**
   * 우유 '뽀글-뽀글-뽀글': 노트북/폰 스피커가 잘 내는 420 → 920Hz 대역의 밝은 거품음 3연타.
   * - 예전의 좁은 밴드패스(Q=6)를 걷어내고 사인 글라이드 + 삼각파 몸통을 그대로 내보낸다.
   * - 한 타 75~90ms, 충분한 음량(≈0.35)으로 BGM 위에서도 또렷하게 들린다.
   */
  _playMilk() {
    for (let i = 0; i < 3; i++) {
      const freq = 420 + i * 25;         // 420 / 445 / 470Hz 에서 출발
      const toFreq = 920 - i * 20;       // 920 / 900 / 880Hz 로 통통 튄다
      const duration = 0.09 - i * 0.007; // 90 / 83 / 76ms
      const delay = i * 0.105;
      const volume = 0.35 - i * 0.015;

      // 거품이 목구멍을 타고 올라오는 '뽀글' — 필터 없이 밝게
      this._beep({
        freq,
        toFreq,
        duration,
        type: 'sine',
        volume,
        delay,
        attack: 0.006,
        sustainLevel: 0.6,
        pan: i % 2 === 0 ? -0.1 : 0.1,
      });

      // 몸통: 같은 음역의 삼각파 — 작은 스피커에서도 두께가 느껴진다
      this._beep({
        freq,
        toFreq,
        duration: duration * 0.9,
        type: 'triangle',
        volume: 0.13,
        delay: delay + 0.004,
        attack: 0.005,
        sustainLevel: 0.5,
      });
    }

    // 마지막 물방울 — 넓은 로우패스로 부드럽게
    this._noise({
      duration: 0.055, volume: 0.09, delay: 0.255,
      filterType: 'lowpass', filterFreq: 2600, Q: 0.7,
    });
  }

  /**
   * 사탕 '쪽~ 아작!': 짧은 상승 사인 팝 직후 고주파 노이즈 스냅.
   * - 삼각파 배음으로 단맛을 더하고, 노이즈는 밴드패스/하이패스로만 다듬는다.
   */
  _playCandy() {
    // 1) "쪽~" — 짧고 귀여운 상승 사인 팝
    this._beep({
      freq: 620, toFreq: 1180, duration: 0.075, type: 'sine', volume: 0.46,
      attack: 0.005, sustainLevel: 0.5, pan: -0.12,
    });
    // 2) 반짝이는 삼각파 배음 — 쨍하지 않은 단맛
    this._beep({
      freq: 1240, toFreq: 1860, duration: 0.055, type: 'triangle', volume: 0.2,
      delay: 0.012, pan: 0.16,
    });
    // 3) "아작!" — 고주파 대역의 날카롭고 경쾌한 노이즈 스냅
    this._noise({
      duration: 0.045, volume: 0.16, delay: 0.052,
      filterType: 'bandpass', filterFreq: 4200, Q: 1.1,
    });
    this._noise({
      duration: 0.028, volume: 0.11, delay: 0.086,
      filterType: 'highpass', filterFreq: 5200,
    });
  }

  /**
   * 쿠키 '타닥-딱-탁!': 900~2800Hz 넓은 대역의 묵직한 바삭 노이즈 3타 + 550/780/640Hz 삼각파 타격.
   * - 예전의 22~32ms 얇은 고주파 대신 60~75ms 넓은 밴드(Q≈0.7) 노이즈로 스피커에서도 확실히 들린다.
   * - 짧은 삼각파 타격음을 함께 얹어 경쾌한 과자 씹는 소리를 만든다.
   */
  _playCookie() {
    const crunches = [
      { delay: 0, noiseFreq: 1800, volume: 0.3, duration: 0.07, tone: 550 },
      { delay: 0.084, noiseFreq: 2400, volume: 0.26, duration: 0.066, tone: 780 },
      { delay: 0.162, noiseFreq: 1500, volume: 0.24, duration: 0.06, tone: 640 },
    ];

    crunches.forEach(crunch => {
      // 과자 부스러기가 부서지는 묵직한 바삭 소리 — 좁지 않은 밴드패스(Q 0.7)
      this._noise({
        duration: crunch.duration,
        volume: crunch.volume,
        delay: crunch.delay,
        filterType: 'bandpass',
        filterFreq: crunch.noiseFreq,
        Q: 0.7,
      });

      // 경쾌한 과자 타격음 — 짧은 삼각파
      this._beep({
        freq: crunch.tone,
        toFreq: crunch.tone * 0.78,
        duration: 0.06,
        type: 'triangle',
        volume: 0.18,
        delay: crunch.delay + 0.004,
        attack: 0.004,
        sustainLevel: 0.35,
      });
    });
  }

  /**
   * 쪽쪽이 '쪽! 쪽! 쪽!' — 480 → 1220Hz 로 시원하게 올라가는 사인 팝 + 삼각 배음 3연타.
   * - 예전의 낮은 220Hz / 41ms 대신 스피커가 잘 내는 음역과 75~90ms 길이로 키웠다.
   * - 0.15초 간격, 높은 음량(≈0.35)으로 누구 귀에도 똑똑히 들린다.
   * - 침대 스텔스(880Hz 하강)와 시작 음역이 달라 소리가 확실히 구분된다.
   */
  playPacifier() {
    // 첫 공기 흡입 소리 — 넓은 로우패스로 부드럽게
    this._noise({ duration: 0.05, volume: 0.07, filterType: 'lowpass', filterFreq: 3000, Q: 0.7 });

    for (let i = 0; i < 3; i++) {
      const delay = 0.02 + i * 0.15;
      const freq = 480 + i * 15;
      const toFreq = 1220 + i * 30;
      const duration = 0.09 - i * 0.007; // 90 / 83 / 76ms
      const volume = 0.35 - i * 0.02;

      // "쪽!" — 입술이 떨어지며 시원하게 올라가는 사인
      this._beep({
        freq,
        toFreq,
        duration,
        type: 'sine',
        volume,
        delay,
        attack: 0.006,
        sustainLevel: 0.55,
        pan: i % 2 === 0 ? -0.12 : 0.12,
      });

      // 삼각 배음 — 작은 스피커에서도 존재감이 생긴다
      this._beep({
        freq: freq * 1.5,
        toFreq: toFreq * 1.4,
        duration: duration * 0.85,
        type: 'triangle',
        volume: 0.12,
        delay: delay + 0.003,
        pan: i % 2 === 0 ? 0.12 : -0.12,
      });

      // 빨아들이는 짧은 공기 노이즈 — 넓게
      this._noise({
        duration: 0.035, volume: 0.05, delay: delay + 0.03,
        filterType: 'lowpass', filterFreq: 3200, Q: 0.7,
      });
    }
  }

  /**
   * 아기 울음소리 (Space 울기): "앙~ 앙~ 흐에엥..." 세 마디
   * - 톱니파를 포먼트 필터로 다듬어 사람 목소리에 가깝게 만들고,
   * - 비브라토(울먹임) + 들이키는 숨소리로 리얼한 아기 울음을 만든다.
   */
  playCry() {
    // 1) "앙-" 첫 울음: 상승 글라이드 + 떨림
    this._beep({
      freq: 640,
      toFreq: 1180,
      duration: 0.26,
      type: 'sawtooth',
      volume: 0.42,
      filterType: 'bandpass',
      filterFreq: 1100,
      filterQ: 2.5,
      vibrato: { hz: 11, depth: 0.04 },
    });
    this._noise({ duration: 0.1, volume: 0.05, filterType: 'bandpass', filterFreq: 1600, Q: 1.5 });

    // 2) "앙-" 두 번째: 숨을 들이쉬며 조금 더 높게
    this._beep({
      freq: 700,
      toFreq: 1240,
      duration: 0.3,
      type: 'sawtooth',
      volume: 0.4,
      delay: 0.34,
      filterType: 'bandpass',
      filterFreq: 1250,
      filterQ: 2.5,
      vibrato: { hz: 9, depth: 0.05 },
    });
    this._noise({
      duration: 0.09,
      volume: 0.045,
      delay: 0.34,
      filterType: 'bandpass',
      filterFreq: 1500,
      Q: 1.2,
    });

    // 3) "흐에엥..." 끝이 처지는 긴 울음 (배음 + 저음 화음)
    this._beep({
      freq: 1180,
      toFreq: 560,
      duration: 0.44,
      type: 'sawtooth',
      volume: 0.34,
      delay: 0.72,
      filterType: 'lowpass',
      filterFreq: 2200,
      vibrato: { hz: 7, depth: 0.05 },
    });
    this._beep({ freq: 590, toFreq: 280, duration: 0.42, type: 'triangle', volume: 0.18, delay: 0.73 });
    this._noise({ duration: 0.08, volume: 0.04, delay: 0.72, filterType: 'bandpass', filterFreq: 800 });
  }

  /** 울기 스킬: 아기 울음 + 얼음 결정이 맺히는 소리 */
  playFreeze() {
    this.playCry();
    this._beep({ freq: 2093, toFreq: 2637, duration: 0.08, type: 'sine', volume: 0.22, delay: 0.03 });
    this._beep({ freq: 2637, toFreq: 3136, duration: 0.1, type: 'sine', volume: 0.18, delay: 0.12 });
  }

  /** 침대 스텔스 발동 */
  playStealth() {
    this._beep({ freq: 880, toFreq: 440, duration: 0.22, type: 'sine', volume: 0.7 });
    this._beep({ freq: 1320, toFreq: 660, duration: 0.18, type: 'sine', volume: 0.4, delay: 0.08 });
  }

  /**
   * 슈가 러시: 통통 튀는 상승 아르페지오.
   * - 삼각파 몸통 + 사인 반짝임 레이어로 쨍함 없이 경쾌하게.
   * - 세 음을 좌→우로 흩어 패닝해 입체적으로 들린다.
   */
  playSugarRush() {
    const notes = [
      { freq: 783.99, toFreq: 1046.5, delay: 0, pan: -0.28, volume: 0.4 },
      { freq: 1046.5, toFreq: 1318.51, delay: 0.075, pan: 0.02, volume: 0.36 },
      { freq: 1318.51, toFreq: 1567.98, delay: 0.15, pan: 0.3, volume: 0.32 },
    ];

    notes.forEach(note => {
      this._beep({
        freq: note.freq, toFreq: note.toFreq, duration: 0.22, type: 'triangle',
        volume: note.volume, delay: note.delay,
        attack: 0.008, sustainLevel: 0.4, pan: note.pan,
      });
      this._beep({
        freq: note.freq * 2, duration: 0.12, type: 'sine',
        volume: note.volume * 0.3, delay: note.delay + 0.004, pan: note.pan * 1.2,
      });
    });
  }

  /**
   * 황금 젖병: 반짝이는 팡파르.
   * - C-E-G 마림바 화음(삼각파) 위로 사인 벨이 흩어져 반짝인다.
   */
  playGolden() {
    const chord = [523.25, 659.25, 783.99];

    chord.forEach((freq, index) => {
      this._beep({
        freq, duration: 0.55, type: 'triangle', volume: 0.3,
        delay: index * 0.06, attack: 0.01, sustainLevel: 0.45,
        pan: -0.3 + index * 0.3,
      });
      this._beep({
        freq: freq * 2, duration: 0.36, type: 'sine', volume: 0.14,
        delay: index * 0.06 + 0.01, attack: 0.006, sustainLevel: 0.2,
        pan: 0.3 - index * 0.3,
      });
    });

    // 마지막 반짝임: 위로 미끄러지는 사인 벨
    this._beep({
      freq: 1046.5, toFreq: 1567.98, duration: 0.5, type: 'sine', volume: 0.2,
      delay: 0.22, attack: 0.02, sustainLevel: 0.3,
    });
  }

  /** 스테이지 클리어 (상승 팡파르) */
  playClear() {
    this._beep({ freq: 523, toFreq: 1046, duration: 0.18, type: 'triangle', volume: 0.9 });
    this._beep({ freq: 784, toFreq: 1568, duration: 0.22, type: 'triangle', volume: 0.7, delay: 0.12 });
  }

  /** 게임 오버 (하강 종료음) */
  playGameOver() {
    this._beep({ freq: 392, toFreq: 98, duration: 0.6, type: 'sawtooth', volume: 0.9 });
    this._beep({ freq: 196, toFreq: 65, duration: 0.7, type: 'square', volume: 0.6, delay: 0.1 });
  }

  /**
   * 트랩 배출(싸기) 사운드.
   * - 종류를 주면 트랩별 코믹한 배출음을 낸다.
   * - 인자가 없으면 기존 기본 배출음(짧은 하강 사인)으로 폴백한다.
   * @param {'PEE'|'VOMIT'|'POOP'|null} [type] 배출된 트랩 종류
   */
  playTrap(type = null) {
    const kind = typeof type === 'string' ? type.toUpperCase() : null;
    if (kind === 'PEE') { this._playPee(); return; }
    if (kind === 'VOMIT') { this._playVomit(); return; }
    if (kind === 'POOP') { this._playPoop(); return; }

    this._beep({ freq: 200, toFreq: 90, duration: 0.16, type: 'sine', volume: 0.9 });
  }

  /**
   * 오줌 '피유-피유-피유~': 520 → 1400Hz 로 맑게 솟는 물방울 사인 6연타(55~75ms).
   * - 예전의 45ms 틱보다 길고 큰 소리로 각 물방울이 귀에 또렷하게 들린다.
   * - 넓은 로우패스의 부드러운 물줄기 노이즈를 깔아 흐르는 느낌을 더한다.
   */
  _playPee() {
    const drops = [
      { delay: 0, freq: 520, toFreq: 1400, volume: 0.28 },
      { delay: 0.055, freq: 545, toFreq: 1385, volume: 0.265 },
      { delay: 0.108, freq: 570, toFreq: 1370, volume: 0.25 },
      { delay: 0.163, freq: 595, toFreq: 1355, volume: 0.235 },
      { delay: 0.216, freq: 620, toFreq: 1340, volume: 0.22 },
      { delay: 0.268, freq: 640, toFreq: 1325, volume: 0.205 },
    ];

    drops.forEach((drop, index) => {
      this._beep({
        freq: drop.freq,
        toFreq: drop.toFreq,
        duration: 0.075 - index * 0.004, // 75 → 55ms
        type: 'sine',
        volume: drop.volume,
        delay: drop.delay,
        attack: 0.004,
        sustainLevel: 0.45,
      });
    });

    // 물줄기 — 부드러운 로우패스 노이즈
    this._noise({
      duration: 0.26, volume: 0.1, delay: 0.02,
      filterType: 'lowpass', filterFreq: 3000, Q: 0.7,
    });
  }

  /**
   * 토사물 '우웨엑-꿀렁~': 380 → 145Hz 삼각파+사인파 하강에 빠른 LFO 떨림.
   * - 예전의 낮은 260→110Hz / 좁은 밴드패스 대신 넓은 로우패스(1400→450Hz)를 스윕해 에너지를 살린다.
   * - 높은 음량(≈0.38)으로 코믹한 울렁임이 확실히 들린다.
   */
  _playVomit() {
    this._beep({
      freq: 380,
      toFreq: 145,
      duration: 0.6,
      type: 'triangle',
      volume: 0.38,
      filterType: 'lowpass',
      filterFreq: 1400,
      filterToFreq: 450,
      filterQ: 0.9,
      vibrato: { hz: 16, depth: 0.1 },
      sustainLevel: 0.55,
    });

    // 목 안쪽에서 같이 울리는 사인 — 웅웅거리는 여운
    this._beep({
      freq: 300,
      toFreq: 120,
      duration: 0.55,
      type: 'sine',
      volume: 0.26,
      delay: 0.03,
      filterType: 'lowpass',
      filterFreq: 1100,
      filterToFreq: 380,
      filterQ: 0.8,
      vibrato: { hz: 12, depth: 0.08 },
      sustainLevel: 0.5,
    });

    // 마무리 '꿀렁' — 축축한 노이즈
    this._noise({
      duration: 0.16, volume: 0.12, delay: 0.34,
      filterType: 'lowpass', filterFreq: 900, Q: 0.8,
    });
  }

  /**
   * 똥 '뿡~! / 뿌직!': 낮은 톱니파(68→38Hz) + 20~24Hz 빠른 떨림 + 하강 로우패스 스윕.
   * - 짧은 노이즈 퍼프를 얹어 귀엽고 유쾌한 방귀 느낌을 완성한다.
   */
  _playPoop() {
    this._beep({
      freq: 68,
      toFreq: 38,
      duration: 0.42,
      type: 'sawtooth',
      volume: 0.55,
      filterType: 'lowpass',
      filterFreq: 900,
      filterToFreq: 180,
      vibrato: { hz: 22, depth: 0.14 },
    });

    // 한 옥타브 아래 사각파 — 방귀의 윙윙거리는 배음
    this._beep({
      freq: 46,
      toFreq: 28,
      duration: 0.34,
      type: 'square',
      volume: 0.2,
      delay: 0.02,
      filterType: 'lowpass',
      filterFreq: 420,
      filterToFreq: 140,
      vibrato: { hz: 20, depth: 0.1 },
    });

    // 처음 퍼프 + 끝 '뿌직'
    this._noise({ duration: 0.12, volume: 0.09, delay: 0.02, filterType: 'lowpass', filterFreq: 800 });
    this._noise({ duration: 0.05, volume: 0.06, delay: 0.3, filterType: 'bandpass', filterFreq: 480, Q: 1.4 });
  }

  /**
   * 악당이 트랩을 밟음 / 보행기로 날려버림.
   * - 톱니파/사각파의 공격성은 남기되 lowpass 로 고음을 눌러 쨍함을 줄인다.
   * @param {number} [pan=0] 보모 위치 기준 좌우 패닝 (-0.8 ~ +0.8)
   */
  playTrapHit(pan = 0) {
    this._beep({
      freq: 150, toFreq: 520, duration: 0.22, type: 'sawtooth', volume: 0.8,
      filterType: 'lowpass', filterFreq: 1800, pan,
    });
    this._beep({
      freq: 90, toFreq: 60, duration: 0.18, type: 'square', volume: 0.5,
      delay: 0.06, filterType: 'lowpass', filterFreq: 900, pan,
    });
  }

  // ===== 어둠 모드 근접 경고: 심장박동 =====

  /**
   * 어둠 모드에서 보모가 가까워질수록 빨라지는 심장박동을 재생한다.
   * 게임 루프에서 매 tick 호출하면 내부 타이머가 박동 간격을 조절한다.
   * @param {number} intensity 0(안전) ~ 1(바로 옆)
   * @param {number} dt 경과 시간(ms)
   * @param {number} [pan=0] 가장 가까운 보모 방향 (-0.8 왼쪽 ~ +0.8 오른쪽)
   * @returns {boolean} 이번 호출에서 박동을 냈는지
   */
  updateHeartbeat(intensity = 0, dt = 0, pan = 0) {
    const level = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    this.heartbeatLevel = level;
    this.heartbeatPan = Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0;

    // 위협이 사라지면 즉시 멈추고, 다시 가까워지면 곧바로 박동을 시작한다
    if (level <= 0.02) {
      this.heartbeatTimer = 0;
      return false;
    }

    const interval = HEARTBEAT_MAX_MS - (HEARTBEAT_MAX_MS - HEARTBEAT_MIN_MS) * level;
    this.heartbeatTimer -= Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.heartbeatTimer > 0) return false;

    this.heartbeatTimer = interval;
    this.playHeartbeat(level, this.heartbeatPan);
    return true;
  }

  /** 심장박동 상태 초기화 (일시정지/라운드 전환/게임 오버) */
  resetHeartbeat() {
    this.heartbeatTimer = 0;
    this.heartbeatLevel = 0;
    this.heartbeatPan = 0;
  }

  /**
   * "쿵-덥" 두 박자 저음 심장박동.
   * - 가까울수록 조금 더 높고 크게 울려 심리적 압박감을 준다.
   * - 저역 필터(lowpass)로 가슴을 울리는 둔탁한 느낌을 만든다.
   * - 보모가 있는 쪽으로 살짝 패닝해 어느 쪽에서 오는지 귀로 알 수 있게 한다.
   * @param {number} intensity 0(안전) ~ 1(바로 옆)
   * @param {number} [pan=0] 보모 방향 (-0.8 ~ +0.8)
   */
  playHeartbeat(intensity = 0.5, pan = 0) {
    const level = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0.5;
    const volume = 0.18 + 0.34 * level;

    // "쿵" — 첫 박동
    this._beep({
      freq: 96 + 28 * level,
      toFreq: 46,
      duration: 0.16 + 0.05 * level,
      type: 'sine',
      volume,
      filterType: 'lowpass',
      filterFreq: 240 + 120 * level,
      pan,
    });

    // "덥" — 살짝 약한 두 번째 박동 (심장의 이중 박동)
    this._beep({
      freq: 78 + 18 * level,
      toFreq: 40,
      duration: 0.2 + 0.05 * level,
      type: 'sine',
      volume: volume * 0.62,
      delay: 0.16,
      filterType: 'lowpass',
      filterFreq: 220 + 90 * level,
      pan,
    });
  }
}
