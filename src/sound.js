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

export default class SoundFX {
  constructor() {
    this.enabled = true;   // 음향 on/off
    this.ctx = null;
    this.master = null;
    this.stepToggle = false; // 발걸음 소리 음높이 번갈아 재생

    // BGM 루프 상태
    this.bgmRunning = false;
    this.bgmStep = 0;
    this.bgmNextTime = 0;
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
   */
  _beep({ freq = 440, toFreq = null, duration = 0.12, type = 'square', volume = 1, delay = 0 }) {
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

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  /** 게임 시작: 두 음 상승 차임 */
  playStart() {
    this._beep({ freq: 523, toFreq: 784, duration: 0.16, type: 'triangle', delay: 0 });
    this._beep({ freq: 784, toFreq: 1046, duration: 0.18, type: 'triangle', delay: 0.13 });
  }

  /**
   * 한 타일 이동: 아기 운동화 삑삑 소리 (짧은 고음 두 번, 음높이 교대)
   * - 살짝 위로 미끄러지는 triangle 파형이라 "삑-" 하는 신발 소리가 난다.
   */
  playStep() {
    this.stepToggle = !this.stepToggle;
    const base = this.stepToggle ? 1568 : 1397; // G6 / F6
    this._beep({ freq: base, toFreq: base * 1.32, duration: 0.05, type: 'triangle', volume: 0.5 });
    this._beep({
      freq: base * 1.12,
      toFreq: base * 1.45,
      duration: 0.055,
      type: 'triangle',
      volume: 0.4,
      delay: 0.055,
    });
  }

  /** 체포: 하강하는 경고음 */
  playCaught() {
    this._beep({ freq: 420, toFreq: 90, duration: 0.5, type: 'sawtooth', volume: 0.9 });
    this._beep({ freq: 210, toFreq: 70, duration: 0.5, type: 'square', volume: 0.5, delay: 0.05 });
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
   * 아기 울음소리 (Space 울기): "앙~ 앙~" 흐느끼는 두 마디
   * - 톱니파를 상승 → 하강으로 휘어 아기자기한 울음 느낌을 만든다.
   */
  playCry() {
    this._beep({ freq: 720, toFreq: 1180, duration: 0.22, type: 'sawtooth', volume: 0.45 });
    this._beep({ freq: 1180, toFreq: 640, duration: 0.28, type: 'sawtooth', volume: 0.42, delay: 0.18 });
    this._beep({ freq: 600, toFreq: 940, duration: 0.2, type: 'triangle', volume: 0.32, delay: 0.48 });
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
}
