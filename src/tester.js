/**
 * Pac-Baby: 테스터 모드 (스위치형)
 *
 * 모드 스위치(상호배타): 1 MANUAL · 2 REPLAY · 3 BOT
 * 기능 스위치(독립): 무적 / 무벽 / 악당 정지 / 1틱 모드 / 상태 라벨 / 클릭 텔레포트
 * 키: F2 패널 · F3 모드 순환 · F4 1틱 · F5 기록 · F6 재생 · F7 봇
 */

import {
  COLS, ROWS, TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT,
} from './constants.js';
import BotBrain from './bot.js';

const MODES = ['MANUAL', 'REPLAY', 'BOT'];
const STORAGE_KEY = 'pacbaby.tester.v1';
const LOG_LIMIT = 40;

/** 시드 기반 난수 (리플레이 결정성 확보) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default class Tester {
  constructor({ game, input, restart = null, ui = true, open = false } = {}) {
    this.game = game;
    this.input = input;
    this.restartGame = restart;
    this.canUseDom = ui && typeof document !== 'undefined';

    this.enabled = true;
    this.panelOpen = false;
    this.mode = 'MANUAL';

    this.flags = {
      invincible: false,
      noclip: false,
      freezeAll: false,
      step: false,
      labels: true,
      teleport: false,
    };

    this.recording = false;
    this.frames = [];
    this.replayIndex = 0;
    this.replaySeed = 1;
    this.botTicks = 0;
    this.brain = new BotBrain();

    this.events = [];
    this._inspectorTimer = null;
    this._panel = null;
    this._inspector = null;
    this._logEl = null;
    this._framesLabel = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onCanvasClick = this._onCanvasClick.bind(this);

    this._load();
    this.bind(game);

    if (this.canUseDom) {
      this._initUI();
      if (open) this.show();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
    }
  }

  /** 새 Game 인스턴스에 다시 연결 (재시작/리플레이 후) */
  bind(game) {
    if (!game) return;
    this.game = game;
    game.tester = this;
    this._applyFlags();
    game.notifyBotState?.();
  }

  /** 이번 틱에 사용할 방향 (undefined = 실제 입력 사용) */
  resolveDirection(game) {
    if (!this.enabled) return undefined;

    if (this.mode === 'REPLAY') {
      if (this.replayIndex >= this.frames.length) {
        this.mode = 'MANUAL';
        this._syncButtons();
        this.log('replay', '재생 끝 → MANUAL');
        game.notifyBotState?.();
        return null;
      }
      return this.frames[this.replayIndex++] ?? null;
    }

    if (this.mode === 'BOT') {
      this.botTicks += 1;
      this._botCry(game);
      return this._botDirection(game);
    }

    return undefined;
  }

  /** 테스터 치트 플래그가 하나라도 켜져 있는지 (리더보드 제출 제외 판정) */
  hasCheatFlags() {
    const flags = this.flags || {};
    return !!(flags.invincible || flags.noclip || flags.freezeAll
      || flags.step || flags.teleport);
  }

  /** MANUAL 모드에서 실제로 쓰인 방향을 기록 */
  record(dir) {
    if (!this.recording) return;
    this.frames.push(dir ?? null);
    if (this._framesLabel) this._framesLabel.textContent = `프레임 ${this.frames.length}`;
  }
  /** 테스터 모드 켜기/끄기 */
  setEnabled(value) {
    this.enabled = !!value;
    if (!this.enabled) {
      this.flags.invincible = false;
      this.flags.noclip = false;
      this.flags.freezeAll = false;
      this.flags.step = false;
      this.flags.teleport = false;
      this.recording = false;
      this.mode = 'MANUAL';
      this._suspendGameBot();
    }
    this._applyFlags();
    this._syncButtons();
    this.game?.notifyBotState?.();
  }

  /** 기능 스위치 토글 */
  toggleFlag(name) {
    if (!(name in this.flags)) return;
    this.flags[name] = !this.flags[name];

    if (name === 'step') {
      if (this.flags.step) this.game.state = 'PAUSED';
      else if (this.game.state === 'PAUSED') this.game.state = 'PLAYING';
    }

    this._applyFlags();
    this._save();
    this._syncButtons();
  }

  /** 모드 스위치 */
  setMode(mode) {
    if (!MODES.includes(mode)) return;

    if (mode === 'MANUAL') {
      this._suspendGameBot();
      this.recording = false;
      this.replayIndex = 0;
      if (!this.flags.step && this.game.state === 'PAUSED') this.game.state = 'PLAYING';
    }

    this.mode = mode;
    this._save();
    this._syncButtons();
    this.game.notifyBotState?.();
  }

  /** 기록 시작 (게임을 초기 상태로 되돌린 뒤 시작) */
  startRecording() {
    this._suspendGameBot();
    this.recording = false;
    this.mode = 'MANUAL';
    this.frames = [];
    this.replaySeed = Math.floor(Math.random() * 2 ** 31);
    this.restart();
    this._applyRng(this.replaySeed);
    this.recording = true;
    this.log('record', `기록 시작 (seed ${this.replaySeed})`);
    this._syncButtons();
    this.game.notifyBotState?.();
  }

  /** 기록 재생 (같은 시드로 리셋 후 입력만 재생) */
  startReplay() {
    if (this.frames.length === 0) {
      this.log('replay', '기록된 프레임이 없습니다');
      return false;
    }

    this._suspendGameBot();
    this.recording = false;
    this.restart();
    this._applyRng(this.replaySeed);
    this.replayIndex = 0;
    this.mode = 'REPLAY';
    this.log('replay', `재생 시작 (${this.frames.length} 프레임)`);
    this._syncButtons();
    this.game.notifyBotState?.();
    return true;
  }

  /** AI 자동 플레이 시작 */
  startBot() {
    this._suspendGameBot();
    this.recording = false;
    this.botTicks = 0;
    this.brain = new BotBrain();
    this.mode = 'BOT';
    if (this.game.state === 'PAUSED' && !this.flags.step) this.game.state = 'PLAYING';
    this.log('bot', '봇 시작');
    this._syncButtons();
    this.game.notifyBotState?.();
  }

  /** 모든 자동 동작 정지 */
  stopAll() {
    this._suspendGameBot();
    this.recording = false;
    this.replayIndex = 0;
    this.mode = 'MANUAL';
    this.log('stop', '정지');
    this._syncButtons();
    this.game.notifyBotState?.();
  }

  /** 게임 한 틱 수동 진행 (1틱 모드) */
  step() {
    if (!this.game) return;
    this.game.state = 'PAUSED';
    this.game._update(this.game.tickMs);
    this.game._render(1);
    this.log('step', '1틱 진행');
  }

  /** 게임 재시작 (콜백이 있을 때만) */
  restart() {
    if (typeof this.restartGame !== 'function') return this.game;
    const next = this.restartGame();
    if (next) this.bind(next);
    return this.game;
  }

  /** 시드 난수를 게임/악당에 주입 (리플레이 결정성) */
  _applyRng(seed) {
    const rng = mulberry32(seed);
    this.game.rng = rng;
    this.game.enemies.forEach(enemy => {
      enemy.rng = rng;
      enemy.guardTarget = null;
    });
  }

  /** 스위치 값을 게임 오브젝트에 반영 */
  _applyFlags() {
    const game = this.game;
    if (!game) return;
    game.player.walkable = this.enabled && this.flags.noclip ? () => true : null;
    game.enemies.forEach(enemy => {
      enemy.pinned = this.enabled && this.flags.freezeAll;
    });
  }
  // ===== 봇 AI =====

  /** 테스터 자동 모드(기록/재생/봇)가 게임 쪽 봇과 겹치지 않게 정리 */
  _suspendGameBot() {
    if (!this.game) return;
    this.game.botMode = false;
    this.game.demoMode = false;
    this.game.demoArmed = false;
    this.game.notifyBotState?.();
  }

  /** 위기 시 키 입력 없이 울기 (테스터 BOT 모드) */
  _botCry(game) {
    if (!this.enabled || !game) return;
    if (this.brain.shouldCry(game)) game._useCry?.(true);
  }

  /** 봇: 얼어붙은 악당을 무시하고 회피/황금 젖병/아이템을 계산한다 */
  _botDirection(game) {
    return this.brain.decide(game);
  }

  // ===== 로그 / 오버레이 =====

  /** 이벤트 로그 */
  log(type, message) {
    this.events.unshift({ type, message, at: Date.now() });
    if (this.events.length > LOG_LIMIT) this.events.length = LOG_LIMIT;
    if (this._logEl) {
      this._logEl.textContent = this.events
        .map(e => `[${e.type}] ${e.message}`)
        .join('\n');
    }
  }

  /** 캔버스 상태 라벨 (labels 스위치) */
  drawOverlay(ctx) {
    if (!this.enabled || !this.flags.labels || !this.game) return;

    const game = this.game;
    const player = game.player;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '11px "Segoe UI", monospace';

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(8, 54, 236, 46);

    ctx.fillStyle = '#8bc34a';
    ctx.fillText(`TEST ${this.mode}${this.flags.step ? ' · STEP' : ''}${this.flags.invincible ? ' · INV' : ''}`, 14, 58);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(`baby (${player.row},${player.col}) ${player.direction || '-'}  score ${player.score}`, 14, 72);
    ctx.fillText(`items ${game.itemCount}  traps ${game.traps.length}  ${game.state}`, 14, 86);
  }

  // ===== 패널 / 키 =====

  show() {
    this.panelOpen = true;
    if (this._panel) this._panel.style.display = 'block';
    this._startInspector();
    this._syncButtons();
  }

  hide() {
    this.panelOpen = false;
    if (this._panel) this._panel.style.display = 'none';
    this._stopInspector();
  }

  togglePanel() {
    if (this.panelOpen) this.hide();
    else this.show();
  }

  /** F3: MANUAL → REPLAY → BOT → MANUAL */
  cycleMode() {
    const index = MODES.indexOf(this.mode);
    const next = MODES[(index + 1) % MODES.length];

    if (next === 'REPLAY') this.startReplay();
    else if (next === 'BOT') this.startBot();
    else this.stopAll();
  }

  /** 캔버스 클릭 → 타일 이동 (teleport 스위치) */
  _onCanvasClick(event) {
    if (!this.enabled || !this.flags.teleport || !this.game) return;

    const rect = event.target.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const x = (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
    const y = (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);

    const col = Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE_SIZE)));
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE_SIZE)));
    this.teleport(row, col);
  }

  /** 베이비를 지정 타일로 이동 */
  teleport(row, col) {
    const player = this.game.player;
    player.row = row;
    player.col = col;
    player.x = col * TILE_SIZE;
    player.y = row * TILE_SIZE;
    player.prevRow = row;
    player.prevCol = col;
    player.direction = null;
    player.nextDirection = null;
    player.isMoving = false;
    this.log('teleport', `(${row},${col})`);
  }

  /** F2/F3/F4/F5/F6/F7 */
  _onKeyDown(event) {
    if (!this.enabled || !this.canUseDom) return;
    const code = event.code;

    if (code === 'F2' && event.shiftKey) {
      event.preventDefault();
      this.togglePanel();
    } else if (code === 'F3') {
      event.preventDefault();
      this.cycleMode();
    } else if (code === 'F4') {
      event.preventDefault();
      this.step();
    } else if (code === 'F5') {
      event.preventDefault();
      this.startRecording();
    } else if (code === 'F6') {
      event.preventDefault();
      this.startReplay();
    } else if (code === 'F7') {
      event.preventDefault();
      if (this.mode === 'BOT') this.stopAll();
      else this.startBot();
    }
  }
  // ===== UI =====

  /** 패널/스타일 생성 */
  _initUI() {
    this._injectStyle();

    const panel = document.createElement('div');
    panel.className = 'tester-panel';
    panel.innerHTML = `
      <div class="tt-head">
        <span>PAC-BABY TESTER</span>
        <button type="button" data-action="hide" title="닫기 (Shift+F2)">✕</button>
      </div>
      <div class="tt-modes">
        <button type="button" data-mode="MANUAL">1 MANUAL</button>
        <button type="button" data-mode="REPLAY">2 REPLAY</button>
        <button type="button" data-mode="BOT">3 BOT</button>
      </div>
      <div class="tt-flags">
        <label><input type="checkbox" data-flag="invincible"> 무적</label>
        <label><input type="checkbox" data-flag="noclip"> 무벽</label>
        <label><input type="checkbox" data-flag="freezeAll"> 악당 정지</label>
        <label><input type="checkbox" data-flag="step"> 1틱 모드</label>
        <label><input type="checkbox" data-flag="labels"> 상태 라벨</label>
        <label><input type="checkbox" data-flag="teleport"> 클릭 텔레포트</label>
      </div>
      <div class="tt-actions">
        <button type="button" data-action="record">● 기록</button>
        <button type="button" data-action="stop">■ 정지</button>
        <button type="button" data-action="replay">▶ 재생</button>
        <button type="button" data-action="bot">🤖 봇</button>
        <button type="button" data-action="step">⏭ 1틱</button>
        <button type="button" data-action="restart">↻ 재시작</button>
      </div>
      <div class="tt-frames">프레임 0</div>
      <pre class="tt-inspector"></pre>
      <div class="tt-log"></div>
    `;
    document.body.appendChild(panel);

    this._panel = panel;
    this._inspector = panel.querySelector('.tt-inspector');
    this._logEl = panel.querySelector('.tt-log');
    this._framesLabel = panel.querySelector('.tt-frames');

    panel.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;
        if (mode === 'REPLAY') this.startReplay();
        else if (mode === 'BOT') this.startBot();
        else this.setMode('MANUAL');
      });
    });

    panel.querySelectorAll('[data-flag]').forEach(input => {
      input.addEventListener('change', () => {
        const name = input.dataset.flag;
        if (this.flags[name] !== input.checked) this.toggleFlag(name);
      });
    });

    panel.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', () => this._onAction(button.dataset.action));
    });

    const canvas = this.game && this.game.canvas;
    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('click', this._onCanvasClick);
    }

    this._syncButtons();
  }

  /** 패널 버튼 처리 */
  _onAction(action) {
    switch (action) {
      case 'hide': this.hide(); break;
      case 'record': this.startRecording(); break;
      case 'stop': this.stopAll(); break;
      case 'replay': this.startReplay(); break;
      case 'bot': this.mode === 'BOT' ? this.stopAll() : this.startBot(); break;
      case 'step': this.step(); break;
      case 'restart': this.restart(); this.log('restart', '재시작'); break;
      default: break;
    }
  }

  /** 버튼/체크박스 상태를 현재 스위치에 맞춘다 */
  _syncButtons() {
    if (!this._panel) return;

    this._panel.querySelectorAll('[data-mode]').forEach(button => {
      button.classList.toggle('tt-active', button.dataset.mode === this.mode);
    });
    this._panel.querySelectorAll('[data-flag]').forEach(input => {
      input.checked = !!this.flags[input.dataset.flag];
    });
    if (this._framesLabel) this._framesLabel.textContent = `프레임 ${this.frames.length}`;
  }
  /** 스타일 1회 주입 */
  _injectStyle() {
    if (document.getElementById('tester-style')) return;
    const style = document.createElement('style');
    style.id = 'tester-style';
    style.textContent = `
      .tester-panel{position:fixed;top:10px;right:10px;width:272px;z-index:9999;
        background:rgba(10,18,32,.94);border:1px solid #29b6f6;border-radius:10px;
        padding:10px;color:#e3f2fd;font:12px/1.4 "Segoe UI",sans-serif;display:none;
        box-shadow:0 8px 24px rgba(0,0,0,.5)}
      .tester-panel .tt-head{display:flex;justify-content:space-between;align-items:center;
        font-weight:700;color:#29b6f6;margin-bottom:8px}
      .tester-panel .tt-head button{background:none;border:0;color:#e3f2fd;cursor:pointer}
      .tester-panel .tt-modes,.tester-panel .tt-actions{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
      .tester-panel button[data-mode],.tester-panel button[data-action]{
        flex:1 1 auto;padding:5px 6px;border-radius:6px;border:1px solid #29527a;
        background:#122a44;color:#cfe8ff;font-size:11px;cursor:pointer}
      .tester-panel button.tt-active{background:#29b6f6;color:#04263b;border-color:#29b6f6;font-weight:700}
      .tester-panel .tt-flags{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-bottom:8px}
      .tester-panel .tt-flags label{display:flex;gap:4px;align-items:center;cursor:pointer}
      .tester-panel .tt-frames{color:#ffd54f;margin-bottom:6px}
      .tester-panel .tt-inspector{margin:0 0 6px;padding:6px;border-radius:6px;
        background:#0a1726;color:#b3e5fc;font:10px/1.5 Consolas,monospace;white-space:pre-wrap}
      .tester-panel .tt-log{max-height:96px;overflow:auto;padding:6px;border-radius:6px;
        background:#0a1726;color:#9ccc65;font:10px/1.4 Consolas,monospace;white-space:pre-wrap}
      @media (max-width:700px){
        .tester-panel{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:56vh;overflow:auto;
          padding:8px;font-size:11px}
        .tester-panel .tt-inspector{font-size:9px}
        .tester-panel .tt-log{max-height:64px;font-size:9px}
        .tester-panel button[data-mode],.tester-panel button[data-action]{font-size:10px;padding:4px}
      }
    `;
    document.head.appendChild(style);
  }

  _startInspector() {
    if (this._inspectorTimer || typeof setInterval !== 'function') return;
    this._inspectorTimer = setInterval(() => this._updateInspector(), 150);
    this._updateInspector();
  }

  _stopInspector() {
    if (!this._inspectorTimer) return;
    clearInterval(this._inspectorTimer);
    this._inspectorTimer = null;
  }

  _updateInspector() {
    if (!this._inspector || !this.game) return;
    const game = this.game;
    const player = game.player;

    this._inspector.textContent =
      `state ${game.state} | mode ${this.mode} | speed ${game.speedLevel}/10 (${game.tickMs}ms)\n`
      + `baby (${player.row},${player.col}) dir ${player.direction || '-'} next ${player.nextDirection || '-'}\n`
      + `score ${player.score} | stealth ${(player.stealthTimer / 1000).toFixed(1)}s | catch ${game.catchCount}\n`
      + `items ${game.itemCount}/${game.items.length} | traps ${game.traps.length} | digest ${player.digesting.length}\n`
      + `enemies ${game.enemies.map(e => `${e.mode[0]}${e.pinned ? 'p' : ''}${e.isFrozen ? 'f' : ''}@${e.row},${e.col}`).join(' ')}\n`
      + `rec ${this.recording ? 'ON' : 'off'} ${this.frames.length}f | replay ${this.replayIndex} | bot ${this.botTicks} ${this.brain.lastMode}`;
  }

  // ===== 저장 / 정리 =====

  _save() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ flags: this.flags }));
    } catch (err) { /* 무시 */ }
  }

  _load() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.flags && typeof data.flags === 'object') {
        Object.assign(this.flags, data.flags);
      }
    } catch (err) { /* 무시 */ }
  }

  /** 리스너/타이머 정리 */
  destroy() {
    this._stopInspector();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
    }
    const canvas = this.game && this.game.canvas;
    if (canvas && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('click', this._onCanvasClick);
    }
    if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
    this._panel = null;
    if (this.game) this.game.tester = null;
    this.game?.notifyBotState?.();
  }
}
