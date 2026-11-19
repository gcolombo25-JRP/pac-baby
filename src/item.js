/**
 * Pac-Baby: 아이템 & 트랩 클래스
 */

import {
  TILE_SIZE, COLORS, ITEMS,
  ITEM_RESPAWN_MS, TRAP_LIFE_MS, TRAP_COLORS, randomWalkableTile,
} from './constants.js';

/**
 * 아이템 (맵에 놓여있는 상태)
 */
export class Item {
  constructor(row, col, type) {
    this.row = row;
    this.col = col;
    this.x = col * TILE_SIZE;
    this.y = row * TILE_SIZE;
    this.type = type;        // 'MILK' | 'CANDY' | 'COOKIE'
    this.config = ITEMS[type];
    this.collected = false;
    this.respawnTimer = 0;   // 섭취 후 다시 나타나기까지 남은 시간(ms)
  }

  /**
   * 아이템 섭취: 숨기고 15초 뒤 리스폰을 예약한다.
   * @returns {number} 획득 점수 (이미 먹힌 상태면 0)
   */
  collect() {
    if (this.collected) return 0;
    this.collected = true;
    this.respawnTimer = ITEM_RESPAWN_MS;
    return this.config.score;
  }

  /**
   * 리스폰 타이머 진행 (수집된 아이템만 동작)
   * @param {number} dt 경과 시간(ms)
   * @param {number[][]} map
   * @param {() => number} rng
   * @param {Array<{row: number, col: number}>} avoid 베이비/악당이 있는 타일
   * @returns {boolean} 이번 호출로 다시 나타났는지
   */
  update(dt, map, rng = Math.random, avoid = []) {
    if (!this.collected) return false;

    this.respawnTimer -= dt;
    if (this.respawnTimer > 0) return false;

    const spot = randomWalkableTile(map, rng, avoid);
    if (!spot) {
      this.respawnTimer = 1000; // 자리를 못 찾으면 1초 뒤 재시도
      return false;
    }

    this.row = spot.row;
    this.col = spot.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.collected = false;
    this.respawnTimer = 0;
    return true;
  }

  render(ctx) {
    if (this.collected) return;
    const cx = this.x + TILE_SIZE / 2;
    const cy = this.y + TILE_SIZE / 2;

    // 아이템 배경 동그라미
    ctx.fillStyle = '#f5f5dc';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 3, 0, Math.PI * 2);
    ctx.fill();

    // 아이템 심볼 (텍스트)
    ctx.fillStyle = '#333';
    ctx.font = `${TILE_SIZE * 0.45}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.config.symbol, cx, cy);
  }
}

/**
 * 트랩 (아이템 소화 후 자동 배출)
 */
export class Trap {
  constructor(row, col, trapType, slowEffect, slowDuration) {
    this.row = row;
    this.col = col;
    this.x = col * TILE_SIZE;
    this.y = row * TILE_SIZE;
    this.trapType = trapType;   // 'PEE' | 'VOMIT' | 'POOP'
    this.slowEffect = slowEffect;
    this.slowDuration = slowDuration;
    this.active = true;
    this.triggered = false;     // 악당이 이미 밟았는지
    this.lifeTimer = TRAP_LIFE_MS; // 바닥에 남아 있는 시간
    this.maxLife = TRAP_LIFE_MS;
  }

  /**
   * 트랩 수명 진행
   * @param {number} dt
   * @returns {boolean} 아직 유효한지
   */
  update(dt) {
    if (!this.active) return false;
    this.lifeTimer -= dt;
    if (this.lifeTimer <= 0) {
      this.lifeTimer = 0;
      this.active = false;
      return false;
    }
    return true;
  }

  /** 악당이 밟아서 소모됨 */
  consume() {
    this.active = false;
    this.triggered = true;
  }

  render(ctx) {
    if (!this.active) return;
    const cx = this.x + TILE_SIZE / 2;
    const cy = this.y + TILE_SIZE / 2;

    ctx.fillStyle = TRAP_COLORS[this.trapType] || TRAP_COLORS.VOMIT;

    ctx.beginPath();
    ctx.ellipse(cx, cy, TILE_SIZE / 2 - 2, TILE_SIZE / 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}