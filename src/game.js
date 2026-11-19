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
    this.player = new Player(this.map.babySpawn);
    this.rng = Math.random; // 아이템/순찰 위치 선택용 난수 (테스트에서 주입 가능)

    // 앞의 CHASE_ENEMY_COUNT 명은 추격, 나머지는 경비(순찰)
    this.enemies = this.map.enemySpawns.map((pos, index) => {
      const mode = index < CHASE_ENEMY_COUNT ? ENEMY_MODE.CHASE : ENEMY_MODE.PATROL;
      return new Enemy(pos, index, ENEMY_START_DELAY_MS + index * 300, mode, this.rng);
    });
    this.items = [];
    this.traps = [];

    // 아이템 스폰 (테스트용 — 모든 4 타일에 아이템 배치)
    this._initItems();

    // 효과음 & 속도 단계
    // 재시작 시 같은 SoundFX 를 재사용해 AudioContext 가 누적되지 않게 한다
    this.sound = options.sound || new SoundFX();
    this.effects = new Effects(); // 파티클/플래시/셰이크
    this.speedLevel = DEFAULT_SPEED_LEVEL;
    this.tickMs = SPEED_LEVELS[this.speedLevel - 1].babyTileMs;
    this._applySpeedLevel();

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
    this.readyTimer = READY_COUNTDOWN_MS;
    this.scorePopups = [];         // { row, col, text, color, life, maxLife }
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0 };
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
  }

  /** 아이템 초기 배치 */
  _initItems() {
    const itemTypes = ['MILK', 'CANDY', 'COOKIE'];
    this.map.itemSpawns.forEach((pos, index) => {
      const type = itemTypes[index % itemTypes.length];
      this.items.push(new Item(pos.row, pos.col, type));
    });
  }

  /**
   * 속도 단계 적용 (1 = 가장 느림 ~ 10 = 가장 빠름)
   * 베이비 tick 간격과 보모 이동 시간을 함께 조정한다.
   */
  _applySpeedLevel() {
    const config = SPEED_LEVELS[this.speedLevel - 1];
    this.tickMs = config.babyTileMs;

    // 악당은 어떤 단계에서도 베이비보다 느려야 한다
    const enemyTileMs = Math.max(
      config.enemyTileMs,
      Math.round(config.babyTileMs * ENEMY_SLOWDOWN_FACTOR),
    );
    this.enemies.forEach(e => { e.baseTileMs = enemyTileMs; });
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

    // 시각 효과(프레임 단위) + 8비트 BGM 스케줄 (일시정지 중에는 BGM 정지)
    this.effects.update(dt / 1000);
    if (this.state !== 'PAUSED') this.sound.updateBgm?.();

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

    // 입력 → 베이비 방향 전환 (테스터 모드에서는 입력 소스가 바뀔 수 있다)
    const dir = this._resolveDirection();
    if (dir) this.player.setDirection(dir);
    this.tester?.record?.(dir);

    this.player.update(this.map.map, dt);
    if (this.player.isMoving) this.sound.playStep();

    // 침대 진입 → 스텔스, 종료 시 침대 표시 해제
    this._updateStealth();

    // 소화가 끝난 아이템 → 트랩 배출
    this._expelTraps();

    // 아이템 섭취 / 리스폰
    this._updateItems(dt);

    // 보모(악당): 일부는 추격, 일부는 경비 순찰
    this.enemies.forEach(e => e.update(dt, this.map.map, this.player.row, this.player.col));

    // 트랩 수명 & 악당 감속 판정
    this._updateTraps(dt);

    // 체포 판정 (무적 시간/스텔스/테스터 무적 중에는 무시)
    if (this.graceTimer > 0) {
      this.graceTimer = Math.max(0, this.graceTimer - dt);
    } else if (!this.player.isStealthed
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
    ];

    for (const item of this.items) {
      if (item.collected) {
        item.update(dt, this.map.map, this.rng, avoid);
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
      }
    }
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
    this.effects.shake(0.2, 6); // 0.2초 카메라 셰이크

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

    // 푸른빛 전체 플래시 + 악당 위치에 얼음 파티클
    this.effects.flashScreen(COLORS.ENEMY_FROZEN, 0.35, 0.3);
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
    this.player.reset(this.map.babySpawn);
    this.enemies.forEach(enemy => enemy.resetToSpawn());

    this.items = [];
    this._initItems();
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
  }

  /** 다음 라운드 시작 (라운드마다 속도 단계 +1, 최대 10) */
  _startRound(round) {
    const nextLevel = round <= 1
      ? this.baseSpeedLevel
      : Math.min(SPEED_LEVELS.length, this.speedLevel + ROUND_SPEED_STEP);

    this.round = round;
    this.speedLevel = nextLevel;
    this._applySpeedLevel();
    this._resetBoard();

    this.tester?.log?.('round', `ROUND ${round} 시작 (속도 ${this.speedLevel}/10)`);
  }

  /** 새 게임 (GAME OVER → 재도전): 점수/목숨/라운드 초기화, 하이스코어는 유지 */
  resetAll() {
    this.player.score = 0;
    this.lives = PLAYER_LIVES;
    this.round = 1;
    this.catchCount = 0;
    this.stats = { items: 0, traps: 0, stealth: 0, cries: 0 };
    this.newRecord = false;
    this.baseSpeedLevel = this.speedLevel; // 재도전 시 현재 속도 단계를 기준으로 유지
    this._applySpeedLevel();
    this._resetBoard();

    this.tester?.log?.('restart', '새 게임 시작');
    return this;
  }

  /** 프레임 렌더링 (alpha로 보간) */
  _render(alpha) {
    const ctx = this.ctx;

    // 배경 클리어
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 카메라 셰이크 (월드만 흔들고 HUD 는 고정)
    const shake = this.effects.getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // 맵 렌더링
    this.map.render(ctx);

    // 아이템 렌더링
    this.items.forEach(item => item.render(ctx));

    // 트랩 렌더링
    this.traps.forEach(trap => trap.render(ctx));

    // 적 렌더링
    this.enemies.forEach(e => e.render(ctx));

    // 플레이어 렌더링 (tick 사이 보간)
    this.player.render(ctx, alpha);

    // 점수 팝업 (+50 / -200 …)
    this._renderPopups(ctx);

    // 파티클 (월드 좌표)
    this.effects.renderParticles(ctx);

    ctx.restore();

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

    // 스텔스 / 얼림 상태
    this._renderStealthGauge(ctx);
    this._renderFreezeBadge(ctx);

    // 하단 조작 안내
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, CANVAS_HEIGHT - 24, CANVAS_WIDTH, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `체포 ${this.catchCount} · 속도 ${this.speedLevel}/10 · 아이템 ${this.itemCount}/${this.items.length} · 트랩 ${this.traps.length}  |  ←↑↓→ SPACE P R M`,
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
      `스텔스 ${this.stats.stealth}회   ·   울기 ${this.stats.cries}회`,
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
    ctx.fillText('[R] 재도전', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 104);
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