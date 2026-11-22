/**
 * Pac-Baby: 맵 데이터 및 렌더링 모듈
 */

import {
  COLS, ROWS, TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT,
  COLORS, TILE_MAP, WALL_PALETTES, isWalkableTile,
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
 * - 윗면(Top face) = 벽 타일 자체. 파스텔 팔레트로 채워 "바닥 위로 솟아오른 장난감 블록"으로 보이게 한다.
 * - 앞벽(Front face) = 타일 아래로 돌출되는 면. 윗면보다 한 톤 진하고 좌우 모서리에 음영이 진다.
 * - 앞벽 높이는 약 6.4 논리 px — DPR 1.5~2 화면에서 약 9~13 물리 px 로 두께가 뚜렷하면서도
 *   아래 타일 중앙의 아이템/트랩을 크게 가리지 않는다.
 * - 그림자는 반투명 그라디언트라 바닥을 덮어도 아이템이 비쳐 보인다.
 */
const WALL_DEPTH = TILE_SIZE * 0.28;                                        // 정면 돌출면
const WALL_EDGE_LIGHT = Math.max(1, TILE_SIZE * 0.05);                      // 윗면↔앞벽 베벨 라인
const WALL_SHADOW_DEPTH = TILE_SIZE * 0.17;                                 // 바닥 드롭 섀도우
const WALL_TOP_LIGHT_DEPTH = TILE_SIZE * 0.5;                               // 윗면 하이라이트
const WALL_SEAM_OVERLAP = 0.6;                                              // 인접 타일 안티앨리어싱 틈 제거
const WALL_SIDE_SHADE = TILE_SIZE * 0.09;                                   // 앞벽 좌우 세로 음영 폭

const WALL_WOOD_TRIM = 'rgba(201, 138, 82, 0.45)'; // 장난감 블록의 따뜻한 우드 이음선

/** 블록 윗면에 새기는 애기풍 도장 순서 (섬 인덱스로 비대칭 순환) */
const WALL_STAMP_SYMBOLS = ['cloud', 'star', 'crescent', 'heart', 'bear'];

/** 라운드 값을 1 이상의 정수로 정규화한다 (잘못된 값은 1라운드) */
function normalizeRound(round) {
  const value = Number(round);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/**
 * 시드 기반 결정적 난수 (LCG).
 * - 같은 라운드에서는 항상 같은 그림 배치가 나오고, 라운드가 바뀌면 새로 섞인다.
 * @param {number} seed
 * @returns {() => number} 0 이상 1 미만 난수
 */
function createSeededRandom(seed) {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}


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
    this._cacheRound = null;  // 캐시가 만들어진 라운드 (라운드가 바뀌면 다시 그린다)
    this.pixelRatio = 1;      // 캐시 해상도 배율 (레티나 선명화)
    this._islands = null;     // 연결된 벽 덩어리(Island) 메타데이터
    this._islandIndex = null; // 타일별 소속 Island id (벽이 아니면 -1)
    this._stampRound = 1;     // 현재 도장 배치가 만들어진 라운드
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
   * - 브라우저: 정적 맵을 오프스크린 캔버스에 라운드당 1회만 그려 두고 매 프레임 blit
   * - 같은 라운드에서는 캐시를 그대로 쓰고, 라운드가 바뀔 때만 벽 그림을 새로 배치한다
   * - DOM 없음(테스트): 매번 직접 그린다
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [timeMs] 애니메이션 시간(ms) — 스텔스 침대 연출용
   * @param {number} [round] 현재 라운드 (기본 1) — 블록 위 그림 배치 시드
   */
  render(ctx, timeMs = 0, round = 1) {
    const roundNo = normalizeRound(round);
    this._prepareStamps(roundNo);

    if (this._ensureCache(roundNo)) {
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

  /**
   * 라운드에 맞는 블록 도장 배치를 보장한다.
   * - 라운드가 같으면 기존 배치를 그대로 재사용한다 (캐시 blit 유지)
   * - 라운드가 바뀌면 시드 기반으로 위치·종류·크기·각도를 새로 뽑는다
   * @param {number} round
   * @returns {Array<object>} islands
   */
  _prepareStamps(round = 1) {
    const roundNo = normalizeRound(round);
    const islands = this._getWallIslands();
    if (this._stampRound === roundNo) return islands;

    for (const island of islands) this._assignIslandStamps(island, roundNo);
    this._stampRound = roundNo;
    return islands;
  }

  /** 정적 맵 캐시 생성 (브라우저 전용, 실패하면 null) */
  _ensureCache(round = this._stampRound) {
    const roundNo = normalizeRound(round);
    if (this._cache && this._cacheRound === roundNo) return this._cache;
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
      this._cacheRound = roundNo;
    } catch (err) {
      this._cache = null;
      this._cacheRound = null;
    }
    return this._cache;
  }

  /** 맵이 바뀌었을 때 캐시를 버린다 */
  invalidate() {
    this._cache = null;
    this._cacheRound = null;
    this._islands = null;
    this._islandIndex = null;
  }

  /** 타일 전체를 그린다 (캐시 생성과 폴백에서 공용) */
  _drawTiles(ctx) {
    const islands = this._getWallIslands();
    const cribTiles = [];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const tile = this.map[row][col];
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        switch (tile) {
          case 1: // 벽 — 바닥/가구를 모두 깐 뒤 Island 단위로 한 덩어리 채운다
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

    // 연결된 벽 덩어리별 파스텔 윗면 → 애기풍 도장 → 2.5D 앞벽/그림자 → 하이라이트 림
    this._drawWallTops(ctx, islands);
    this._drawWallStamps(ctx, islands);
    this._drawWallExtrusion(ctx, islands);
    this._drawNeonWalls(ctx, islands);

    // 침대 가구는 벽 앞벽/그림자보다 나중에 그린다.
    // → 위쪽 벽의 앞벽·드롭 섀도우가 침대 상단을 덮어 뭉개지 않는다.
    for (const crib of cribTiles) {
      this._drawCribFurniture(ctx, crib.x, crib.y, crib.cx, CRIB_WARM);
    }
  }

  /**
   * 연결된 벽 타일(4방향)을 Island 로 묶고 파스텔 팔레트를 배분한다.
   * - 인접한 Island 끼리는 같은 색을 쓰지 않아 경계가 자연스럽게 드러난다.
   * - 모든 벽 Island 에 아기방 도장(구름/별/초승달/하트/곰돌이)을 배정한다.
   * - 라운드가 바뀌면 시드 기반으로 위치/종류/크기/각도를 다시 뽑는다.
   * - 맵 구조 자체는 정적이므로 Island 계산 결과만 캐시한다.
   * @returns {Array<object>}
   */
  _getWallIslands() {
    if (this._islands) return this._islands;

    const index = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
    const islands = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (this.map[row][col] !== 1 || index[row][col] !== -1) continue;

        const id = islands.length;
        const island = {
          id,
          tiles: [],
          minRow: row,
          maxRow: row,
          minCol: col,
          maxCol: col,
          neighbors: [],
          paletteIndex: -1,
          palette: WALL_PALETTES[0],
          stamp: null,
          stamps: [],
        };
        const queue = [[row, col]];
        index[row][col] = id;

        while (queue.length > 0) {
          const [r, c] = queue.pop();
          island.tiles.push({ row: r, col: c });
          if (r < island.minRow) island.minRow = r;
          if (r > island.maxRow) island.maxRow = r;
          if (c < island.minCol) island.minCol = c;
          if (c > island.maxCol) island.maxCol = c;

          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (!this._isWallTile(nr, nc) || index[nr][nc] !== -1) continue;
            index[nr][nc] = id;
            queue.push([nr, nc]);
          }
        }

        islands.push(island);
      }
    }

    // 인접 Island 수집 + 그리디 색 배분 (이미 배정된 이웃과 겹치지 않게)
    const neighborSets = islands.map(() => new Set());
    for (const island of islands) {
      for (const { row, col } of island.tiles) {
        for (const [dr, dc] of dirs) {
          const other = index[row + dr]?.[col + dc];
          if (other === undefined || other < 0 || other === island.id) continue;
          neighborSets[island.id].add(other);
        }
      }
    }

    let usage = null;

    for (const island of islands) {
      island.neighbors = Array.from(neighborSets[island.id]);
      const used = new Set();
      for (const otherId of island.neighbors) {
        if (otherId < island.id) used.add(islands[otherId].paletteIndex);
      }

      const width = island.maxCol - island.minCol + 1;
      const height = island.maxRow - island.minRow + 1;
      const paletteCount = WALL_PALETTES.length;
      const start = (island.id * 3 + island.minRow + island.minCol * 2 + width * 5) % paletteCount;
      if (!usage) usage = new Array(paletteCount).fill(0);

      // 이웃 색을 피하면서, 전체적으로 색이 고르게 퍼지도록 가장 적게 쓴 팔레트를 고른다
      let pick = -1;
      for (let k = 0; k < paletteCount; k++) {
        const candidate = (start + k) % paletteCount;
        if (used.has(candidate)) continue;
        if (pick < 0 || usage[candidate] < usage[pick]) pick = candidate;
      }
      if (pick < 0) pick = start;

      usage[pick] += 1;
      island.paletteIndex = pick;
      island.palette = WALL_PALETTES[pick];
    }

    // 라운드별 도장 배치 (크기/각도/종류를 달리해 블록을 촘촘히 채운다)
    for (const island of islands) this._assignIslandStamps(island, this._stampRound);

    this._islandIndex = index;
    this._islands = islands;
    return islands;
  }

  /**
   * 한 Island 에 애기풍 도장을 배정한다.
   * - 모든 블록 덩어리에 최소 1개를 새겨 빈 블록이 남지 않게 한다.
   * - 큰 블록(3x2, L/T, 긴 가장자리 블록)은 최원점 샘플링으로 2~6개를 고르게 배치한다.
   * - 도장 크기·각도·종류는 라운드 시드로 달라져 라운드마다 새로 갱신된다.
   * @param {object} island
   * @param {number} round
   */
  _assignIslandStamps(island, round = 1) {
    const roundNo = normalizeRound(round);
    const tiles = island.tiles;
    if (tiles.length === 0) {
      island.stamps = [];
      island.stamp = null;
      return;
    }

    const rng = createSeededRandom(
      ((island.id + 1) * 2654435761) ^ ((roundNo * 2246822519) >>> 0),
    );
    const area = tiles.length;
    const width = island.maxCol - island.minCol + 1;
    const height = island.maxRow - island.minRow + 1;

    let count = 1;
    if (area >= 4 || width >= 3 || height >= 3) count = 2;
    if (area >= 8) count = 3;
    if (area >= 30) count = 4;
    if (area >= 60) count = 5;
    if (area >= 100) count = 6;
    count = Math.min(count, tiles.length);

    // 시드로 첫 타일을 고르고, 이후에는 이미 뽑힌 도장과 가장 먼 타일을 고른다
    const chosen = [];
    let cursor = Math.floor(rng() * tiles.length);
    for (let n = 0; n < count; n++) {
      if (n > 0) {
        let pick = 0;
        let bestScore = -1;
        for (let i = 0; i < tiles.length; i++) {
          let minDist = Infinity;
          for (const chosenTile of chosen) {
            const dr = tiles[i].row - chosenTile.row;
            const dc = tiles[i].col - chosenTile.col;
            const dist = dr * dr + dc * dc;
            if (dist < minDist) minDist = dist;
          }
          if (minDist > bestScore) {
            bestScore = minDist;
            pick = i;
          }
        }
        cursor = pick;
      }
      chosen.push(tiles[cursor]);
    }

    island.stamps = chosen.map((tile, index) => {
      // 도장이 타일 밖으로 넘치지 않도록 지터를 작게 유지한다
      const jitterX = (rng() - 0.5) * TILE_SIZE * 0.18;
      const jitterY = (rng() - 0.5) * TILE_SIZE * 0.18;
      const radius = TILE_SIZE * (0.26 + rng() * 0.10);
      const rotation = (rng() - 0.5) * 0.7;
      const symbolOffset = Math.floor(rng() * WALL_STAMP_SYMBOLS.length);
      const symbolIndex = (island.id + roundNo + index * 2 + symbolOffset)
        % WALL_STAMP_SYMBOLS.length;

      return {
        x: (tile.col + 0.5) * TILE_SIZE + jitterX,
        y: (tile.row + 0.5) * TILE_SIZE + jitterY,
        radius,
        rotation,
        symbol: WALL_STAMP_SYMBOLS[symbolIndex],
      };
    });

    // 기존 단일 도장 계약(island.stamp) 유지 — 첫 번째 도장을 가리킨다
    island.stamp = island.stamps[0] || null;
  }

  /**
   * 벽 윗면을 Island 색으로 채운다.
   * - 타일마다 0.6px 씩 겹쳐 채워 인접 타일 사이로 바닥 격자선이 비치지 않는다.
   * - fillRect 1회/타일 계약은 그대로 유지한다 (기존 캐시 테스트 호환).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallTops(ctx, islands = this._getWallIslands()) {
    for (const island of islands) {
      ctx.fillStyle = island.palette.top;
      for (const { row, col } of island.tiles) {
        ctx.fillRect(
          col * TILE_SIZE - WALL_SEAM_OVERLAP,
          row * TILE_SIZE - WALL_SEAM_OVERLAP,
          TILE_SIZE + WALL_SEAM_OVERLAP * 2,
          TILE_SIZE + WALL_SEAM_OVERLAP * 2,
        );
      }
    }
  }


  /**
   * 벽 윗면에 아기방 도장(구름/별/초승달/하트/곰돌이)을 새긴다.
   * - 모든 도장은 **하나의 닫힌 경로(single closed path)** 로만 그려 내부 겹침 음영이 없다.
   * - 블록 색보다 확실히 밝은 양각 면 + 1px 어긋난 진한 음각 그림자 + 1px 하이라이트 림으로
   *   어두운 라운드에서도 장난감 블록 음각 도장처럼 또렷하게 보인다.
   * - roundRect/ellipse/bezierCurveTo 에 의존하지 않고 기본 경로(arc/lineTo)만 쓴다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallStamps(ctx, islands = this._getWallIslands()) {
    for (const island of islands) {
      const stamps = Array.isArray(island.stamps) && island.stamps.length > 0
        ? island.stamps
        : (island.stamp ? [island.stamp] : []);
      if (stamps.length === 0) continue;

      const palette = island.palette || WALL_PALETTES[0];
      const shadowColor = palette.embossDark || 'rgba(0, 0, 0, 0.42)';
      const rimColor = palette.embossEdge || 'rgba(255, 255, 255, 0.92)';
      const faceColor = palette.emboss || 'rgba(255, 255, 255, 0.9)';

      for (const stamp of stamps) {
        const radius = Math.max(1.5, Number(stamp.radius) || TILE_SIZE * 0.3);
        const rotation = Number.isFinite(stamp.rotation) ? stamp.rotation : 0;

        ctx.save?.();

        // 도장마다 각도를 살짝 달리해 손으로 찍은 듯한 리듬을 준다
        if (rotation !== 0
          && typeof ctx.translate === 'function'
          && typeof ctx.rotate === 'function') {
          ctx.translate(stamp.x, stamp.y);
          ctx.rotate(rotation);
          ctx.translate(-stamp.x, -stamp.y);
        }

        // 1) 음각 그림자 — 오른쪽 아래로 1px 어긋나게
        ctx.fillStyle = shadowColor;
        this._traceStampPath(ctx, stamp.symbol, stamp.x + 0.9, stamp.y + 1.2, radius);
        ctx.fill();

        // 2) 하이라이트 림 — 왼쪽 위로 1px 어긋나 양각 테두리를 만든다
        ctx.fillStyle = rimColor;
        this._traceStampPath(ctx, stamp.symbol, stamp.x - 0.8, stamp.y - 1.0, radius);
        ctx.fill();

        // 3) 도장 면 — 불투명에 가까운 밝은 색으로 대비를 확실히 준다
        ctx.fillStyle = faceColor;
        this._traceStampPath(ctx, stamp.symbol, stamp.x, stamp.y, radius);
        ctx.fill();

        ctx.restore?.();
      }
    }
  }

  /**
   * 도장 실루엣 경로 (기본 Canvas 2D 도형만 사용).
   * 각 심볼은 moveTo 1회로 시작하는 단일 폐곡선이며, 내부에 별도 sub-path 를 만들지 않는다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} symbol
   * @param {number} cx
   * @param {number} cy
   * @param {number} r
   */
  _traceStampPath(ctx, symbol, cx, cy, r) {
    ctx.beginPath();

    if (symbol === 'cloud') {
      // 납작한 밑면 + 세 개의 방울을 한 줄로 이은 단일 외곽선
      ctx.moveTo(cx - r * 0.95, cy + r * 0.44);
      ctx.lineTo(cx - r * 0.65, cy + r * 0.445);
      ctx.arc(cx - r * 0.58, cy + r * 0.02, r * 0.43, Math.PI * 0.55, Math.PI * 1.45);
      ctx.arc(cx, cy - r * 0.16, r * 0.50, Math.PI * 1.15, Math.PI * 1.85);
      ctx.arc(cx + r * 0.58, cy + r * 0.02, r * 0.43, Math.PI * 1.55, Math.PI * 2.45);
      ctx.lineTo(cx + r * 0.95, cy + r * 0.44);
      ctx.closePath();
    } else if (symbol === 'star') {
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? r : r * 0.46;
        const angle = -Math.PI / 2 + (Math.PI / 5) * i;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (symbol === 'crescent') {
      // 바깥 원(왼쪽 호) → 안쪽 원(왼쪽 호)을 한 폐곡선으로 이어 초승달을 만든다
      const offset = 0.4;
      const ratio = 0.85;
      const a = (offset * offset + 1 - ratio * ratio) / (2 * offset);
      const h = Math.sqrt(Math.max(0, 1 - a * a));
      const outerBottom = Math.atan2(h, a);
      const innerBottom = Math.atan2(h, a - offset);

      ctx.moveTo(cx + r * a, cy + r * h);
      ctx.arc(cx, cy, r, outerBottom, Math.PI * 2 - outerBottom);
      ctx.arc(cx + r * offset, cy, r * ratio, -innerBottom, innerBottom, true);
      ctx.closePath();
    } else if (symbol === 'heart') {
      // 아래 꼭짓점 → 왼쪽 볼 → 가운데 홈 → 오른쪽 볼 → 꼭짓점 (단일 경로)
      ctx.moveTo(cx, cy + r * 0.95);
      ctx.lineTo(cx - r * 0.93, cy);
      ctx.arc(cx - r * 0.44, cy - r * 0.24, r * 0.54, 2.72, 5.72);
      ctx.arc(cx + r * 0.44, cy - r * 0.24, r * 0.54, -2.58, 0.42);
      ctx.lineTo(cx, cy + r * 0.95);
      ctx.closePath();
    } else {
      // 곰돌이 실루엣 — 머리 외곽선에 양쪽 귀를 이어 붙인 단일 폐곡선
      const headY = cy + r * 0.08;
      const headR = r * 0.72;
      const earR = r * 0.30;

      ctx.moveTo(cx, cy + r * 0.80);
      ctx.arc(cx, headY, headR, Math.PI / 2, Math.PI * 7 / 6);
      ctx.arc(cx - r * 0.56, cy - r * 0.52, earR, Math.PI * 7 / 12, Math.PI * 35 / 18);
      ctx.lineTo(cx - headR * 0.174, headY - headR * 0.985);
      ctx.arc(cx, headY, headR, Math.PI * 13 / 9, Math.PI * 11 / 6);
      ctx.arc(cx + r * 0.56, cy - r * 0.52, earR, Math.PI * 5 / 12, -Math.PI * 37 / 36, true);
      ctx.arc(cx, headY, headR, Math.PI * 5 / 3, Math.PI * 5 / 2);
      ctx.closePath();
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
  /**
   * 벽 Island 을 2.5D 장난감 블록처럼 돌출시킨다.
   * ① 윗면 위쪽 모서리의 부드러운 빛 번짐(sheen)
   * ② 윗면보다 한 톤 진한 정면 앞벽 + 양쪽 세로 모서리 음영 + 베벨/우드 이음선
   * ③ 앞벽 아래 바닥으로 떨어지는 드롭 섀도우
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallExtrusion(ctx, islands = this._getWallIslands()) {
    for (const island of islands) this._drawIslandExtrusion(ctx, island);
  }

  /** Island 안에서 조건을 만족하는 연속 가로 구간(run)을 순회한다 */
  _forEachIslandRun(island, predicate, callback) {
    for (let row = island.minRow; row <= island.maxRow; row++) {
      let start = -1;
      for (let col = island.minCol; col <= island.maxCol + 1; col++) {
        const inside = col <= island.maxCol
          && this._islandIndex?.[row]?.[col] === island.id
          && predicate(row, col);
        if (inside && start < 0) start = col;
        else if (!inside && start >= 0) {
          callback(row, start, col - 1);
          start = -1;
        }
      }
    }
  }

  /** Island 하나의 앞벽/모서리 음영/드롭 섀도우 */
  _drawIslandExtrusion(ctx, island) {
    const palette = island.palette;
    const trimH = Math.max(1, TILE_SIZE * 0.035);

    // ① 윗면 상단에서 아래로 옅어지는 부드러운 빛 (위에서 빛이 내려온다)
    this._forEachIslandRun(
      island,
      (row, col) => !this._isWallTile(row - 1, col),
      (row, start, end) => {
        const y = row * TILE_SIZE;
        const sheen = safeLinearGradient(ctx, 0, y, 0, y + WALL_TOP_LIGHT_DEPTH, palette.sheen)
          || 'rgba(255, 255, 255, 0.1)';
        fillRects(ctx, sheen, [[
          start * TILE_SIZE, y, (end - start + 1) * TILE_SIZE, WALL_TOP_LIGHT_DEPTH,
        ]]);
      },
    );

    // ② 아래가 뚫린 구간에 정면 앞벽을 세운다
    this._forEachIslandRun(
      island,
      (row, col) => !this._isWallTile(row + 1, col),
      (row, start, end) => {
        const runX = start * TILE_SIZE;
        const runW = (end - start + 1) * TILE_SIZE;
        const baseY = (row + 1) * TILE_SIZE;
        const bottomY = baseY + WALL_DEPTH;

        const face = safeLinearGradient(ctx, 0, baseY, 0, bottomY, [
          [0, palette.frontTop],
          [0.55, palette.frontMid],
          [1, palette.frontBottom],
        ]) || palette.frontMid;
        fillRects(ctx, face, [[runX, baseY, runW, WALL_DEPTH]]);

        // 윗면↔앞벽 경계의 밝은 베벨 + 원목 이음선
        fillRects(ctx, palette.bevel, [[runX, baseY, runW, WALL_EDGE_LIGHT]]);
        fillRects(ctx, WALL_WOOD_TRIM, [[runX, baseY + WALL_EDGE_LIGHT, runW, trimH]]);

        // 양쪽 세로 모서리 음영 + 왼쪽 빛 받는 모서리
        const shadeTop = baseY + WALL_EDGE_LIGHT;
        const shadeH = WALL_DEPTH - WALL_EDGE_LIGHT;
        fillRects(ctx, 'rgba(0, 0, 0, 0.14)', [[runX, shadeTop, WALL_SIDE_SHADE, shadeH]]);
        fillRects(ctx, 'rgba(0, 0, 0, 0.2)', [[
          runX + runW - WALL_SIDE_SHADE, shadeTop, WALL_SIDE_SHADE, shadeH,
        ]]);
        fillRects(ctx, palette.rimSoft, [[runX + WALL_SIDE_SHADE * 0.45, shadeTop, 0.8, shadeH]]);

        // 블록 실루엣을 또렷하게 잡는 1px 구분선
        fillRects(ctx, palette.seam, [
          [runX, baseY, 1, WALL_DEPTH],
          [runX + runW - 1, baseY, 1, WALL_DEPTH],
          [runX, bottomY - 1, runW, 1],
        ]);

        // ③ 앞벽 밑면 바로 아래로 짧게 떨어지는 드롭 섀도우
        const shadow = safeLinearGradient(ctx, 0, bottomY, 0, bottomY + WALL_SHADOW_DEPTH, [
          [0, 'rgba(0, 0, 0, 0.5)'],
          [0.5, 'rgba(0, 0, 0, 0.2)'],
          [1, 'rgba(0, 0, 0, 0)'],
        ]) || 'rgba(0, 0, 0, 0.24)';
        fillRects(ctx, shadow, [[runX, bottomY, runW, WALL_SHADOW_DEPTH]]);
      },
    );
  }

  /** 벽 타일 여부 (범위 밖은 벽으로 취급하지 않는다) */
  _isWallTile(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS && this.map[row][col] === 1;
  }

  /**
   * Island 테두리 중 지정한 방향의 모서리만 하나의 path 로 만든다.
   * - 빛은 위에서 내려오므로 'top'(가장 밝음) / 'left'(밝음) / 'right'(어두움)을
   *   각각 따로 그려 방향성 있는 림 라이트를 만든다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} island
   * @param {'top'|'topLeft'|'right'} sides
   * @returns {boolean} 그린 선이 하나라도 있으면 true
   */
  _traceIslandEdges(ctx, island, sides) {
    const isWall = (row, col) => this._isWallTile(row, col);
    const wantTop = sides === 'top' || sides === 'topLeft';
    const wantLeft = sides === 'left' || sides === 'topLeft';
    const wantRight = sides === 'right';

    let hasEdges = false;
    ctx.beginPath();

    for (const { row, col } of island.tiles) {
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

    return hasEdges;
  }

  /**
   * 통로와 맞닿은 벽 테두리에 Island 색의 방향성 하이라이트 림을 그린다.
   * - 윗면 상단 + 좌측 모서리: 빛을 받는 면 → 밝은 파스텔 림
   * - 우측 모서리: 빛을 등지는 면 → 낮은 광량의 얇은 라인
   * - 아랫면(앞벽 밑면)은 여기서 빛내지 않는다 → _drawWallExtrusion 의 어두운 1px 선이 담당
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawNeonWalls(ctx, islands = this._getWallIslands()) {
    // shadowBlur 는 CTM 의 영향을 받지 않으므로 DPR 만큼 키워 논리 크기를 유지한다
    const blurScale = this.pixelRatio > 0 ? this.pixelRatio : 1;

    for (const island of islands) {
      const p = island.palette;

      ctx.save?.();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1) 윗면 상단 + 좌측 모서리의 은은한 파스텔 글로우 + 선명한 코어
      if (this._traceIslandEdges(ctx, island, 'topLeft')) {
        ctx.shadowColor = p.rimGlow;
        ctx.shadowBlur = Math.max(5, TILE_SIZE * 0.4) * blurScale;
        ctx.strokeStyle = p.rimSoft;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.shadowBlur = Math.max(2, TILE_SIZE * 0.16) * blurScale;
        ctx.strokeStyle = p.rim;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // 2) 상단 모서리는 빛과 정면으로 만나므로 한 번 더 밝게
      if (this._traceIslandEdges(ctx, island, 'top')) {
        ctx.shadowColor = p.rimGlow;
        ctx.shadowBlur = Math.max(3, TILE_SIZE * 0.26) * blurScale;
        ctx.strokeStyle = p.rim;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      // 3) 우측 모서리는 빛을 등지므로 얇고 어둡게 (4면이 똑같이 빛나지 않게)
      if (this._traceIslandEdges(ctx, island, 'right')) {
        ctx.shadowColor = p.rimRightGlow;
        ctx.shadowBlur = Math.max(1, TILE_SIZE * 0.08) * blurScale;
        ctx.strokeStyle = p.rimRight;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.restore?.();
    }
  }

  /** 아이템 스폰 타일 (바닥 + 은은한 금빛 패드) */
  _drawItemPad(ctx, x, y) {
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;

    ctx.fillStyle = COLORS.ITEM_SPOT;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    ctx.fillStyle = 'rgba(255, 214, 130, 0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffd38a';
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

    ctx.fillStyle = 'rgba(255, 226, 178, 0.12)';
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