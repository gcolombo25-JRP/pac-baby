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
  READY_COUNTDOWN_MS, SCORE_POPUP_MS,
  PLAYER_LIVES, ROUND_CLEAR_MODE, ROUND_TARGET_SCORE, ROUND_SPEED_STEP, HISCORE_KEY,
  SKILL_CRY, PENALTY,
  MAX_DEVICE_PIXEL_RATIO, BABY_LIGHT_RADIUS_TILES, BABY_LIGHT_FEATHER_TILES,
  SUGAR_RUSH, GOLDEN_BOTTLE, GOLDEN_SPAWN,
  EXTRA_ENEMY_SPAWNS, GATE_OPEN_MS, GATE_CLOSED_MS, GATE_MAX, GATE_POSITIONS,
  VISION_START_ROUND, VISION_START_TILES, VISION_MIN_TILES,
} from './constants.js';
import MapRenderer from './map.js';
import Player from './player.js';
import Enemy, { ENEMY_MODE } from './enemy.js';
import { Item, Trap } from './item.js';
import Effects from './effects.js';
import SoundFX from './sound.js';

/** 한 프레임에서 처리할 최대 tick 수 (탭 전환 후 폭주 방지) */
const MAX_FRAME_TICKS = 3;

/** localStorage 안전 접근 (없거나 차단된 환경은 null) */
function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (err) { /* 접근 차단 환경 */ }
  return null;
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
    this.tickAccumulator = 0;
    this.lastTime = 0;
    this.graceTimer = 0;   // 체포 직후 무적 시간
    this.catchCount = 0;   // 체포 횟수 (HUD 표시용)
    this.cryCooldown = 0;  // 울기 재사용 대기(ms)

    // 침대 스텔스
    this.stealthBed = null; // 스텔스에 사용 중인 침대 { row, col }
    // 시작 위치가 침대이므로 "이미 침대 위" 상태로 시작 (자동 발동 방지)
    this._wasOnBed = this.map.map[this.map.babySpawn.row][this.map.babySpawn.col] === 2;

    // 게임 상태 (7단계 UI)
    this.state = 'READY';          // READY | PLAYING | PAUSED
    this.helpOpen = false;         // 사용 설명서(도움말) 열림 여부 — 열려 있으면 로직/입력 정지
    this.readyTimer = READY_COUNTDOWN_MS;
    this.scorePopups = [];         // { row, col, text, color, life, maxLife }
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0, sugar: 0, golden: 0, knocks: 0 };
    this.tester = null;            // 테스터 모드 연결 지점 (src/tester.js)

    // 진행 상태 (9단계: 목숨/라운드/하이스코어)
    this.storage = options.storage || safeStorage();
    this.lives = PLAYER_LIVES;
    this.round = 1;
    this.roundStartScore = 0;
    this.roundItemsEaten = 0;
    this.hiScore = this._loadHiScore();
    this.newRecord = false;
    this.baseSpeedLevel = this.speedLevel;

    // 1라운드는 철창문/시야 제한 없음
    this._initGates(this.round);
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
    const configs = this.map.enemySpawns.map((pos, index) => ({
      spawn: pos,
      mode: index < CHASE_ENEMY_COUNT ? ENEMY_MODE.CHASE : ENEMY_MODE.PATROL,
    }));

    if (round >= 4) {
      configs.push({ spawn: EXTRA_ENEMY_SPAWNS.CHASE, mode: ENEMY_MODE.CHASE });
    }
    if (round >= 5) {
      configs.push({ spawn: EXTRA_ENEMY_SPAWNS.PATROL, mode: ENEMY_MODE.PATROL });
    }

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
    this.lastTime = performance.now();
    this.sound.playStart();
    this._loop(this.lastTime);
  }

  /** 메인 루프 */
  _loop = (now) => {
    if (!this.running) return;

    try {
      this._tick(now);
    } catch (err) {
      // 렌더/로직 예외로 게임이 영구 정지하지 않도록 보호
      console.error('[Pac-Baby] loop error:', err);
    }

    requestAnimationFrame(this._loop);
  };

  /** 한 프레임 처리 (예외는 _loop 에서 잡는다) */
  _tick(now) {
    const dt = now - this.lastTime;
    this.lastTime = now;

    // 애니메이션 시간 (캐릭터 바운스/아이템 부유/트랩 흔들림)
    if (dt > 0) this.animTime = (this.animTime + dt) % 600000;

    // 시각 효과(프레임 단위) + 8비트 BGM 스케줄 (일시정지·도움말 중에는 BGM 정지)
    this.effects.update(dt / 1000);
    if (this.state !== 'PAUSED' && !this.helpOpen) this.sound.updateBgm?.();

    // 사용 설명서(도움말)가 열려 있으면 게임은 완전히 정지한다 (입력도 처리하지 않음)
    if (this.helpOpen) {
      this._render(this.tickMs > 0 ? this.tickAccumulator / this.tickMs : 0);
      this.input.clearJustPressed();
      return;
    }

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
      while (this.tickAccumulator >= tickMs) {
        this._update(tickMs);
        this.tickAccumulator -= tickMs;
      }
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
    return this.helpOpen;
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

    // 입력 → 베이비 방향 전환 (테스터 모드에서는 입력 소스가 바뀔 수 있다)
    const dir = this._resolveDirection();
    if (dir) this.player.setDirection(dir);
    this.tester?.record?.(dir);

    // 닫힌 철창문이 반영된 navMap 으로 이동한다
    this.player.update(this.navMap, dt);
    if (this.player.isMoving) this.sound.playStep();

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

    // 트랩 수명 & 악당 감속 판정
    this._updateTraps(dt);

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
      this._catchPlayer();
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
        this.player.score += gained;
        this.player.startDigestion(item.config); // 소화 시작 → 나중에 트랩 배출
        this.stats.items += 1;
        this.roundItemsEaten += 1;
        this._addPopup(item.row, item.col, `+${gained}`, '#8bc34a');
        this.tester?.log?.('item', `${item.config.name} +${gained}`);
        this.sound.playItem();
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

  /** 악당 날려버리기: +300점, 스폰 지점 복귀, 남은 보행기 시간 동안 다시 도망 */
  _knockEnemy(enemy) {
    const hitRow = enemy.row;
    const hitCol = enemy.col;
    const fleeRemaining = Math.max(0, this.goldenTimer);

    this.player.score += GOLDEN_BOTTLE.knockScore;
    this.stats.knocks += 1;
    this._updateHiScore();

    enemy.resetToSpawn();
    if (fleeRemaining > 0) enemy.startFlee(fleeRemaining);

    this._addPopup(hitRow, hitCol, `+${GOLDEN_BOTTLE.knockScore}`, COLORS.GOLDEN);
    this.tester?.log?.(
      'knock',
      `악당 날려버림 @ (${hitRow},${hitCol}) +${GOLDEN_BOTTLE.knockScore}`,
    );
    this.sound.playTrapHit();
    this.effects.burstSparkle(hitRow, hitCol, 16);
    this.effects.shockwave(hitRow, hitCol, COLORS.GOLDEN, TILE_SIZE * 2.8, 0.45);
    this.effects.flashScreen(COLORS.GOLDEN, 0.16, 0.2);
    this.effects.shake(0.12, 4);
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
      this.sound.playTrap();
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
      this.player.score += TRAP_HIT_SCORE;
      this.stats.traps += 1;
      this._addPopup(trap.row, trap.col, `+${TRAP_HIT_SCORE}`, '#ffb74d');
      this.tester?.log?.('trap', `${trap.trapType} 적중 +${TRAP_HIT_SCORE} · ${freezeMs / 1000}s 얼림`);
      this.sound.playTrapHit();
      this._updateHiScore();
    }

    // 만료되거나 밟힌 트랩은 제거
    this.traps = this.traps.filter(trap => trap.active);
  }

  /** 남아 있는(먹을 수 있는) 아이템 수 */
  get itemCount() {
    return this.items.filter(item => !item.collected).length;
  }

  /** 체포 처리: -200점, 침대 귀환, 악당은 대기실로 복귀, 잠깐 무적 */
  _catchPlayer() {
    const caughtAt = { row: this.player.row, col: this.player.col };

    this.player.onCaught(this.map.babySpawn);
    this.enemies.forEach(e => e.resetToSpawn());
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
    if (!this.input.isJustPressed(SKILL_CRY.key)) return;
    if (this.state !== 'PLAYING') return;
    if (this.enemies.length === 0) return;
    if (this.cryCooldown > 0) return; // 연사 제한: 3초에 1회

    this.player.score += SKILL_CRY.cost;
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

  /** 현재 점수가 최고점이면 갱신 + 저장 */
  _updateHiScore() {
    if (this.player.score <= this.hiScore) return;

    this.hiScore = this.player.score;
    this.newRecord = true;
    if (!this.storage) return;
    try {
      this.storage.setItem(HISCORE_KEY, String(this.hiScore));
    } catch (err) { /* 저장 실패 무시 */ }
  }

  // ===== 라운드 진행 =====

  /** 라운드 클리어 조건 검사 (PLAYING 에서만) */
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
    this._updateHiScore();
    this.tester?.log?.('gameover', `최종 점수 ${this.player.score}`);
    this.sound.playGameOver();
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

    this.traps = [];
    this.scorePopups = [];
    this.effects.reset();

    this.roundItemsEaten = 0;
    this.roundStartScore = this.player.score;
    this.graceTimer = RESPAWN_GRACE_MS;

    this.stealthBed = null;
    this.map.highlightBed = null;
    this._wasOnBed = true;

    this.cryCooldown = 0;
    this.tickAccumulator = 0;
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
    this.player.score = 0;
    this.lives = PLAYER_LIVES;
    this.round = 1;
    this.catchCount = 0;
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0, sugar: 0, golden: 0, knocks: 0 };
    this.newRecord = false;
    this.baseSpeedLevel = this.speedLevel; // 재도전 시 현재 속도 단계를 기준으로 유지
    this._resetBoard();

    this.tester?.log?.('restart', '새 게임 시작');
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

    // 맵 렌더링
    this.map.render(ctx, this.animTime);

    // 철창문 (닫힌 문은 벽처럼 통행을 막는다)
    this._renderGates(ctx);

    if (!this.darkMode) {
      // 아이템 렌더링
      this.items.forEach(item => item.render(ctx, this.animTime));

      // 황금 젖병 (맵 중앙 슈퍼 아이템)
      this.goldenBottle?.render(ctx, this.animTime);

      // 트랩 렌더링
      this.traps.forEach(trap => trap.render(ctx, this.animTime));

      // 적 렌더링
      this.enemies.forEach(e => e.render(ctx, this.animTime));

      // 플레이어 렌더링 (tick 사이 보간 + 파워업 연출)
      this.player.render(ctx, alpha, this.animTime, {
        sugarRush: this.sugarRushTimer > 0,
        goldenWalker: this.goldenTimer > 0,
      });
    } else {
      // 8라운드 이후: 적/미로는 어둠에 가리고,
      // 아이템과 트랩은 어둠 위에 다시 그려 반짝이게 한다.
      this.enemies.forEach(e => e.render(ctx, this.animTime));

      this._renderDarkness(ctx, alpha);

      this.items.forEach(item => item.render(ctx, this.animTime, { dark: true }));
      this.goldenBottle?.render(ctx, this.animTime, { dark: true });
      this.traps.forEach(trap => trap.render(ctx, this.animTime, { dark: true }));

      // 어둠 속에서도 철창문 상태를 알 수 있게 작은 표시등
      this._renderGateLamps(ctx);

      this.player.render(ctx, alpha, this.animTime, {
        sugarRush: this.sugarRushTimer > 0,
        goldenWalker: this.goldenTimer > 0,
      });
    }

    // 점수 팝업 (+50 / -200 …)
    this._renderPopups(ctx);

    // 충격파(울기) + 파티클 (월드 좌표)
    this.effects.renderShockwaves(ctx);
    this.effects.renderParticles(ctx);

    ctx.restore();

    // 베이비 주변 원형 조명 + 주변부 비네트
    this._renderLighting(ctx, alpha);

    // 점수 UI (임시)
    this._renderUI(ctx);

    // 테스터 오버레이 (labels 스위치가 켜져 있을 때만)
    this.tester?.drawOverlay?.(ctx);

    // 상태 오버레이
    if (this.state === 'READY') this._renderReadyOverlay(ctx);
    else if (this.state === 'PAUSED') this._renderPauseOverlay(ctx);
    else if (this.state === 'STAGE_CLEAR') this._renderStageClearOverlay(ctx);
    else if (this.state === 'GAME_OVER') this._renderGameOverOverlay(ctx);

    // 화면 전체 플래시 (가장 위)
    this.effects.renderFlash(ctx);
  }

  /** 철창문 렌더링 (anim: 1 열림 ~ 0 닫힘) */
  _renderGates(ctx) {
    if (this.gates.length === 0) return;

    for (const gate of this.gates) {
      const x = gate.col * TILE_SIZE;
      const y = gate.row * TILE_SIZE;
      const cx = x + TILE_SIZE / 2;
      const closedAmount = 1 - gate.anim;

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

      // 상태등 (열림 초록 / 닫힘 빨강)
      ctx.fillStyle = gate.closed ? '#ef5350' : '#8bc34a';
      ctx.beginPath();
      ctx.arc(cx, y + 3, 1.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore?.();
    }
  }

  /** 어둠 속 철창문 위치 표시등 (멀리서도 열림/닫힘을 알 수 있게) */
  _renderGateLamps(ctx) {
    for (const gate of this.gates) {
      const cx = (gate.col + 0.5) * TILE_SIZE;
      const cy = (gate.row + 0.5) * TILE_SIZE;

      ctx.fillStyle = gate.closed
        ? 'rgba(239, 83, 80, 0.95)'
        : 'rgba(139, 195, 74, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
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
    const radius = TILE_SIZE * lightTiles;
    const outerRadius = radius + TILE_SIZE * BABY_LIGHT_FEATHER_TILES;

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

    // 파워업 중에는 조명 색도 바뀐다 (황금 / 핑크)
    let glowStops;
    if (this.goldenTimer > 0) {
      glowStops = [
        `rgba(255, 235, 130, ${0.3 * strength})`,
        `rgba(255, 215, 0, ${0.14 * strength})`,
        'rgba(255, 200, 0, 0)',
      ];
    } else if (this.sugarRushTimer > 0) {
      glowStops = [
        `rgba(255, 180, 220, ${0.24 * strength})`,
        `rgba(240, 98, 146, ${0.1 * strength})`,
        'rgba(240, 98, 146, 0)',
      ];
    } else {
      glowStops = [
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

    const hearts = '♥'.repeat(this.lives) + '♡'.repeat(Math.max(0, PLAYER_LIVES - this.lives));

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
    drawItem(hearts, '#ef5350');
    drawItem(`R${this.round}`, '#29b6f6');

    ctx.textAlign = 'right';
    ctx.fillText(`${this.sound.enabled ? '🔊' : '🔇'} Pac-Baby 🍼`, CANVAS_WIDTH - 10, 14);

    // 소화 게이지 (트랩 배출까지)
    this._renderDigestionGauge(ctx);

    // 스텔스 / 얼림 / 파워업 상태
    this._renderStealthGauge(ctx);
    this._renderFreezeBadge(ctx);
    this._renderBoostBadges(ctx);

    // 하단 조작 안내
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, CANVAS_HEIGHT - 24, CANVAS_WIDTH, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';

    // PC(키보드)에서만 H:도움말 안내 (폰은 D-패드 도움말 버튼 사용)
    const coarsePointer = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    const touchActive = typeof document !== 'undefined'
      && document.body?.classList?.contains?.('touch-active');
    const helpHint = (coarsePointer || touchActive) ? '' : ' · H:도움말';

    ctx.fillText(
      `체포 ${this.catchCount} · 속도 ${this.speedLevel}/10 · 아이템 ${this.itemCount}/${this.items.length} · 트랩 ${this.traps.length}  |  ←↑↓→ SPACE P R M${helpHint}`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT - 11,
    );
  }

  /** 소화 진행 게이지 (트랩 배출까지 남은 시간) */
  _renderDigestionGauge(ctx) {
    const track = this.player.digesting[0];
    if (!track) return;

    const progress = Math.min(1, Math.max(0, 1 - track.remaining / track.total));
    const label = { PEE: '오줌', VOMIT: '토사물', POOP: '똥' }[track.trapType] || '트랩';

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, 32, 120, 8);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(10, 32, 120 * progress, 8);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`소화중 → ${label}`, 138, 36);
  }

  /** 스텔스 남은 시간 게이지 (소화 게이지와 고정 슬롯으로 분리) */
  _renderStealthGauge(ctx) {
    if (!this.player.isStealthed) return;

    const ratio = this.player.stealthTimer / STEALTH_DURATION_MS;
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

    ctx.fillStyle = 'rgba(100,181,246,0.95)';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`얼림 ${(remain / 1000).toFixed(1)}초`, CANVAS_WIDTH / 2, 40);
  }

  /** 슈가 러시 / 황금 보행기 남은 시간 배지 (우측 상단) */
  _renderBoostBadges(ctx) {
    const badges = [];
    if (this.goldenTimer > 0) {
      badges.push({
        text: `🍼 보행기 ${(this.goldenTimer / 1000).toFixed(1)}초`,
        color: COLORS.GOLDEN,
      });
    }
    if (this.sugarRushTimer > 0) {
      badges.push({
        text: `🍬 슈가 러시 ${(this.sugarRushTimer / 1000).toFixed(1)}초`,
        color: COLORS.SUGAR,
      });
    }
    if (badges.length === 0) return;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Segoe UI", sans-serif';

    let y = 40;
    for (const badge of badges) {
      const metrics = typeof ctx.measureText === 'function' ? ctx.measureText(badge.text) : null;
      const textWidth = metrics && typeof metrics.width === 'number'
        ? metrics.width
        : badge.text.length * 7;
      const width = textWidth + 18;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(CANVAS_WIDTH - 10 - width, y - 9, width, 18);

      ctx.fillStyle = badge.color;
      ctx.fillText(badge.text, CANVAS_WIDTH - 18, y);
      y += 24;
    }
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

  /** READY 카운트다운 오버레이 */
  _renderReadyOverlay(ctx) {
    const remaining = Math.max(1, Math.ceil(this.readyTimer / 1000));

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 52px "Segoe UI", sans-serif';
    ctx.fillText('READY', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 48);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 70px "Segoe UI", sans-serif';
    ctx.fillText(`${remaining}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 32);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillText('침대로 들어가면 10초 스텔스!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 104);
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
    ctx.fillText(
      `목숨 +1  (${'♥'.repeat(this.lives)})`,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2 + 38,
    );

    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.fillText('[SPACE] 다음 라운드', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 84);
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
}