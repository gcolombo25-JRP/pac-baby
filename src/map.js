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
 * - 평소: 진한 원목 프레임 + 순백 베개 + 채도 높은 하늘색 이불 (고대비)
 * - 스텔스: 신비로운 푸른 네온 (프레임/이불 모두 채도를 살려 형태가 뭉개지지 않게)
 * - outline: 프레임·베개·이불 경계마다 넣는 얇고 진한 구분선
 */
const CRIB_WARM = {
  frame: '#7a4928',
  frameLight: '#c98a52',
  frameDark: '#4a2a14',
  outline: '#2b170a',
  sheet: '#e6d2ae',
  blanket: '#38bdf8',
  blanketFold: '#7dd3fc',
  blanketEdge: '#0369a1',
  pillow: '#ffffff',
  pillowEdge: '#2b170a',
  accent: '#f472b6',
  underlay: 'rgba(255, 190, 120, 0.14)',
  grain: 'rgba(43, 23, 10, 0.45)',
};

const CRIB_STEALTH = {
  frame: '#1f6f9e',
  frameLight: '#8ad4f7',
  frameDark: '#08344f',
  outline: '#04212f',
  sheet: '#d7efff',
  blanket: '#00b8f0',
  blanketFold: '#7ce0ff',
  blanketEdge: '#024a6b',
  pillow: '#ffffff',
  pillowEdge: '#04212f',
  accent: '#ffffff',
  underlay: 'rgba(41, 182, 246, 0.2)',
  grain: 'rgba(4, 33, 47, 0.5)',
};

/**
 * 벽 2.5D 블록 규격
 * - 윗면(Top face) = 벽 타일 자체. 바닥보다 살짝 밝은 짙은 슬레이트/인디고 블루로 채워
 *   "네온 테두리만 있는 구멍"이 아니라 "바닥 위로 솟아오른 블록"으로 보이게 한다.
 * - 앞벽(Front face) = 타일 아래로 돌출되는 면. 윗면보다 어둡고 좌우 끝단/하단이 또렷하다.
 * - 앞벽 높이는 타일 높이의 24%(≈5.5 논리 px) — DPR 1.5~2 화면에서는 8~11 물리 px 로
 *   블록 두께가 뚜렷이 보이면서도 아래 타일 중앙의 아이템/트랩을 크게 가리지 않는다.
 * - 그림자는 반투명 그라디언트라 바닥을 덮어도 아이템이 비쳐 보인다.
 */
const WALL_DEPTH = TILE_SIZE * 0.24;                                        // 정면 돌출면
const WALL_EDGE_LIGHT = Math.max(1, TILE_SIZE * 0.045);                     // 윗면↔앞벽 베벨 라인
const WALL_SHADOW_DEPTH = TILE_SIZE * 0.16;                                 // 바닥 드롭 섀도우
const WALL_TOP_LIGHT_DEPTH = TILE_SIZE * 0.5;                               // 윗면 하이라이트

// 벽 윗면(바닥보다 밝은 인디고) / 앞벽(윗면보다 어둡고 바닥과 구분되는 중간 톤) / 구분선 색
const WALL_TOP_FACE = '#2a3f68';
const WALL_FRONT_TOP = '#233757';
const WALL_FRONT_MID = '#1e2f4d';
const WALL_FRONT_BOTTOM = '#182642';
const WALL_FRONT_SEAM = 'rgba(6, 10, 20, 0.85)';
const WALL_FRONT_BEVEL = 'rgba(188, 222, 255, 0.5)';

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
    // 벽 윗면(Top face)은 바닥보다 살짝 밝은 짙은 인디고 블루.
    // → 어두운 구멍처럼 보이지 않고 바닥 위로 솟아오른 블록으로 읽힌다.
    const wallFill = WALL_TOP_FACE;
    const cribTiles = [];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const tile = this.map[row][col];
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        switch (tile) {
          case 1: // 벽 — 윗면은 한 번만 채우고, 입체 디테일은 뒤에서 일괄 처리한다
            ctx.fillStyle = wallFill;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            break;

          case 2: // 베이비 스폰 (침대) — 바닥만 먼저 깔고 가구는 벽 위에 덧그린다
            this._drawCribBase(ctx, x, y, CRIB_WARM);
            cribTiles.push({ x, y, cx: x + TILE_SIZE / 2 });
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

    // 침대 가구는 벽 앞벽/그림자보다 나중에 그린다.
    // → 위쪽 벽의 앞벽·드롭 섀도우가 침대 상단을 덮어 뭉개지 않는다.
    for (const crib of cribTiles) {
      this._drawCribFurniture(ctx, crib.x, crib.y, crib.cx, CRIB_WARM);
    }
  }

  /**
   * 벽 타일을 2.5D 블록처럼 보이게 하는 돌출 레이어.
   *
   * ① 밝은 윗면(Top face) — 위에서 빛을 받는 면
   * ② 아래로 뻗는 중간 톤의 정면 앞벽(Extruded front face) + 좌우 끝단/하단 1px 구분선
   * ③ 앞벽 바로 아래 바닥의 드롭 섀도우(Drop shadow)
   *
   * - 타일을 모두 그린 뒤 한 번에 그린다 (벽끼리 겹쳐 그리지 않음).
   * - 아래 타일 위로 앞벽/그림자가 걸치므로, 침대 가구는 이 레이어 다음에 그린다.
   * - 행(row)마다 면(面)을 묶어 fill 하므로 타일 수와 무관하게 채움 호출은 행당 최대 5회다.
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawWallExtrusion(ctx) {
    const isWall = (row, col) => this._isWallTile(row, col);

    for (let row = 0; row < ROWS; row++) {
      const lit = [];      // 위가 뚫린 벽 (윗면이 빛을 받는다)
      const exposed = [];  // 아래가 뚫린 벽 (앞벽이 보인다)

      for (let col = 0; col < COLS; col++) {
        if (this.map[row][col] !== 1) continue;
        if (!isWall(row - 1, col)) lit.push(col);
        if (!isWall(row + 1, col)) exposed.push(col);
      }

      const y = row * TILE_SIZE;

      // ① 윗면(Top face) — 위 모서리에서 아래로 갈수록 옅어지는 빛 (빛은 위에서 내려온다)
      if (lit.length > 0) {
        const topSheen = safeLinearGradient(ctx, 0, y, 0, y + WALL_TOP_LIGHT_DEPTH, [
          [0, 'rgba(198, 229, 255, 0.26)'],
          [0.35, 'rgba(126, 180, 255, 0.10)'],
          [1, 'rgba(126, 180, 255, 0)'],
        ]) || 'rgba(160, 208, 255, 0.12)';

        fillRects(
          ctx,
          topSheen,
          lit.map(col => [col * TILE_SIZE, y, TILE_SIZE, WALL_TOP_LIGHT_DEPTH]),
        );
      }

      if (exposed.length === 0) continue;

      const baseY = y + TILE_SIZE;        // 윗면과 앞벽의 경계
      const bottomY = baseY + WALL_DEPTH; // 블록의 가장 아랫면

      // ② 정면 앞벽 — 윗면보다 어둡고, 아래로 갈수록 더 가라앉는 중간 톤
      const face = safeLinearGradient(ctx, 0, baseY, 0, bottomY, [
        [0, WALL_FRONT_TOP],
        [0.55, WALL_FRONT_MID],
        [1, WALL_FRONT_BOTTOM],
      ]) || WALL_FRONT_MID;

      fillRects(
        ctx,
        face,
        exposed.map(col => [col * TILE_SIZE, baseY, TILE_SIZE, WALL_DEPTH]),
      );

      // 윗면↔앞벽 경계의 얇고 선명한 베벨 라인 (블록이 꺾여 내려오는 모서리)
      fillRects(
        ctx,
        WALL_FRONT_BEVEL,
        exposed.map(col => [col * TILE_SIZE, baseY, TILE_SIZE, WALL_EDGE_LIGHT]),
      );

      // 연속된 앞벽 구간마다 좌·우 끝단 세로선 + 하단 가로선 (1px)
      // → 블록의 두께와 실루엣이 작은 화면에서도 또렷해진다.
      const seamRects = [];
      let runStart = exposed[0];
      for (let i = 0; i < exposed.length; i++) {
        const isRunEnd = i === exposed.length - 1 || exposed[i + 1] !== exposed[i] + 1;
        if (!isRunEnd) continue;

        const runX = runStart * TILE_SIZE;
        const runW = (exposed[i] + 1) * TILE_SIZE - runX;

        seamRects.push([runX, baseY, 1, WALL_DEPTH]);
        seamRects.push([runX + runW - 1, baseY, 1, WALL_DEPTH]);
        seamRects.push([runX, bottomY - 1, runW, 1]);

        runStart = exposed[i + 1];
      }
      fillRects(ctx, WALL_FRONT_SEAM, seamRects);

      // ③ 바닥 드롭 섀도우 — 앞벽 밑면 바로 아래로 짧게 떨어진다
      //    (아이템은 게임 루프에서 그 위에 그려지므로 가려지지 않는다)
      const shadow = safeLinearGradient(ctx, 0, bottomY, 0, bottomY + WALL_SHADOW_DEPTH, [
        [0, 'rgba(0, 0, 0, 0.46)'],
        [0.5, 'rgba(0, 0, 0, 0.18)'],
        [1, 'rgba(0, 0, 0, 0)'],
      ]) || 'rgba(0, 0, 0, 0.22)';

      fillRects(
        ctx,
        shadow,
        exposed.map(col => [col * TILE_SIZE, bottomY, TILE_SIZE, WALL_SHADOW_DEPTH]),
      );
    }
  }

  /** 벽 타일 여부 (범위 밖은 벽으로 취급하지 않는다) */
  _isWallTile(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS && this.map[row][col] === 1;
  }

  /**
   * 벽 테두리 중 지정한 방향의 모서리만 하나의 path 로 만든다.
   * - 빛은 위에서 내려오므로 'top'(가장 밝음) / 'left'(밝음) / 'right'(어두움)을
   *   각각 따로 그려 방향성 있는 림 라이트를 만든다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {'top'|'topLeft'|'right'} sides
   * @returns {boolean} 그린 선이 하나라도 있으면 true
   */
  _traceWallEdges(ctx, sides) {
    const isWall = (row, col) => this._isWallTile(row, col);
    const wantTop = sides === 'top' || sides === 'topLeft';
    const wantLeft = sides === 'left' || sides === 'topLeft';
    const wantRight = sides === 'right';

    let hasEdges = false;
    ctx.beginPath();

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (this.map[row][col] !== 1) continue;

        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        if (wantTop && !isWall(row - 1, col)) {
          ctx.moveTo(x, y + 0.6);
          ctx.lineTo(x + TILE_SIZE, y + 0.6);
          hasEdges = true;
        }
        if (wantLeft && !isWall(row, col - 1)) {
          ctx.moveTo(x + 0.6, y);
          ctx.lineTo(x + 0.6, y + TILE_SIZE);
          hasEdges = true;
        }
        if (wantRight && !isWall(row, col + 1)) {
          ctx.moveTo(x + TILE_SIZE - 0.6, y);
          ctx.lineTo(x + TILE_SIZE - 0.6, y + TILE_SIZE);
          hasEdges = true;
        }
      }
    }

    return hasEdges;
  }

  /**
   * 통로와 맞닿은 벽 테두리에 방향성 있는 네온 림 라이트를 그린다.
   * - 윗면 상단 + 좌측 모서리: 빛을 받는 면 → 가장 밝은 시안 네온
   * - 우측 모서리: 빛을 등지는 면 → 낮은 광량의 얇은 라인
   * - 아랫면(앞벽 밑면)은 여기서 빛내지 않는다 → _drawWallExtrusion 의 어두운 1px 선이 담당
   */
  _drawNeonWalls(ctx) {
    if (!this._traceWallEdges(ctx, 'topLeft')) return;

    // shadowBlur 는 CTM 의 영향을 받지 않으므로 DPR 만큼 키워 논리 크기를 유지한다
    const blurScale = this.pixelRatio > 0 ? this.pixelRatio : 1;

    ctx.save?.();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1) 윗면 상단 + 좌측 모서리에만 넓고 은은한 시안 글로우
    ctx.shadowColor = 'rgba(79, 195, 247, 0.95)';
    ctx.shadowBlur = Math.max(6, TILE_SIZE * 0.45) * blurScale;
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // 2) 면도칼처럼 선명한 네온 코어
    ctx.shadowBlur = Math.max(2, TILE_SIZE * 0.18) * blurScale;
    ctx.strokeStyle = 'rgba(206, 241, 255, 0.95)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // 3) 상단 모서리는 빛의 방향과 정면으로 만나므로 가장 밝게 한 번 더
    if (this._traceWallEdges(ctx, 'top')) {
      ctx.shadowColor = 'rgba(214, 246, 255, 0.95)';
      ctx.shadowBlur = Math.max(4, TILE_SIZE * 0.3) * blurScale;
      ctx.strokeStyle = 'rgba(250, 254, 255, 0.98)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 4) 우측 모서리는 빛을 등지므로 얇고 어둡게 (4면이 똑같이 빛나지 않게)
    if (this._traceWallEdges(ctx, 'right')) {
      ctx.shadowColor = 'rgba(28, 74, 122, 0.55)';
      ctx.shadowBlur = Math.max(1, TILE_SIZE * 0.08) * blurScale;
      ctx.strokeStyle = 'rgba(96, 156, 218, 0.62)';
      ctx.lineWidth = 0.9;
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

  /**
   * 스텔스 침대를 감싸는 푸른 네온 글로우 (숨쉬는 듯한 펄스)
   * - 침대 본체 위로 번지지 않도록, 타일 바깥 테두리(링)에만 클리핑해서 그린다.
   *   → 침대 위가 뿌옇게 덮이지 않고 실루엣이 선명하게 남는다.
   */
  _drawCribGlow(ctx, x, y, timeMs) {
    const pad = 1.5;
    const frameSize = TILE_SIZE - pad * 2;
    const radius = TILE_SIZE * 0.18;
    const pulse = 0.72 + 0.28 * Math.sin(timeMs / 420);

    ctx.save?.();

    // 타일 바깥 링만 남기는 클립 (침대 본체 영역은 제외)
    if (typeof ctx.clip === 'function' && typeof ctx.rect === 'function') {
      ctx.beginPath();
      ctx.rect(x - 2.5, y - 2.5, TILE_SIZE + 5, TILE_SIZE + 5);
      ctx.rect(x + pad, y + pad, frameSize, frameSize);
      ctx.clip('evenodd');
    }

    // 1) 바닥 테두리로 퍼지는 넓고 은은한 빛
    ctx.shadowColor = `rgba(79, 195, 247, ${(0.85 * pulse).toFixed(3)})`;
    ctx.shadowBlur = TILE_SIZE * 0.42 * pulse;
    ctx.strokeStyle = `rgba(79, 195, 247, ${(0.5 * pulse).toFixed(3)})`;
    ctx.lineWidth = 3;
    roundedRectPath(ctx, x + pad, y + pad, frameSize, frameSize, radius);
    ctx.stroke();

    // 2) 프레임 바로 바깥을 감싸는 선명한 시안 림
    ctx.shadowBlur = TILE_SIZE * 0.22 * pulse;
    ctx.strokeStyle = 'rgba(225, 245, 254, 0.9)';
    ctx.lineWidth = 1;
    roundedRectPath(ctx, x + pad - 1.2, y + pad - 1.2, frameSize + 2.4, frameSize + 2.4, radius + 1.2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore?.();
  }

  /**
   * 진한 원목 프레임 + 순백 베개 + 채도 높은 이불.
   * - 프레임/매트리스/이불/베개 경계마다 얇고 진한 구분선을 넣어
   *   작은 모바일 화면에서도 침대 실루엣이 뭉개지지 않는다.
   * - 발광(glow)은 _drawCribGlow 가 침대 바깥 테두리에만 담당한다.
   */
  _drawCribFurniture(ctx, x, y, cx, p) {
    const pad = 1.5;
    const frameSize = TILE_SIZE - pad * 2;
    const radius = TILE_SIZE * 0.18;
    const innerPad = pad + 1.9;
    const innerSize = TILE_SIZE - innerPad * 2;
    const innerRadius = radius * 0.58;

    // 1) 원목 프레임 — 어두운 1.3px 외곽선으로 실루엣을 칼같이 잡는다
    roundedRectPath(ctx, x + pad, y + pad, frameSize, frameSize, radius);
    ctx.fillStyle = p.frame;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // 프레임 상단의 빛 받는 나뭇결 (아주 얇게)
    ctx.strokeStyle = p.frameLight;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x + pad + radius * 0.85, y + pad + 1.1);
    ctx.lineTo(x + TILE_SIZE - pad - radius * 0.85, y + pad + 1.1);
    ctx.stroke();

    // 2) 매트리스/시트 — 프레임과 진한 선으로 분리
    roundedRectPath(ctx, x + innerPad, y + innerPad, innerSize, innerSize, innerRadius);
    ctx.fillStyle = p.sheet;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // 3) 이불 (아래쪽 절반) — 채도 높은 하늘색 + 진한 외곽선
    const blanketX = x + innerPad + 0.3;
    const blanketW = innerSize - 0.6;
    const blanketY = y + TILE_SIZE * 0.49;
    const blanketH = y + TILE_SIZE - innerPad - 0.3 - blanketY;
    const blanketRadius = innerRadius * 0.9;
    const foldH = Math.max(2.2, TILE_SIZE * 0.1);

    roundedRectPath(ctx, blanketX, blanketY, blanketW, blanketH, blanketRadius);
    ctx.fillStyle = p.blanket;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // 이불 접힌 윗단 (한 단계 밝은 톤 + 진한 구분선)
    roundedRectPath(ctx, blanketX, blanketY, blanketW, foldH, blanketRadius * 0.8);
    ctx.fillStyle = p.blanketFold;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 접힌 단 아래 그림자선 (이불 주름)
    ctx.strokeStyle = p.blanketEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(blanketX + 0.9, blanketY + foldH + 0.5);
    ctx.lineTo(blanketX + blanketW - 0.9, blanketY + foldH + 0.5);
    ctx.stroke();

    // 이불 패턴 (작은 점 3개)
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = p === CRIB_STEALTH ? 0.8 : 0.6;
    ctx.beginPath();
    ctx.arc(cx - 3, blanketY + blanketH * 0.66, 0.7, 0, Math.PI * 2);
    ctx.arc(cx + 0.2, blanketY + blanketH * 0.76, 0.7, 0, Math.PI * 2);
    ctx.arc(cx + 3.2, blanketY + blanketH * 0.66, 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 4) 미니 베개 — 순백 + 진한 외곽선으로 이불/시트와 확실히 분리
    const pillowCx = cx - 1.1;
    const pillowCy = y + TILE_SIZE * 0.32;
    const pillowRx = TILE_SIZE * 0.24;
    const pillowRy = TILE_SIZE * 0.135;

    ctx.fillStyle = p.pillow;
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(pillowCx, pillowCy, pillowRx, pillowRy, -0.12, 0, Math.PI * 2);
    } else {
      ctx.arc(pillowCx, pillowCy, pillowRx * 0.8, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = p.pillowEdge;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // 베개 밑단 음영 (둥근 볼륨)
    ctx.strokeStyle = p.pillowEdge;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(pillowCx - pillowRx * 0.62, pillowCy + pillowRy * 0.5);
    ctx.lineTo(pillowCx + pillowRx * 0.58, pillowCy + pillowRy * 0.32);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 5) 모서리 기둥 (침대 다리) — 밝은 원목 + 어두운 테두리
    ctx.fillStyle = p.frameLight;
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 0.6;
    const postInset = pad + 1.2;
    const posts = [
      [x + postInset, y + postInset],
      [x + TILE_SIZE - postInset, y + postInset],
      [x + postInset, y + TILE_SIZE - postInset],
      [x + TILE_SIZE - postInset, y + TILE_SIZE - postInset],
    ];
    for (const [px, py] of posts) {
      ctx.beginPath();
      ctx.arc(px, py, 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 나뭇결 (원목 느낌)
    ctx.strokeStyle = p.grain;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x + pad + 0.85, y + TILE_SIZE * 0.36);
    ctx.lineTo(x + pad + 0.85, y + TILE_SIZE * 0.5);
    ctx.moveTo(x + TILE_SIZE - pad - 0.85, y + TILE_SIZE * 0.5);
    ctx.lineTo(x + TILE_SIZE - pad - 0.85, y + TILE_SIZE * 0.64);
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