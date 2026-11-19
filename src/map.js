/**
 * Pac-Baby: 맵 데이터 및 렌더링 모듈
 */

import {
  COLS, ROWS, TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT,
  COLORS, TILE_MAP, isWalkableTile,
  getBabySpawn, getEnemySpawns, getItemSpawns,
} from './constants.js';

/**
 * 선형 그라디언트를 안전하게 만든다.
 * - 테스트용 최소 ctx 스텁(createLinearGradient 없음)에서는 null 을 돌려주고
 *   호출부가 단색으로 폴백한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {Array<[number, string]>} stops
 * @returns {CanvasGradient|null}
 */
function safeLinearGradient(ctx, x0, y0, x1, y1, stops) {
  if (typeof ctx.createLinearGradient !== 'function') return null;

  let gradient = null;
  try {
    gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  } catch (err) {
    return null;
  }
  if (!gradient || typeof gradient.addColorStop !== 'function') return null;

  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

export default class MapRenderer {
  constructor() {
    this.map = TILE_MAP;
    this.babySpawn = getBabySpawn(this.map);
    this.enemySpawns = getEnemySpawns(this.map);
    this.itemSpawns = getItemSpawns(this.map);
    this.highlightBed = null; // 스텔스로 사용 중인 침대 { row, col }
    this._cache = null;       // 정적 맵 오프스크린 캔버스
    this.pixelRatio = 1;      // 캐시 해상도 배율 (레티나 선명화)
  }

  /**
   * 레티나 배율 지정 (값이 바뀌면 캐시를 다시 만든다)
   * @param {number} ratio
   * @returns {number} 적용된 배율
   */
  setPixelRatio(ratio = 1) {
    const next = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    if (Math.abs(next - this.pixelRatio) < 0.001) return this.pixelRatio;

    this.pixelRatio = next;
    this.invalidate();
    return this.pixelRatio;
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
      // 캐시는 devicePixelRatio 만큼 큰 해상도 → 논리 좌표(640x640)로 축소해 그린다
      ctx.drawImage(this._cache, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
      canvas.width = Math.round(CANVAS_WIDTH * this.pixelRatio);
      canvas.height = Math.round(CANVAS_HEIGHT * this.pixelRatio);
      const ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx) return null;

      // 고해상도 캐시에서도 논리 좌표(640x640)로 그릴 수 있게 변환한다
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      }
      if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;

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
    // 벽은 위에서 아래로 살짝 어두워지는 그라디언트 (캐시 생성 시 1회만 만든다)
    const wallFill = safeLinearGradient(ctx, 0, 0, 0, CANVAS_HEIGHT, [
      [0, COLORS.WALL_TOP],
      [0.55, COLORS.WALL],
      [1, '#141a2e'],
    ]) || COLORS.WALL;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const tile = this.map[row][col];
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        switch (tile) {
          case 1: // 벽 — 네온 테두리는 타일을 모두 그린 뒤 한 번에 그린다
            ctx.fillStyle = wallFill;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

            // 벽 덩어리의 바깥 모서리에만 하이라이트/그림자 (내부 줄무늬 방지)
            if (!this._isWallTile(row - 1, col)) {
              ctx.strokeStyle = 'rgba(140, 190, 255, 0.14)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x + 0.5, y + 1);
              ctx.lineTo(x + TILE_SIZE - 0.5, y + 1);
              ctx.stroke();
            }

            if (!this._isWallTile(row + 1, col)) {
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x + 0.5, y + TILE_SIZE - 0.5);
              ctx.lineTo(x + TILE_SIZE - 0.5, y + TILE_SIZE - 0.5);
              ctx.stroke();
            }
            break;

          case 2: // 베이비 스폰 (침대) — 하이라이트는 render()에서 덧그린다
            this._drawBedTile(ctx, row, col, COLORS.SPAWN_BED);
            break;

          case 3: // 악당 스폰 (보모 대기실)
            this._drawSpawnPad(ctx, x, y, COLORS.ENEMY_SPAWN);
            break;

          case 4: // 아이템 스폰 위치
            this._drawItemPad(ctx, x, y);
            break;

          default: // 0 — 빈 바닥 (은은한 체크 패턴 + 별가루)
            ctx.fillStyle = (row + col) % 2 === 0 ? COLORS.FLOOR : COLORS.FLOOR_ALT;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            this._drawFloorMote(ctx, row, col, x, y);
            break;
        }
      }
    }

    // 벽 테두리를 따라 푸른 네온 글로우 (한 번의 path + stroke)
    this._drawNeonWalls(ctx);
  }

  /** 벽 타일 여부 (범위 밖은 벽으로 취급하지 않는다) */
  _isWallTile(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS && this.map[row][col] === 1;
  }

  /**
   * 통로와 맞닿은 벽 테두리에만 네온 라인을 그린다.
   * - 바깥 외곽선(화면 끝)은 제외해 액자처럼 보이지 않게 한다.
   * - path 를 한 번만 stroke 해서 shadowBlur 비용을 최소화한다.
   */
  _drawNeonWalls(ctx) {
    const isWall = (row, col) => this._isWallTile(row, col);

    let hasEdges = false;
    ctx.beginPath();

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (this.map[row][col] !== 1) continue;

        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        if (!isWall(row - 1, col)) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + TILE_SIZE, y);
          hasEdges = true;
        }
        if (!isWall(row + 1, col)) {
          ctx.moveTo(x, y + TILE_SIZE);
          ctx.lineTo(x + TILE_SIZE, y + TILE_SIZE);
          hasEdges = true;
        }
        if (!isWall(row, col - 1)) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + TILE_SIZE);
          hasEdges = true;
        }
        if (!isWall(row, col + 1)) {
          ctx.moveTo(x + TILE_SIZE, y);
          ctx.lineTo(x + TILE_SIZE, y + TILE_SIZE);
          hasEdges = true;
        }
      }
    }

    if (!hasEdges) return;

    // shadowBlur 는 CTM 의 영향을 받지 않으므로 DPR 만큼 키워 논리 크기를 유지한다
    const blurScale = this.pixelRatio > 0 ? this.pixelRatio : 1;

    ctx.save?.();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1) 넓고 은은한 글로우
    ctx.shadowColor = 'rgba(79, 195, 247, 0.95)';
    ctx.shadowBlur = Math.max(6, TILE_SIZE * 0.42) * blurScale;
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.45)';
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // 2) 면도칼처럼 선명한 네온 코어
    ctx.shadowBlur = Math.max(2, TILE_SIZE * 0.16) * blurScale;
    ctx.strokeStyle = 'rgba(201, 239, 255, 0.92)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore?.();
  }

  /** 아이템 스폰 타일 (바닥 + 은은한 금빛 패드) */
  _drawItemPad(ctx, x, y) {
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;

    ctx.fillStyle = COLORS.ITEM_SPOT;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    ctx.fillStyle = 'rgba(245, 200, 66, 0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f5c842';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 악당 스폰 타일 (보모 대기실 — 보랏빛 룬) */
  _drawSpawnPad(ctx, x, y, color) {
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;

    ctx.fillStyle = COLORS.FLOOR;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    ctx.save?.();
    ctx.shadowColor = color;
    ctx.shadowBlur = TILE_SIZE * 0.4;
    ctx.fillStyle = 'rgba(83, 52, 131, 0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = 'rgba(220, 190, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 3 - 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore?.();
  }

  /** 바닥의 아주 옅은 별가루 (정적 캐시에만 들어가므로 비용 없음) */
  _drawFloorMote(ctx, row, col, x, y) {
    if ((row * 7 + col * 13) % 11 !== 0) return;

    ctx.fillStyle = 'rgba(120, 190, 255, 0.10)';
    ctx.beginPath();
    ctx.arc(x + TILE_SIZE * 0.65, y + TILE_SIZE * 0.35, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 침대 타일 1개 (바닥 + 매트리스 + 베개) */
  _drawBedTile(ctx, row, col, color) {
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;
    const pad = 2.5;
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;

    // 1) 바닥
    ctx.fillStyle = COLORS.FLOOR;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    // 2) 매트리스 (네온 글로우)
    ctx.save?.();
    ctx.shadowColor = color;
    ctx.shadowBlur = TILE_SIZE * 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, TILE_SIZE - pad * 2, TILE_SIZE - pad * 2);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // 시트 하이라이트
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(cx, cy + 1, TILE_SIZE * 0.30, TILE_SIZE * 0.20, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx, cy + 1, TILE_SIZE * 0.24, 0, Math.PI * 2);
    }
    ctx.fill();

    // 베개
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(
        x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.3,
        TILE_SIZE * 0.16, TILE_SIZE * 0.11,
        -0.3, 0, Math.PI * 2,
      );
    } else {
      ctx.arc(x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.3, TILE_SIZE * 0.13, 0, Math.PI * 2);
    }
    ctx.fill();

    // 담요 주름 (십자 무늬)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + pad, y + TILE_SIZE * 0.72);
    ctx.lineTo(x + TILE_SIZE - pad, y + TILE_SIZE * 0.72);
    ctx.moveTo(x + TILE_SIZE * 0.5, y + pad);
    ctx.lineTo(x + TILE_SIZE * 0.5, y + TILE_SIZE - pad);
    ctx.stroke();

    ctx.restore?.();
  }

}