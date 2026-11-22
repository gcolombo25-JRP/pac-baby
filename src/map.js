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

/**
 * 침대(타일 2) 팔레트
 * - 평소: 따뜻한 원목 프레임 + 파스텔 침구
 * - 스텔스: 신비로운 푸른 네온
 */
const CRIB_WARM = {
  frame: '#b07a4f',
  frameLight: '#d9a877',
  frameDark: '#7a4e2e',
  sheet: '#f6e7c9',
  blanket: '#bfe3d0',
  blanketFold: '#d8f0e2',
  blanketEdge: '#9fcfb4',
  pillow: '#fffaf0',
  pillowEdge: '#ecd9bd',
  accent: '#f2a6b8',
  underlay: 'rgba(255, 205, 140, 0.12)',
  grain: 'rgba(90, 55, 30, 0.35)',
};

const CRIB_STEALTH = {
  frame: '#29b6f6',
  frameLight: '#81d4fa',
  frameDark: '#0277bd',
  sheet: '#e1f5fe',
  blanket: '#81d4fa',
  blanketFold: '#b3e5fc',
  blanketEdge: '#4fc3f7',
  pillow: '#f4fcff',
  pillowEdge: '#b3e5fc',
  accent: '#ffffff',
  underlay: 'rgba(41, 182, 246, 0.18)',
  grain: 'rgba(255, 255, 255, 0.35)',
};

/**
 * 벽 2.5D 돌출(Extrude) 규격
 * - 정면 돌출면 높이는 타일 높이의 18%(≈4.1px)로 제한한다.
 *   → 바로 아래 타일 중앙의 아이템/트랩을 가리지 않는다. (15~20% 이내 유지)
 *   → 고해상도(DPR 1.5~2) 화면에서는 6~8 물리 픽셀 두께로 보인다.
 * - 그림자는 반투명 그라디언트라 바닥을 덮어도 아이템이 비쳐 보인다.
 */
const WALL_DEPTH = TILE_SIZE * 0.18;                                        // 정면 돌출면
const WALL_EDGE_LIGHT = Math.max(0.8, TILE_SIZE * 0.04);                    // 돌출면 상단 칩 라인
const WALL_SHADOW_DEPTH = TILE_SIZE * 0.14;                                 // 바닥 드롭 섀도우
const WALL_TOP_LIGHT_DEPTH = TILE_SIZE * 0.46;                              // 윗면 하이라이트

/**
 * 같은 면(面)에 속한 사각형들을 path 로 모아 한 번의 fill 로 채운다.
 * - 타일 기본 채움(fillRect)과 섞이지 않아 렌더 계약이 그대로 유지된다.
 * - rect() 가 없는 최소 ctx 스텁에서도 moveTo/lineTo 로 같은 사각형을 만든다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|CanvasGradient} fillStyle
 * @param {Array<[number, number, number, number]>} rects [x, y, w, h]
 */
function fillRects(ctx, fillStyle, rects) {
  if (rects.length === 0) return;

  const useRect = typeof ctx.rect === 'function';

  ctx.fillStyle = fillStyle;
  ctx.beginPath();

  for (const [x, y, w, h] of rects) {
    if (useRect) {
      ctx.rect(x, y, w, h);
      continue;
    }

    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  ctx.fill();
}

/**
 * 둥근 모서리 사각형 경로 (roundRect 미지원 컨텍스트에서도 동작)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x + radius, y + h);
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + radius);
  ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
  ctx.closePath();
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
   * @param {number} [timeMs] 애니메이션 시간(ms) — 스텔스 침대 연출용
   */
  render(ctx, timeMs = 0) {
    if (this._ensureCache()) {
      // 캐시는 devicePixelRatio 만큼 큰 해상도 → 논리 좌표(640x640)로 축소해 그린다
      ctx.drawImage(this._cache, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      this._drawTiles(ctx);
    }

    // 스텔스로 사용 중인 침대는 파란색으로 덧그린다
    if (this.highlightBed) {
      this._drawBedTile(ctx, this.highlightBed.row, this.highlightBed.col, {
        stealth: true,
        timeMs,
      });
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
            this._drawBedTile(ctx, row, col);
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

    // 벽을 2.5D 블록처럼 돌출시킨 뒤, 테두리를 따라 푸른 네온 글로우
    this._drawWallExtrusion(ctx);
    this._drawNeonWalls(ctx);
  }

  /**
   * 벽 타일을 2.5D 블록처럼 보이게 하는 돌출 레이어.
   *
   * ① 밝은 윗면(Top face) — 위에서 빛을 받는 면
   * ② 아래로 뻗는 어두운 정면 돌출면(Extruded front face)
   * ③ 돌출면 바로 아래 바닥의 은은한 드롭 섀도우(Drop shadow)
   *
   * - 타일을 모두 그린 뒤 한 번에 그려서 다른 타일(아이템 패드/침대)을 덮지 않는다.
   * - 행(row)마다 면(面)을 묶어 fill 하므로 타일 수와 무관하게 fill 호출은 행당 최대 4회다.
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawWallExtrusion(ctx) {
    const isWall = (row, col) => this._isWallTile(row, col);

    for (let row = 0; row < ROWS; row++) {
      const lit = [];      // 위가 뚫린 벽 (윗면이 빛을 받는다)
      const exposed = [];  // 아래가 뚫린 벽 (정면이 보인다)

      for (let col = 0; col < COLS; col++) {
        if (this.map[row][col] !== 1) continue;
        if (!isWall(row - 1, col)) lit.push(col);
        if (!isWall(row + 1, col)) exposed.push(col);
      }

      const y = row * TILE_SIZE;

      // ① 윗면(Top face) — 위 모서리에서 아래로 갈수록 옅어지는 빛
      if (lit.length > 0) {
        const topFace = safeLinearGradient(ctx, 0, y, 0, y + WALL_TOP_LIGHT_DEPTH, [
          [0, 'rgba(176, 218, 255, 0.22)'],
          [0.45, 'rgba(122, 180, 255, 0.08)'],
          [1, 'rgba(122, 180, 255, 0)'],
        ]) || 'rgba(150, 205, 255, 0.10)';

        fillRects(
          ctx,
          topFace,
          lit.map(col => [col * TILE_SIZE, y, TILE_SIZE, WALL_TOP_LIGHT_DEPTH]),
        );
      }

      if (exposed.length === 0) continue;

      const baseY = y + TILE_SIZE; // 벽 타일의 아래 모서리 = 윗면과 정면의 경계

      // ② 정면 돌출면(Extruded front face) — 위는 살짝 밝고 아래로 갈수록 어둡다
      const face = safeLinearGradient(ctx, 0, baseY, 0, baseY + WALL_DEPTH, [
        [0, '#243052'],
        [0.42, '#131b31'],
        [1, '#060912'],
      ]) || '#101830';

      fillRects(
        ctx,
        face,
        exposed.map(col => [col * TILE_SIZE, baseY, TILE_SIZE, WALL_DEPTH]),
      );

      // 돌출면 상단 칩(chisel) 라인 — 빛을 받는 모서리를 살짝 밝게
      fillRects(
        ctx,
        'rgba(158, 205, 255, 0.24)',
        exposed.map(col => [col * TILE_SIZE, baseY, TILE_SIZE, WALL_EDGE_LIGHT]),
      );

      // ③ 바닥 드롭 섀도우 — 돌출면 바로 아래에 짧게 떨어진다 (아이템은 그 위에 그려진다)
      const shadowY = baseY + WALL_DEPTH;
      const shadow = safeLinearGradient(ctx, 0, shadowY, 0, shadowY + WALL_SHADOW_DEPTH, [
        [0, 'rgba(0, 0, 0, 0.42)'],
        [0.55, 'rgba(0, 0, 0, 0.16)'],
        [1, 'rgba(0, 0, 0, 0)'],
      ]) || 'rgba(0, 0, 0, 0.20)';

      fillRects(
        ctx,
        shadow,
        exposed.map(col => [col * TILE_SIZE, shadowY, TILE_SIZE, WALL_SHADOW_DEPTH]),
      );
    }
  }

  /** 벽 타일 여부 (범위 밖은 벽으로 취급하지 않는다) */
  _isWallTile(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS && this.map[row][col] === 1;
  }

  /**
   * 통로와 맞닿은 벽 테두리에만 네온 라인을 그린다.
   * - 바깥 외곽선(화면 끝)은 제외해 액자처럼 보이지 않게 한다.
   * - path 를 한 번만 stroke 해서 shadowBlur 비용을 최소화한다.
   * - 마지막에 위쪽 모서리만 한 번 더 밝게 덧그려 2.5D 윗면의 림 라이트를 만든다.
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

    // 3) 상단 모서리 림 라이트 — 윗면과 정면이 만나는 위쪽 모서리만 더 밝게
    let hasRim = false;
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (this.map[row][col] !== 1 || isWall(row - 1, col)) continue;

        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        ctx.moveTo(x, y + 0.8);
        ctx.lineTo(x + TILE_SIZE, y + 0.8);
        hasRim = true;
      }
    }

    if (hasRim) {
      ctx.shadowColor = 'rgba(198, 240, 255, 0.95)';
      ctx.shadowBlur = Math.max(3, TILE_SIZE * 0.22) * blurScale;
      ctx.strokeStyle = 'rgba(244, 253, 255, 0.96)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

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

  /** 침대 타일 1개 — 둥근 원목 프레임 + 미니 베개 + 파스텔 이불 */
  _drawBedTile(ctx, row, col, options = {}) {
    const stealth = options.stealth === true;
    const timeMs = Number.isFinite(options.timeMs) ? options.timeMs : 0;
    const palette = stealth ? CRIB_STEALTH : CRIB_WARM;
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;

    this._drawCribBase(ctx, x, y, palette);
    if (stealth) this._drawCribGlow(ctx, x, y, timeMs);
    this._drawCribFurniture(ctx, x, y, cx, palette);
    if (stealth) this._drawCribParticles(ctx, cx, cy, timeMs);
  }

  /** 침대 바닥 + 은은한 빛 번짐 (fillRect 2회 — 기존 렌더 계약 유지) */
  _drawCribBase(ctx, x, y, palette) {
    ctx.fillStyle = COLORS.FLOOR;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    ctx.fillStyle = palette.underlay;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  }

  /** 스텔스 침대를 감싸는 푸른 네온 글로우 (숨쉬는 듯한 펄스) */
  _drawCribGlow(ctx, x, y, timeMs) {
    const pad = 1.7;
    const frameSize = TILE_SIZE - pad * 2;
    const radius = TILE_SIZE * 0.19;
    const pulse = 0.72 + 0.28 * Math.sin(timeMs / 420);

    ctx.save?.();
    ctx.shadowColor = `rgba(79, 195, 247, ${(0.9 * pulse).toFixed(3)})`;
    ctx.shadowBlur = TILE_SIZE * 0.6 * pulse;
    ctx.strokeStyle = `rgba(79, 195, 247, ${(0.55 * pulse).toFixed(3)})`;
    ctx.lineWidth = 2.6;
    roundedRectPath(ctx, x + pad - 1, y + pad - 1, frameSize + 2, frameSize + 2, radius + 1);
    ctx.stroke();

    ctx.shadowBlur = TILE_SIZE * 0.28;
    ctx.strokeStyle = 'rgba(225, 245, 254, 0.85)';
    ctx.lineWidth = 1;
    roundedRectPath(ctx, x + pad + 0.6, y + pad + 0.6, frameSize - 1.2, frameSize - 1.2, radius - 0.6);
    ctx.stroke();
    ctx.restore?.();
  }

  /** 둥근 원목 프레임 + 시트 + 이불 + 미니 베개 + 기둥/나뭇결 */
  _drawCribFurniture(ctx, x, y, cx, p) {
    const pad = 1.7;
    const frameSize = TILE_SIZE - pad * 2;
    const radius = TILE_SIZE * 0.19;
    const innerPad = pad + 1.9;

    // 원목 프레임
    roundedRectPath(ctx, x + pad, y + pad, frameSize, frameSize, radius);
    ctx.fillStyle = p.frame;
    ctx.fill();
    ctx.strokeStyle = p.frameDark;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 매트리스/시트
    roundedRectPath(
      ctx, x + innerPad, y + innerPad,
      TILE_SIZE - innerPad * 2, TILE_SIZE - innerPad * 2,
      radius * 0.62,
    );
    ctx.fillStyle = p.sheet;
    ctx.fill();

    // 이불 (아래쪽 절반)
    const blanketX = x + innerPad + 0.4;
    const blanketY = y + TILE_SIZE * 0.47;
    const blanketW = TILE_SIZE - (innerPad + 0.4) * 2;
    const blanketH = y + TILE_SIZE - innerPad - 0.4 - blanketY;
    roundedRectPath(ctx, blanketX, blanketY, blanketW, blanketH, radius * 0.55);
    ctx.fillStyle = p.blanket;
    ctx.fill();
    ctx.strokeStyle = p.blanketEdge;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 이불 접힌 윗단
    roundedRectPath(ctx, blanketX, blanketY, blanketW, 2.4, 1.2);
    ctx.fillStyle = p.blanketFold;
    ctx.fill();
    ctx.strokeStyle = p.blanketEdge;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(blanketX + 1, blanketY + 2.5);
    ctx.lineTo(blanketX + blanketW - 1, blanketY + 2.5);
    ctx.stroke();

    // 이불 패턴 (작은 점 3개)
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = p === CRIB_STEALTH ? 0.75 : 0.45;
    ctx.beginPath();
    ctx.arc(cx - 3, blanketY + blanketH * 0.62, 0.65, 0, Math.PI * 2);
    ctx.arc(cx + 0.2, blanketY + blanketH * 0.72, 0.65, 0, Math.PI * 2);
    ctx.arc(cx + 3.2, blanketY + blanketH * 0.62, 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 미니 베개
    const pillowCx = cx - 1.3;
    const pillowCy = y + TILE_SIZE * 0.33;
    const pillowRx = TILE_SIZE * 0.21;
    const pillowRy = TILE_SIZE * 0.125;
    ctx.fillStyle = p.pillow;
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(pillowCx, pillowCy, pillowRx, pillowRy, -0.18, 0, Math.PI * 2);
    } else {
      ctx.arc(pillowCx, pillowCy, pillowRx * 0.8, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = p.pillowEdge;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // 베개 광택
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(pillowCx - pillowRx * 0.55, pillowCy - 0.7);
    ctx.lineTo(pillowCx + pillowRx * 0.2, pillowCy - 1.3);
    ctx.stroke();

    // 모서리 기둥 (침대 다리)
    ctx.fillStyle = p.frameLight;
    ctx.strokeStyle = p.frameDark;
    ctx.lineWidth = 0.5;
    const postInset = pad + 1.15;
    const posts = [
      [x + postInset, y + postInset],
      [x + TILE_SIZE - postInset, y + postInset],
      [x + postInset, y + TILE_SIZE - postInset],
      [x + TILE_SIZE - postInset, y + TILE_SIZE - postInset],
    ];
    for (const [px, py] of posts) {
      ctx.beginPath();
      ctx.arc(px, py, 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 나뭇결 (원목 느낌)
    ctx.strokeStyle = p.grain;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x + pad + 0.9, y + TILE_SIZE * 0.36);
    ctx.lineTo(x + pad + 0.9, y + TILE_SIZE * 0.5);
    ctx.moveTo(x + TILE_SIZE - pad - 0.9, y + TILE_SIZE * 0.5);
    ctx.lineTo(x + TILE_SIZE - pad - 0.9, y + TILE_SIZE * 0.64);
    ctx.stroke();

    // 작은 반짝이 포인트
    const sparkleX = cx + 4.2;
    const sparkleY = blanketY + blanketH * 0.38;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(sparkleX - 1.3, sparkleY);
    ctx.lineTo(sparkleX + 1.3, sparkleY);
    ctx.moveTo(sparkleX, sparkleY - 1.3);
    ctx.lineTo(sparkleX, sparkleY + 1.3);
    ctx.stroke();
  }

  /** 스텔스 침대 위로 피어오르는 푸른 별가루 */
  _drawCribParticles(ctx, cx, cy, timeMs) {
    ctx.save?.();
    for (let i = 0; i < 6; i++) {
      const phase = ((timeMs / 1400) + i * 0.19) % 1;
      const alpha = Math.sin(phase * Math.PI) * 0.85;
      if (alpha <= 0.02) continue;

      const sx = cx + Math.sin(timeMs / 650 + i * 1.9) * TILE_SIZE * 0.16 + (i - 2.5) * 1.3;
      const sy = cy + TILE_SIZE * 0.16 - phase * TILE_SIZE * 0.92;
      const size = 0.9 + (1 - phase) * 1.2;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#e1f5fe';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(sx - size, sy);
      ctx.lineTo(sx + size, sy);
      ctx.moveTo(sx, sy - size);
      ctx.lineTo(sx, sy + size);
      ctx.stroke();

      ctx.fillStyle = '#b3e5fc';
      ctx.beginPath();
      ctx.arc(sx, sy, 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore?.();
  }

}