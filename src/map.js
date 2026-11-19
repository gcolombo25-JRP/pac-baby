/**
 * Pac-Baby: 맵 데이터 및 렌더링 모듈
 */

import {
  COLS, ROWS, TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT,
  COLORS, TILE_MAP, isWalkableTile,
  getBabySpawn, getEnemySpawns, getItemSpawns,
} from './constants.js';

export default class MapRenderer {
  constructor() {
    this.map = TILE_MAP;
    this.babySpawn = getBabySpawn(this.map);
    this.enemySpawns = getEnemySpawns(this.map);
    this.itemSpawns = getItemSpawns(this.map);
    this.highlightBed = null; // 스텔스로 사용 중인 침대 { row, col }
    this._cache = null;       // 정적 맵 오프스크린 캔버스
  }

  /**
   * 주어진 타일 좌표가 이동 가능한지 검사
   * @param {number} row
   * @param {number} col
   * @returns {boolean}
   */
  isWalkable(row, col) {
    // constants 의 공용 판정과 동일 규칙 (벽(1)만 이동 불가)
    return isWalkableTile(this.map, row, col);
  }

  /**
   * 타일맵을 캔버스에 렌더링
   * - 브라우저: 정적 맵을 오프스크린 캔버스에 1회만 그려 두고 매 프레임 blit
   * - DOM 없음(테스트): 매번 직접 그린다
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this._ensureCache()) {
      ctx.drawImage(this._cache, 0, 0);
    } else {
      this._drawTiles(ctx);
    }

    // 스텔스로 사용 중인 침대는 파란색으로 덧그린다
    if (this.highlightBed) {
      this._drawBedTile(ctx, this.highlightBed.row, this.highlightBed.col, COLORS.STEALTH_BED);
    }
  }

  /** 정적 맵 캐시 생성 (브라우저 전용, 실패하면 null) */
  _ensureCache() {
    if (this._cache) return this._cache;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx) return null;

      this._drawTiles(ctx);
      this._cache = canvas;
    } catch (err) {
      this._cache = null;
    }
    return this._cache;
  }

  /** 맵이 바뀌었을 때 캐시를 버린다 */
  invalidate() {
    this._cache = null;
  }

  /** 타일 전체를 그린다 (캐시 생성과 폴백에서 공용) */
  _drawTiles(ctx) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const tile = this.map[row][col];
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        switch (tile) {
          case 1: // 벽
            ctx.fillStyle = COLORS.WALL;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            // 벽 테두리 효과
            ctx.strokeStyle = '#2a2a4e';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
            break;

          case 2: // 베이비 스폰 (침대) — 하이라이트는 render()에서 덧그린다
            this._drawBedTile(ctx, row, col, COLORS.SPAWN_BED);
            break;

          case 3: // 악당 스폰
            ctx.fillStyle = COLORS.FLOOR;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = COLORS.ENEMY_SPAWN;
            ctx.beginPath();
            ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
            ctx.fill();
            break;

          case 4: // 아이템 스폰 위치
            ctx.fillStyle = COLORS.ITEM_SPOT;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            // 작은 점 표시 (미식별 아이템)
            ctx.fillStyle = '#f5c842';
            ctx.beginPath();
            ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 2, 0, Math.PI * 2);
            ctx.fill();
            break;

          default: // 0 — 빈 바닥
            ctx.fillStyle = COLORS.FLOOR;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            break;
        }
      }
    }
  }

  /** 침대 타일 1개 (바닥 + 사각형 + 십자 무늬) */
  _drawBedTile(ctx, row, col, color) {
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;

    ctx.fillStyle = COLORS.FLOOR;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    ctx.fillStyle = color;
    ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + TILE_SIZE / 2);
    ctx.lineTo(x + TILE_SIZE, y + TILE_SIZE / 2);
    ctx.moveTo(x + TILE_SIZE / 2, y);
    ctx.lineTo(x + TILE_SIZE / 2, y + TILE_SIZE);
    ctx.stroke();
  }

}