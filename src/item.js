/**
 * Pac-Baby: 아이템 & 트랩 클래스
 */

import {
  TILE_SIZE, COLORS, ITEMS,
  ITEM_RESPAWN_MS, TRAP_LIFE_MS, TRAP_COLORS, randomWalkableTile,
} from './constants.js';

/** 아이템 종류별 테두리 색 (접시 링/글로우) */
const ITEM_RING_COLORS = {
  MILK: '#90caf9',
  CANDY: '#f48fb1',
  COOKIE: '#ffcc80',
  GOLDEN: '#ffd700',
};

/** 작은 4갈래 반짝이 (선 4개) */
function drawSparkle(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

/**
 * 아이템 (맵에 놓여있는 상태)
 */
export class Item {
  /**
   * @param {number} row
   * @param {number} col
   * @param {'MILK'|'CANDY'|'COOKIE'|'GOLDEN'} type
   * @param {{fixed?: boolean}} options fixed=true 면 리스폰도 처음 위치(황금 젖병)
   */
  constructor(row, col, type, options = {}) {
    this.row = row;
    this.col = col;
    this.x = col * TILE_SIZE;
    this.y = row * TILE_SIZE;
    this.type = type;        // 'MILK' | 'CANDY' | 'COOKIE' | 'GOLDEN'
    this.config = ITEMS[type];
    this.collected = false;
    this.respawnTimer = 0;   // 섭취 후 다시 나타나기까지 남은 시간(ms)

    this.homeRow = row;      // 고정 스폰 위치 (황금 젖병)
    this.homeCol = col;
    this.fixedSpawn = options.fixed === true;
  }

  /**
   * 아이템 섭취: 숨기고 리스폰을 예약한다 (일반 15초 / 황금 젖병 20초).
   * @returns {number} 획득 점수 (이미 먹힌 상태면 0)
   */
  collect() {
    if (this.collected) return 0;
    this.collected = true;
    this.respawnTimer = this.config.respawnMs || ITEM_RESPAWN_MS;
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

    // 황금 젖병은 항상 맵 중앙(원래 자리)으로 돌아온다
    const spot = this.fixedSpawn
      ? { row: this.homeRow, col: this.homeCol }
      : randomWalkableTile(map, rng, avoid);

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

  /**
   * 캔버스에 아이템 렌더링 (살짝 떠다니는 연출)
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} timeMs 애니메이션 시간(ms)
   * @param {{dark?: boolean}} [options] dark: 어둠 속 발광 연출
   */
  render(ctx, timeMs = 0, options = {}) {
    if (this.collected) return;

    const supportsEllipse = typeof ctx.ellipse === 'function';
    const isGolden = this.type === 'GOLDEN';
    const cx = this.x + TILE_SIZE / 2;
    const bob = Math.sin(timeMs / 320 + this.row * 0.7 + this.col * 1.1) * (isGolden ? 1.9 : 1.3);
    const cy = this.y + TILE_SIZE / 2 + bob;
    const ring = ITEM_RING_COLORS[this.type] || '#ffe082';

    // 바닥 그림자
    if (supportsEllipse) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(cx, this.y + TILE_SIZE * 0.78, TILE_SIZE * 0.28, TILE_SIZE * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 어둠 속에서도 반짝이며 보이도록 발광 후광
    if (options.dark) {
      const pulse = 0.18 + Math.abs(Math.sin(timeMs / 360 + this.row * 0.8)) * 0.16;
      ctx.fillStyle = isGolden
        ? `rgba(255, 215, 0, ${pulse + 0.12})`
        : `rgba(255, 236, 150, ${pulse})`;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isGolden
        ? 'rgba(255, 230, 120, 0.9)'
        : 'rgba(255, 248, 190, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 황금 젖병: 커다란 황금 후광 + 회전하는 링
    if (isGolden) {
      const pulse = 0.16 + Math.abs(Math.sin(timeMs / 360)) * 0.2;
      ctx.fillStyle = `rgba(255, 215, 0, ${pulse})`;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 236, 130, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const start = timeMs / 480 + (Math.PI * 2 / 6) * i;
        ctx.arc(cx, cy, TILE_SIZE * 0.62, start, start + 0.5);
      }
      ctx.stroke();
    }

    // 접시 (아이보리 원판) — shadowBlur 대신 저비용 후광 원
    ctx.save?.();
    ctx.fillStyle = isGolden ? 'rgba(255, 226, 130, 0.5)' : 'rgba(255, 244, 196, 0.20)';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 + (isGolden ? 2 : 1), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isGolden ? '#fff8dc' : '#f7f3e3';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 - 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 접시 테두리 링
    ctx.strokeStyle = ring;
    ctx.lineWidth = isGolden ? 2 : 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();

    // 아이템 심볼 (크고 선명하게)
    ctx.fillStyle = '#333';
    ctx.font = `${TILE_SIZE * (isGolden ? 0.7 : 0.62)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.config.symbol, cx, cy + 0.5);

    // 둘레를 도는 반짝이
    ctx.strokeStyle = isGolden ? 'rgba(255, 215, 0, 0.95)' : 'rgba(255, 248, 200, 0.9)';
    ctx.lineWidth = isGolden ? 1.3 : 1;
    const sparkleCount = isGolden ? 6 : 3;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = timeMs / (isGolden ? 420 : 620) + (Math.PI * 2 / sparkleCount) * i;
      drawSparkle(
        ctx,
        cx + Math.cos(angle) * (TILE_SIZE * (isGolden ? 0.56 : 0.44)),
        cy + Math.sin(angle) * (TILE_SIZE * (isGolden ? 0.46 : 0.36)),
        isGolden ? 2.4 : 1.8,
      );
    }

    ctx.restore?.();
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

  /**
   * 캔버스에 트랩 렌더링 (종류별 색 + 흔들리는 웅덩이)
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} timeMs 애니메이션 시간(ms)
   * @param {{dark?: boolean}} [options] dark: 어둠 속 발광 연출
   */
  render(ctx, timeMs = 0, options = {}) {
    if (!this.active) return;

    const supportsEllipse = typeof ctx.ellipse === 'function';
    const cx = this.x + TILE_SIZE / 2;
    const cy = this.y + TILE_SIZE / 2;
    const color = TRAP_COLORS[this.trapType] || TRAP_COLORS.VOMIT;

    // 수명이 얼마 남지 않으면 서서히 사라진다
    const fade = Math.max(0.25, Math.min(1, this.lifeTimer / 1600));
    const wobble = Math.sin(timeMs / 240 + this.row * 1.3 + this.col * 0.9);
    const rx = TILE_SIZE / 2 - 2 + wobble * 0.9;
    const ry = TILE_SIZE / 3 + Math.cos(timeMs / 260 + this.row) * 0.7;

    ctx.globalAlpha = fade;
    ctx.save?.();

    // 바닥 그림자
    if (supportsEllipse) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1.5, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 어둠 속에서도 트랩이 빛나 보이도록 색색의 발광 링
    if (options.dark) {
      ctx.globalAlpha = fade * 0.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (supportsEllipse) {
        ctx.ellipse(cx, cy, rx + 5, ry + 5, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, Math.min(rx, ry) + 4, 0, Math.PI * 2);
      }
      ctx.fill();

      ctx.globalAlpha = fade * 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (supportsEllipse) {
        ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, Math.min(rx, ry) + 5, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.globalAlpha = fade;
    }

    // 바깥 후광 (shadowBlur 대신 저비용 반투명 타원)
    if (supportsEllipse) {
      ctx.globalAlpha = fade * 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 2.4, ry + 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade;
    }

    // 웅덩이 본체 (가장자리를 살짝 밝게 해 글로우 느낌)
    ctx.fillStyle = color;
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx, cy, Math.min(rx, ry), 0, Math.PI * 2);
    }
    ctx.fill();

    // 광택 하이라이트
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx - rx * 0.28, cy - ry * 0.32, rx * 0.32, ry * 0.28, -0.2, 0, Math.PI * 2);
    } else {
      ctx.arc(cx - rx * 0.28, cy - ry * 0.32, Math.min(rx, ry) * 0.28, 0, Math.PI * 2);
    }
    ctx.fill();

    // 보글보글 거품
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < 3; i++) {
      const angle = timeMs / 700 + (Math.PI * 2 / 3) * i;
      const bx = cx + Math.cos(angle) * rx * 0.55;
      const by = cy + Math.sin(angle) * ry * 0.55;
      ctx.beginPath();
      ctx.arc(bx, by, 0.9 + Math.abs(Math.sin(angle)) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 테두리 링
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx, cy, rx - 0.8, ry - 0.8, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx, cy, Math.min(rx, ry) - 0.8, 0, Math.PI * 2);
    }
    ctx.stroke();

    ctx.restore?.();
    ctx.globalAlpha = 1;
  }
}