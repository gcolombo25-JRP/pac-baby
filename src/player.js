/**
 * Pac-Baby: 베이비(플레이어) 클래스
 */

import {
  COLS, TILE_SIZE, COLORS, TICK_RATE, INPUT_BUFFER_MS,
  STEALTH_COOLDOWN_MS,
  DIRECTIONS, isWalkableTile,
  PENALTY,
} from './constants.js';

export default class Player {
  constructor(spawnPos) {
    this.row = spawnPos.row;
    this.col = spawnPos.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;

    // 렌더링 보간용 이전 타일 좌표
    this.prevRow = this.row;
    this.prevCol = this.col;

    this.direction = null;    // 현재 진행 방향
    this.nextDirection = null; // 다음 입력 방향
    this.nextDirectionTimer = 0; // 입력 버퍼 남은 시간 (조작 여유)
    this.walkable = null;     // 이동 가능 판정 오버라이드 (테스터 무벽 모드)
    this.score = 0;
    this.isMoving = false;

    // 소화 트랙 (아이템 → 트랩)
    this.digesting = [];      // { trapType, slowEffect, slowDuration, remaining, total }
    this.expelledTraps = [];  // 소화 완료로 배출된 트랩 (게임 루프가 가져간다)

    // 침대 스텔스 (6단계 부가 기능)
    this.stealthTimer = 0;      // 남은 스텔스 시간
    this.stealthCooldown = 0;   // 재사용 대기 시간
  }

  /** 현재 스텔스 중인지 */
  get isStealthed() {
    return this.stealthTimer > 0;
  }

  /**
   * 침대 은신: 스텔스 시작
   * @param {number} duration 지속 시간(ms)
   * @returns {boolean} 발동 성공 여부
   */
  activateStealth(duration) {
    if (this.stealthTimer > 0) return false;    // 이미 스텔스 중
    if (this.stealthCooldown > 0) return false; // 재사용 대기 중
    this.stealthTimer = duration;
    return true;
  }

  /** 스텔스/쿨다운 타이머 진행 */
  _updateStealth(dt) {
    if (this.stealthTimer > 0) {
      this.stealthTimer -= dt;
      if (this.stealthTimer <= 0) {
        this.stealthTimer = 0;
        this.stealthCooldown = STEALTH_COOLDOWN_MS;
      }
      return;
    }

    if (this.stealthCooldown > 0) {
      this.stealthCooldown = Math.max(0, this.stealthCooldown - dt);
    }
  }

  /**
   * 아이템 섭취 시 소화 시작 (digestTime 후 트랩 배출)
   * @param {object} config ITEMS 의 아이템 설정
   */
  startDigestion(config) {
    this.digesting.push({
      trapType: config.trapType,
      slowEffect: config.slowEffect,
      slowDuration: config.slowDuration,
      remaining: config.digestTime,
      total: config.digestTime,
      itemName: config.name,
    });
  }

  /**
   * 소화된 트랩을 꺼내 간다 (게임 루프에서 호출)
   * @returns {Array<{trapType: string, slowEffect: number, slowDuration: number}>}
   */
  takeExpelledTraps() {
    const expelled = this.expelledTraps;
    this.expelledTraps = [];
    return expelled;
  }

  /** 소화 타이머 진행 → 끝난 항목은 배출 목록으로 이동 */
  _updateDigestion(dt) {
    for (let i = this.digesting.length - 1; i >= 0; i--) {
      const track = this.digesting[i];
      track.remaining -= dt;
      if (track.remaining > 0) continue;

      this.digesting.splice(i, 1);
      this.expelledTraps.push({
        trapType: track.trapType,
        slowEffect: track.slowEffect,
        slowDuration: track.slowDuration,
      });
    }
  }

  /** 입력 방향 설정 (타일 중앙에서만 전환 적용, 일정 시간 기억) */
  setDirection(dir) {
    if (!DIRECTIONS[dir]) return;
    if (this.nextDirection === dir) return; // 같은 방향 반복 입력은 타이머만 유지
    this.nextDirection = dir;
    this.nextDirectionTimer = INPUT_BUFFER_MS;
  }

  /**
   * 다음 타일 좌표 계산 (좌우 터널 통과 포함)
   * @param {string} dir
   * @returns {{row: number, col: number}}
   */
  _nextTile(dir) {
    const delta = DIRECTIONS[dir];
    let row = this.row + delta.row;
    let col = this.col + delta.col;

    // 좌우 끝은 연결된 터널 (row 14 처럼 양 끝이 뚫린 행)
    if (col < 0) col = COLS - 1;
    if (col >= COLS) col = 0;

    return { row, col };
  }

  /** 해당 방향으로 이동 가능한지 */
  _canMove(dir, map) {
    if (!DIRECTIONS[dir]) return false;
    const { row, col } = this._nextTile(dir);

    // 테스터 무벽 모드: 외부 판정을 우선 사용
    if (typeof this.walkable === 'function') return this.walkable(row, col);

    return isWalkableTile(map, row, col);
  }

  /**
   * tick 마다 호출 — 타일 단위 이동 처리
   * @param {number[][]} map
   * @param {number} dt tick 간격(ms) — 입력 버퍼 만료 판정
   */
  update(map, dt = TICK_RATE) {
    // 보간 기준점 저장
    this.prevRow = this.row;
    this.prevCol = this.col;

    // 소화 진행 (완료되면 트랩 배출 예약)
    this._updateDigestion(dt);

    // 스텔스/쿨다운 타이머
    this._updateStealth(dt);

    // 1) 대기 중인 방향: 지금 갈 수 있으면 즉시 전환, 아니면 버퍼 시간만큼 기다린다
    if (this.nextDirection) {
      if (this._canMove(this.nextDirection, map)) {
        this.direction = this.nextDirection;
        this.nextDirection = null;
        this.nextDirectionTimer = 0;
      } else {
        this.nextDirectionTimer -= dt;
        if (this.nextDirectionTimer <= 0) {
          this.nextDirection = null;
          this.nextDirectionTimer = 0;
        }
      }
    }

    // 2) 이동할 수 없으면 정지
    if (!this.direction || !this._canMove(this.direction, map)) {
      this.isMoving = false;
      return;
    }

    // 3) 한 타일 이동
    const { row, col } = this._nextTile(this.direction);
    this.row = row;
    this.col = col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.isMoving = true;
  }

  /**
   * 캔버스에 베이비 렌더링
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} alpha 보간 계수 (0~1)
   */
  render(ctx, alpha = 1) {
    const t = Math.min(Math.max(alpha, 0), 1);

    // 스텔스 중에는 반투명하게 그린다
    if (this.stealthTimer > 0) ctx.globalAlpha = 0.3;

    // 터널 통과(타일 좌표가 1칸 이상 점프) 시에는 보간하지 않는다
    const drawCol = Math.abs(this.prevCol - this.col) <= 1
      ? this.prevCol + (this.col - this.prevCol) * t
      : this.col;
    const drawRow = Math.abs(this.prevRow - this.row) <= 1
      ? this.prevRow + (this.row - this.prevRow) * t
      : this.row;

    const cx = (drawCol + 0.5) * TILE_SIZE;
    const cy = (drawRow + 0.5) * TILE_SIZE;
    const radius = TILE_SIZE / 2 - 2;

    // 몸통
    ctx.fillStyle = COLORS.BABY;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 눈
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 3, 2, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 3, 2, 0, Math.PI * 2);
    ctx.fill();

    // 미소
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy + 2, 4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    // 스텔스 중이면 반짝이는 테두리 표시
    if (this.stealthTimer > 0) {
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1; // 알파 복원
    }
  }

  /**
   * 페널티 없이 초기 상태로 되돌린다 (라운드 시작 / 재도전용)
   * @param {{row: number, col: number}} spawnPos
   */
  reset(spawnPos) {
    this.row = spawnPos.row;
    this.col = spawnPos.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.prevRow = this.row;
    this.prevCol = this.col;
    this.isMoving = false;
    this.direction = null;
    this.nextDirection = null;
    this.nextDirectionTimer = 0;
    this.digesting = [];
    this.expelledTraps = [];
    this.stealthTimer = 0;
    this.stealthCooldown = 0;
  }

  /** 악당에게 잡혔을 때 */
  onCaught(spawnPos) {
    this.score += PENALTY.CAUGHT;
    this.reset(spawnPos);
  }
}