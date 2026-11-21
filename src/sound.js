/**
 * Pac-Baby: 효과음 모듈 (Web Audio API 합성음)
 *
 * - 외부 오디오 파일 없이 오실레이터로 소리를 만든다.
 * - AudioContext 는 브라우저 정책상 "사용자 입력" 이후에만 재생되므로,
 *   매 재생 시 _ensure() 에서 생성/재개를 시도한다.
 * - 오디오가 없는 환경(Node 테스트 등)에서는 조용히 무시된다.
 */

// ===== 8비트 BGM 설정 =====
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

export default class SoundFX {
  constructor() {
    this.enabled = true;   // 음향 on/off
    this.ctx = null;
    this.master = null;
    this.stepToggle = false; // 발걸음 소리 음높이 번갈아 재생
    this._noiseBuffer = null; // 효과음용 노이즈 원본 (한 번만 생성)
    this._lastUiClickAt = 0;  // UI 클릭음 연타 제한용 타임스탬프(ms)

    // BGM 루프 상태
    this.bgmRunning = false;
    this.bgmStep = 0;
    this.bgmNextTime = 0;

    // 어둠 모드 근접 경고(심장박동) 상태
    this.heartbeatTimer = 0;  // 다음 박동까지 남은 시간(ms)
    this.heartbeatLevel = 0;  // 0(안전) ~ 1(바로 옆)
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

  // ===== 8비트 BGM 루프 =====

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
      this._beepAt(freq, when, BGM_STEP_SEC * 0.85, 'square', 0.16);
    }

    if (step % 4 === 0) {
      const bass = NOTE_FREQ[BGM_BASS[Math.floor(step / 4) % BGM_BASS.length]];
      if (bass) this._beepAt(bass, when, BGM_STEP_SEC * 1.6, 'triangle', 0.12);
    }
  }

  /** 절대 시각(when)에 한 음 예약 */
  _beepAt(freq, when, duration, type = 'square', volume = 0.4) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.01);
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
        this.master.gain.value = 0.4; // 전체 볼륨
        this.master.connect(this.ctx.destination);
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
   * @param {number} options.filterQ 필터 Q (포먼트 날카로움)
   * @param {{hz: number, depth: number}|null} options.vibrato 비브라토(떨림) — 아기 목소리 느낌
   */
  _beep({
    freq = 440, toFreq = null, duration = 0.12, type = 'square', volume = 1, delay = 0,
    filterType = null, filterFreq = 0, filterQ = 1, vibrato = null,
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
      if (filter.Q && typeof filter.Q.setValueAtTime === 'function') {
        filter.Q.setValueAtTime(Math.max(0.0001, filterQ), start);
      }
    }

    // 빠른 어택 → 지수 감쇠: 짧아도 '톡' 하고 때리는 느낌을 만든다
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
    if (duration > 0.16) {
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.62), start + duration * 0.55);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    if (filter) {
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(this.master);
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
   */
  _noise({
    duration = 0.08, volume = 0.2, delay = 0, filterType = 'bandpass', filterFreq = 1200, Q = 1,
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

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.008);
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
    gain.connect(this.master);

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
   * - 살짝 위로 미끄러지는 triangle 파형(고무 마찰) + 짧은 고역 노이즈(바닥 스침)
   * - 음높이를 번갈아 재생해 걸음걸이 리듬을 만든다.
   * - 슈가 러시 중에는 피치를 올리고 길이/노이즈 대역을 더 밝고 짧게 만들어
   *   "경쾌하게 튀는" 발걸음으로 바꾼다.
   * @param {{sugarRush?: boolean}|boolean} [state] 베이비 상태 (true 만 넘겨도 동작)
   */
  playStep(state = {}) {
    // 호환: playStep(true) 로도 슈가 러시 상태를 전달할 수 있다
    const sugarRush = typeof state === 'boolean'
      ? state
      : !!(state && state.sugarRush);

    this.stepToggle = !this.stepToggle;
    const base = this.stepToggle ? 1568 : 1397; // G6 / F6
    const pitch = sugarRush ? 1.35 : 1;         // 슈가 러시: 약 5반음 위로
    const duration = sugarRush ? 0.032 : 0.05;  // 더 짧게 톡톡 튀는 느낌

    // 1) "삑-" 고무가 미끄러지는 주음
    this._beep({
      freq: base * pitch,
      toFreq: base * pitch * 1.3,
      duration,
      type: 'triangle',
      volume: sugarRush ? 0.44 : 0.5,
      filterType: 'highpass',
      filterFreq: sugarRush ? 1200 : 900,
    });

    // 2) 살짝 낮은 화음 — 소리가 얇지 않게 두께를 준다
    this._beep({
      freq: base * pitch * 0.5,
      toFreq: base * pitch * 0.6,
      duration: duration + 0.01,
      type: 'sine',
      volume: sugarRush ? 0.14 : 0.16,
      delay: 0.004,
    });

    // 3) 바닥을 스치는 짧은 '사각' 노이즈 (슈가 러시는 더 높은 대역)
    this._noise({
      duration: sugarRush ? 0.02 : 0.03,
      volume: sugarRush ? 0.07 : 0.09,
      delay: 0.002,
      filterType: 'highpass',
      filterFreq: sugarRush ? 4200 : 2600,
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
    if (!this.ctx) return;
    try {
      if (typeof this.ctx.close === 'function') this.ctx.close();
    } catch (err) { /* 무시 */ }
    this.ctx = null;
    this.master = null;
  }

  /** 아이템 섭취 (4단계에서 사용) */
  playItem() {
    this._beep({ freq: 880, toFreq: 1320, duration: 0.09, type: 'triangle', volume: 0.8 });
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

  /** 슈가 러시: 통통 튀는 상승 아르페지오 */
  playSugarRush() {
    this._beep({ freq: 880, toFreq: 1320, duration: 0.08, type: 'square', volume: 0.55 });
    this._beep({ freq: 1100, toFreq: 1760, duration: 0.1, type: 'square', volume: 0.5, delay: 0.07 });
  }

  /** 황금 젖병: 반짝이는 팡파르 */
  playGolden() {
    this._beep({ freq: 660, toFreq: 990, duration: 0.12, type: 'triangle', volume: 0.8 });
    this._beep({ freq: 990, toFreq: 1480, duration: 0.16, type: 'triangle', volume: 0.7, delay: 0.1 });
    this._beep({ freq: 1480, toFreq: 1980, duration: 0.2, type: 'sine', volume: 0.5, delay: 0.2 });
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

  /** 트랩 배출 (소화 완료) */
  playTrap() {
    this._beep({ freq: 200, toFreq: 90, duration: 0.16, type: 'sine', volume: 0.9 });
  }

  /** 악당이 트랩을 밟음 */
  playTrapHit() {
    this._beep({ freq: 150, toFreq: 520, duration: 0.22, type: 'sawtooth', volume: 0.85 });
    this._beep({ freq: 90, toFreq: 60, duration: 0.18, type: 'square', volume: 0.5, delay: 0.06 });
  }

  // ===== 어둠 모드 근접 경고: 심장박동 =====

  /**
   * 어둠 모드에서 보모가 가까워질수록 빨라지는 심장박동을 재생한다.
   * 게임 루프에서 매 tick 호출하면 내부 타이머가 박동 간격을 조절한다.
   * @param {number} intensity 0(안전) ~ 1(바로 옆)
   * @param {number} dt 경과 시간(ms)
   * @returns {boolean} 이번 호출에서 박동을 냈는지
   */
  updateHeartbeat(intensity = 0, dt = 0) {
    const level = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    this.heartbeatLevel = level;

    // 위협이 사라지면 즉시 멈추고, 다시 가까워지면 곧바로 박동을 시작한다
    if (level <= 0.02) {
      this.heartbeatTimer = 0;
      return false;
    }

    const interval = HEARTBEAT_MAX_MS - (HEARTBEAT_MAX_MS - HEARTBEAT_MIN_MS) * level;
    this.heartbeatTimer -= Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.heartbeatTimer > 0) return false;

    this.heartbeatTimer = interval;
    this.playHeartbeat(level);
    return true;
  }

  /** 심장박동 상태 초기화 (일시정지/라운드 전환/게임 오버) */
  resetHeartbeat() {
    this.heartbeatTimer = 0;
    this.heartbeatLevel = 0;
  }

  /**
   * "쿵-덥" 두 박자 저음 심장박동.
   * - 가까울수록 조금 더 높고 크게 울려 심리적 압박감을 준다.
   * - 저역 필터(lowpass)로 가슴을 울리는 둔탁한 느낌을 만든다.
   * @param {number} intensity 0(안전) ~ 1(바로 옆)
   */
  playHeartbeat(intensity = 0.5) {
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
    });
  }
}
