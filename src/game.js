/**
 * Pac-Baby: 메인 게임 루프
 *
 * requestAnimationFrame 기반 루프.
 * Tick 단위(100ms)로 이동/충돌 처리,
 * 그 사이 프레임은 부드러운 보간(interpolation) 렌더링.
 */

import {
  CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE,
  COLORS, SPEED_LEVELS, DEFAULT_SPEED_LEVEL, ENEMY_SLOWDOWN_FACTOR,
  ENEMY_START_DELAY_MS, CHASE_ENEMY_COUNT,
  RESPAWN_GRACE_MS,
  TRAP_MAX_ACTIVE, TRAP_HIT_SCORE, TRAP_FREEZE_MS, TRAP_COLORS,
  STEALTH_DURATION_MS, ENEMY_CONFUSE_MS,
  READY_COUNTDOWN_MS, SCORE_POPUP_MS, DEMO_IDLE_MS, CAUGHT_STUN_MS, getRoundTitle,
  PLAYER_LIVES, ROUND_CLEAR_MODE, ROUND_TARGET_SCORE, ROUND_SPEED_STEP, HISCORE_KEY,
  SKILL_CRY, PENALTY,
  MAX_DEVICE_PIXEL_RATIO, BABY_LIGHT_RADIUS_TILES, BABY_LIGHT_FEATHER_TILES,
  SUGAR_RUSH, GOLDEN_BOTTLE, GOLDEN_SPAWN, FAKE_PACIFIER, randomPacifierTile,
  GATE_OPEN_MS, GATE_CLOSED_MS, GATE_WARN_MS, GATE_MAX, GATE_POSITIONS,
  VISION_START_ROUND, VISION_START_TILES, VISION_MIN_TILES,
  DARK_HEARTBEAT_WARN_TILES,
} from './constants.js';
import MapRenderer from './map.js';
import BotBrain from './bot.js';
import Player from './player.js';
import Enemy, { ENEMY_MODE, createEnemySpawnPlan } from './enemy.js';
import {
  Item, Trap, drawItemIcon,
  drawHeartIcon, drawCheckIcon, drawIceCrystalIcon, drawSpeakerIcon, drawRobotIcon,
} from './item.js';
import Effects from './effects.js';
import SoundFX, { stereoPanFromTiles } from './sound.js';
import { scoreCapForRound } from './validation.js';

/** 한 프레임에서 처리할 최대 tick 수 (탭 전환 후 폭주 방지) */
const MAX_FRAME_TICKS = 3;

/**
 * 임팩트 연출: 히트스톱(프레임 정지) + 마이크로 줌
 * - 보모를 날려버릴 때 75~90ms 동안 화면을 멈춰 타격감을 준다.
 * - 체포될 때는 75ms 동안 멈춘다.
 * - 멈춘 동안 베이비 중심으로 1.05~1.07배 줌인했다가 부드럽게 원복한다.
 */
const HIT_STOP_KNOCK_MS = 85;
const HIT_STOP_CAUGHT_MS = 75;
const IMPACT_ZOOM_KNOCK = 1.06;
const IMPACT_ZOOM_CAUGHT = 1.06;
const IMPACT_ZOOM_MS = 280;

/** 임팩트 줌 커브: 빠르게 최대치까지 당긴 뒤(22%) 남은 시간 동안 ease-out 으로 복귀 */
const ZOOM_ATTACK_RATIO = 0.22;

/** localStorage 안전 접근 (없거나 차단된 환경은 null) */
function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (err) { /* 접근 차단 환경 */ }
  return null;
}

// ===== 데모 안내 문구 (PC / 터치 기기) =====
// 기기별 문구는 순수 헬퍼로 분리해 단위 테스트에서 분기를 검증한다.
export const DEMO_HINT_PC = '게임 하시려면 아무 키나 누르세요';
export const DEMO_HINT_TOUCH = '게임 하시려면 터치 하세요';

/**
 * 데모 안내 문구 선택 (순수 함수)
 * @param {boolean} isTouch 터치 지원 기기 여부
 * @returns {string}
 */
export function demoHintFor(isTouch) {
  return isTouch ? DEMO_HINT_TOUCH : DEMO_HINT_PC;
}

/**
 * 터치 지원 기기(안드로이드/iOS 등) 판별.
 * - `options.touch` 가 boolean 이면 그 값을 그대로 쓴다 (테스트용 오버라이드).
 * - D-패드가 활성화된 `body.touch-active`, coarse pointer, maxTouchPoints 를 차례로 확인한다.
 * @param {{touch?: boolean, window?: object, document?: object, navigator?: object}} [options]
 * @returns {boolean}
 */
export function detectTouchDevice(options = {}) {
  if (typeof options.touch === 'boolean') return options.touch;

  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const nav = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);

  if (doc?.body?.classList?.contains?.('touch-active')) return true;

  try {
    if (win && typeof win.matchMedia === 'function') {
      if (win.matchMedia('(pointer: coarse)')?.matches) return true;
      if (win.matchMedia('(any-pointer: coarse)')?.matches) return true;
    }
  } catch (err) { /* matchMedia 미지원/차단 환경 무시 */ }

  if (nav && Number(nav.maxTouchPoints) > 0) return true;
  if (win && 'ontouchstart' in win) return true;
  return false;
}

/**
 * 터치 D-패드가 실제로 화면에 떠 있는지 판별 (순수 함수).
 * - 하단 HUD 의 키보드 안내는 "D-패드가 보일 때"만 숨긴다.
 * - Windows 터치스크린 PC 처럼 `maxTouchPoints`/`ontouchstart` 신호만 있고
 *   D-패드가 표시되지 않는 환경에서 키 안내가 사라지는 버그를 막는다.
 * @param {{touchUi?: boolean, document?: object}} [options]
 * @returns {boolean}
 */
export function isTouchUiActive(options = {}) {
  if (typeof options.touchUi === 'boolean') return options.touchUi;
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  return !!doc?.body?.classList?.contains?.('touch-active');
}

export default class Game {
  constructor(canvas, inputManager, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = inputManager;

    // 게임 오브젝트
    this.map = new MapRenderer();
    // 이동 판정용 맵 사본 (닫힌 철창문을 벽(1)으로 반영)
    this.navMap = this.map.map.map(row => row.slice());
    this.gates = [];
    this.gateClock = 0;

    this.player = new Player(this.map.babySpawn);
    this.rng = Math.random; // 아이템/순찰 위치 선택용 난수 (테스트에서 주입 가능)

    // 앞의 CHASE_ENEMY_COUNT 명은 추격, 나머지는 경비(순찰)
    this._buildEnemies(1);
    this.items = [];
    this.traps = [];

    // 아이템 스폰 (테스트용 — 모든 4 타일에 아이템 배치)
    this._initItems();
    // 맵 정중앙의 슈퍼 아이템 '황금 젖병'
    this.goldenBottle = null;
    this._initGoldenBottle();

    // 특수 아이템 '가짜 젖꼭지(쪽쪽이)' — 라운드 중 최대 1개, 클리어 카운트와 분리
    this.pacifier = null;
    this._initPacifier();

    // 효과음 & 속도 단계
    // 재시작 시 같은 SoundFX 를 재사용해 AudioContext 가 누적되지 않게 한다
    this.sound = options.sound || new SoundFX();
    this.effects = new Effects(); // 파티클/플래시/셰이크
    this.speedLevel = DEFAULT_SPEED_LEVEL;

    // 파워업 타이머 (슈가 러시 / 황금 젖병 보행기 모드)
    this.sugarRushTimer = 0;
    this.goldenTimer = 0;

    this._baseTickMs = SPEED_LEVELS[this.speedLevel - 1].babyTileMs;
    this.tickMs = this._baseTickMs;
    this._applySpeedLevel();

    // 레티나(고해상도) 대응: 캔버스 내부 해상도를 실제 픽셀 밀도에 맞춘다
    this.dpr = 1;
    this.animTime = 0; // 캐릭터/아이템 애니메이션용 시간(ms)
    this.applyPixelRatio();

    // 게임 상태
    this.running = false;
    this.loopToken = 0;            // [게임 종료] 후 재시작 시 이전 rAF 체인을 무효화
    this.tickAccumulator = 0;
    this.lastTime = 0;
    this.graceTimer = 0;   // 체포 직후 무적 시간
    this.catchCount = 0;   // 체포 횟수 (HUD 표시용)
    this.cryCooldown = 0;  // 울기 재사용 대기(ms)
    this.heartbeatIntensity = 0; // 어둠 모드 보모 근접 경고 강도 (0 = 안전 ~ 1 = 바로 옆)
    this.heartbeatPan = 0;       // 가장 가까운 보모의 좌우 방향 (-0.8 왼쪽 ~ +0.8 오른쪽)

    // 임팩트 연출 (히트스톱 + 베이비 중심 마이크로 줌)
    this.hitStopMs = 0;     // 남은 프레임 정지 시간(ms) — 0 이면 정상 진행
    this.zoomTimer = 0;     // 남은 줌 펄스 시간(ms)
    this.zoomDuration = 0;  // 줌 펄스 총 길이(ms)
    this.zoomPeak = 1;      // 줌 최대 배율 (1.05~1.07)

    // 침대 스텔스
    this.stealthBed = null; // 스텔스에 사용 중인 침대 { row, col }
    // 시작 위치가 침대이므로 "이미 침대 위" 상태로 시작 (자동 발동 방지)
    this._wasOnBed = this.map.map[this.map.babySpawn.row][this.map.babySpawn.col] === 2;

    // 게임 상태 (READY | PLAYING | PAUSED | CAUGHT | STAGE_CLEAR | GAME_OVER)
    this.state = 'READY';
    this.helpOpen = false;         // 사용 설명서(도움말) 열림 여부 — 열려 있으면 로직/입력 정지
    this.readyTimer = READY_COUNTDOWN_MS;
    this.caughtTimer = 0;          // 체포 연출(Oh! No~) 남은 시간 — 동안 베이비/보모 정지
    this._inRealtimeTick = false;  // 실시간 루프가 _update 를 돌리는 중인지 (연출 조건)
    this.scorePopups = [];         // { row, col, text, color, life, maxLife }
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0, sugar: 0, golden: 0, knocks: 0, pacifier: 0 };
    this.tester = null;            // 테스터 모드 연결 지점 (src/tester.js)

    // ===== 봇 / 데모 플레이 =====
    this.bot = new BotBrain();
    this.botMode = false;          // F2/모바일에서 명시적으로 켠 BOT
    this.demoMode = false;         // 무입력 5초 후 자동 / [데모 실행] 버튼으로 시작된 DEMO
    this.demoArmed = true;         // 최초 로딩 후 한 번만 자동 데모 허용
    this.autoDemoConsumed = false; // 접속 세션 동안 자동 데모 사용/수동 시작 여부 (다시 무장하지 않는다)
    this.demoIdleMs = 0;
    this.demoDelayMs = options.demoDelayMs ?? DEMO_IDLE_MS;
    // 테스트용 기기 판별 오버라이드 (true=터치 기기 / false=PC, undefined=자동 감지)
    this.demoTouchOverride = typeof options.demoTouch === 'boolean' ? options.demoTouch : null;
    this.demoTouchDetected = undefined; // 자동 감지 결과 캐시 (렌더마다 matchMedia 조회 방지)
    // 하단 HUD 키 안내 표시용: D-패드(body.touch-active) 오버라이드 (테스트/외부 제어)
    this.touchUiOverride = typeof options.touchUi === 'boolean' ? options.touchUi : null;
    this.lastInputActivitySeq = Number.isFinite(this.input?.activitySeq)
      ? this.input.activitySeq
      : 0;
    this.onBotStateChange = null;

    // ===== 글로벌 기록용 런 추적 =====
    this.onRunStart = typeof options.onRunStart === 'function' ? options.onRunStart : null;
    this.onRunEnd = typeof options.onRunEnd === 'function' ? options.onRunEnd : null;
    this.runStartedAt = 0;
    this.runAssisted = false;

    // 진행 상태 (9단계: 목숨/라운드/하이스코어)
    this.storage = options.storage || safeStorage();
    this.lives = PLAYER_LIVES;
    this.round = 1;
    this.roundStartScore = 0;
    this.roundItemsEaten = 0;
    // 라운드별 점수 상한(서버 SCORE_EXCEEDS_CAP 미러) 도달 여부 — HUD 'Score Cleared' 표시
    this.scoreCapReached = false;
    this.hiScore = this._loadHiScore();
    this.newRecord = false;
    this.baseSpeedLevel = this.speedLevel;

    // 1라운드는 철창문/시야 제한 없음
    this._initGates(this.round);

    // 초기 런 시작 시각 기록 (상위 ProfileManager 가 run 토큰을 발급한다)
    this._beginRun();
  }

  /** 현재 봇이 조작 중인지 (데모 / 명시적 BOT / 테스터 BOT) */
  get isBotActive() {
    return this.botMode || this.demoMode || this.tester?.mode === 'BOT';
  }

  /**
   * BOT 치트(D-패드 자리 배지/[BOT 종료] 표시 대상)가 실행 중인지.
   * - 자동/버튼 데모(DEMO 오버레이)는 제외하고 명시적 BOT · F2 테스터 BOT 만 포함한다.
   */
  get isBotCheatActive() {
    return this.botMode || this.tester?.mode === 'BOT';
  }

  /** 하단 HUD 키보드 안내를 숨겨야 하는지 (D-패드가 실제 표시 중일 때만 true) */
  isTouchUiVisible() {
    if (typeof this.touchUiOverride === 'boolean') return this.touchUiOverride;
    return isTouchUiActive();
  }

  /** 데모 안내 문구용 터치 기기 판별 (테스트 오버라이드 우선) */
  isTouchDemoDevice() {
    if (typeof this.demoTouchOverride === 'boolean') return this.demoTouchOverride;
    if (typeof this.demoTouchDetected !== 'boolean') {
      this.demoTouchDetected = detectTouchDevice();
    }
    return this.demoTouchDetected;
  }

  /** 현재 기기에 맞는 데모 안내 문구 (PC / 터치) */
  get demoHint() {
    return demoHintFor(this.isTouchDemoDevice());
  }

  /** 봇 상태 변경 리스너 (모바일 [🤖 BOT] 버튼 동기화용) */
  setBotStateListener(listener) {
    this.onBotStateChange = typeof listener === 'function' ? listener : null;
    this._notifyBotState();
    return this;
  }

  _notifyBotState() {
    if (!this.onBotStateChange) return;
    this.onBotStateChange({
      botMode: !!this.botMode,
      demoMode: !!this.demoMode,
      active: this.isBotActive,
      cheatActive: this.isBotCheatActive,
    });
  }

  /** 외부(테스터 등)에서 봇 상태 변경을 알릴 때 쓰는 공개 훅 */
  notifyBotState() {
    this._notifyBotState();
    return this.isBotActive;
  }

  /**
   * 키보드/터치 등 사용자 입력 감지.
   * - 자동 데모를 즉시 종료하고 수동 플레이(MANUAL)로 전환한다.
   * - 데모 판을 이어받지 않고 1라운드·0점·목숨 3의 새 매뉴얼 런으로 재시작한다.
   * - 명시적으로 켠 BOT 모드는 유지한다 (버튼으로만 끈다).
   * @param {{restart?: boolean}} [options] restart=false 면 데모 종료만 하고 재시작은 호출부가 맡는다
   * @returns {boolean} 데모에서 매뉴얼로 전환했는지
   */
  noteUserActivity(options = {}) {
    const seq = this.input?.activitySeq;
    if (Number.isFinite(seq)) this.lastInputActivitySeq = seq;

    // 접속 세션 동안 자동 데모는 다시 무장하지 않는다
    this.autoDemoConsumed = true;
    this.demoArmed = false;
    this.demoIdleMs = 0;

    if (!this.demoMode) return false;

    this.demoMode = false;
    this.tester?.log?.('demo', '사용자 입력 → MANUAL 전환');

    if (options.restart !== false) {
      // 데모 점수/라운드를 이어받지 않는다. resetAll 이 정식 런(onRunStart)을 새로 시작한다.
      this.resetAll();
    } else {
      this._notifyBotState();
    }
    return true;
  }

  /**
   * 모바일 [🤖 BOT] 버튼 / 외부 제어용 토글.
   * 데모/테스터 BOT이 켜져 있으면 모두 끄고 수동으로 돌아간다.
   * @returns {boolean} 토글 후 봇 활성 여부
   */
  toggleBot() {
    if (this.isBotActive) {
      const wasDemo = this.demoMode;
      this.botMode = false;
      this.demoMode = false;
      this.demoArmed = false;
      this.autoDemoConsumed = true;
      this.demoIdleMs = 0;
      if (this.tester?.mode === 'BOT') this.tester.stopAll?.();

      // 데모 판을 이어받지 않는다 — 끄는 순간 새 매뉴얼 런으로 재시작
      if (wasDemo) {
        this.resetAll();
      } else {
        this._notifyBotState();
      }
      return false;
    }

    // REPLAY 중이면 먼저 종료하고 봇이 입력을 가져가게 한다
    if (this.tester?.mode === 'REPLAY') this.tester.stopAll?.();

    this.botMode = true;
    this.demoMode = false;
    this.demoArmed = false;
    this.autoDemoConsumed = true;
    this.demoIdleMs = 0;

    if (this.state === 'PAUSED' && !this.tester?.flags?.step) {
      this.state = 'PLAYING';
      this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    this.tester?.log?.('bot', 'BOT 모드 시작 (외부 버튼)');
    this._notifyBotState();
    return true;
  }

  /**
   * 프로필 배지 3연타 → BOT 치트 즉시 실행.
   * - 1라운드 · 0점 · 목숨 3의 새 판을 READY 없이 바로 PLAYING 으로 시작한다.
   * - 서버 런(onRunStart)은 시작하지 않고 `runAssisted = true` 로 랭킹에서 제외한다.
   * - F2 테스터의 BOT/REPLAY 가 켜져 있으면 먼저 정리한다.
   * @returns {boolean} 항상 true
   */
  startBotCheat() {
    // 진행 중인 정식 매뉴얼 런의 점수는 버리지 않고 먼저 제출한다.
    if (!this.runAssisted && !this.runEnded && this.player.score > 0) this._endRun();

    if (this.tester && this.tester.mode !== 'MANUAL') this.tester.stopAll?.();

    // 새 판(1라운드·0점·목숨 3) + READY 없이 바로 플레이 + assisted
    this._resetDemoBoard();
    this.demoMode = false;   // 큰 DEMO 오버레이 대신 BOT 배지로 표시
    this.botMode = true;
    this.runAssisted = true; // 랭킹 제외
    this.demoArmed = false;
    this.autoDemoConsumed = true;
    this.demoIdleMs = 0;

    this.tester?.log?.('bot', '프로필 배지 3연타 → BOT 치트 시작 (랭킹 제외)');
    this._notifyBotState();
    return true;
  }

  /**
   * BOT(및 F2 테스터 BOT)을 종료하고 매뉴얼 READY 대기 모드로 복귀한다.
   * - 1라운드 · 0점 · 목숨 3 · `runAssisted = false` 의 새 매뉴얼 런을 시작한다.
   * - 봇이 만든 점수는 제출하지 않는다 (자산이 아니라 치트 기록).
   * @returns {string} 전환 후 상태 ('READY')
   */
  exitBotToManual() {
    const hadBot = this.isBotActive;

    // 봇이 만든 점수가 resetAll 에서 제출되지 않도록 assisted 로 표시
    if (hadBot) this.runAssisted = true;

    this.botMode = false;
    this.demoMode = false;
    if (this.tester && this.tester.mode !== 'MANUAL') this.tester.stopAll?.();

    this.demoArmed = false;
    this.autoDemoConsumed = true;
    this.demoIdleMs = 0;

    // resetAll 이 새 매뉴얼 런(onRunStart, runAssisted=false)과 READY 보드를 구성한다
    this.resetAll();
    this.state = 'READY';
    this.readyTimer = READY_COUNTDOWN_MS;
    this.tickAccumulator = 0;

    this.tester?.log?.('bot', 'BOT 종료 → 매뉴얼 READY 복귀');
    this._notifyBotState();
    return this.state;
  }

  /**
   * 무입력 5초 자동 데모 시작 (접속 세션당 1회).
   * - 사용자가 한 번이라도 매뉴얼 플레이를 시작했으면(autoDemoConsumed) 다시 켜지 않는다.
   * - 데모 판은 서버 런/하이스코어와 완전히 분리해 새로 구성한다.
   */
  _startAutoDemo() {
    if (this.autoDemoConsumed || !this.demoArmed || this.demoMode || this.botMode) return false;
    if (this.tester && this.tester.mode !== 'MANUAL') {
      this.demoArmed = false;
      return false;
    }
    if (this.state !== 'READY' && this.state !== 'PLAYING') return false;

    this._resetDemoBoard();
    this.tester?.log?.('demo', `무입력 ${Math.round(this.demoDelayMs / 1000)}초 → DEMO PLAY 시작`);
    return true;
  }

  /** READY/PLAYING 중 사용자 입력 없이 흐른 시간을 누적한다 */
  _updateDemoTimer(dt) {
    if (this.autoDemoConsumed || !this.demoArmed || this.demoMode || this.botMode) return;
    if (this.state !== 'READY' && this.state !== 'PLAYING') return;
    if (this.tester && this.tester.mode !== 'MANUAL') {
      this.demoArmed = false;
      return;
    }

    this.demoIdleMs += Math.max(0, dt);
    if (this.demoIdleMs >= this.demoDelayMs) this._startAutoDemo();
  }

  /** InputManager.activitySeq 변화 = 실제 사용자 입력 */
  _checkUserActivity() {
    // 설명서(모달) 조작은 게임 플레이 입력이 아니므로 데모 대기 시간을 건드리지 않는다.
    if (this.helpOpen) return;

    const seq = this.input?.activitySeq;
    if (!Number.isFinite(seq) || seq === this.lastInputActivitySeq) return;
    this.lastInputActivitySeq = seq;
    this.noteUserActivity();
  }

  /** 봇이 위기라고 판단하면 키 입력 없이 울기 실행 */
  _handleBotSkill() {
    if (!this.botMode && !this.demoMode) return;
    if (this.tester && this.tester.mode !== 'MANUAL') return;
    if (this.bot.shouldCry(this)) this._useCry(true);
  }

  /**
   * 도움말 모달의 [게임 시작/재개] (+ 외부 호환용 demo/exit 동작)
   * - 실제 UI 의 [게임 종료] 는 main.js 가 game.exitGame() 을 직접 호출해
   *   전용 종료 화면(#exit-overlay)을 띄운다.
   */
  handleHelpAction(action) {
    if (action === 'start') return this.startFromHelp();
    if (action === 'demo') return this.startDemoFromHelp();
    // 외부 호출 호환: READY 로비로 완전 복귀
    if (action === 'exit-lobby') return this.resetToLobby();
    // (기존 'exit' 동작은 단위 테스트/외부 호환을 위해 일시정지로 유지)
    if (action === 'exit') return this.pauseFromHelp();
    return this.state;
  }

  /** 도움말에서 수동 플레이 시작/재개 */
  startFromHelp() {
    this.noteUserActivity();
    this.botMode = false;
    this.demoMode = false;
    this.demoArmed = false;
    this.demoIdleMs = 0;

    if (this.tester && this.tester.mode !== 'MANUAL') this.tester.stopAll?.();

    if (this.state === 'GAME_OVER') {
      this.resetAll();
    } else if (this.state === 'STAGE_CLEAR') {
      this._startRound(this.round + 1);
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.tickAccumulator = 0;
      this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    this._notifyBotState();
    return this.state;
  }

  /** 도움말에서 데모 플레이 바로 시작 */
  startDemoFromHelp() {
    this.startDemo();
    this.tester?.log?.('demo', '도움말에서 DEMO PLAY 시작');
    return true;
  }

  /**
   * 명시적 [데모 실행] — 접속 중 언제든 새 데모 판을 시작한다.
   * - 서버 런 시작/점수 제출/하이스코어 저장과 완전히 분리한다.
   * - 이미 데모 중이면 처음부터 다시 시작한다.
   */
  startDemo() {
    // restart=false: 데모에서 빠져나올 때 매뉴얼 런을 새로 시작하지 않는다
    this.noteUserActivity({ restart: false });
    if (this.tester && this.tester.mode !== 'MANUAL') this.tester.stopAll?.();
    this._resetDemoBoard();
    this.tester?.log?.('demo', '명시적 DEMO PLAY 시작');
    return true;
  }

  /**
   * 데모 판을 1라운드 · 0점 · 목숨 3으로 새로 구성한다.
   * - `_beginRun`(onRunStart) / `_updateHiScore`(localStorage) / `_endRun`(submit) 을 호출하지 않는다.
   * - 데모 런은 항상 assisted 로 표시해 어떤 경로로도 제출되지 않게 한다.
   */
  _resetDemoBoard() {
    this.runStartedAt = null;
    this.runAssisted = true;

    this.player.score = 0;
    this.lives = PLAYER_LIVES;
    this.round = 1;
    this.catchCount = 0;
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0, sugar: 0, golden: 0, knocks: 0, pacifier: 0 };
    this.newRecord = false;
    this.speedLevel = DEFAULT_SPEED_LEVEL;
    this.baseSpeedLevel = DEFAULT_SPEED_LEVEL;
    this._resetBoard();

    this.demoMode = true;
    this.botMode = false;
    this.demoArmed = false;
    this.autoDemoConsumed = true;
    this.demoIdleMs = 0;

    // 데모는 READY 카운트다운 없이 바로 움직인다
    this.state = 'PLAYING';
    this.readyTimer = 0;
    this.tickAccumulator = 0;

    this._notifyBotState();
    return this;
  }

  /** 도움말에서 게임 종료(일시정지) */
  pauseFromHelp() {
    this.noteUserActivity();
    this.botMode = false;
    this.demoMode = false;
    this.demoArmed = false;
    this.demoIdleMs = 0;

    if (this.tester && this.tester.mode !== 'MANUAL') this.tester.stopAll?.();

    if (this.state === 'READY' || this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.tickAccumulator = 0;
      this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    this._notifyBotState();
    return this.state;
  }

  /** 아이템 초기 배치 */
  _initItems() {
    const itemTypes = ['MILK', 'CANDY', 'COOKIE'];
    this.map.itemSpawns.forEach((pos, index) => {
      const type = itemTypes[index % itemTypes.length];
      this.items.push(new Item(pos.row, pos.col, type));
    });
  }

  /** 맵 정중앙에 황금 젖병 배치 (먹은 뒤 20초 후 제자리에 다시 나타난다) */
  _initGoldenBottle() {
    this.goldenBottle = new Item(
      GOLDEN_SPAWN.row, GOLDEN_SPAWN.col, 'GOLDEN', { fixed: true },
    );
  }

  /**
   * 쪽쪽이 스폰/리스폰 시 피해야 하는 타일 목록.
   * - 기존 아이템/황금 젖병/닫힌 철창문
   * - 플레이어·보모의 2타일 이내(체비셰프 거리)
   * - 리스폰이면 방금 있던 타일 (항상 다른 빈 타일에 나타나게)
   * @param {{includeSelf?: boolean}} [options]
   * @returns {Array<{row: number, col: number}>}
   */
  _pacifierAvoid(options = {}) {
    const includeSelf = options.includeSelf !== false;
    const avoid = [];

    for (const item of this.items || []) {
      if (!item.collected) avoid.push({ row: item.row, col: item.col });
    }
    if (this.goldenBottle && !this.goldenBottle.collected) {
      avoid.push({ row: this.goldenBottle.row, col: this.goldenBottle.col });
    }
    for (const gate of this.gates || []) {
      avoid.push({ row: gate.row, col: gate.col });
    }

    // 침대(2)·보모 대기실(3) 타일은 리스폰(randomWalkableTile)에서도 제외한다
    const sourceMap = this.map?.map || this.navMap;
    for (let row = 0; row < sourceMap.length; row++) {
      for (let col = 0; col < sourceMap[row].length; col++) {
        if (sourceMap[row][col] === 2 || sourceMap[row][col] === 3) {
          avoid.push({ row, col });
        }
      }
    }

    const radius = FAKE_PACIFIER.minSpawnDistanceTiles;
    const actors = [
      { row: this.player.row, col: this.player.col },
      ...(this.enemies || []).map(enemy => ({ row: enemy.row, col: enemy.col })),
    ];
    for (const actor of actors) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          avoid.push({ row: actor.row + dr, col: actor.col + dc });
        }
      }
    }

    if (includeSelf && this.pacifier) {
      avoid.push({ row: this.pacifier.row, col: this.pacifier.col });
    }

    return avoid;
  }

  /**
   * 랜덤 빈 복도 타일에 가짜 젖꼭지(쪽쪽이) 배치 — 라운드 중 최대 1개.
   * (벽·침대·보모 대기실·기존 아이템·플레이어/보모 인접 타일 제외)
   * @returns {Item|null}
   */
  _initPacifier() {
    const spot = randomPacifierTile(this.navMap, this.rng, this._pacifierAvoid());
    if (!spot) return null;

    this.pacifier = new Item(spot.row, spot.col, 'PACIFIER');
    return this.pacifier;
  }

  // ===== 고라운드 난이도: 악당 수 / 철창문 / 시야 =====

  /**
   * 라운드별 악당 편성.
   * - 기본 4마리 (추격 2 + 순찰 2)
   * - 4라운드: 추격 +1 (총 5)
   * - 5라운드: 순찰 +1 (총 6)
   * @param {number} round
   * @returns {Enemy[]}
   */
  _buildEnemies(round) {
    const baseCount = this.map.enemySpawns.length;
    const extraCount = (round >= 4 ? 1 : 0) + (round >= 5 ? 1 : 0);
    const totalCount = baseCount + extraCount;

    // 3x3 구역의 중앙(2행 2열)을 제외한 8개 구역에서 무작위로 배치한다.
    // 같은 타일/인접 타일은 피하고, 바닥(0)만 사용한다.
    const spawns = createEnemySpawnPlan(this.map.map, totalCount, this.rng);

    const modes = [];
    for (let index = 0; index < baseCount; index++) {
      modes.push(index < CHASE_ENEMY_COUNT ? ENEMY_MODE.CHASE : ENEMY_MODE.PATROL);
    }
    if (round >= 4) modes.push(ENEMY_MODE.CHASE);
    if (round >= 5) modes.push(ENEMY_MODE.PATROL);

    const configs = spawns.map((pos, index) => ({
      spawn: pos,
      mode: modes[index] || ENEMY_MODE.PATROL,
    }));

    this.enemies = configs.map((config, index) => new Enemy(
      config.spawn,
      index,
      ENEMY_START_DELAY_MS + index * 300,
      config.mode,
      this.rng,
    ));
    return this.enemies;
  }

  /**
   * 라운드별 철창문 배치.
   * - 6라운드: 1개
   * - 이후 2라운드마다 +1 (8→2, 10→3, 12→4), 최대 4개
   * @param {number} round
   */
  _initGates(round) {
    const count = Math.min(
      GATE_MAX,
      Math.max(0, Math.floor((round - 4) / 2)),
    );

    this.gates = GATE_POSITIONS.slice(0, count).map((pos) => ({
      row: pos.row,
      col: pos.col,
      closed: false,
      anim: 1, // 1 = 완전히 열림, 0 = 완전히 닫힘 (시각용)
    }));
    this.gateClock = 0;
    this._refreshNavMap();
  }

  /** 닫힌 철창문을 이동 불가(1)로 반영한 길찾기용 맵을 갱신한다 */
  _refreshNavMap() {
    if (!this.navMap) return;

    // 이전 라운드의 철창문 흔적까지 지우기 위해 원본 맵에서 다시 복사한다
    for (let row = 0; row < this.map.map.length; row++) {
      const source = this.map.map[row];
      const target = this.navMap[row];
      for (let col = 0; col < source.length; col++) {
        target[col] = source[col];
      }
    }

    for (const gate of this.gates) {
      if (gate.closed) this.navMap[gate.row][gate.col] = 1;
    }
  }

  /** 철창문 위에 베이비/악당이 있으면 닫히지 않게 한다 */
  _isGateOccupied(gate) {
    if (this.player.row === gate.row && this.player.col === gate.col) return true;
    return this.enemies.some(e => e.row === gate.row && e.col === gate.col);
  }

  /** 철창문 주기 갱신 (열림 3초 → 닫힘 3초 반복) */
  _updateGates(dt) {
    if (this.gates.length === 0) return;

    this.gateClock += dt;
    const cycle = GATE_OPEN_MS + GATE_CLOSED_MS;
    const wantClosed = (this.gateClock % cycle) >= GATE_OPEN_MS;
    let navChanged = false;

    for (const gate of this.gates) {
      let closed = wantClosed;

      // 문 위에 사람이 있으면 닫히지 않고 기다린다
      if (closed && this._isGateOccupied(gate)) closed = false;

      if (closed !== gate.closed) {
        gate.closed = closed;
        navChanged = true;
      }

      // 철창이 미끄러지듯 열리고 닫히는 시각 효과
      const target = gate.closed ? 0 : 1;
      const step = dt > 0 ? Math.min(1, dt / 500) : 1;
      gate.anim += (target - gate.anim) * step;
      if (Math.abs(gate.anim - target) < 0.01) gate.anim = target;
    }

    if (navChanged) this._refreshNavMap();
  }

  /** 8라운드부터 시야 제한(어둠) 활성화 */
  get darkMode() {
    return this.round >= VISION_START_ROUND;
  }

  /** 현재 라운드의 시야 반경(타일): 8라운드 8 → 라운드마다 -1 → 최소 3 */
  get visionTiles() {
    if (!this.darkMode) return VISION_START_TILES;
    return Math.max(
      VISION_MIN_TILES,
      VISION_START_TILES - (this.round - VISION_START_ROUND),
    );
  }

  /**
   * 속도 단계 적용 (1 = 가장 느림 ~ 10 = 가장 빠름)
   * 베이비 tick 간격과 보모 이동 시간을 함께 조정한다.
   */
  _applySpeedLevel() {
    const config = SPEED_LEVELS[this.speedLevel - 1];
    this._baseTickMs = config.babyTileMs;

    // 파워업(슈가 러시 / 보행기 모드) 중이면 tick 간격을 줄여 실제 속도를 높인다
    this.tickMs = this._boostedTickMs(this._baseTickMs);

    // 악당은 어떤 단계에서도 베이비보다 느려야 한다
    const enemyTileMs = Math.max(
      config.enemyTileMs,
      Math.round(config.babyTileMs * ENEMY_SLOWDOWN_FACTOR),
    );
    this.enemies.forEach(e => { e.baseTileMs = enemyTileMs; });
  }

  /** 현재 적용 중인 파워업 속도 배율 (없으면 1) */
  _currentSpeedMultiplier() {
    let multiplier = 1;
    if ((this.sugarRushTimer || 0) > 0) {
      multiplier = Math.max(multiplier, SUGAR_RUSH.speedMultiplier);
    }
    if ((this.goldenTimer || 0) > 0) {
      multiplier = Math.max(multiplier, GOLDEN_BOTTLE.speedMultiplier);
    }
    return multiplier;
  }

  /** 배율이 적용된 tick 간격 (ms) */
  _boostedTickMs(baseTickMs) {
    const multiplier = this._currentSpeedMultiplier();
    if (!(multiplier > 1)) return baseTickMs;
    return Math.max(60, Math.round(baseTickMs / multiplier));
  }

  /**
   * 파워업 시작/종료 시 tick 간격 재계산.
   * 진행 중이던 타일 이동 비율을 유지해 화면이 튀지 않게 한다.
   * @returns {number} 적용된 tick 간격
   */
  _refreshTickRate() {
    const nextTickMs = this._boostedTickMs(this._baseTickMs);
    if (nextTickMs === this.tickMs) return this.tickMs;

    const oldTickMs = this.tickMs > 0 ? this.tickMs : nextTickMs;
    const progress = Math.min(1, Math.max(0, (this.tickAccumulator || 0) / oldTickMs));
    this.tickMs = nextTickMs;
    this.tickAccumulator = Math.min(nextTickMs - 1, progress * nextTickMs);
    return this.tickMs;
  }

  /**
   * 속도 단계 변경 (1~10 범위로 보정)
   * @param {number} level
   * @returns {number} 적용된 단계
   */
  setSpeedLevel(level) {
    const next = Math.min(SPEED_LEVELS.length, Math.max(1, Math.round(level)));
    if (next === this.speedLevel) return this.speedLevel;

    this.speedLevel = next;
    this._applySpeedLevel();
    this.sound.playSpeedChange();
    return this.speedLevel;
  }

  /** 게임 조작 외 시스템 키 (속도 단계, 음향 on/off) */
  _handleSystemInput() {
    const input = this.input;

    if (input.isJustPressed('KeyM')) {
      this.sound.toggleMute();
      if (this.sound.enabled) this.sound.playToggle();
    }

    if (input.isJustPressed('Minus') || input.isJustPressed('NumpadSubtract')) {
      this.setSpeedLevel(this.speedLevel - 1);
    }
    if (input.isJustPressed('Equal') || input.isJustPressed('NumpadAdd')) {
      this.setSpeedLevel(this.speedLevel + 1);
    }

    // 숫자 1~9, 0(=10단계) 으로 바로 선택
    for (let level = 1; level <= SPEED_LEVELS.length; level++) {
      const code = level === 10 ? 'Digit0' : `Digit${level}`;
      if (input.isJustPressed(code)) {
        this.setSpeedLevel(level);
        break;
      }
    }
  }

  /**
   * 현재 화면의 devicePixelRatio (Node/테스트 환경은 1)
   * - 3배를 넘는 초고해상도 기기는 성능 보호를 위해 상한을 둔다
   * @returns {number}
   */
  _resolvePixelRatio() {
    if (typeof window === 'undefined') return 1;
    const raw = Number(window.devicePixelRatio) || 1;
    return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, raw));
  }

  /**
   * 캔버스 내부 해상도를 devicePixelRatio 에 맞춰 조정한다.
   * 논리 좌표계는 항상 640x640 이며, 렌더 시 setTransform 으로 스케일한다.
   * @param {number} [ratio]
   * @returns {number} 적용된 배율
   */
  applyPixelRatio(ratio = this._resolvePixelRatio()) {
    const next = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    this.dpr = next;

    if (this.canvas) {
      const pixelWidth = Math.round(CANVAS_WIDTH * next);
      const pixelHeight = Math.round(CANVAS_HEIGHT * next);

      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    }

    // 정적 맵 캐시도 같은 배율로 다시 만든다
    this.map?.setPixelRatio?.(next);
    return this.dpr;
  }

  /** 모니터/창 크기 변경 시 DPR 재적용 (main.js 에서 호출) */
  refreshPixelRatio() {
    const next = this._resolvePixelRatio();
    if (Math.abs(next - this.dpr) < 0.01) return this.dpr;
    return this.applyPixelRatio(next);
  }

  /** 게임 시작 */
  start() {
    this.running = true;
    this.loopToken = (this.loopToken || 0) + 1;
    this.lastTime = performance.now();
    this.sound.playStart();
    this._loop(this.lastTime, this.loopToken);
  }

  /** 메인 루프 */
  _loop = (now, token = this.loopToken) => {
    if (!this.running || token !== this.loopToken) return;

    try {
      this._tick(now);
    } catch (err) {
      // 렌더/로직 예외로 게임이 영구 정지하지 않도록 보호
      console.error('[Pac-Baby] loop error:', err);
    }

    requestAnimationFrame(next => this._loop(next, token));
  };

  /** 한 프레임 처리 (예외는 _loop 에서 잡는다) */
  _tick(now) {
    const dt = now - this.lastTime;
    this.lastTime = now;

    // 입력이 들어오면 자동 데모를 즉시 종료한다 (main.js 의 터치 리스너와 함께 동작)
    this._checkUserActivity();
    this._markAssistedIfNeeded();

    // 마이크로 줌은 히트스톱으로 프레임이 멈춘 동안에도 부드럽게 이어져야 한다
    this._updateCameraZoom(dt);

    // 시각 효과(프레임 단위) + 8비트 BGM 스케줄 (일시정지·도움말 중에는 BGM 정지)
    this.effects.update(dt / 1000);
    if (this.state !== 'PAUSED' && !this.helpOpen) this.sound.updateBgm?.();

    // 사용 설명서(도움말)가 열려 있으면 게임은 완전히 정지한다 (입력도 처리하지 않음)
    if (this.helpOpen) {
      this._render(this.tickMs > 0 ? this.tickAccumulator / this.tickMs : 0);
      this.input.clearJustPressed();
      return;
    }

    // 히트스톱: 임팩트 순간(75~90ms) 로직·애니메이션 시간을 멈추고 같은 프레임을 유지한다.
    // - 파티클/셰이크(effects)는 그대로 흘려 타격 순간의 여운을 살린다.
    // - 입력은 clear 하지 않고 다음 프레임에서 처리되게 남겨 둔다.
    if (this.hitStopMs > 0) {
      this.hitStopMs = Math.max(0, this.hitStopMs - dt);
      this._render(this.tickMs > 0 ? this.tickAccumulator / this.tickMs : 0);
      return;
    }

    // 애니메이션 시간 (캐릭터 바운스/아이템 부유/트랩 흔들림) — 히트스톱 중에는 멈춘다
    if (dt > 0) this.animTime = (this.animTime + dt) % 600000;

    // 황금 보행기 넉백: 보모가 포물선으로 날아가는 연출 (히트스톱 뒤부터 진행)
    this._updateKnockFlights(dt);

    // 매 프레임 조작 확인 (속도/음향/스킬/일시정지/재시작·다음 라운드)
    this._handleSystemInput();
    this._handleSkillInput();
    this._togglePauseInput();
    this._handleStateInput();

    // 일시정지 / 스테이지 클리어 / 게임 오버: 게임 로직 정지 (화면만 유지)
    if (this.state === 'PAUSED' || this.state === 'STAGE_CLEAR' || this.state === 'GAME_OVER') {
      this._render(this.tickMs > 0 ? this.tickAccumulator / this.tickMs : 0);
      this.input.clearJustPressed();
      return;
    }

    // 체포 연출(Oh! No~): 베이비·보모 모두 굳은 채 연출 시간만 흐른다
    if (this.state === 'CAUGHT') {
      this._updateCaught(dt);
      this._render(this.tickMs > 0 ? this.tickAccumulator / this.tickMs : 0);
      this.input.clearJustPressed();
      return;
    }

    // 무입력 5초 → DEMO PLAY (READY/PLAYING 에서만)
    this._updateDemoTimer(dt);

    if (this.state === 'READY') {
      // 준비 카운트다운 (게임 로직은 정지)
      this._updateReady(dt);
    } else {
      this.tickAccumulator += dt;

      const tickMs = this.tickMs;

      // 탭 전환 등으로 프레임이 밀렸을 때 한 번에 몰아서 처리하지 않는다 (폭주 방지)
      if (this.tickAccumulator > MAX_FRAME_TICKS * tickMs) {
        this.tickAccumulator = MAX_FRAME_TICKS * tickMs;
      }

      // Tick 단위 업데이트
      let stateChanged = false;
      while (this.tickAccumulator >= tickMs) {
        this._inRealtimeTick = true;
        try {
          this._update(tickMs);
        } finally {
          this._inRealtimeTick = false;
        }
        this.tickAccumulator -= tickMs;

        // 체포 연출/라운드 클리어로 상태가 바뀌면 남은 tick 을 몰아서 처리하지 않는다
        if (this.state !== 'PLAYING') {
          stateChanged = true;
          break;
        }

        // 임팩트 히트스톱이 걸리면 그 자리에서 멈춘다 (밀린 tick 으로 프레임이 튀지 않게)
        if (this.hitStopMs > 0) {
          stateChanged = true;
          break;
        }
      }
      if (stateChanged) this.tickAccumulator = 0;
    }

    // 렌더링 (매 프레임)
    const alpha = this.tickMs > 0 ? this.tickAccumulator / this.tickMs : 0;
    this._render(alpha);

    this.input.clearJustPressed();
  }

  /**
   * 준비(READY) 카운트다운
   * @param {number} dt
   * @returns {boolean} 게임 시작 여부
   */
  _updateReady(dt) {
    this.readyTimer = Math.max(0, this.readyTimer - dt);
    if (this.readyTimer > 0) return false;

    this.state = 'PLAYING';
    this.tickAccumulator = 0;
    return true;
  }

  /** P / ESC — 일시정지 토글 */
  _togglePauseInput() {
    const pressed = this.input.isJustPressed('KeyP') || this.input.isJustPressed('Escape');
    if (!pressed) return;

    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
  }

  /** 게임 오버 → R / Space / Enter 로 재도전, 스테이지 클리어 → Space / Enter 로 다음 라운드 */
  _handleStateInput() {
    const input = this.input;
    const confirm = input.isJustPressed('Space')
      || input.isJustPressed('Enter')
      || input.isJustPressed('NumpadEnter');
    const retry = input.isJustPressed('KeyR');

    if (this.state === 'GAME_OVER') {
      if (retry || confirm) this.resetAll();
      return;
    }

    if (this.state === 'STAGE_CLEAR') {
      // 데모(어트랙트 모드)는 버튼 입력 없이 다음 라운드로 계속 진행한다
      if (this.demoMode) {
        this._startRound(this.round + 1);
        this.state = 'PLAYING';
        this.readyTimer = 0;
        this.tickAccumulator = 0;
        return;
      }
      if (confirm || retry) this._startRound(this.round + 1);
    }
  }

  /** 탭 숨김/최소화 시 자동 일시정지 (main.js 의 visibilitychange 에서 호출) */
  handleVisibilityChange(hidden) {
    if (hidden && this.state === 'PLAYING') {
      this.state = 'PAUSED';
    }
  }

  /**
   * 사용 설명서(도움말) 열림/닫힘 (src/help.js 에서 호출)
   * 열려 있는 동안 _tick 은 게임 로직·입력 처리를 모두 건너뛴다.
   * @param {boolean} open
   */
  setHelpOpen(open) {
    this.helpOpen = !!open;
    // 닫은 뒤 밀린 프레임을 몰아서 진행하지 않는다
    this.tickAccumulator = 0;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // 설명서를 여닫는 키/터치는 게임 조작이 아니므로 자동 데모 입력으로 오인하지 않는다.
    const seq = this.input?.activitySeq;
    if (Number.isFinite(seq)) this.lastInputActivitySeq = seq;
    return this.helpOpen;
  }

  /**
   * 등록/리더보드 모달도 도움말과 동일하게 게임 로직·입력을 멈춘다.
   * (도움말 외 UI 가 늘어나도 호출부는 이 이름을 쓰면 된다)
   * @param {boolean} open
   */
  setUiBlocked(open) {
    return this.setHelpOpen(open);
  }

  /**
   * 점수 팝업 추가 (+50 / -200 등)
   * @param {number} row
   * @param {number} col
   * @param {string} text
   * @param {string} color
   */
  _addPopup(row, col, text, color) {
    this.scorePopups.push({
      row, col, text, color,
      life: SCORE_POPUP_MS,
      maxLife: SCORE_POPUP_MS,
    });
  }

  /** 팝업 수명 진행 */
  _updatePopups(dt) {
    for (const popup of this.scorePopups) {
      popup.life -= dt;
    }
    this.scorePopups = this.scorePopups.filter(popup => popup.life > 0);
  }

  /** Tick 단위 게임 로직 업데이트 */
  _update(dt) {
    // 울기 쿨다운 진행 (3초 연사 제한)
    if (this.cryCooldown > 0) {
      this.cryCooldown = Math.max(0, this.cryCooldown - dt);
    }

    // 파워업 타이머 (슈가 러시 / 황금 젖병 보행기 모드)
    this._updatePowerUps(dt);

    // 철창문 열림/닫힘 → navMap(이동 판정) 갱신
    this._updateGates(dt);

    // 봇 모드: 위협이 가까우면 자동 울기 (얼어붙은 악당은 위협에서 제외)
    this._handleBotSkill();

    // 입력 → 베이비 방향 전환 (테스터 모드에서는 입력 소스가 바뀔 수 있다)
    const dir = this._resolveDirection();
    if (dir) this.player.setDirection(dir);
    this.tester?.record?.(dir);

    // 닫힌 철창문이 반영된 navMap 으로 이동한다
    this.player.update(this.navMap, dt);
    if (this.player.isMoving) {
      const sugarRush = this.sugarRushTimer > 0;
      const goldenWalker = this.goldenTimer > 0;

      // 일반 / 슈가 러시 / 황금 보행기 상태를 모두 넘겨 발자국 소리를 구분한다
      this.sound.playStep({ sugarRush, goldenWalker });

      // 이동할 때마다 지나온 타일 발밑에 작은 먼지 흔적을 남긴다
      // (아이템을 먹기 전 1라운드 시작 직후에도 바로 이동감이 느껴진다)
      const foot = this.player.getRenderCenter(0);
      let dustColor;
      if (goldenWalker) dustColor = '#ffe082';
      else if (sugarRush) dustColor = `hsl(${(this.animTime / 8) % 360}, 100%, 78%)`;
      this.effects.footstep(foot.x, foot.y, {
        color: dustColor,
        boost: goldenWalker || sugarRush,
      });
    }

    // 침대 진입 → 스텔스, 종료 시 침대 표시 해제
    this._updateStealth();

    // 소화가 끝난 아이템 → 트랩 배출
    this._expelTraps();

    // 아이템 섭취 / 리스폰
    this._updateItems(dt);

    // 황금 젖병 습득 / 리스폰
    this._updateGoldenBottle(dt);

    // 보모(악당): 일부는 추격, 일부는 경비 순찰 (닫힌 철창문은 통과 불가)
    this.enemies.forEach(e => e.update(dt, this.navMap, this.player.row, this.player.col));

    // 특수 아이템: 쪽쪽이 (아기 획득 / 보모가 치움 / 30초·1.5초 쿨타임 재등장)
    this._updatePacifier(dt);

    // 트랩 수명 & 악당 감속 판정
    this._updateTraps(dt);

    // 어둠 모드: 보모가 시야 근처로 오면 심장박동 경고
    this._updateHeartbeat(dt);

    // 체포/무적 판정
    const wasInvincible = this.graceTimer > 0;
    if (this.graceTimer > 0) this.graceTimer = Math.max(0, this.graceTimer - dt);

    if (this.goldenTimer > 0) {
      // 보행기 모드: 무적 + 부딪힌 악당을 날려버린다 (+300)
      this._resolveGoldenCollisions();
    } else if (!wasInvincible
      && !this.player.isStealthed
      && !this.tester?.flags?.invincible
      && this._isCaught()) {
      this._beginCaught();
    }

    // 점수 팝업 수명
    this._updatePopups(dt);

    // 라운드 클리어 조건 확인
    this._checkRoundProgress();
  }

  /**
   * 이번 틱에 사용할 방향 결정
   * 테스터가 방향을 반환하면 그 값을, 아니면 실제 입력을 사용한다.
   * @returns {string|null}
   */
  _resolveDirection() {
    if (this.tester) {
      const resolved = this.tester.resolveDirection(this);
      if (resolved !== undefined) return resolved;
    }

    // 모바일 버튼/자동 데모 봇
    if (this.botMode || this.demoMode) return this.bot.decide(this);

    return this.input.getDirection();
  }

  /**
   * 베이비가 악당과 같은 타일에 있는지 (교차 통과 포함)
   * - 울기로 얼어붙은 악당은 무해하다 (밟아도 체포되지 않음)
   */
  _isCaught() {
    const player = this.player;
    const activeEnemies = this.enemies.filter(enemy => !enemy.isFrozen);
    if (activeEnemies.length === 0) return false;

    // 1) 같은 타일
    if (activeEnemies.some(e => e.row === player.row && e.col === player.col)) return true;

    // 2) 같은 틱에 서로의 타일을 맞바꾼 경우(스치듯 통과)도 체포로 처리
    return activeEnemies.some(e => e.movedThisTick
      && player.isMoving
      && e.row === player.prevRow && e.col === player.prevCol
      && e.prevRow === player.row && e.prevCol === player.col);
  }

  /** 가장 가까운 보모 — 얼어붙은 보모는 위협에서 제외 (없으면 null) */
  _nearestEnemy() {
    let nearest = null;
    let best = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.isFrozen) continue;
      const distance = Math.hypot(enemy.row - this.player.row, enemy.col - this.player.col);
      if (distance < best) {
        best = distance;
        nearest = enemy;
      }
    }
    return nearest;
  }

  /** 가장 가까운 보모까지의 거리(타일) — 얼어붙은 보모는 위협에서 제외 */
  _nearestEnemyDistance() {
    const nearest = this._nearestEnemy();
    if (!nearest) return Infinity;
    return Math.hypot(nearest.row - this.player.row, nearest.col - this.player.col);
  }

  /**
   * 8라운드 이후 어둠 모드 근접 경고.
   * - 시야 반경 + 여유(DARK_HEARTBEAT_WARN_TILES) 안으로 보모가 들어오면
   *   가까울수록 빠르고 큰 심장박동 소리를 낸다.
   * - 무적(보행기 모드) / 스텔스 / 플레이 중이 아닐 때는 조용히 초기화한다.
   * @param {number} dt
   * @returns {number} 이번 tick 의 경고 강도 (0 = 안전, 1 = 바로 옆)
   */
  _updateHeartbeat(dt) {
    const silent = !this.darkMode
      || this.state !== 'PLAYING'
      || this.goldenTimer > 0
      || this.player.isStealthed;

    if (silent) {
      if (this.heartbeatIntensity > 0) this.sound?.resetHeartbeat?.();
      this.heartbeatIntensity = 0;
      this.heartbeatPan = 0;
      return 0;
    }

    const warningRange = this.visionTiles + DARK_HEARTBEAT_WARN_TILES;
    const nearest = this._nearestEnemy();
    const distance = nearest
      ? Math.hypot(nearest.row - this.player.row, nearest.col - this.player.col)
      : Infinity;
    const intensity = Number.isFinite(distance)
      ? Math.min(1, Math.max(0, (warningRange - distance) / Math.max(1, warningRange - 1)))
      : 0;

    // 보모가 있는 좌/우 방향으로 심장박동을 패닝 (-0.8 ~ +0.8)
    const pan = nearest ? stereoPanFromTiles(nearest.col - this.player.col) : 0;

    this.heartbeatIntensity = intensity;
    this.heartbeatPan = pan;
    this.sound?.updateHeartbeat?.(intensity, dt, pan);
    return intensity;
  }

  /**
   * 아이템 섭취 및 리스폰 처리
   * - 베이비가 아이템 타일에 도달하면 점수 획득 후 사라진다.
   * - 섭취된 아이템은 15초 뒤 베이비/악당이 없는 임의의 타일에 다시 나타난다.
   */
  _updateItems(dt) {
    const avoid = [
      { row: this.player.row, col: this.player.col },
      ...this.enemies.map(e => ({ row: e.row, col: e.col })),
      // 철창문 타일에는 아이템이 겹쳐 리스폰하지 않게 한다
      ...this.gates.map(g => ({ row: g.row, col: g.col })),
    ];

    for (const item of this.items) {
      if (item.collected) {
        item.update(dt, this.navMap, this.rng, avoid);
        continue;
      }

      if (item.row === this.player.row && item.col === this.player.col) {
        const gained = item.collect();
        // 라운드 상한에 닿으면 획득 점수는 상한에서 멈춘다 (아이템은 그대로 섭취 처리)
        const applied = this._addScore(gained);
        this.player.startDigestion(item.config); // 소화 시작 → 나중에 트랩 배출
        this.stats.items += 1;
        this.roundItemsEaten += 1;
        this._addPopup(item.row, item.col, applied > 0 ? `+${applied}` : 'MAX', '#8bc34a');
        this.tester?.log?.('item', `${item.config.name} +${gained}`);
        this.sound.playItem(item.type); // 'MILK' | 'CANDY' | 'COOKIE' 별 먹는 소리
        this.effects.burstSparkle(item.row, item.col); // 노란 반짝이
        this._updateHiScore();

        // 캔디(🍬)는 슈가 러시 발동
        if (item.type === 'CANDY') this._activateSugarRush();
      }
    }
  }

  /**
   * 황금 젖병 습득 판정 + 리스폰 타이머 (일반 아이템과 분리해 클리어 카운트에 영향 없음)
   * @param {number} dt
   */
  _updateGoldenBottle(dt) {
    const bottle = this.goldenBottle;
    if (!bottle) return;

    if (bottle.collected) {
      bottle.update(dt, this.map.map, this.rng, [
        { row: this.player.row, col: this.player.col },
      ]);
      return;
    }

    if (bottle.row === this.player.row && bottle.col === this.player.col) {
      this._activateGoldenWalker();
      bottle.collect();
    }
  }

  /**
   * 가짜 젖꼭지(쪽쪽이) 판정 + 리스폰 타이머.
   * - 아기가 먼저 밟으면 5초 스텔스(기존 스텔스가 더 길면 유지) + 소량 점수.
   * - 얼어붙지 않은 보모가 먼저 밟으면 '치웠다!' 팝업과 함께 1.5초 뒤 다른 빈 타일에서 재등장.
   * - 일반 아이템 12개/클리어 카운트/소화/트랩과 완전히 분리된다.
   * @param {number} dt
   */
  _updatePacifier(dt) {
    const pacifier = this.pacifier;
    if (!pacifier) return;

    // 아기 획득 (같은 타일이면 보모보다 아기 우선)
    if (!pacifier.collected
      && pacifier.row === this.player.row
      && pacifier.col === this.player.col) {
      this._activatePacifier();
      pacifier.collect(); // 30초 쿨타임 예약 (소화/클리어 카운트에는 영향 없음)
      return;
    }

    // 보모가 먼저 찾은 경우 (얼어붙은 보모는 쪽쪽이를 치우지 못한다)
    if (!pacifier.collected) {
      const finder = this.enemies.find(
        enemy => !enemy.isFrozen
          && enemy.row === pacifier.row
          && enemy.col === pacifier.col,
      );
      if (finder) {
        this._clearPacifier(finder, pacifier);
        return;
      }
    }

    if (pacifier.collected) {
      pacifier.update(dt, this.navMap, this.rng, this._pacifierAvoid());
    }
  }

  /** 아기가 쪽쪽이를 획득: 5초 스텔스 + 소량 점수 (라운드 상한 캡 유지) */
  _activatePacifier() {
    const applied = this._addScore(FAKE_PACIFIER.score);
    const remaining = this.player.applyStealth(FAKE_PACIFIER.stealthDuration);

    // 침대 스텔스와 동일하게 추격 보모는 목표를 잃고 잠시 순찰한다
    this.enemies.forEach(enemy => enemy.loseTarget(ENEMY_CONFUSE_MS));

    this.stats.stealth += 1;
    this.stats.pacifier = (this.stats.pacifier || 0) + 1;
    this._updateHiScore();

    this._addPopup(
      this.player.row, this.player.col,
      applied > 0 ? `+${applied}` : 'MAX',
      FAKE_PACIFIER.color,
    );
    this.tester?.log?.(
      'pacifier',
      `쪽쪽이! ${(remaining / 1000).toFixed(1)}초 스텔스 (+${applied})`,
    );
    // 침대 스텔스(playStealth)와 구분되는 쪽쪽이 빠는 소리
    if (typeof this.sound.playPacifier === 'function') this.sound.playPacifier();
    else this.sound.playStealth?.();
    this.effects.flashScreen(FAKE_PACIFIER.color, 0.16, 0.24);
    this.effects.burstSparkle(this.player.row, this.player.col, 10);
  }

  /**
   * 보모가 쪽쪽이를 치움: 즉시 다른 빈 타일로 옮기지 않고 짧은 딜레이(1.5초) 후 재등장.
   * @param {object} enemy 찾은 보모
   * @param {Item} pacifier
   */
  _clearPacifier(enemy, pacifier) {
    pacifier.collect(); // 기본 30초 예약 → 아래에서 짧은 딜레이로 교체
    pacifier.respawnTimer = FAKE_PACIFIER.enemyClearDelayMs;

    this._addPopup(pacifier.row, pacifier.col, '치웠다!', FAKE_PACIFIER.color);
    this.tester?.log?.(
      'pacifier',
      `보모가 쪽쪽이를 치웠다 @ (${enemy.row},${enemy.col})`,
    );
    this.effects.burstSparkle(pacifier.row, pacifier.col, 6);
  }

  /** 캔디(🍬) 섭취: 3초간 이동 속도 +50% 슈가 러시 */
  _activateSugarRush() {
    this.sugarRushTimer = SUGAR_RUSH.duration;
    this.stats.sugar += 1;
    this._refreshTickRate();

    this._addPopup(this.player.row, this.player.col, 'SUGAR RUSH!', COLORS.SUGAR);
    this.tester?.log?.(
      'sugar',
      `슈가 러시 ${SUGAR_RUSH.duration / 1000}초 (+${Math.round((SUGAR_RUSH.speedMultiplier - 1) * 100)}% 속도)`,
    );
    this.sound.playSugarRush?.();
    this.effects.flashScreen('#f8bbd0', 0.16, 0.2);
    this.effects.burstSparkle(this.player.row, this.player.col, 8);
  }

  /** 황금 젖병 섭취: 8초 보행기 모드 (무적 + 속도 증가) + 모든 악당이 겁에 질려 도망 */
  _activateGoldenWalker() {
    this.goldenTimer = GOLDEN_BOTTLE.duration;
    this.stats.golden += 1;
    this._refreshTickRate();

    this.enemies.forEach(enemy => enemy.startFlee(this.goldenTimer));

    this._addPopup(this.player.row, this.player.col, '보행기 모드!', COLORS.GOLDEN);
    this.tester?.log?.(
      'golden',
      `황금 젖병! ${GOLDEN_BOTTLE.duration / 1000}초 무적 보행기 (악당 도망)`,
    );
    this.sound.playGolden?.();
    this.effects.flashScreen('#ffd54f', 0.32, 0.4);
    this.effects.shockwave(
      this.player.row, this.player.col,
      COLORS.GOLDEN, TILE_SIZE * 4, 0.6,
    );
    this.effects.burstSparkle(this.player.row, this.player.col, 18);
  }

  /** 파워업 타이머 진행 (만료 시 속도/도망 상태 복구) */
  _updatePowerUps(dt) {
    let changed = false;

    if (this.sugarRushTimer > 0) {
      this.sugarRushTimer = Math.max(0, this.sugarRushTimer - dt);
      if (this.sugarRushTimer === 0) changed = true;
    }

    if (this.goldenTimer > 0) {
      this.goldenTimer = Math.max(0, this.goldenTimer - dt);
      if (this.goldenTimer === 0) {
        this.enemies.forEach(enemy => enemy.endFlee());
        changed = true;
        this.tester?.log?.('golden', '보행기 모드 종료');
      }
    }

    if (changed) this._refreshTickRate();
  }

  /** 보행기 모드: 부딪힌 악당을 모두 날려버린다 */
  _resolveGoldenCollisions() {
    const hits = this.enemies.filter(enemy => this._enemyTouchesPlayer(enemy));
    hits.forEach(enemy => this._knockEnemy(enemy));
    return hits.length;
  }

  /** 베이비와 악당이 같은 타일이거나 서로를 스쳐 지나갔는지 (얼어 있는 악당 포함) */
  _enemyTouchesPlayer(enemy) {
    const player = this.player;
    if (enemy.row === player.row && enemy.col === player.col) return true;

    return !!enemy.movedThisTick
      && player.isMoving
      && enemy.row === player.prevRow && enemy.col === player.prevCol
      && enemy.prevRow === player.row && enemy.prevCol === player.col;
  }

  /** 체포/넉백된 악당을 이전 위치·구역과 베이비 근처를 피해 안전하게 리스폰 */
  _respawnEnemy(enemy) {
    if (!enemy) return;

    const avoid = this.enemies
      .filter(other => other !== enemy)
      .map(other => ({ row: other.row, col: other.col }));

    enemy.resetToSpawn({
      map: this.navMap,
      baby: this.player,
      avoid,
      rng: this.rng,
    });
  }

  /** 악당 날려버리기: +300점, 스폰 지점 복귀, 남은 보행기 시간 동안 다시 도망 */
  _knockEnemy(enemy) {
    const hitRow = enemy.row;
    const hitCol = enemy.col;
    const fleeRemaining = Math.max(0, this.goldenTimer);

    const applied = this._addScore(GOLDEN_BOTTLE.knockScore);
    this.stats.knocks += 1;
    this._updateHiScore();

    this._respawnEnemy(enemy);
    // 논리 위치는 스폰으로 복귀했지만, 화면에서는 맞은 지점 → 스폰까지
    // 0.65초 동안 빙글빙글 포물선으로 날아가는 연출을 재생한다.
    enemy.startKnockFlight(hitRow, hitCol);
    if (fleeRemaining > 0) enemy.startFlee(fleeRemaining);

    this._addPopup(hitRow, hitCol, applied > 0 ? `+${applied}` : 'MAX', COLORS.GOLDEN);
    this.tester?.log?.(
      'knock',
      `악당 날려버림 @ (${hitRow},${hitCol}) +${applied}`,
    );
    // 날아가기 전 보모의 좌우 위치로 패닝해 타격이 들리는 방향을 알려준다
    this.sound.playTrapHit(stereoPanFromTiles(hitCol - this.player.col));
    this.effects.burstSparkle(hitRow, hitCol, 18);
    this.effects.shockwave(hitRow, hitCol, COLORS.GOLDEN, TILE_SIZE * 3.2, 0.5);
    this.effects.flashScreen(COLORS.GOLDEN, 0.18, 0.22);
    this.effects.shake(0.2, 6);

    // 85ms 프레임 정지 + 1.06배 줌인으로 '쾅' 하고 날려버리는 손맛
    this._startImpact({ holdMs: HIT_STOP_KNOCK_MS, zoom: IMPACT_ZOOM_KNOCK });
  }

  /**
   * 황금 보행기 넉백 비행 연출 진행 (프레임 단위)
   * - 날아가는 궤적 뒤로 별가루 꼬리를 뿌리고, 착지 순간 작은 충격파를 남긴다.
   * - 히트스톱(프레임 정지) 중에는 호출되지 않아 비행도 함께 멈춘다.
   * @param {number} dt 프레임 경과(ms)
   */
  _updateKnockFlights(dt) {
    if (!(dt > 0)) return;

    for (const enemy of this.enemies) {
      if (!enemy.knockFlight) continue;

      const pose = enemy.advanceKnockFlight(dt);
      if (!pose) continue;

      if (pose.emitTrail) this.effects.flightTrail?.(pose.x, pose.y);

      if (pose.landed) {
        this.effects.burstSparkle?.(enemy.row, enemy.col, 8);
        this.effects.shockwave?.(enemy.row, enemy.col, COLORS.GOLDEN, TILE_SIZE * 1.5, 0.3);
      }
    }
  }

  /** 라운드/재시작 시 파워업 상태를 모두 해제 */
  _clearPowerUps() {
    this.sugarRushTimer = 0;
    this.goldenTimer = 0;
    this.enemies.forEach(enemy => enemy.endFlee());
    this._refreshTickRate();
  }

  /** 소화가 끝난 아이템을 현재 타일에 트랩으로 배출 */
  _expelTraps() {
    const expelled = this.player.takeExpelledTraps();

    for (const trap of expelled) {
      // 너무 많으면 가장 오래된 트랩을 치운다
      while (this.traps.length >= TRAP_MAX_ACTIVE) {
        this.traps.shift();
      }
      this.traps.push(new Trap(
        this.player.row, this.player.col,
        trap.trapType, trap.slowEffect, trap.slowDuration,
      ));
      this.sound.playTrap(trap.trapType); // 'PEE' | 'VOMIT' | 'POOP' 별 배출음
      this.effects.burstDrops(this.player.row, this.player.col, TRAP_COLORS[trap.trapType]);
    }
  }

  /** 트랩 수명 관리 + 악당이 밟으면 감속 */
  _updateTraps(dt) {
    for (const trap of this.traps) {
      if (!trap.active) continue;
      trap.update(dt);
      if (!trap.active) continue;

      const victim = this.enemies.find(
        e => e.row === trap.row && e.col === trap.col,
      );
      if (!victim) continue;

      victim.applySlow(trap.slowEffect, trap.slowDuration); // 기존 감속 규칙 유지

      // 트랩 종류별 추가 얼림 (소변 3초 / 토사물 6초 / 대변 10초)
      const freezeMs = TRAP_FREEZE_MS[trap.trapType] || 0;
      if (freezeMs > 0) victim.freeze(freezeMs);

      trap.consume();
      const applied = this._addScore(TRAP_HIT_SCORE);
      this.stats.traps += 1;
      this._addPopup(trap.row, trap.col, applied > 0 ? `+${applied}` : 'MAX', '#ffb74d');
      this.tester?.log?.('trap', `${trap.trapType} 적중 +${TRAP_HIT_SCORE} · ${freezeMs / 1000}s 얼림`);
      // 트랩을 밟은 보모의 좌우 위치에 맞춰 타격음을 패닝 (-0.8 ~ +0.8)
      this.sound.playTrapHit(stereoPanFromTiles(victim.col - this.player.col));
      this._updateHiScore();
    }

    // 만료되거나 밟힌 트랩은 제거
    this.traps = this.traps.filter(trap => trap.active);
  }

  /** 남아 있는(먹을 수 있는) 아이템 수 */
  get itemCount() {
    return this.items.filter(item => !item.collected).length;
  }

  /**
   * 임팩트 히트스톱 + 마이크로 줌을 동시에 발동한다.
   * - 황금 보행기로 보모를 날려버릴 때 / 보모에게 체포될 때 사용한다.
   * @param {{holdMs?: number, zoom?: number, durationMs?: number}} [options]
   * @returns {{holdMs: number, zoom: number}} 실제 적용된 값
   */
  _startImpact(options = {}) {
    const holdMs = Number.isFinite(options.holdMs) ? options.holdMs : HIT_STOP_KNOCK_MS;
    const zoom = Number.isFinite(options.zoom) ? options.zoom : IMPACT_ZOOM_KNOCK;
    const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : IMPACT_ZOOM_MS;

    // 진행 중인 히트스톱이 있으면 더 긴 쪽을 유지한다 (연속 임팩트)
    this.hitStopMs = Math.max(this.hitStopMs || 0, Math.max(0, holdMs));
    this.zoomPeak = Math.max(1, zoom);
    this.zoomDuration = Math.max(0, durationMs);
    this.zoomTimer = this.zoomDuration;

    return { holdMs: this.hitStopMs, zoom: this.zoomPeak };
  }

  /**
   * 마이크로 줌 펄스 진행 (ms)
   * - 히트스톱으로 로직이 멈춘 동안에도 _tick 에서 계속 호출된다.
   * @param {number} dt 프레임 경과(ms)
   */
  _updateCameraZoom(dt) {
    if (!(this.zoomTimer > 0) || !(dt > 0)) return;

    this.zoomTimer = Math.max(0, this.zoomTimer - dt);
    if (this.zoomTimer === 0) {
      this.zoomDuration = 0;
      this.zoomPeak = 1;
    }
  }

  /**
   * 현재 마이크로 줌 배율 (1 = 원본)
   * - 22% 구간에서 빠르게 최대치까지 당긴 뒤 ease-out 으로 1.0 까지 복귀한다.
   * @returns {number} 1.0 ~ 1.07
   */
  getZoomScale() {
    if (!(this.zoomTimer > 0) || !(this.zoomDuration > 0)) return 1;

    const progress = Math.min(1, Math.max(0, 1 - this.zoomTimer / this.zoomDuration));
    const eased = progress < ZOOM_ATTACK_RATIO
      ? progress / ZOOM_ATTACK_RATIO
      : Math.pow(1 - (progress - ZOOM_ATTACK_RATIO) / (1 - ZOOM_ATTACK_RATIO), 2);

    return 1 + (this.zoomPeak - 1) * Math.max(0, Math.min(1, eased));
  }

  /**
   * 체포 연출 시작: 베이비가 그 자리에 굳고 "Oh! No~" 가 울린다.
   * 실제 페널티(목숨 -1 / 게임 오버)는 CAUGHT_STUN_MS 뒤 `_finishCaught()` 에서 적용한다.
   *
   * 실시간 루프(_loop → _tick)가 돌리는 중일 때만 연출을 재생하고,
   * 단위 테스트/테스터 스텝처럼 _update 를 직접 호출하는 경우에는 기존처럼 즉시 체포 처리한다.
   */
  _beginCaught() {
    if (!this._inRealtimeTick) {
      this._catchPlayer();
      return;
    }

    this.state = 'CAUGHT';
    this.caughtTimer = CAUGHT_STUN_MS;
    this.player.stun(CAUGHT_STUN_MS); // 그 자리에 멈춰 굳는다 (입력 무시)

    this._addPopup(this.player.row, this.player.col, 'Oh! No~', '#ef5350');
    this.tester?.log?.('catch', `체포! Oh! No~ @ (${this.player.row},${this.player.col})`);
    this.sound.playOhNo();                                  // 낮고 서글픈 "Oh! No~"
    this.effects.burstTears(this.player.row, this.player.col);
    this.effects.flashScreen('#ef5350', 0.32, 0.5);          // 붉은 섬광
    this.effects.shake(0.4, 12);                             // 카메라 셰이크

    // 75ms 프레임 정지 + 베이비 중심 1.06배 줌인으로 '덜컥' 잡히는 타격감
    this._startImpact({ holdMs: HIT_STOP_CAUGHT_MS, zoom: IMPACT_ZOOM_CAUGHT });
  }

  /**
   * 체포 연출 진행 (CAUGHT 상태에서 프레임마다 호출)
   * @param {number} dt 프레임 경과(ms)
   * @returns {boolean} 연출이 끝나 페널티가 적용되었는지
   */
  _updateCaught(dt) {
    this.caughtTimer = Math.max(0, this.caughtTimer - dt);
    this.player.stunTimer = this.caughtTimer;

    // 연출 동안은 소화 타이머도 멈춘다 (게임 루프 전체가 대기하는 느낌)
    if (this.caughtTimer > 0) return false;

    this._finishCaught();
    return true;
  }

  /** 연출 종료 → 목숨 차감/침대 귀환, 목숨이 남아 있으면 곧바로 플레이 재개 */
  _finishCaught() {
    this.player.stunTimer = 0;
    this._catchPlayer(); // -200점 · 침대 귀환 · 악당 대기실 복귀 · 목숨 -1

    if (this.state === 'CAUGHT') {
      this.state = 'PLAYING';
      this.tickAccumulator = 0;
    }
  }

  /** 체포 처리: -200점, 침대 귀환, 악당은 대기실로 복귀, 잠깐 무적 */
  _catchPlayer() {
    const caughtAt = { row: this.player.row, col: this.player.col };

    this.player.onCaught(this.map.babySpawn);
    // 체포 -200점은 상한과 무관하게 적용 → Score Cleared 상태를 다시 계산한다
    this._refreshScoreCapState();
    this.enemies.forEach(e => this._respawnEnemy(e));
    this.graceTimer = RESPAWN_GRACE_MS;
    this.catchCount += 1;
    this.lives = Math.max(0, this.lives - 1);
    this._addPopup(caughtAt.row, caughtAt.col, `${PENALTY.CAUGHT}`, '#ef5350');
    this.tester?.log?.('catch', `체포 @ (${caughtAt.row},${caughtAt.col}) 남은 목숨 ${this.lives}`);
    this.sound.playCaught();
    this.effects.shake(0.2, 9); // 0.2초 카메라 셰이크
    this.effects.flashScreen('#ef5350', 0.22, 0.26); // 붉은 피격 섬광

    // 귀환한 침대 위이므로 재발동 방지 상태로 맞춘다
    this._wasOnBed = true;

    if (this.lives === 0) this._gameOver();
  }

  /**
   * 침대 진입 판정 + 스텔스 종료 처리
   * - 침대 타일에 "새로 들어온" 순간에만 스텔스가 발동한다.
   * - 스텔스가 끝나면 침대는 다시 빨간색으로 돌아온다.
   */
  _updateStealth() {
    const { row, col } = this.player;
    const onBed = (this.map.map[row] || [])[col] === 2;

    if (onBed && !this._wasOnBed) {
      this._tryStealth(row, col);
    }

    if (this.stealthBed && !this.player.isStealthed) {
      this.stealthBed = null;
      this.map.highlightBed = null;
    }

    this._wasOnBed = onBed;
  }

  /**
   * 침대 은신 발동: 10초 스텔스 + 추격 악당은 5초간 목표 상실
   * @returns {boolean} 발동 성공 여부
   */
  _tryStealth(row, col) {
    if (!this.player.activateStealth(STEALTH_DURATION_MS)) return false;

    this.stealthBed = { row, col };
    this.map.highlightBed = this.stealthBed;

    // 추격 악당은 베이비를 놓치고 잠시 경비(순찰) 모드가 된다
    this.enemies.forEach(e => e.loseTarget(ENEMY_CONFUSE_MS));

    this.stats.stealth += 1;
    this._addPopup(row, col, '스텔스!', '#29b6f6');
    this.tester?.log?.('stealth', `침대 은신 @ (${row},${col})`);
    this.sound.playStealth();
    return true;
  }

  /** 스페이스바 — 울기: 모든 악당 3초 얼림, -100점 (얼어 있으면 +3초 연장) */
  _handleSkillInput() {
    this._useCry();
  }

  /**
   * 울기 실행 (사람의 Space / 봇 자동 발동 공용)
   * @param {boolean} [force] true 이면 키 입력 없이 실행 (봇)
   * @returns {boolean} 사용 여부
   */
  _useCry(force = false) {
    if (!force && !this.input.isJustPressed(SKILL_CRY.key)) return;
    if (this.state !== 'PLAYING') return;
    if (this.enemies.length === 0) return;
    if (this.cryCooldown > 0) return; // 연사 제한: 3초에 1회

    // 감점은 라운드 상한과 무관하게 적용된다 (다시 상한까지 오를 수 있음)
    this._addScore(SKILL_CRY.cost);
    this.cryCooldown = SKILL_CRY.cooldown;

    // 비상 탈출용: 트랩으로 얼어 있는 악당에게도 사용 가능하며, 그 악당은 +3초 연장된다
    this.enemies.forEach(enemy => enemy.extendFreeze(SKILL_CRY.freezeDuration));

    this.stats.cries += 1;
    this._addPopup(this.player.row, this.player.col, `${SKILL_CRY.cost}`, '#64b5f6');
    this.tester?.log?.('cry', `울기 사용 (-100, 얼림 +${SKILL_CRY.freezeDuration / 1000}s)`);
    this.sound.playFreeze();

    // 푸른 섬광 + 눈물 파티클 + 악당 위치에 얼음 파편
    this.effects.flashScreen(COLORS.ENEMY_FROZEN, 0.45, 0.38);
    this.effects.shockwave(
      this.player.row, this.player.col,
      '#9be7ff', TILE_SIZE * 3.4, 0.55,
    );
    this.effects.burstTears(this.player.row, this.player.col);
    this.enemies.forEach(enemy => this.effects.burstIce(enemy.row, enemy.col));

    return true;
  }

  // ===== 하이스코어 =====

  /** 저장된 하이스코어 로드 (없으면 0) */
  _loadHiScore() {
    if (!this.storage) return 0;
    try {
      const value = Number(this.storage.getItem(HISCORE_KEY));
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } catch (err) {
      return 0;
    }
  }

  /** 현재 점수가 최고점이면 갱신 + 저장 (데모 중에는 절대 저장하지 않는다) */
  _updateHiScore() {
    if (this.demoMode) return;
    if (this.player.score <= this.hiScore) return;

    this.hiScore = this.player.score;
    this.newRecord = true;
    if (!this.storage) return;
    try {
      this.storage.setItem(HISCORE_KEY, String(this.hiScore));
    } catch (err) { /* 저장 실패 무시 */ }
  }

  // ===== 라운드 진행 =====

  /** 이번 라운드 점수 상한 — 서버 pacbaby_score_cap / validation.scoreCapForRound 미러 */
  get roundScoreCap() {
    return scoreCapForRound(this.round);
  }

  /**
   * 점수 획득/차감 공통 처리 (아이템·트랩 적중·넉백·울기·체포).
   * - 획득(+)은 라운드별 상한에서 멈춘다 (서버 SCORE_EXCEEDS_CAP 오인 방지).
   * - 감점(-, 울기 -100 / 체포 -200)은 상한과 무관하게 그대로 적용되어
   *   다시 상한까지 점수를 올릴 수 있다.
   * @param {number} amount 가감할 점수 (음수 허용)
   * @returns {number} 실제 반영된 점수 변화량
   */
  _addScore(amount) {
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) return 0;

    const before = this.player.score;

    if (delta > 0) {
      // 이미 상한을 넘긴 상태(구버전 기록 등)는 깎지 않고 그대로 둔다
      if (before < this.roundScoreCap) {
        this.player.score = Math.min(this.roundScoreCap, before + delta);
      }
    } else {
      this.player.score = before + delta;
    }

    this._refreshScoreCapState();
    return this.player.score - before;
  }

  /** 라운드 상한 도달 여부 동기화 (HUD 'Score Cleared' 표시용) */
  _refreshScoreCapState() {
    this.scoreCapReached = this.player.score >= this.roundScoreCap;
    return this.scoreCapReached;
  }

  /** 라운드 클리어 조건 검사 (PLAYING 에서만)
   * - 기본 설정(ROUND_CLEAR_MODE='ITEMS')은 아이템을 모두 섭취하면 클리어된다.
   * - 점수 상한(Score Cleared)은 클리어 조건이 아니라, 상한 도달 후에도 남은 아이템을
   *   모아 다음 라운드로 가도록 HUD 에서 안내하는 용도다.
   */
  _checkRoundProgress() {
    if (this.state !== 'PLAYING') return;

    const itemsCleared = this.roundItemsEaten >= this.items.length;
    const scoreCleared = this.player.score - this.roundStartScore >= ROUND_TARGET_SCORE;

    let cleared = false;
    if (ROUND_CLEAR_MODE === 'SCORE') cleared = scoreCleared;
    else if (ROUND_CLEAR_MODE === 'BOTH') cleared = itemsCleared && scoreCleared;
    else cleared = itemsCleared; // 기본: 아이템을 모두 섭취

    if (cleared) this._stageClear();
  }

  /** 스테이지 클리어: 목숨 +1 후 다음 라운드 입력 대기 */
  _stageClear() {
    this.state = 'STAGE_CLEAR';
    this.lives = Math.min(PLAYER_LIVES, this.lives + 1); // 클리어 보상: 목숨 회복
    this._updateHiScore();
    this.tester?.log?.('clear', `ROUND ${this.round} 클리어`);
    this.sound.playClear();
  }

  /** 게임 오버 (목숨 0) */
  _gameOver() {
    this.state = 'GAME_OVER';
    this._updateHiScore(); // 데모 중이면 내부에서 무시
    this.tester?.log?.('gameover', `최종 점수 ${this.player.score}`);
    this.sound.playGameOver();

    // 데모 런은 서버 제출/등록 안내(onRunEnd)를 절대 호출하지 않는다.
    // 데모 모드는 유지해 아무 키/터치로 새 매뉴얼 게임을 시작할 수 있게 한다.
    if (this.demoMode) {
      this._notifyBotState();
      return;
    }

    this._endRun();
  }

  // ===== 글로벌 기록용 런 추적 =====

  /** 새 런 시작 (재도전 포함) — 상위 ProfileManager 가 run 토큰을 발급한다 */
  _beginRun() {
    this.runEnded = false;

    // 데모 중에는 서버 런을 시작하지 않는다 (데모/매뉴얼 완전 격리)
    if (this.demoMode) {
      this.runStartedAt = null;
      this.runAssisted = true;
      return;
    }

    this.runStartedAt = Date.now();
    this.runAssisted = false;
    this._safeRunCallback(this.onRunStart, { startedAt: this.runStartedAt });
  }

  /** 게임 오버 시 런 요약을 상위로 전달 (UI 오류가 게임 루프를 죽이지 않게 격리) */
  _endRun() {
    if (this.runEnded) return; // 같은 런을 두 번 제출하지 않는다 (게임 오버 + [게임 종료]/재시작)
    this.runEnded = true;
    this._safeRunCallback(this.onRunEnd, this.getRunSummary());
  }

  /** 이번 런의 요약 (서버 제출/등록 유도 판단용) */
  getRunSummary() {
    return {
      score: this.player.score,
      round: this.round,
      catchCount: this.catchCount,
      lives: this.lives,
      stats: { ...this.stats },
      durationMs: this.runStartedAt ? Date.now() - this.runStartedAt : null,
      assisted: !!this.runAssisted,
      newRecord: this.newRecord,
    };
  }

  /** 데모/봇/테스터 치트로 플레이한 런은 리더보드에 제출하지 않는다 */
  _markAssistedIfNeeded() {
    if (this.runAssisted) return;
    if (this.isBotActive
        || (this.tester && this.tester.mode !== 'MANUAL')
        || this.tester?.hasCheatFlags?.()) {
      this.runAssisted = true;
    }
  }

  _safeRunCallback(callback, payload) {
    if (typeof callback !== 'function') return;
    try {
      callback(payload);
    } catch (err) {
      console.error('[Pac-Baby] run hook error:', err);
    }
  }

  /** 보드/플레이어 초기화 (점수·목숨·하이스코어는 유지) */
  _resetBoard() {
    this._clearPowerUps();

    // 라운드에 맞는 악당 편성 + 철창문 배치
    this._buildEnemies(this.round);
    this._initGates(this.round);

    this.player.reset(this.map.babySpawn);
    this.enemies.forEach(enemy => enemy.resetToSpawn());

    this.items = [];
    this._initItems();

    // 황금 젖병도 중앙에 다시 배치
    this.goldenBottle = null;
    this._initGoldenBottle();

    // 가짜 젖꼭지(쪽쪽이)도 라운드마다 랜덤 빈 타일에 1개 배치
    this.pacifier = null;
    this._initPacifier();

    this.traps = [];
    this.scorePopups = [];
    this.effects.reset();

    this.roundItemsEaten = 0;
    this.roundStartScore = this.player.score;
    this.scoreCapReached = false; // 새 라운드/새 게임에서는 새 상한까지 다시 점수 획득 가능
    this.graceTimer = RESPAWN_GRACE_MS;

    this.stealthBed = null;
    this.map.highlightBed = null;
    this._wasOnBed = true;

    this.cryCooldown = 0;
    this.heartbeatIntensity = 0;
    this.heartbeatPan = 0;

    // 라운드/재시작 시 임팩트 연출(히트스톱·줌)을 초기화한다
    this.hitStopMs = 0;
    this.zoomTimer = 0;
    this.zoomDuration = 0;
    this.zoomPeak = 1;

    this.sound?.resetHeartbeat?.();
    this.tickAccumulator = 0;
    this.caughtTimer = 0;
    this.state = 'READY';
    this.readyTimer = READY_COUNTDOWN_MS;

    // 새로 구성한 악당들에게 현재 속도 단계를 적용
    this._applySpeedLevel();
  }

  /** 다음 라운드 시작 (라운드마다 속도 단계 +1, 최대 10) */
  _startRound(round) {
    const nextLevel = round <= 1
      ? this.baseSpeedLevel
      : Math.min(SPEED_LEVELS.length, this.speedLevel + ROUND_SPEED_STEP);

    this.round = round;
    this.speedLevel = nextLevel;
    this._resetBoard();

    this.tester?.log?.('round', `ROUND ${round} 시작 (속도 ${this.speedLevel}/10)`);
  }

  /** 새 게임 (GAME OVER → 재도전): 점수/목숨/라운드 초기화, 하이스코어는 유지 */
  resetAll() {
    // 중도 재시작(R 등)으로 아직 제출되지 않은 정식 매뉴얼 런의 점수를 먼저 제출한다.
    if (!this.demoMode && !this.runAssisted && !this.runEnded && this.player.score > 0) {
      this._endRun();
    }

    // 데모 중이라도 새 게임은 매뉴얼 런이다 — 데모 플래그를 먼저 해제해야
    // _beginRun 이 서버 런(onRunStart)과 runAssisted=false 를 정상 시작한다.
    this.demoMode = false;
    this._beginRun();

    this.player.score = 0;
    this.lives = PLAYER_LIVES;
    this.round = 1;
    this.catchCount = 0;
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0, sugar: 0, golden: 0, knocks: 0, pacifier: 0 };
    this.newRecord = false;
    this.baseSpeedLevel = this.speedLevel; // 재도전 시 현재 속도 단계를 기준으로 유지
    this._resetBoard();

    this.tester?.log?.('restart', '새 게임 시작');

    // 재시작 후에는 자동 데모를 다시 켜지 않는다 (명시적 BOT 은 유지)
    this.demoMode = false;
    this.demoIdleMs = 0;
    this.demoArmed = false;
    this.autoDemoConsumed = true; // 접속 세션 동안 자동 데모 재무장 금지
    this._notifyBotState();

    return this;
  }

  /** 프레임 렌더링 (alpha로 보간) */
  _render(alpha) {
    const ctx = this.ctx;

    // 레티나 캔버스: 이후 모든 그리기를 640x640 논리 좌표로 수행한다
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;

    // 배경 클리어
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 카메라 셰이크 (월드만 흔들고 HUD 는 고정)
    const shake = this.effects.getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // 임팩트 마이크로 줌 — 베이비 중심으로 확대했다가 원복한다.
    // 줌 변환은 반드시 아래 월드 레이어(미로/아이템/어둠/파티클)에만 적용하고,
    // 조명·HUD·오버레이는 화면 좌표 그대로 그린다.
    const zoom = this.getZoomScale();
    const zoomed = zoom > 1.0001 && typeof ctx.scale === 'function';
    if (zoomed) {
      const focus = this.player.getRenderCenter(alpha);
      ctx.save();
      ctx.translate(focus.x, focus.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-focus.x, -focus.y);
    }

    // 맵 렌더링
    this.map.render(ctx, this.animTime, this.round);

    // 철창문 (닫힌 문은 벽처럼 통행을 막는다)
    this._renderGates(ctx);

    // 파워업 잔상 트레일 (슈가 러시 / 황금 보행기) — 매 프레임 위치를 샘플링
    const powerOptions = {
      sugarRush: this.sugarRushTimer > 0,
      goldenWalker: this.goldenTimer > 0,
    };
    this.player.updateTrail(this.animTime, alpha, powerOptions);

    if (!this.darkMode) {
      // 아이템 렌더링
      this.items.forEach(item => item.render(ctx, this.animTime));

      // 황금 젖병 (맵 중앙 슈퍼 아이템)
      this.goldenBottle?.render(ctx, this.animTime);

      // 가짜 젖꼭지(쪽쪽이) — 랜덤 복도 특수 아이템
      this.pacifier?.render(ctx, this.animTime);

      // 트랩 렌더링
      this.traps.forEach(trap => trap.render(ctx, this.animTime));

      // 적 렌더링
      this.enemies.forEach(e => e.render(ctx, this.animTime));

      // 플레이어 잔상 → 본체 순서로 렌더링 (tick 사이 보간 + 파워업 연출)
      this.player.renderTrail(ctx);
      this.player.render(ctx, alpha, this.animTime, powerOptions);
    } else {
      // 8라운드 이후: 적/미로는 어둠에 가리고,
      // 아이템과 트랩은 어둠 위에 다시 그려 반짝이게 한다.
      this.enemies.forEach(e => e.render(ctx, this.animTime));

      this._renderDarkness(ctx, alpha);

      this.items.forEach(item => item.render(ctx, this.animTime, { dark: true }));
      this.goldenBottle?.render(ctx, this.animTime, { dark: true });
      this.pacifier?.render(ctx, this.animTime, { dark: true });
      this.traps.forEach(trap => trap.render(ctx, this.animTime, { dark: true }));

      // 어둠 속에서도 철창문 상태를 알 수 있게 작은 표시등
      this._renderGateLamps(ctx);

      // 잔상은 어둠 위에서도 빛나야 파워업 중임을 알 수 있다
      this.player.renderTrail(ctx);
      this.player.render(ctx, alpha, this.animTime, powerOptions);
    }

    // 점수 팝업 (+50 / -200 …)
    this._renderPopups(ctx);

    // 충격파(울기) + 파티클 (월드 좌표)
    this.effects.renderShockwaves(ctx);
    this.effects.renderParticles(ctx);

    if (zoomed) ctx.restore(); // [월드 레이어 끝] 마이크로 줌 해제
    ctx.restore();

    // 베이비 주변 원형 조명 + 주변부 비네트
    this._renderLighting(ctx, alpha);

    // 점수 UI (임시)
    this._renderUI(ctx);

    // 테스터 오버레이 (labels 스위치가 켜져 있을 때만)
    this.tester?.drawOverlay?.(ctx);

    // 상태 오버레이
    if (this.state === 'READY') this._renderReadyOverlay(ctx);
    else if (this.state === 'CAUGHT') this._renderCaughtOverlay(ctx);
    else if (this.state === 'PAUSED') this._renderPauseOverlay(ctx);
    else if (this.state === 'STAGE_CLEAR') this._renderStageClearOverlay(ctx);
    else if (this.state === 'GAME_OVER') this._renderGameOverOverlay(ctx);

    // 데모 안내 (큰 DEMO + PC/터치 기기별 문구)
    this._renderDemoOverlay(ctx);

    // 화면 전체 플래시 (가장 위)
    this.effects.renderFlash(ctx);
  }

  /**
   * 철창문 상태 변화까지 남은 시간 비율 (경고 깜빡임용)
   * - gateClock 주기에서 다음 열림/닫힘 전환까지 얼마나 남았는지 계산한다.
   * @param {{closed: boolean}} gate
   * @returns {{warn: number, closing: boolean}} warn: 0(여유)~1(곧 변화), closing: 곧 닫히는지
   */
  _gateWarning(gate) {
    const cycle = GATE_OPEN_MS + GATE_CLOSED_MS;
    const phase = ((this.gateClock % cycle) + cycle) % cycle;
    const closing = !gate.closed;

    // 열린 문 → 열림 구간이 끝날 때 닫힌다 / 닫힌 문 → 닫힘 구간이 끝날 때 열린다
    // (문 위에 사람이 있어 못 닫는 경우엔 remaining 0 → 계속 경고)
    const remaining = gate.closed
      ? cycle - phase
      : (phase < GATE_OPEN_MS ? GATE_OPEN_MS - phase : 0);

    const warn = Math.max(0, Math.min(1, 1 - remaining / GATE_WARN_MS));
    return { warn, closing };
  }

  /** 철창문 렌더링 (anim: 1 열림 ~ 0 닫힘) */
  _renderGates(ctx) {
    if (this.gates.length === 0) return;

    for (const gate of this.gates) {
      const x = gate.col * TILE_SIZE;
      const y = gate.row * TILE_SIZE;
      const cx = x + TILE_SIZE / 2;
      const closedAmount = 1 - gate.anim;
      const warning = this._gateWarning(gate);

      ctx.save?.();

      // 문틀
      ctx.strokeStyle = 'rgba(144, 164, 174, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 2.5, y + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);

      if (closedAmount > 0.02) {
        const top = y + 2;
        const height = (TILE_SIZE - 4) * closedAmount;

        ctx.shadowColor = 'rgba(144, 202, 249, 0.75)';
        ctx.shadowBlur = 7;
        ctx.strokeStyle = 'rgba(207, 216, 220, 0.95)';
        ctx.lineWidth = 2;

        for (let i = 1; i <= 3; i++) {
          const bx = x + (TILE_SIZE / 4) * i;
          ctx.beginPath();
          ctx.moveTo(bx, top);
          ctx.lineTo(bx, top + height);
          ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        // 가로 지지대
        ctx.strokeStyle = 'rgba(176, 190, 197, 0.85)';
        ctx.lineWidth = 1.4;
        const crossY = top + Math.max(2, height - 2);
        ctx.beginPath();
        ctx.moveTo(x + 3, crossY);
        ctx.lineTo(x + TILE_SIZE - 3, crossY);
        ctx.stroke();
      } else {
        // 열린 상태: 바닥에 접힌 문틀
        ctx.fillStyle = 'rgba(144, 164, 174, 0.28)';
        ctx.fillRect(x + 3, y + TILE_SIZE - 4, TILE_SIZE - 6, 2);
      }

      // 상태등 (열림 초록 / 닫힘 빨강) — 변화가 임박하면 점멸 + 크기 증가
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime / 70);
      const warnPulse = warning.warn * pulse;
      let lampColor = gate.closed ? '#ef5350' : '#8bc34a';
      if (warnPulse > 0.02) {
        lampColor = warning.closing ? '#ffb300' : '#aed581';
      }
      ctx.fillStyle = lampColor;
      ctx.beginPath();
      ctx.arc(cx, y + 3, 1.6 + warnPulse * 1.4, 0, Math.PI * 2);
      ctx.fill();

      // 상태 변화 직전 은은한 경고 깜빡임 (닫힘=호박색 / 열림=연두색)
      if (warning.warn > 0.02) {
        const glow = warning.warn * (0.45 + 0.55 * pulse);
        const warnColor = warning.closing ? '255, 179, 0' : '174, 213, 129';

        ctx.fillStyle = `rgba(${warnColor}, ${(0.14 * glow).toFixed(3)})`;
        ctx.fillRect(x + 1.5, y + 1.5, TILE_SIZE - 3, TILE_SIZE - 3);

        ctx.strokeStyle = `rgba(${warnColor}, ${(0.85 * glow).toFixed(3)})`;
        ctx.lineWidth = 1.4 + 1.4 * glow;
        if (warning.closing) {
          ctx.shadowColor = 'rgba(255, 179, 0, 0.85)';
          ctx.shadowBlur = 9 * glow;
        }
        ctx.strokeRect(x + 2.5, y + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }

      ctx.restore?.();
    }
  }

  /** 어둠 속 철창문 위치 표시등 (멀리서도 열림/닫힘을 알 수 있게) */
  _renderGateLamps(ctx) {
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime / 70);

    for (const gate of this.gates) {
      const cx = (gate.col + 0.5) * TILE_SIZE;
      const cy = (gate.row + 0.5) * TILE_SIZE;
      const { warn, closing } = this._gateWarning(gate);
      const warnPulse = warn * pulse;

      // 상태 변화가 임박하면 은은한 후광이 함께 깜빡인다
      if (warnPulse > 0.02) {
        ctx.globalAlpha = warnPulse * 0.75;
        ctx.fillStyle = closing ? '#ffb300' : '#aed581';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.4 + warn * 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      let lampColor;
      if (gate.closed) lampColor = 'rgba(239, 83, 80, 0.95)';
      else if (warnPulse > 0.02) {
        lampColor = `rgba(255, 193, 7, ${(0.35 + 0.65 * warnPulse).toFixed(3)})`;
      } else lampColor = 'rgba(139, 195, 74, 0.9)';

      ctx.fillStyle = lampColor;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8 + warnPulse * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 8라운드 이후: 베이비 주변만 밝게 남기는 시야 제한 */
  _renderDarkness(ctx, alpha) {
    if (typeof ctx.createRadialGradient !== 'function') return;

    const center = this.player.getRenderCenter(alpha);
    const radius = this.visionTiles * TILE_SIZE;
    const inner = radius;
    const outer = radius + TILE_SIZE * 1.2;

    const darkness = ctx.createRadialGradient(
      center.x, center.y, inner,
      center.x, center.y, outer,
    );
    if (!darkness || typeof darkness.addColorStop !== 'function') return;

    darkness.addColorStop(0, 'rgba(0, 0, 0, 0)');
    darkness.addColorStop(0.6, 'rgba(0, 0, 0, 0.72)');
    darkness.addColorStop(1, 'rgba(0, 0, 0, 0.97)');

    ctx.fillStyle = darkness;
    // 카메라 셰이크로 화면 가장자리가 비지 않게 넉넉히 채운다
    ctx.fillRect(-32, -32, CANVAS_WIDTH + 64, CANVAS_HEIGHT + 64);

    // 보모가 가까워지면 시야 경계가 심장박동처럼 붉게 맥동한다 (시각 경고)
    const danger = this.heartbeatIntensity || 0;
    if (this.state === 'PLAYING' && danger > 0.02) {
      const beat = 0.5 + 0.5 * Math.sin(this.animTime / 130);
      const ring = ctx.createRadialGradient(
        center.x, center.y, radius * 0.62,
        center.x, center.y, radius * 1.06,
      );
      if (ring && typeof ring.addColorStop === 'function') {
        const alphaEdge = 0.16 * danger * (0.35 + 0.65 * beat);
        ring.addColorStop(0, 'rgba(255, 60, 60, 0)');
        ring.addColorStop(0.72, `rgba(255, 60, 60, ${alphaEdge.toFixed(3)})`);
        ring.addColorStop(1, 'rgba(255, 60, 60, 0)');
        ctx.fillStyle = ring;
        ctx.fillRect(-32, -32, CANVAS_WIDTH + 64, CANVAS_HEIGHT + 64);
      }
    }
  }

  /**
   * 베이비 주변 반경 3~4타일의 은은한 원형 조명 + 주변부 비네트.
   * - 캔버스 API 가 없는 테스트 스텁에서는 아무 일도 하지 않는다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} alpha
   */
  _renderLighting(ctx, alpha) {
    if (typeof ctx.createRadialGradient !== 'function') return;

    const center = this.player.getRenderCenter(alpha);
    const shake = this.effects.getShakeOffset();
    const cx = center.x + shake.x;
    const cy = center.y + shake.y;

    const lightTiles = this.darkMode
      ? Math.min(BABY_LIGHT_RADIUS_TILES, this.visionTiles)
      : BABY_LIGHT_RADIUS_TILES;

    // 줌은 베이비 중심이므로 조명 중심은 그대로지만, 반경은 월드와 같은 배율로 맞춘다
    const zoom = this.getZoomScale();
    const radius = TILE_SIZE * lightTiles * zoom;
    const outerRadius = radius + TILE_SIZE * BABY_LIGHT_FEATHER_TILES * zoom;

    // 1) 8라운드 이전에만 은은한 비네트 (이후엔 강한 어둠이 담당)
    if (!this.darkMode) {
      const vignette = ctx.createRadialGradient(cx, cy, radius, cx, cy, outerRadius);
      if (!vignette || typeof vignette.addColorStop !== 'function') return;

      vignette.addColorStop(0, 'rgba(3, 7, 18, 0)');
      vignette.addColorStop(0.55, 'rgba(3, 7, 18, 0.10)');
      vignette.addColorStop(1, 'rgba(2, 5, 14, 0.48)');

      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // 2) 베이비 주변의 따뜻한 빛 (가산 합성)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
    if (!glow || typeof glow.addColorStop !== 'function') return;

    const strength = this.player.isStealthed ? 0.45 : 1; // 숨는 중엔 빛을 줄인다

    // 일반 라운드의 조명은 '따뜻한 수유등'처럼 은은하게 (아기 얼굴/벽 테두리가 하얗게 날아가지 않도록).
    // 8라운드 이후 어둠 모드에서는 시야 가시성을 위해 기존 광량을 그대로 유지한다.
    const softWarmLight = !this.darkMode;

    // 파워업 중에는 조명 색도 바뀐다 (황금 / 핑크)
    let glowStops;
    if (this.goldenTimer > 0) {
      glowStops = softWarmLight
        ? [
          `rgba(255, 235, 130, ${0.16 * strength})`,
          `rgba(255, 215, 0, ${0.07 * strength})`,
          'rgba(255, 200, 0, 0)',
        ]
        : [
          `rgba(255, 235, 130, ${0.3 * strength})`,
          `rgba(255, 215, 0, ${0.14 * strength})`,
          'rgba(255, 200, 0, 0)',
        ];
    } else if (this.sugarRushTimer > 0) {
      glowStops = softWarmLight
        ? [
          `rgba(255, 180, 220, ${0.13 * strength})`,
          `rgba(240, 98, 146, ${0.05 * strength})`,
          'rgba(240, 98, 146, 0)',
        ]
        : [
          `rgba(255, 180, 220, ${0.24 * strength})`,
          `rgba(240, 98, 146, ${0.1 * strength})`,
          'rgba(240, 98, 146, 0)',
        ];
    } else {
      glowStops = softWarmLight
        ? [
          `rgba(255, 236, 186, ${0.1 * strength})`,
          `rgba(255, 210, 130, ${0.04 * strength})`,
          'rgba(255, 200, 90, 0)',
        ]
        : [
          `rgba(255, 234, 170, ${0.2 * strength})`,
          `rgba(255, 214, 120, ${0.08 * strength})`,
          'rgba(255, 200, 90, 0)',
        ];
    }
    glow.addColorStop(0, glowStops[0]);
    glow.addColorStop(0.45, glowStops[1]);
    glow.addColorStop(1, glowStops[2]);

    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.globalCompositeOperation = previous || 'source-over';
  }

  /** 간단한 HUD 렌더링 */
  _renderUI(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 28);

    ctx.fillStyle = '#fff';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // 좌표 하드코딩 대신 실제 텍스트 폭을 재서 배치 (폰트/언어 대체 대응)
    const measure = (text) => {
      if (typeof ctx.measureText !== 'function') return text.length * 7;
      const metrics = ctx.measureText(text);
      return metrics && typeof metrics.width === 'number' ? metrics.width : text.length * 7;
    };

    const heartsSize = 11;
    const heartsGap = 4;

    let x = 10;
    const rightLimit = CANVAS_WIDTH - 150; // 우측 사운드/타이틀 영역 확보
    const drawItem = (text, color = '#fff') => {
      const width = measure(text);
      if (x + width > rightLimit) return;
      ctx.fillStyle = color;
      ctx.fillText(text, x, 14);
      x += width + 16;
    };

    drawItem(`SCORE: ${this.player.score}`);
    drawItem(`HI: ${this.hiScore}`, '#ffd54f');

    // 목숨 하트 — OS '♥/♡' 문자 대신 Canvas 2D 벡터로 그린다
    const heartsWidth = PLAYER_LIVES * heartsSize + (PLAYER_LIVES - 1) * heartsGap;
    if (x + heartsWidth <= rightLimit) {
      for (let i = 0; i < PLAYER_LIVES; i++) {
        const hx = x + heartsSize / 2 + i * (heartsSize + heartsGap);
        drawHeartIcon(ctx, hx, 14, heartsSize, i < this.lives);
      }
      x += heartsWidth + 16;
    }

    drawItem(`R${this.round}`, '#29b6f6');

    // 우측: 사운드 스피커(벡터) + 브랜드 젖병(벡터) + 타이틀
    // 좁은 폭(모바일 320~390px)에서도 왼쪽 R{round}·하트와 겹치지 않도록
    // 남은 폭을 재서 폰트를 줄이거나 'Hungry Baby'로 축약한다.
    ctx.textAlign = 'right';
    const titleRight = CANVAS_WIDTH - 10;
    const titleIconsWidth = 46; // 스피커 + 젖병 아이콘 자리 + 여백
    const titleSpace = Math.max(0, titleRight - x - titleIconsWidth);
    const titleCandidates = [
      { text: 'Hungry Baby Rush', size: 14 },
      { text: 'Hungry Baby Rush', size: 12 },
      { text: 'Hungry Baby', size: 13 },
      { text: 'Hungry Baby', size: 11 },
      { text: 'HBR', size: 11 },
    ];
    let title = '';
    let titleWidth = 0;
    for (const candidate of titleCandidates) {
      ctx.font = `${candidate.size}px "Segoe UI", sans-serif`;
      const width = measure(candidate.text);
      if (width <= titleSpace) {
        title = candidate.text;
        titleWidth = width;
        break;
      }
    }

    if (title) {
      const titleLeft = titleRight - titleWidth;
      ctx.fillStyle = '#29b6f6';
      ctx.fillText(title, titleRight, 14);

      // OS '🔊/🔇' 대신 Canvas 2D 스피커 아이콘
      drawSpeakerIcon(ctx, titleLeft - 10, 14, 13, this.sound.enabled);

      // 브랜드 젖병 아이콘 — OS 이모지 대신 Canvas 2D 벡터로 그린다
      drawItemIcon(ctx, 'MILK', titleLeft - 28, 14, 13, this.animTime || 0);
    }

    // 이후 게이지/배지 렌더링이 기준 폰트를 이어 쓰도록 되돌린다
    ctx.font = '14px "Segoe UI", sans-serif';

    // 소화 게이지 (트랩 배출까지)
    this._renderDigestionGauge(ctx);

    // 스텔스 / 얼림 / 파워업 상태
    this._renderStealthGauge(ctx);
    this._renderFreezeBadge(ctx);
    this._renderBoostBadges(ctx);
    this._renderScoreCapBadge(ctx);
    this._renderBotStatus(ctx);

    // 하단 조작 안내
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, CANVAS_HEIGHT - 24, CANVAS_WIDTH, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';

    // 터치/모바일에서 D-패드가 실제로 표시 중일 때만 키보드 안내를 숨긴다.
    // (Windows 터치스크린 PC 처럼 터치 신호만 있는 데스크톱에서도 안내는 그대로 표시)
    const keyboardHint = this.isTouchUiVisible()
      ? ''
      : '  |  ←↑↓→ SPACE P R M · H:도움말';

    ctx.fillText(
      `체포 ${this.catchCount} · 속도 ${this.speedLevel}/10 · 아이템 ${this.itemCount}/${this.items.length} · 트랩 ${this.traps.length}${keyboardHint}`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT - 11,
    );
  }

  /** 봇 상태 배지 (상단 중앙) — 데모는 큰 DEMO 오버레이로 따로 표시한다 */
  _renderBotStatus(ctx) {
    if (!this.isBotActive || this.demoMode) return;

    const text = 'BOT MODE';
    const iconSize = 12;
    const metrics = typeof ctx.measureText === 'function' ? ctx.measureText(text) : null;
    const textWidth = metrics && typeof metrics.width === 'number'
      ? metrics.width
      : text.length * 7;
    const contentWidth = iconSize + 5 + textWidth;
    const width = contentWidth + 20;
    const centerX = CANVAS_WIDTH / 2;
    const y = 64;
    const left = centerX - width / 2;

    ctx.fillStyle = 'rgba(255, 224, 130, 0.18)';
    ctx.fillRect(left, y - 9, width, 18);

    // OS '🤖' 대신 Canvas 2D 로봇 아이콘
    drawRobotIcon(ctx, left + 10 + iconSize / 2, y, iconSize, '#ffe082');

    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 10 + iconSize + 5, y);
    ctx.textAlign = 'left';
  }

  /**
   * 데모 안내 오버레이 — 캔버스 상단에 큰 `DEMO` + 기기별 안내 문구.
   * PC: "게임 하시려면 아무 키나 누르세요"
   * 모바일(터치): "게임 하시려면 터치 하세요"
   * - 배경은 반투명(rgba 0.48)이라 뒤에서 아기/보모가 움직이는 플레이 화면이 자연스럽게 비친다.
   */
  _renderDemoOverlay(ctx) {
    if (!this.demoMode) return;

    const centerX = CANVAS_WIDTH / 2;
    const panelW = Math.min(CANVAS_WIDTH - 80, 380);
    const panelH = 92;
    const panelX = centerX - panelW / 2;
    const panelY = 46;

    // 은은한 맥동으로 데모가 살아 있음을 보여 준다
    const pulse = 0.65 + 0.35 * Math.abs(Math.sin((this.animTime || 0) / 380));

    ctx.save?.();

    // 반투명 오버레이 — 박스 뒤로 실제 플레이 화면이 비쳐 보인다
    ctx.fillStyle = 'rgba(3, 12, 26, 0.48)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = `rgba(41, 182, 246, ${(0.24 + 0.22 * pulse).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect?.(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 큰 DEMO
    ctx.font = 'bold 44px "Segoe UI", sans-serif';
    ctx.fillStyle = '#29b6f6';
    ctx.shadowColor = 'rgba(41, 182, 246, 0.9)';
    ctx.shadowBlur = 16;
    ctx.fillText('DEMO', centerX, panelY + 34);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // PC/모바일 안내 문구
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffe082';
    ctx.fillText(this.demoHint, centerX, panelY + 68);

    ctx.textAlign = 'left';
    ctx.restore?.();
  }

  /** 소화 진행 게이지 (트랩 배출까지 남은 시간) */
  _renderDigestionGauge(ctx) {
    const track = this.player.digesting[0];
    if (!track) return;

    const progress = Math.min(1, Math.max(0, 1 - track.remaining / track.total));
    const label = { PEE: '오줌', VOMIT: '토사물', POOP: '똥' }[track.trapType] || '트랩';
    const itemType = { PEE: 'MILK', VOMIT: 'CANDY', POOP: 'COOKIE' }[track.trapType] || 'MILK';

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, 32, 120, 8);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(10, 32, 120 * progress, 8);

    // 아이템 종류를 item.js 의 벡터 아이콘으로 표시 (OS 이모지 없음)
    drawItemIcon(ctx, itemType, 138, 36, 12, this.animTime || 0);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`소화중 → ${label}`, 148, 36);
  }

  /** 스텔스 남은 시간 게이지 (소화 게이지와 고정 슬롯으로 분리) */
  _renderStealthGauge(ctx) {
    if (!this.player.isStealthed) return;

    // 침대(10초)든 쪽쪽이(5초)든 이번 스텔스의 총 시간을 기준으로 게이지를 채운다
    const total = this.player.stealthTotal > 0
      ? this.player.stealthTotal
      : STEALTH_DURATION_MS;
    const ratio = Math.min(1, Math.max(0, this.player.stealthTimer / total));
    const y = 44; // 소화 게이지(y=32) 아래 고정 슬롯

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, y, 120, 8);
    ctx.fillStyle = '#29b6f6';
    ctx.fillRect(10, y, 120 * ratio, 8);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`스텔스 ${(this.player.stealthTimer / 1000).toFixed(1)}초`, 138, y + 4);
  }

  /** 울기 스킬로 악당이 얼어 있는 시간 표시 */
  _renderFreezeBadge(ctx) {
    const frozen = this.enemies.filter(e => e.isFrozen);
    if (frozen.length === 0) return;

    const remain = Math.max(...frozen.map(e => e.frozenTimer));
    const text = `얼림 ${(remain / 1000).toFixed(1)}초`;
    const y = 40;

    ctx.font = 'bold 12px "Segoe UI", sans-serif';
    const metrics = typeof ctx.measureText === 'function' ? ctx.measureText(text) : null;
    const textWidth = metrics && typeof metrics.width === 'number'
      ? metrics.width
      : text.length * 7;
    const iconSize = 13;
    const contentWidth = iconSize + 5 + textWidth;
    const left = CANVAS_WIDTH / 2 - contentWidth / 2;

    ctx.fillStyle = 'rgba(13, 71, 161, 0.55)';
    ctx.fillRect(left - 8, y - 10, contentWidth + 16, 20);

    // OS '❄' 대신 Canvas 2D 눈결정 아이콘
    drawIceCrystalIcon(ctx, left + iconSize / 2, y, iconSize, '#e3f2fd');

    ctx.fillStyle = '#bbdefb';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + iconSize + 5, y);
    ctx.textAlign = 'left';
  }

  /** 슈가 러시 / 황금 보행기 남은 시간 배지 (우측 상단) */
  _renderBoostBadges(ctx) {
    const badges = [];
    if (this.goldenTimer > 0) {
      badges.push({
        type: 'GOLDEN',
        text: `보행기 ${(this.goldenTimer / 1000).toFixed(1)}초`,
        color: COLORS.GOLDEN,
      });
    }
    if (this.sugarRushTimer > 0) {
      badges.push({
        type: 'CANDY',
        text: `슈가 러시 ${(this.sugarRushTimer / 1000).toFixed(1)}초`,
        color: COLORS.SUGAR,
      });
    }
    if (badges.length === 0) return;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Segoe UI", sans-serif';

    const iconSize = 13;
    let y = 40;
    for (const badge of badges) {
      const metrics = typeof ctx.measureText === 'function' ? ctx.measureText(badge.text) : null;
      const textWidth = metrics && typeof metrics.width === 'number'
        ? metrics.width
        : badge.text.length * 7;
      // 아이콘 + 여백까지 포함한 배지 폭
      const width = textWidth + iconSize + 24;
      const left = CANVAS_WIDTH - 10 - width;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(left, y - 9, width, 18);

      // OS 이모지 대신 아이템 벡터 아이콘을 배지 왼쪽에 그린다
      drawItemIcon(ctx, badge.type, left + 11, y, iconSize, this.animTime || 0);

      ctx.fillStyle = badge.color;
      ctx.fillText(badge.text, CANVAS_WIDTH - 18, y);
      y += 24;
    }
    ctx.textAlign = 'left';
  }

  /**
   * 라운드 점수 상한 도달 배지 (`Score Cleared`)
   * - 점수는 상한에서 멈추지만 라운드 클리어는 아이템 섭취로 이뤄지므로
   *   남은 아이템을 모으도록 안내한다.
   */
  _renderScoreCapBadge(ctx) {
    if (!this.scoreCapReached) return;

    const centerX = CANVAS_WIDTH / 2;
    const y = 92;
    const title = `Score Cleared · ${this.roundScoreCap}`;
    const guide = '남은 아이템을 모아 다음 라운드로 가세요!';

    const measure = (text, font) => {
      if (font) ctx.font = font;
      if (typeof ctx.measureText !== 'function') return text.length * 7;
      const metrics = ctx.measureText(text);
      return metrics && typeof metrics.width === 'number' ? metrics.width : text.length * 7;
    };

    const titleFont = 'bold 13px "Segoe UI", sans-serif';
    const guideFont = '11px "Segoe UI", sans-serif';
    const titleWidth = measure(title, titleFont);
    const guideWidth = measure(guide, guideFont);
    const checkSize = 12;
    const titleGroupWidth = checkSize + 6 + titleWidth;
    const width = Math.max(titleGroupWidth, guideWidth) + 24;

    // 배경/테두리 (얇은 금색 프레임)
    ctx.fillStyle = 'rgba(255, 213, 79, 0.18)';
    ctx.fillRect(centerX - width / 2, y - 17, width, 36);
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeStyle = 'rgba(255, 213, 79, 0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - width / 2 + 0.5, y - 16.5, width - 1, 35);
    }

    ctx.textBaseline = 'middle';

    // OS '✅' 대신 Canvas 2D 체크 배지
    const groupLeft = centerX - titleGroupWidth / 2;
    drawCheckIcon(ctx, groupLeft + checkSize / 2, y - 4, checkSize, '#8bc34a');

    ctx.fillStyle = '#ffd54f';
    ctx.font = titleFont;
    ctx.textAlign = 'left';
    ctx.fillText(title, groupLeft + checkSize + 6, y - 4);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = guideFont;
    ctx.textAlign = 'center';
    ctx.fillText(guide, centerX, y + 11);

    // 이후 HUD 텍스트가 좌측 정렬을 기대하므로 되돌린다
    ctx.textAlign = 'left';
  }

  /** 점수 팝업 렌더링 (위로 떠오르며 사라짐) */
  _renderPopups(ctx) {
    if (this.scorePopups.length === 0) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px "Segoe UI", sans-serif';

    for (const popup of this.scorePopups) {
      const progress = 1 - Math.max(0, popup.life) / popup.maxLife; // 0 → 1
      const x = (popup.col + 0.5) * TILE_SIZE;
      const y = (popup.row + 0.5) * TILE_SIZE - progress * 18;

      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.fillStyle = popup.color;
      ctx.fillText(popup.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * READY 카운트다운 오버레이: 라운드별 네온 타이틀 + "3... 2... 1..."
   * - 카운트다운 동안 베이비/보모는 READY 상태로 대기한다.
   */
  _renderReadyOverlay(ctx) {
    const t = this.animTime;
    const remain = Math.max(0, this.readyTimer);
    const count = Math.max(1, Math.ceil(remain / 1000));   // 3 → 2 → 1
    const withinSecond = 1 - (remain % 1000) / 1000;       // 0 → 1 (숫자 바뀐 뒤 흐른 정도)
    const pop = 1.3 - withinSecond * 0.24;                 // 막 바뀔 때 크게, 곧 정착
    const title = getRoundTitle(this.round);
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;

    // 배경 (살짝 푸른 어둠)
    ctx.fillStyle = 'rgba(2, 6, 20, 0.62)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 스캔라인 — 네온 아케이드 느낌
    ctx.fillStyle = 'rgba(79, 195, 247, 0.06)';
    for (let y = (t / 26) % 24; y < CANVAS_HEIGHT; y += 24) {
      ctx.fillRect(0, y, CANVAS_WIDTH, 2);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ROUND 배지
    ctx.font = 'bold 17px "Segoe UI", sans-serif';
    ctx.fillStyle = '#4fc3f7';
    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur = 18;
    ctx.fillText(`ROUND ${this.round}`, cx, cy - 132);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // 라운드 타이틀 — 위에서 떠오르며 숨쉬는 네온 글로우
    const intro = Math.min(1, (READY_COUNTDOWN_MS - remain) / 400); // 0 → 1 (등장)
    const neon = 0.55 + Math.abs(Math.sin(t / 320)) * 0.45;
    ctx.globalAlpha = 0.15 + intro * 0.85;
    ctx.font = 'bold 30px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffe082';
    ctx.shadowColor = `rgba(255, 213, 79, ${neon})`;
    ctx.shadowBlur = 16 + neon * 16;
    ctx.fillText(title, cx, cy - 70 + (1 - intro) * 20);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;

    // 3 · 2 · 1 카운트다운 (터질 듯 커졌다가 정착)
    ctx.save?.();
    if (typeof ctx.translate === 'function') ctx.translate(cx, cy + 22);
    if (typeof ctx.scale === 'function') ctx.scale(pop, pop);
    ctx.font = 'bold 96px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = count === 1 ? '#8bc34a' : '#4fc3f7';
    ctx.shadowBlur = 30;
    ctx.fillText(`${count}`, 0, 0);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore?.();

    // 3... 2... 1... 진행 점
    for (let i = 0; i < 3; i++) {
      const lit = (3 - i) >= count;
      ctx.fillStyle = lit ? '#4fc3f7' : 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.arc(cx - 28 + i * 28, cy + 84, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 안내문
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillText('침대로 들어가면 10초 스텔스!', cx, cy + 118);
  }

  /**
   * 체포 연출 오버레이: 굳은 베이비 위로 떨리는 "Oh! No~"
   * (CAUGHT_STUN_MS 동안 표시된 뒤 목숨 차감/게임 오버로 전환)
   */
  _renderCaughtOverlay(ctx) {
    const progress = 1 - Math.max(0, this.caughtTimer) / CAUGHT_STUN_MS; // 0 → 1
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;

    // 붉은 비네트 (심장 박동처럼 옅게 강해졌다 약해짐)
    const vignette = 0.18 + Math.sin(progress * Math.PI) * 0.16;
    ctx.fillStyle = `rgba(120, 0, 16, ${vignette})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 떨리는 "Oh! No~"
    const tremble = Math.sin(this.animTime / 38) * 3;
    const scale = 1 + Math.sin(progress * Math.PI) * 0.14;

    ctx.save?.();
    if (typeof ctx.translate === 'function') ctx.translate(cx + tremble, cy - 40);
    if (typeof ctx.scale === 'function') ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, progress * 4);
    ctx.font = 'bold 62px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffe082';
    ctx.shadowColor = '#ef5350';
    ctx.shadowBlur = 26;
    ctx.fillText('Oh! No~', 0, 0);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    ctx.restore?.();

    // 깜빡이는 경고 문구
    ctx.globalAlpha = 0.65 + Math.sin(this.animTime / 130) * 0.35;
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ff8a80';
    ctx.fillText('베이비가 보모에게 잡혔다!', cx, cy + 34);
    ctx.globalAlpha = 1;

    // 남은 목숨 (연출이 끝나면 1개 줄어든다)
    const willRemain = Math.max(0, this.lives - 1);
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(
      willRemain > 0 ? `남은 목숨 ${willRemain}  ·  곧 다시 달려요!` : '목숨을 모두 잃었어요...',
      cx, cy + 70,
    );
  }

  /** 일시정지 오버레이 (현재 점수 요약 포함) */
  _renderPauseOverlay(ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px "Segoe UI", sans-serif';
    ctx.fillText('일시정지', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 54);

    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText('P 또는 ESC 로 계속', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 6);

    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffe082';
    ctx.fillText(
      `점수 ${this.player.score}   ·   체포 ${this.catchCount}회   ·   아이템 ${this.stats.items}   ·   트랩 적중 ${this.stats.traps}`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2 + 36,
    );
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(
      `스텔스 ${this.stats.stealth}회 · 울기 ${this.stats.cries}회 · 슈가 ${this.stats.sugar}회 · 보행기 ${this.stats.golden}회`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2 + 62,
    );

    // 전역 [게임 종료] 버튼 안내
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillText('나가려면 우측 상단 [게임 종료] 버튼을 누르세요', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
  }

  /** 스테이지 클리어 오버레이 */
  _renderStageClearOverlay(ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 44px "Segoe UI", sans-serif';
    ctx.fillText('STAGE CLEAR', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 84);

    // 무엇으로 클리어했는지 표시 (아이템 섭취 / 점수 상한 달성)
    const itemsCleared = this.roundItemsEaten >= this.items.length;
    const clearLabel = itemsCleared
      ? (this.scoreCapReached ? 'Item Cleared · Score Cleared' : 'Item Cleared')
      : 'Score Cleared';
    ctx.fillStyle = '#8bc34a';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.fillText(clearLabel, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 58);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillText(
      `ROUND ${this.round} · 아이템 ${this.roundItemsEaten}/${this.items.length} · 속도 ${this.speedLevel}/10`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2 - 34,
    );

    ctx.font = '20px "Segoe UI", sans-serif';
    ctx.fillText(
      `점수 ${this.player.score}   ·   HI ${this.hiScore}`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2 + 4,
    );

    ctx.fillStyle = '#8bc34a';
    ctx.font = '14px "Segoe UI", sans-serif';
    const lifeY = CANVAS_HEIGHT / 2 + 38;
    const lifeText = '목숨 +1';
    const lifeMetrics = typeof ctx.measureText === 'function' ? ctx.measureText(lifeText) : null;
    const lifeTextWidth = lifeMetrics && typeof lifeMetrics.width === 'number'
      ? lifeMetrics.width
      : lifeText.length * 7;
    const heartSize = 12;
    const heartGap = 3;
    const heartCount = Math.max(0, Math.min(this.lives, PLAYER_LIVES));
    const heartsWidth = heartCount > 0
      ? heartCount * heartSize + (heartCount - 1) * heartGap
      : 0;
    const lifeGroupWidth = lifeTextWidth + (heartCount > 0 ? 8 + heartsWidth : 0);
    const lifeStartX = CANVAS_WIDTH / 2 - lifeGroupWidth / 2;

    // OS '♥' 문자 대신 Canvas 2D 하트 아이콘
    ctx.textAlign = 'left';
    ctx.fillText(lifeText, lifeStartX, lifeY);
    for (let i = 0; i < heartCount; i++) {
      const hx = lifeStartX + lifeTextWidth + 8 + heartSize / 2 + i * (heartSize + heartGap);
      drawHeartIcon(ctx, hx, lifeY, heartSize, true);
    }
    ctx.textAlign = 'center';

    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.fillText('[R] / [SPACE] / [ENTER] 다음 라운드', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 84);
  }

  /** 게임 오버 오버레이 */
  _renderGameOverOverlay(ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ef5350';
    ctx.font = 'bold 46px "Segoe UI", sans-serif';
    ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 86);

    ctx.fillStyle = '#ffffff';
    ctx.font = '22px "Segoe UI", sans-serif';
    ctx.fillText(`최종 점수 ${this.player.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30);

    ctx.fillStyle = '#ffd54f';
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillText(`HI-SCORE ${this.hiScore}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 6);

    if (this.newRecord) {
      ctx.fillStyle = '#8bc34a';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillText('NEW RECORD!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 34);
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillText(
      `ROUND ${this.round} · 체포 ${this.catchCount}회`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2 + 62,
    );

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('[R] 재도전 · 폰: 재시작', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 104);
  }

  /** 경비(순찰) 중인 악당 수 */
  _patrolCount() {
    return this.enemies.filter(e => e.mode === ENEMY_MODE.PATROL).length;
  }

  /** 게임 중지 */
  stop() {
    this.running = false;
  }

  /**
   * 전역 [게임 종료]: 진행 중인 루프와 BGM 을 즉시 멈추고 EXITED 로 전환한다.
   * [다시 시작] 은 main.js 가 #exit-overlay 를 닫은 뒤 resetToLobby() 를 호출한다.
   */
  exitGame() {
    // [게임 종료] 로 나가더라도 진행 중인 정식 매뉴얼 런의 점수는 버리지 않는다.
    if (!this.demoMode && !this.runAssisted && !this.runEnded && this.player.score > 0) {
      this._endRun();
    }

    this.running = false;
    this.loopToken = (this.loopToken || 0) + 1;
    this.tickAccumulator = 0;
    this.helpOpen = false;
    this.input?.clearJustPressed?.();
    this.sound?.stopBgm?.();
    this.state = 'EXITED';
    return this.state;
  }

  /** [게임 종료] 이후 다시 시작: 로비(READY) 상태로 초기화하고 루프를 재가동한다 */
  resumeFromExit() {
    if (this.state !== 'EXITED') return this.state;
    this.resetAll();
    this.running = true;
    this.loopToken = (this.loopToken || 0) + 1;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.sound?.playStart?.();
    this.sound?.startBgm?.(); // 종료 시 멈춘 BGM 을 다시 켠다 (음향 ON 인 경우)
    this._loop(this.lastTime, this.loopToken);
    return this.state;
  }

  /**
   * 종료 화면의 [다시 시작] → 메인 타이틀(READY 로비)로 완전 초기화 + 루프 재가동.
   * main.js 의 [게임 종료] 는 exitGame() 만 호출하고, 이 함수는 재시작 경로에서만 쓴다.
   */
  resetToLobby() {
    this.exitGame();          // 진행 중인 루프/BGM 즉시 정지 + rAF 토큰 무효화
    return this.resumeFromExit(); // READY 로비로 리셋 후 루프 재가동
  }
}