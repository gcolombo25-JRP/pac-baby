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
const WALL_CORNER_RADIUS = TILE_SIZE * 0.2;                                 // 바깥으로 노출된 볼록 모서리 라운드 (≈4.6px)

const WALL_WOOD_TRIM = 'rgba(201, 138, 82, 0.45)'; // 장난감 블록의 따뜻한 우드 이음선

/** 블록 윗면에 새기는 애기풍 도장 순서 (섬 인덱스로 비대칭 순환) — 얇은 막대 블록의 잔점 장식용 */
const WALL_STAMP_SYMBOLS = ['cloud', 'star', 'crescent', 'heart', 'bear'];

/**
 * 벽 블록 중앙에 인쇄하는 아기방 일러스트 14종.
 * - 블록 모양(가로로 긴 / 세로로 긴 / 정사각)에 맞는 세트에서 라운드 시드로 하나를 고른다.
 * - 같은 맵이라도 라운드마다 종류·위치·질감이 새로 섞여 벽지가 다시 인쇄된 느낌이 된다.
 * - 납작한 단색 실루엣 대신 파스텔 다색 채색 + 눈/코/볼터치 디테일을 가진다.
 */
const WALL_ILLUSTRATIONS_HORIZONTAL = ['train', 'caterpillar', 'car', 'rainbow'];
const WALL_ILLUSTRATIONS_VERTICAL = ['rocket', 'giraffe', 'balloons', 'tallFlower'];
const WALL_ILLUSTRATIONS_SQUARE = ['bear', 'cloud', 'duck', 'flower', 'sun', 'boat'];
const WALL_ILLUSTRATIONS = [
  ...WALL_ILLUSTRATIONS_SQUARE,
  ...WALL_ILLUSTRATIONS_HORIZONTAL,
  ...WALL_ILLUSTRATIONS_VERTICAL,
];

/**
 * centerpiece.kind 로 유지해야 하는 기존 분류(테스트/호환 계약).
 * 실제 그림 종류는 centerpiece.variant 가 갖는다 (가로/세로/정사각 세트에서 시드로 선택).
 */
const WALL_ILLUSTRATION_KINDS = ['bear', 'cloud', 'rainbow', 'duck', 'flower'];

/**
 * 일러스트가 블록 내부 사각형을 채우는 비율 (75~85%).
 * - 기존 1.3~1.6 타일(내부 사각형의 약 40%)보다 약 2배 큰 그림이 된다.
 * - 가로/세로를 각각 채우므로 블록 비율에 맞춰 그림이 늘어나 꽉 들어찬다.
 */
const WALL_ART_FILL_MIN = 0.75;
const WALL_ART_FILL_MAX = 0.85;

/**
 * 그림 질감 3종 (기존 키 유지 — piece 계약 호환).
 * - emboss / deboss: 파스텔 그림 인쇄
 * - scratch: 예전 45° 빗금 질감의 이름을 그대로 두되, 이제 빗금 대신 크레파스 자유 낙서로 그린다
 */
const WALL_ART_TEXTURES = ['emboss', 'deboss', 'scratch'];

/**
 * 그림 테두리(스티커 판) 3종 — 라운드/블록 시드로 하나를 고른다.
 * - none  : 테두리 없이 블록 위에 직접 끄적인다
 * - deboss: 음각 틀 (눌려 파인 홈)
 * - emboss: 양각 틀 (살짝 떠오른 판)
 */
const WALL_ART_FRAMES = ['none', 'deboss', 'emboss'];

/** 은은한 크림 테두리 + 얕은 홈 그림자 — 시선을 과하게 끌지 않도록 낮은 알파 */
const WALL_ART_FRAME_CREAM = 'rgba(255, 247, 228, 0.34)';
const WALL_ART_FRAME_SHADE = 'rgba(48, 34, 24, 0.24)';

/** 벽 윗면 톤 다운 — 복도의 캐릭터/아이템이 먼저 보이도록 약 15% 차분하게 */
const WALL_TONE_DOWN = 'rgba(42, 36, 56, 0.15)';

/** 낙서 모티프(소용돌이/집/해/별똥별/하트/별/물결/꽃)와 크레파스 잉크 */
const WALL_DOODLE_MOTIFS = ['spiral', 'house', 'sun', 'starShower', 'heart', 'star', 'squiggle', 'flower'];
const WALL_DOODLE_INKS = [
  'rgba(92, 74, 58, 0.9)',
  'rgba(118, 88, 132, 0.82)',
  'rgba(70, 106, 96, 0.82)',
  'rgba(140, 92, 76, 0.82)',
];
const WALL_DOODLE_SKETCH = 'rgba(86, 68, 52, 0.62)';

/** 일러스트는 복도 캐릭터보다 한참 뒤로 물러나도록 은은한 배경 수준으로만 남긴다 */
const WALL_ART_ALPHA_MIN = 0.55;
const WALL_ART_ALPHA_MAX = 0.72;

/**
 * 실제 렌더링 알파 배율.
 * - piece.alpha 계약(0.55~0.72)은 그대로 두고, 그릴 때만 0.68 을 곱한다.
 * - 화면에 보이는 그림 불투명도는 0.37~0.49 → 캐릭터/아이템이 먼저 눈에 들어온다.
 */
const WALL_ART_RENDER_ALPHA = 0.68;

/** 그림 없이 비워 둘 면의 비율 (라운드마다 25~30%) */
const WALL_ART_SKIP_RATIO = 0.27;

/** 일러스트 공통 잉크색 (눈/코/미소) — 파스텔 사이에서도 표정이 읽히는 정도만 */
const WALL_ART_INK = '#5a4633';
const WALL_ART_INK_SOFT = '#7c6650';
const WALL_ART_BLUSH = 'rgba(246, 163, 168, 0.9)';

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
 * 아래쪽 두 모서리를 둥글게 깎은 가로 막대 경로 (앞벽 전용).
 * - roundRect 없이 moveTo/lineTo/arc 만 사용한다 (렌더 계약 유지).
 * - rLeft/rRight 가 0 이면 그 모서리는 기존처럼 각지게 남는다 (안쪽 계단 모서리).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} rLeft
 * @param {number} rRight
 */
function runBoxPath(ctx, x, y, w, h, rLeft, rRight) {
  const left = Math.max(0, Math.min(rLeft, w / 2, h));
  const right = Math.max(0, Math.min(rRight, w / 2, h));

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);

  if (right > 0) {
    ctx.lineTo(x + w, y + h - right);
    ctx.arc(x + w - right, y + h - right, right, 0, Math.PI / 2);
  } else {
    ctx.lineTo(x + w, y + h);
  }

  if (left > 0) {
    ctx.lineTo(x + left, y + h);
    ctx.arc(x + left, y + h - left, left, Math.PI / 2, Math.PI);
  } else {
    ctx.lineTo(x, y + h);
  }

  ctx.closePath();
}

/**
 * 앞벽 하단 라운드와 같은 반경으로 모서리를 다듬은 드롭 섀도우 경로.
 * - 위쪽 두 모서리는 앞벽이 둥글게 파인 만큼 안쪽에서 시작해 어긋남을 줄인다.
 * - quadraticCurveTo 가 없는 최소 ctx 스텁에서는 lineTo 로 근사한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} rLeft
 * @param {number} rRight
 */
function shadowRunPath(ctx, x, y, w, h, rLeft, rRight) {
  const maxRadius = Math.min(w / 2, h / 2);
  const left = Math.max(0, Math.min(rLeft, maxRadius));
  const right = Math.max(0, Math.min(rRight, maxRadius));
  const curve = typeof ctx.quadraticCurveTo === 'function'
    ? (cpx, cpy, px, py) => ctx.quadraticCurveTo(cpx, cpy, px, py)
    : (cpx, cpy, px, py) => ctx.lineTo(px, py);

  ctx.beginPath();
  ctx.moveTo(x + left, y);
  ctx.lineTo(x + w - right, y);
  if (right > 0) curve(x + w, y, x + w, y + right);
  else ctx.lineTo(x + w, y);

  ctx.lineTo(x + w, y + h - right);
  if (right > 0) curve(x + w, y + h, x + w - right, y + h);
  else ctx.lineTo(x + w, y + h);

  ctx.lineTo(x + left, y + h);
  if (left > 0) curve(x, y + h, x, y + h - left);
  else ctx.lineTo(x, y + h);

  ctx.lineTo(x, y + left);
  if (left > 0) curve(x, y, x + left, y);
  else ctx.lineTo(x, y);

  ctx.closePath();
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

/** 둥근 사각형 면 채우기 (fillRect 를 추가하지 않고 path fill 만 사용) */
function fillRoundBox(ctx, x, y, w, h, r, color) {
  if (!(w > 0 && h > 0)) return;
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

/** 둥근 사각형 윤곽선 (겹선 윤곽/홈 하이라이트 전용) */
function strokeRoundBox(ctx, x, y, w, h, r, color, width) {
  if (!(w > 0 && h > 0)) return;
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.4, width);
  ctx.stroke();
}

/** 꼭짓점 배열을 잇는 폐곡선 채우기 (지붕/돛/날개/불꽃 같은 다각형 전용) */
function fillPolygon(ctx, points, color) {
  if (!Array.isArray(points) || points.length < 3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** 파스텔 원 한 점 (fillRect 없이 경로만 사용 → 캐시 fillRect 계약 유지) */
function fillCircle(ctx, x, y, radius, color) {
  if (!(radius > 0)) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, radius), 0, Math.PI * 2);
  ctx.fill();
}

/** 둥근 캡 아크 선 (눈웃음/미소/무지개 띠) */
function strokeArc(ctx, x, y, radius, start, end, color, width) {
  if (!(radius > 0)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.4, width);
  ctx.beginPath();
  ctx.arc(x, y, radius, start, end);
  ctx.stroke();
}

/** 아래로 뾰족한 파스텔 빗방울 (구름 일러스트 전용) */
function fillRaindrop(ctx, x, y, radius, color) {
  if (!(radius > 0)) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 2.1);
  ctx.lineTo(x - radius, y);
  ctx.arc(x, y, radius, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
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
    this._stampRound = 1;     // 현재 스티치/중앙 일러스트 배치가 만들어진 라운드
    this._skipPlan = null;    // 라운드별 "그림 없이 비울 면" 키 집합
    this._skipPlanRound = null; // skipPlan 이 만들어진 라운드
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
    this._skipPlan = null;
    this._skipPlanRound = null;
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

    // 연결된 벽 덩어리별 파스텔 윗면 → 톤 다운 → 2.5D 앞벽/그림자 → 장난감 스티치/중앙 일러스트 → 하이라이트 림
    // (윗면 빛 번짐이 일러스트를 덮어 뿌옇게 만들지 않도록 일러스트를 그 뒤에 인쇄한다)
    this._drawWallTops(ctx, islands);
    this._drawWallToneDown(ctx, islands);
    this._drawWallExtrusion(ctx, islands);
    this._drawWallStamps(ctx, islands);
    this._drawWallIllustrations(ctx, islands);
    this._drawNeonWalls(ctx, islands);
    this._drawWallCorners(ctx, islands);

    // 침대 가구는 벽 앞벽/그림자보다 나중에 그린다.
    // → 위쪽 벽의 앞벽·드롭 섀도우가 침대 상단을 덮어 뭉개지 않는다.
    for (const crib of cribTiles) {
      this._drawCribFurniture(ctx, crib.x, crib.y, crib.cx, CRIB_WARM);
    }
  }

  /**
   * 연결된 벽 타일(4방향)을 Island 로 묶고 파스텔 팔레트를 배분한다.
   * - 인접한 Island 끼리는 같은 색을 쓰지 않아 경계가 자연스럽게 드러난다.
   * - 모든 벽 Island 에 스티치 테두리와 중앙 일러스트(곰돌이/구름/무지개/병아리/꽃)를 배정한다.
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

    // 라운드별 도장/중앙 일러스트 배치 (가장 넓은 내부 사각형을 찾으려면 타일 인덱스가 먼저 필요하다)
    // - "비울 면" 계획이 전체 Island 를 훑으므로 this._islands 를 먼저 확정한다
    this._islandIndex = index;
    this._islands = islands;
    this._skipPlan = null;
    this._skipPlanRound = null;
    for (const island of islands) this._assignIslandStamps(island, this._stampRound);

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

    // 넓은 내부 사각형부터 차례로 마킹(소비)하며, 남은 2x2 이상 구역마다 일러스트를 배치한다
    // (외곽 테두리처럼 하나로 이어진 큰 덩어리도 오른쪽 가운데 위/아래 블록이 비지 않는다)
    const artRects = this._collectIslandArtRects(island);
    island.artRects = artRects;
    island.innerRect = artRects[0] || this._findIslandInnerRect(island);

    // 매 라운드 배치 가능한 면 중 약 25~30%(최소 2면)는 그림 없이 깔끔히 비워 둔다
    // → 라운드마다 비는 면과 그림/테두리가 들어가는 면이 확실히 달라진다
    const skipPlan = this._buildArtSkipPlan(roundNo);
    const keptRects = [];
    artRects.forEach((rect, index) => {
      if (skipPlan.has(`${island.id}:${index}`)) return;
      keptRects.push({ rect, index });
    });
    island.artSkipped = artRects.length > 0 && keptRects.length === 0;

    island.pieces = keptRects
      .map(({ rect, index }) => this._assignIslandCenterpiece(island, roundNo, rect, index))
      .filter(Boolean);
    island.centerpiece = island.pieces[0] || null;

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
   * 라운드 시드로 "그림을 비워 둘 면"을 고른다.
   * - 배치 가능한 2x2 이상 면의 약 25~30%(최소 2면)를 비워 숨 쉴 여백을 만든다.
   * - 라운드가 바뀌면 비는 면과 그림이 들어가는 면이 완전히 달라진다 (캐시 갱신과 함께 새로 뽑힘).
   * - 그림이 1개뿐인 블록은 비우지 않는다 (모든 2x2 이상 블록에 최소 1개 일러스트 유지 계약).
   *   → 여러 면을 가진 큰 블록에서만 여분의 면을 비우므로, 빈 면과 그림 면이 함께 생긴다.
   * - 반환 키는 `islandId:rectIndex` 이며, 같은 라운드에서는 항상 같은 결과가 나온다.
   * @param {number} round
   * @returns {Set<string>}
   */
  _buildArtSkipPlan(round = 1) {
    const roundNo = normalizeRound(round);
    if (this._skipPlan && this._skipPlanRound === roundNo) return this._skipPlan;

    const islands = Array.isArray(this._islands) ? this._islands : [];
    const rng = createSeededRandom(((roundNo + 7) * 2654435761) ^ 0x85ebca6b);
    const candidates = [];
    const spare = new Map(); // islandId → 비울 수 있는 최대 면 수
    let total = 0;

    for (const island of islands) {
      const rects = Array.isArray(island.artRects)
        ? island.artRects
        : this._collectIslandArtRects(island);
      island.artRects = rects;
      total += rects.length;
      if (rects.length < 2) continue;

      spare.set(island.id, rects.length - 1);
      rects.forEach((rect, index) => {
        // 가장 넓은 첫 면(index 0)은 항상 그림을 남긴다 → centerpiece 와 innerRect 계약이 일치한다
        if (index === 0) return;
        candidates.push({
          key: `${island.id}:${index}`,
          islandId: island.id,
          index,
          area: rect.area || rect.width * rect.height || 0,
          roll: rng(),
        });
      });
    }

    candidates.sort((a, b) => (
      a.roll - b.roll
      || b.area - a.area
      || a.islandId - b.islandId
      || a.index - b.index
    ));

    let skipCount = Math.round(total * WALL_ART_SKIP_RATIO);
    if (total >= 3) skipCount = Math.max(2, skipCount);

    const plan = new Set();
    for (const entry of candidates) {
      if (plan.size >= skipCount) break;
      const left = spare.get(entry.islandId) || 0;
      if (left <= 0) continue;
      plan.add(entry.key);
      spare.set(entry.islandId, left - 1);
    }

    this._skipPlan = plan;
    this._skipPlanRound = roundNo;
    return plan;
  }

  /**
   * Island 안에서 가장 넓은 축정렬 내부 사각형을 찾는다.
   * - 히스토그램 최대 사각형 알고리즘으로 O(행 x 열) 에 구한다.
   * - 한 칸 두께 막대(1xN)보다 2칸 이상 두께의 사각형을 우선해 일러스트가 놓일 자리를 고른다.
   * - consumed(마킹된 타일 집합)를 넘기면 이미 그림이 들어간 영역을 제외하고 다시 찾는다.
   * @param {object} island
   * @param {Set<number>|null} [consumed] 이미 소비한 타일 키(row * COLS + col) 집합
   * @returns {{minRow:number,maxRow:number,minCol:number,maxCol:number,width:number,height:number,area:number}|null}
   */
  _findIslandInnerRect(island, consumed = null) {
    const index = this._islandIndex;
    if (!index) return null;

    const width = island.maxCol - island.minCol + 1;
    if (width <= 0) return null;

    const heights = new Array(width).fill(0);
    let bestWide = null; // 두께 2칸 이상 후보 (중앙 일러스트 자리)
    let bestAny = null;  // 두께 1칸 포함 후보 (얇은 막대 판정용)

    const record = (area, w, h, minCol, maxRow) => {
      const rect = {
        minRow: maxRow - h + 1,
        maxRow,
        minCol,
        maxCol: minCol + w - 1,
        width: w,
        height: h,
        area,
      };
      const isBetter = (candidate, best) => !best
        || area > best.area
        || (area === best.area && Math.min(w, h) > Math.min(best.width, best.height));

      if (isBetter(rect, bestAny)) bestAny = rect;
      if (Math.min(w, h) >= 2 && isBetter(rect, bestWide)) bestWide = rect;
    };

    for (let row = island.minRow; row <= island.maxRow; row++) {
      for (let i = 0; i < width; i++) {
        const col = island.minCol + i;
        const usable = index[row]?.[col] === island.id
          && (!consumed || !consumed.has(row * COLS + col));
        heights[i] = usable ? heights[i] + 1 : 0;
      }

      const stack = [];
      for (let i = 0; i <= width; i++) {
        const current = i < width ? heights[i] : 0;
        while (stack.length > 0 && heights[stack[stack.length - 1]] >= current) {
          const top = stack.pop();
          const left = stack.length > 0 ? stack[stack.length - 1] + 1 : 0;
          const w = i - left;
          const h = heights[top];
          if (h > 0 && w > 0) record(w * h, w, h, island.minCol + left, row);
        }
        stack.push(i);
      }
    }

    return bestWide || bestAny;
  }

  /**
   * Island 안에서 그림을 넣을 수 있는 2x2 이상 내부 사각형을 모두 모은다.
   * - 가장 넓은 사각형을 찾아 마킹(소비)하고, 남은 타일에서 다시 찾는 것을 반복한다.
   * - 그래서 외곽 테두리와 하나로 이어진 큰 덩어리도 오른쪽 가운데 위/아래 블록처럼
   *   아직 그림이 없는 2x2 이상 구역마다 일러스트가 추가로 들어간다.
   * - 서로 겹치지 않으며, 넓은 순서(첫 항목이 가장 큼)로 돌려준다.
   * @param {object} island
   * @returns {Array<object>} 내부 사각형 목록
   */
  _collectIslandArtRects(island) {
    const rects = [];
    const consumed = new Set();
    let rect = this._findIslandInnerRect(island);

    while (rect && rect.width >= 2 && rect.height >= 2) {
      rects.push(rect);
      for (let row = rect.minRow; row <= rect.maxRow; row++) {
        for (let col = rect.minCol; col <= rect.maxCol; col++) {
          consumed.add(row * COLS + col);
        }
      }
      rect = this._findIslandInnerRect(island, consumed);
    }

    return rects;
  }

  /**
   * Island 중앙 일러스트를 라운드 시드로 배정한다.
   * - 내부 사각형이 2x2 이상일 때만 일러스트를 놓는다 (긴 1칸 막대는 스티치 테두리로 대체).
   * - 블록 모양(가로형/세로형/정사각)에 맞는 일러스트 세트에서 하나를 고른다.
   * - 내부 사각형 폭·높이의 75~85% 를 꽉 채우도록 rx/ry 를 따로 잡는다 (기존 대비 약 2배).
   * - 테두리 3종(없음/음각/양각)과 낙서 모티프 1~3개도 시드로 섞어 블록마다 다르게 끄적인다.
   * - 한 Island 안의 여러 구역은 pieceIndex 를 시드에 섞어 위치마다 종류·테두리·낙서가 갈린다.
   * @param {object} island
   * @param {number} round
   * @param {object|null} [rect] 그림을 놓을 내부 사각형 (기본: island.innerRect)
   * @param {number} [pieceIndex] Island 안에서 몇 번째 그림인지
   * @returns {object|null}
   */
  _assignIslandCenterpiece(island, round = 1, rect = island.innerRect, pieceIndex = 0) {
    const roundNo = normalizeRound(round);
    if (!rect || rect.width < 2 || rect.height < 2) return null;

    const rng = createSeededRandom(
      ((island.id + 13) * 2654435761)
      ^ ((roundNo * 3266489917) >>> 0)
      ^ Math.imul(pieceIndex + 1, 668265263),
    );

    // ① 블록 모양에 맞는 일러스트 세트 (가로로 긴 / 세로로 긴 / 정사각)
    const shapeRatio = rect.width / rect.height;
    let pool = WALL_ILLUSTRATIONS_SQUARE;
    let orientation = 'square';
    if (shapeRatio > 1.25) {
      pool = WALL_ILLUSTRATIONS_HORIZONTAL;
      orientation = 'horizontal';
    } else if (shapeRatio < 0.8) {
      pool = WALL_ILLUSTRATIONS_VERTICAL;
      orientation = 'vertical';
    }

    const variant = pool[Math.floor(rng() * pool.length)];
    // kind 는 기존 5종 분류를 유지한다 (실제 그림은 variant)
    const kind = WALL_ILLUSTRATION_KINDS[Math.floor(rng() * WALL_ILLUSTRATION_KINDS.length)];

    // ② 내부 사각형의 75~85% 를 가로/세로 각각 채우는 그림 박스
    const fill = WALL_ART_FILL_MIN + rng() * (WALL_ART_FILL_MAX - WALL_ART_FILL_MIN);
    const rx = (rect.width * TILE_SIZE * fill) / 2;
    const ry = (rect.height * TILE_SIZE * fill) / 2;

    // ③ 박스 안에서 아주 조금만 흔들어 블록 중앙에 인쇄한다
    const jitter = TILE_SIZE * 0.04;
    const centerX = (rect.minCol + rect.width / 2) * TILE_SIZE + (rng() - 0.5) * jitter;
    const centerY = (rect.minRow + rect.height / 2) * TILE_SIZE + (rng() - 0.5) * jitter;

    // ④ 그림 질감(레거시 키) + 테두리 3종(없음/음각/양각)을 각각 시드로 고른다
    const texture = WALL_ART_TEXTURES[Math.floor(rng() * WALL_ART_TEXTURES.length)];
    const frame = WALL_ART_FRAMES[Math.floor(rng() * WALL_ART_FRAMES.length)];
    const rotation = (rng() - 0.5) * 0.08;
    const alpha = WALL_ART_ALPHA_MIN + rng() * (WALL_ART_ALPHA_MAX - WALL_ART_ALPHA_MIN);

    // ⑤ 블록 위에 끄적인 낙서 1~3개 (소용돌이/손그림 집/웃는 해/별똥별/하트/별/물결/꽃)
    const doodleCount = 1 + Math.floor(rng() * 3);
    const doodles = [];
    for (let i = 0; i < doodleCount; i++) {
      doodles.push({
        motif: WALL_DOODLE_MOTIFS[Math.floor(rng() * WALL_DOODLE_MOTIFS.length)],
        dx: (rng() - 0.5) * 1.1,
        dy: (rng() - 0.5) * 1.1,
        scale: 0.2 + rng() * 0.2,
        tilt: (rng() - 0.5) * 0.8,
      });
    }
    const doodleSeed = Math.floor(rng() * 0x7fffffff) || 7;

    return {
      kind,
      variant,
      orientation,
      texture,
      frame,
      doodles,
      doodleSeed,
      x: centerX,
      y: centerY,
      rx,
      ry,
      // 레거시 단일 반지름(1.2~1.7 타일 지름) — 실제 렌더링 크기는 rx/ry(내부 사각형의 75~85%)를 쓴다
      radius: Math.min(
        TILE_SIZE * 0.78,
        Math.max(TILE_SIZE * 0.68, Math.min(rect.width, rect.height) * TILE_SIZE * 0.34),
      ),
      rotation,
      alpha,
    };
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
   * 벽 블록 배경 톤 다운.
   * - 복도의 베이비/보모/아이템이 먼저 눈에 들어오도록 윗면 색의 채도·밝기를 약 15% 낮춘다.
   * - 타일마다 fillRect 를 추가하지 않고 Island 단위 path fill 로만 덮는다 (캐시 fillRect 계약 유지).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallToneDown(ctx, islands = this._getWallIslands()) {
    for (const island of islands) {
      const rects = island.tiles.map(({ row, col }) => [
        col * TILE_SIZE - WALL_SEAM_OVERLAP,
        row * TILE_SIZE - WALL_SEAM_OVERLAP,
        TILE_SIZE + WALL_SEAM_OVERLAP * 2,
        TILE_SIZE + WALL_SEAM_OVERLAP * 2,
      ]);
      fillRects(ctx, WALL_TONE_DOWN, rects);
    }
  }

  /**
   * 벽 블록 윗면의 장식 레이어.
   * - 모든 Island 안쪽 테두리를 따라 은은한 파스텔 점선 스티치를 넣어 긴 1칸 막대 구간도 비지 않게 한다.
   * - 중앙 일러스트가 없는 얇은 블록에는 작은 파스텔 실땀(도트 + 십자 스티치)을 더한다.
   * - setLineDash 가 없는 최소 ctx 스텁에서는 파스텔 도트로 자연스럽게 폴백한다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallStamps(ctx, islands = this._getWallIslands()) {
    for (const island of islands) {
      // 모든 블록 안쪽 테두리에 장난감 스티치를 넣어 긴 1칸 막대 구간도 비지 않게 한다
      this._drawToyStitchTrim(ctx, island);

      // 큰 블록은 중앙 일러스트가 본체 → 잔점 장식을 겹치지 않는다
      // 그림 없이 비워 둔 면도 장식을 얹지 않고 깔끔한 여백으로 남긴다
      if (island.centerpiece || island.artSkipped) continue;

      const stamps = Array.isArray(island.stamps) && island.stamps.length > 0
        ? island.stamps
        : (island.stamp ? [island.stamp] : []);
      if (stamps.length === 0) continue;

      const palette = island.palette || WALL_PALETTES[0];
      const dotColor = palette.embossEdge || 'rgba(255, 255, 255, 0.6)';
      const threadColor = palette.embossDark || 'rgba(90, 70, 51, 0.32)';

      ctx.save?.();
      ctx.globalAlpha = 0.5;

      for (const stamp of stamps) {
        const dotRadius = Math.max(
          1,
          Math.min(TILE_SIZE * 0.1, (Number(stamp.radius) || TILE_SIZE * 0.3) * 0.28),
        );
        fillCircle(ctx, stamp.x, stamp.y, dotRadius, dotColor);

        // 실꿰기 바늘땀 느낌의 작은 십자 스티치
        const s = Math.max(1.6, dotRadius * 1.8);
        ctx.strokeStyle = threadColor;
        ctx.lineWidth = Math.max(0.8, TILE_SIZE * 0.04);
        ctx.beginPath();
        ctx.moveTo(stamp.x - s, stamp.y);
        ctx.lineTo(stamp.x + s, stamp.y);
        ctx.moveTo(stamp.x, stamp.y - s);
        ctx.lineTo(stamp.x, stamp.y + s);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.restore?.();
    }
  }

  /**
   * Island 안쪽 테두리를 따라 장난감 블록 점선 스티치를 넣는다.
   * 통로와 맞닿은 면만 따라가므로 블록 실루엣이 그대로 살아난다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} island
   */
  _drawToyStitchTrim(ctx, island) {
    const palette = island.palette || WALL_PALETTES[0];
    const inset = TILE_SIZE * 0.18;
    const segments = [];

    for (const { row, col } of island.tiles) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const left = x + inset;
      const right = x + TILE_SIZE - inset;
      const top = y + inset;
      const bottom = y + TILE_SIZE - inset;

      if (!this._isWallTile(row - 1, col) && this._isInsideMap(row - 1, col)) {
        segments.push([left, top, right, top]);
      }
      if (!this._isWallTile(row + 1, col) && this._isInsideMap(row + 1, col)) {
        segments.push([left, bottom, right, bottom]);
      }
      if (!this._isWallTile(row, col - 1) && this._isInsideMap(row, col - 1)) {
        segments.push([left, top, left, bottom]);
      }
      if (!this._isWallTile(row, col + 1) && this._isInsideMap(row, col + 1)) {
        segments.push([right, top, right, bottom]);
      }
    }
    if (segments.length === 0) return;

    ctx.save?.();
    ctx.strokeStyle = palette.bevel || 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(0.8, TILE_SIZE * 0.05);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.5;

    const canDash = typeof ctx.setLineDash === 'function';
    if (canDash) ctx.setLineDash([TILE_SIZE * 0.14, TILE_SIZE * 0.13]);

    ctx.beginPath();
    for (const [x0, y0, x1, y1] of segments) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }

    if (canDash) {
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // 점선 미지원 스텁: 일정 간격 파스텔 도트로 대체
      const step = TILE_SIZE * 0.26;
      for (const [x0, y0, x1, y1] of segments) {
        const length = Math.hypot(x1 - x0, y1 - y0);
        const count = Math.max(1, Math.round(length / step));
        for (let i = 0; i <= count; i++) {
          const t = i / count;
          fillCircle(
            ctx,
            x0 + (x1 - x0) * t,
            y0 + (y1 - y0) * t,
            Math.max(0.7, TILE_SIZE * 0.035),
            palette.bevel || 'rgba(255, 255, 255, 0.55)',
          );
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore?.();
  }

  /**
   * 큰 벽 블록 중앙에 아기방 일러스트 + 낙서를 그린다.
   * - 내부 사각형의 75~85% 를 가로/세로로 채워 그림이 블록 비율에 맞게 들어간다.
   * - 파스텔 다색 + 눈/코/볼터치로 그려 벽지에 인쇄된 교구 그림처럼 보이게 한다.
   * - piece.alpha(0.55~0.72)에 0.68 을 곱해 화면 불투명도 0.37~0.49 로 낮춘다 (캐릭터/아이템 우선).
   * - 테두리는 none/deboss/emboss 3종을 시드로 섞고, 위에는 크레파스 낙서를 얹는다.
   * - 둥근 사각형은 arc/lineTo 경로로만 그리고, 면 채움도 path fill 로만 한다 (fillRect 계약 유지).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallIllustrations(ctx, islands = this._getWallIslands()) {
    for (const island of islands) {
      const pieces = Array.isArray(island.pieces) && island.pieces.length > 0
        ? island.pieces
        : (island.centerpiece ? [island.centerpiece] : []);
      if (pieces.length === 0) continue;

      const palette = island.palette || WALL_PALETTES[0];

      for (const piece of pieces) {
        if (!piece) continue;

        const rx = piece.rx || piece.radius || TILE_SIZE * 0.4;
        const ry = piece.ry || rx;
        const art = piece.variant || piece.kind;

        ctx.save?.();

        if (piece.rotation !== 0
          && typeof ctx.translate === 'function'
          && typeof ctx.rotate === 'function') {
          ctx.translate(piece.x, piece.y);
          ctx.rotate(piece.rotation);
          ctx.translate(-piece.x, -piece.y);
        }

        ctx.globalAlpha = piece.alpha * WALL_ART_RENDER_ALPHA;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // ① 테두리(스티커 판) 3종 — none 이면 블록 위에 그림을 그대로 끄적인다
        this._drawArtTexture(ctx, palette, piece);

        // ② 파스텔 그림 본체
        ctx.globalAlpha = piece.alpha * WALL_ART_RENDER_ALPHA;
        this._drawArtGlyph(ctx, art, piece.x, piece.y, rx, ry);

        // ③ 아기가 끄적인 낙서(소용돌이/집/해/별똥별/하트) + 삐뚤빼뚤 손그림 윤곽
        this._drawArtDoodles(ctx, piece);

        ctx.globalAlpha = 1;
        ctx.restore?.();
      }
    }
  }

  /**
   * 일러스트 variant → 그리기 함수 디스패치 (kind 는 기존 분류 메타데이터).
   * - 가로형(기차/애벌레/자동차/무지개), 세로형(로켓/기린/풍선/키 큰 꽃)은 rx/ry 를 모두 써서 박스를 꽉 채운다.
   * - 정사각/원형 계열(곰돌이/구름/병아리/꽃/햇님/종이배)은 짧은 변 기준 반지름으로 그린다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} variant
   * @param {number} x
   * @param {number} y
   * @param {number} rx
   * @param {number} ry
   */
  _drawArtGlyph(ctx, variant, x, y, rx, ry) {
    const r = Math.min(rx, ry);
    switch (variant) {
      case 'train': return this._drawArtTrain(ctx, x, y, rx, ry);
      case 'caterpillar': return this._drawArtWorm(ctx, x, y, rx, ry);
      case 'car': return this._drawArtCar(ctx, x, y, rx, ry);
      case 'rainbow': return this._drawArtRainbow(ctx, x, y, rx, ry);
      case 'rocket': return this._drawArtRocket(ctx, x, y, rx, ry);
      case 'giraffe': return this._drawArtGiraffe(ctx, x, y, rx, ry);
      case 'balloons': return this._drawArtBalloons(ctx, x, y, rx, ry);
      case 'tallFlower': return this._drawArtTallFlower(ctx, x, y, rx, ry);
      case 'bear': return this._drawArtBear(ctx, x, y, r);
      case 'cloud': return this._drawArtCloud(ctx, x, y, r);
      case 'duck': return this._drawArtDuck(ctx, x, y, r);
      case 'sun': return this._drawArtSun(ctx, x, y, r);
      case 'boat': return this._drawArtBoat(ctx, x, y, rx, ry);
      case 'flower': return this._drawArtFlower(ctx, x, y, r);
      default: return this._drawArtFlower(ctx, x, y, r);
    }
  }

  /**
   * 그림 테두리(스티커 판) 3종 — piece.frame 으로 고른다.
   * - none  : 테두리 없이 블록 위에 그림을 직접 끄적인다 (판/틀 없음)
   * - deboss: 좌상단 어두운 홈 + 우하단 은은한 크림 턱 → 꾹 눌려 파인 음각 틀
   * - emboss: 좌상단 은은한 크림 하이라이트 + 우하단 얕은 그림자 → 살짝 떠오른 양각 틀
   * - 크림 테두리는 알파 0.34 로 낮춰 시선을 과하게 끌지 않게 한다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} palette
   * @param {object} piece
   */
  _drawArtTexture(ctx, palette, piece) {
    const frame = piece.frame || piece.texture || 'none';
    if (frame !== 'deboss' && frame !== 'emboss') return;

    const dark = WALL_ART_FRAME_SHADE;
    const cream = WALL_ART_FRAME_CREAM;
    const pad = Math.min(piece.rx, piece.ry) * 0.05;
    const x = piece.x - piece.rx + pad;
    const y = piece.y - piece.ry + pad;
    const w = (piece.rx - pad) * 2;
    const h = (piece.ry - pad) * 2;
    const radius = Math.min(w, h) * 0.42;

    if (frame === 'deboss') {
      fillRoundBox(ctx, x - 1.2, y - 1.2, w, h, radius, dark);
      fillRoundBox(ctx, x + 1.2, y + 1.2, w, h, radius, cream);
      strokeRoundBox(ctx, x, y, w, h, radius, dark, 0.8);
      return;
    }

    fillRoundBox(ctx, x + 1.4, y + 1.4, w, h, radius, dark);
    fillRoundBox(ctx, x - 1.2, y - 1.2, w, h, radius, cream);
    strokeRoundBox(ctx, x, y, w, h, radius, cream, 0.8);
  }

  /**
   * 아기가 블록 위에 크레파스/연필로 끄적인 자유 낙서 레이어.
   * - 삐뚤빼뚤 손그림 윤곽선 + 소용돌이/손그림 집/웃는 해/별똥별/하트/별/물결/꽃 낙서 1~3개.
   * - bezierCurveTo / ellipse / scale / roundRect / fillRect 없이
   *   moveTo·lineTo·arc·quadraticCurveTo 만으로 그린다 (렌더 계약 유지).
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} piece
   */
  _drawArtDoodles(ctx, piece) {
    const rx = piece.rx || TILE_SIZE * 0.4;
    const ry = piece.ry || rx;
    const short = Math.min(rx, ry);
    const rng = createSeededRandom(
      piece.doodleSeed || (Math.floor(piece.x * 31 + piece.y * 17) || 7),
    );

    // ① 삐뚤빼뚤 손그림 윤곽선 — 그림이 블록 위에 직접 끄적인 느낌을 준다
    this._drawArtSketchOutline(ctx, piece, rng);

    // ② 낙서 모티프 1~3개
    const doodles = Array.isArray(piece.doodles) ? piece.doodles : [];
    for (const doodle of doodles) {
      if (!doodle || !doodle.motif) continue;

      const cx = piece.x + doodle.dx * rx;
      const cy = piece.y + doodle.dy * ry;
      const size = Math.max(TILE_SIZE * 0.18, short * doodle.scale);
      const ink = WALL_DOODLE_INKS[Math.floor(rng() * WALL_DOODLE_INKS.length)];
      const width = Math.max(0.6, size * 0.13);

      switch (doodle.motif) {
        case 'spiral': this._drawDoodleSpiral(ctx, cx, cy, size, ink, width); break;
        case 'house': this._drawDoodleHouse(ctx, cx, cy, size, ink, width); break;
        case 'sun': this._drawDoodleSun(ctx, cx, cy, size, ink, width); break;
        case 'starShower': this._drawDoodleStarShower(ctx, cx, cy, size, ink, width); break;
        case 'heart': this._drawDoodleHeart(ctx, cx, cy, size, ink, width); break;
        case 'star': this._drawDoodleStar(ctx, cx, cy, size, ink); break;
        case 'squiggle': this._drawDoodleSquiggle(ctx, cx, cy, size, ink, width); break;
        default: this._drawDoodleFlower(ctx, cx, cy, size, ink, width); break;
      }
    }
  }

  /**
   * 삐뚤빼뚤 손그림 윤곽선 — 그림 박스 네 변을 조금씩 밀어 곡선으로 잇는다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} piece
   * @param {() => number} rng
   */
  _drawArtSketchOutline(ctx, piece, rng) {
    const rx = (piece.rx || TILE_SIZE * 0.4) * 0.94;
    const ry = (piece.ry || rx) * 0.94;
    const short = Math.min(rx, ry);
    const jitter = Math.max(0.8, short * 0.08);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const points = corners.map(([sx, sy]) => [
      piece.x + sx * rx + (rng() - 0.5) * jitter,
      piece.y + sy * ry + (rng() - 0.5) * jitter,
    ]);

    ctx.strokeStyle = WALL_DOODLE_SKETCH;
    ctx.lineWidth = Math.max(0.55, short * 0.045);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 0; i < points.length; i++) {
      const from = points[i];
      const to = points[(i + 1) % points.length];
      const ctrlX = (from[0] + to[0]) / 2 + (rng() - 0.5) * jitter * 1.6;
      const ctrlY = (from[1] + to[1]) / 2 + (rng() - 0.5) * jitter * 1.6;
      ctx.quadraticCurveTo(ctrlX, ctrlY, to[0], to[1]);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /** 달팽이/회오리 소용돌이 낙서 (자유 곡선) */
  _drawDoodleSpiral(ctx, cx, cy, r, ink, width) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.beginPath();

    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI * 2 * 2.6;
      const radius = r * (0.1 + t * 0.9);
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius * 0.92;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /** 삐뚤빼뚤 손그림 집 — 기울어진 지붕/벽 + 문 + 창 + 굴뚝 연기 소용돌이 */
  _drawDoodleHouse(ctx, cx, cy, r, ink, width) {
    const w = r * 1.5;
    const h = r * 1.25;
    const baseY = cy + h * 0.42;

    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.5, baseY);
    ctx.lineTo(cx - w * 0.52, cy - h * 0.06);
    ctx.lineTo(cx - w * 0.06, cy - h * 0.62);
    ctx.lineTo(cx + w * 0.52, cy - h * 0.04);
    ctx.lineTo(cx + w * 0.48, baseY);
    ctx.closePath();
    ctx.stroke();

    // 삐뚤빼뚤 문 + 작은 창
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.18, baseY);
    ctx.lineTo(cx - w * 0.16, cy + h * 0.06);
    ctx.lineTo(cx + w * 0.08, cy + h * 0.09);
    ctx.lineTo(cx + w * 0.1, baseY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + w * 0.22, cy - h * 0.2);
    ctx.lineTo(cx + w * 0.4, cy - h * 0.24);
    ctx.stroke();

    // 굴뚝에서 피어오르는 연기 소용돌이
    this._drawDoodleSpiral(
      ctx, cx + w * 0.32, cy - h * 0.66, r * 0.26, ink, Math.max(0.5, width * 0.8),
    );
  }

  /** 웃는 해 낙서 — 동그란 얼굴 + 삐뚤빼뚤 광선 + 점눈/미소 */
  _drawDoodleSun(ctx, cx, cy, r, ink, width) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 7; i++) {
      const angle = (Math.PI * 2 * i) / 7 + 0.3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r * 0.66, cy + Math.sin(angle) * r * 0.66);
      ctx.lineTo(
        cx + Math.cos(angle + 0.1) * r * 0.98,
        cy + Math.sin(angle + 0.1) * r * 0.98,
      );
      ctx.stroke();
    }

    fillCircle(ctx, cx - r * 0.17, cy - r * 0.08, Math.max(0.5, r * 0.05), ink);
    fillCircle(ctx, cx + r * 0.17, cy - r * 0.08, Math.max(0.5, r * 0.05), ink);
    strokeArc(ctx, cx, cy + r * 0.04, r * 0.2, Math.PI * 0.15, Math.PI * 0.85, ink, width);
  }

  /** 별똥별 낙서 — 자유 곡선 꼬리 3줄 + 머리 별 + 잔별 */
  _drawDoodleStarShower(ctx, cx, cy, r, ink, width) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.95, cy + r * 0.7);
    ctx.quadraticCurveTo(cx - r * 0.2, cy + r * 0.2, cx + r * 0.55, cy - r * 0.42);
    ctx.moveTo(cx - r * 0.7, cy + r * 0.92);
    ctx.quadraticCurveTo(cx - r * 0.1, cy + r * 0.46, cx + r * 0.42, cy - r * 0.2);
    ctx.moveTo(cx - r * 1.0, cy + r * 0.42);
    ctx.quadraticCurveTo(cx - r * 0.4, cy + r * 0.02, cx + r * 0.2, cy - r * 0.62);
    ctx.stroke();

    this._drawDoodleStar(ctx, cx + r * 0.62, cy - r * 0.5, r * 0.3, ink);
    this._drawDoodleStar(ctx, cx - r * 0.55, cy - r * 0.55, r * 0.16, ink);
  }

  /** 손그림 별 — 꼭짓점 10개를 이어 채운다 */
  _drawDoodleStar(ctx, cx, cy, r, ink) {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? r : r * 0.44;
      const angle = -Math.PI / 2 + (Math.PI / 5) * i;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    fillPolygon(ctx, points, ink);
  }

  /** 낙서 하트 — 자유 곡선 4개로 두 볼과 아래 꼭짓점을 잇는다 */
  _drawDoodleHeart(ctx, cx, cy, r, ink, width) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.85);
    ctx.quadraticCurveTo(cx - r * 1.05, cy + r * 0.05, cx - r * 0.5, cy - r * 0.55);
    ctx.quadraticCurveTo(cx - r * 0.12, cy - r * 0.92, cx, cy - r * 0.38);
    ctx.quadraticCurveTo(cx + r * 0.12, cy - r * 0.92, cx + r * 0.5, cy - r * 0.55);
    ctx.quadraticCurveTo(cx + r * 1.05, cy + r * 0.05, cx, cy + r * 0.85);
    ctx.closePath();
    ctx.stroke();
  }

  /** 자유 곡선 물결 낙서 (S 자 두 번) */
  _drawDoodleSquiggle(ctx, cx, cy, r, ink, width) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.quadraticCurveTo(cx - r * 0.5, cy - r * 0.75, cx, cy);
    ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.75, cx + r, cy);
    ctx.stroke();
  }

  /** 꽃 낙서 — 삐뚤빼뚤 꽃잎 5장 + 가운데 소용돌이 */
  _drawDoodleFlower(ctx, cx, cy, r, ink, width) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(angle) * r * 0.46,
        cy + Math.sin(angle) * r * 0.46,
        r * 0.3, 0, Math.PI * 2,
      );
      ctx.stroke();
    }
    this._drawDoodleSpiral(ctx, cx, cy, r * 0.34, ink, Math.max(0.5, width * 0.9));
  }

  /** ① 웃는 곰돌이 얼굴 — 둥근 얼굴 + 귀 안쪽 포인트 + 점눈 + 코/미소 + 볼터치 */
  _drawArtBear(ctx, cx, cy, r) {
    const headR = r * 0.74;
    const headY = cy + r * 0.08;
    const earR = r * 0.28;

    fillCircle(ctx, cx - r * 0.54, cy - r * 0.5, earR, '#cf9d72');
    fillCircle(ctx, cx + r * 0.54, cy - r * 0.5, earR, '#cf9d72');
    fillCircle(ctx, cx - r * 0.54, cy - r * 0.5, earR * 0.5, '#f3bcc2');
    fillCircle(ctx, cx + r * 0.54, cy - r * 0.5, earR * 0.5, '#f3bcc2');

    fillCircle(ctx, cx, headY, headR, '#d8a97c');
    fillCircle(ctx, cx, headY + headR * 0.27, headR * 0.42, '#f8e5ca');

    fillCircle(ctx, cx - headR * 0.36, headY - headR * 0.14, r * 0.072, WALL_ART_INK);
    fillCircle(ctx, cx + headR * 0.36, headY - headR * 0.14, r * 0.072, WALL_ART_INK);
    fillCircle(ctx, cx - headR * 0.36 + r * 0.03, headY - headR * 0.2, r * 0.024, 'rgba(255, 255, 255, 0.95)');
    fillCircle(ctx, cx + headR * 0.36 + r * 0.03, headY - headR * 0.2, r * 0.024, 'rgba(255, 255, 255, 0.95)');

    fillCircle(ctx, cx, headY + headR * 0.05, r * 0.085, WALL_ART_INK);
    strokeArc(
      ctx, cx, headY + headR * 0.11, r * 0.14,
      Math.PI * 0.18, Math.PI * 0.82, WALL_ART_INK, r * 0.05,
    );

    fillCircle(ctx, cx - headR * 0.56, headY + headR * 0.24, r * 0.12, WALL_ART_BLUSH);
    fillCircle(ctx, cx + headR * 0.56, headY + headR * 0.24, r * 0.12, WALL_ART_BLUSH);
  }

  /** ② 웃는 뭉게구름 — 크림 구름 + 눈웃음/볼터치 + 아래쪽 파스텔 빗방울 2개 */
  _drawArtCloud(ctx, cx, cy, r) {
    const cream = '#fdf6e3';

    fillCircle(ctx, cx - r * 0.46, cy + r * 0.04, r * 0.4, cream);
    fillCircle(ctx, cx + r * 0.46, cy + r * 0.06, r * 0.38, cream);
    fillCircle(ctx, cx, cy - r * 0.18, r * 0.52, cream);
    fillCircle(ctx, cx - r * 0.08, cy + r * 0.26, r * 0.44, cream);
    fillCircle(ctx, cx + r * 0.16, cy + r * 0.24, r * 0.36, cream);

    fillCircle(ctx, cx - r * 0.2, cy + r * 0.36, r * 0.18, '#f2e5cf');
    fillCircle(ctx, cx + r * 0.24, cy + r * 0.32, r * 0.15, '#f2e5cf');

    strokeArc(ctx, cx - r * 0.2, cy - r * 0.02, r * 0.1, Math.PI, Math.PI * 2, WALL_ART_INK, r * 0.055);
    strokeArc(ctx, cx + r * 0.2, cy - r * 0.02, r * 0.1, Math.PI, Math.PI * 2, WALL_ART_INK, r * 0.055);

    fillCircle(ctx, cx - r * 0.42, cy + r * 0.1, r * 0.1, WALL_ART_BLUSH);
    fillCircle(ctx, cx + r * 0.42, cy + r * 0.1, r * 0.1, WALL_ART_BLUSH);
    strokeArc(ctx, cx, cy + r * 0.1, r * 0.1, Math.PI * 0.2, Math.PI * 0.8, WALL_ART_INK_SOFT, r * 0.04);

    fillRaindrop(ctx, cx - r * 0.3, cy + r * 0.78, r * 0.1, '#a9d8f0');
    fillRaindrop(ctx, cx + r * 0.32, cy + r * 0.88, r * 0.085, '#b9e3f5');
  }

  /** ③ 파스텔 무지개 — 넓게 나란한 3겹 아치 + 양 끝 작은 솜구름 2개 (가로 블록용) */
  _drawArtRainbow(ctx, cx, cy, rx, ry) {
    const baseY = cy + ry * 0.56;
    const halfW = rx * 0.8;
    const bands = [
      { lift: 1.0, color: '#f6c4d5' },
      { lift: 0.78, color: '#fbe3a6' },
      { lift: 0.56, color: '#bfe3cf' },
    ];

    for (const band of bands) {
      ctx.strokeStyle = band.color;
      ctx.lineWidth = Math.max(1, ry * 0.17);
      ctx.beginPath();
      ctx.moveTo(cx - halfW, baseY);
      ctx.quadraticCurveTo(cx, baseY - ry * 1.5 * band.lift, cx + halfW, baseY);
      ctx.stroke();
    }

    this._drawArtCloudPuff(ctx, cx - halfW, baseY, ry * 0.24);
    this._drawArtCloudPuff(ctx, cx + halfW, baseY, ry * 0.24);

    fillCircle(ctx, cx - halfW, baseY + ry * 0.02, ry * 0.08, WALL_ART_BLUSH);
    fillCircle(ctx, cx + halfW, baseY + ry * 0.02, ry * 0.08, WALL_ART_BLUSH);
  }

  /** 무지개 끝 솜구름 (작은 크림 구름 덩이) */
  _drawArtCloudPuff(ctx, cx, cy, r) {
    const cream = '#fdf6e3';
    fillCircle(ctx, cx - r * 0.62, cy + r * 0.18, r * 0.55, cream);
    fillCircle(ctx, cx + r * 0.62, cy + r * 0.18, r * 0.55, cream);
    fillCircle(ctx, cx, cy - r * 0.18, r * 0.72, cream);
    fillCircle(ctx, cx, cy + r * 0.34, r * 0.5, cream);
  }

  /** ④ 아기 오리/병아리 — 동그란 병아리 + 주황 부리 + 날개 + 점눈 */
  _drawArtDuck(ctx, cx, cy, r) {
    ctx.strokeStyle = '#ecc05f';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.12, cy - r * 0.62);
    ctx.lineTo(cx - r * 0.04, cy - r * 0.84);
    ctx.moveTo(cx + r * 0.08, cy - r * 0.64);
    ctx.lineTo(cx + r * 0.2, cy - r * 0.86);
    ctx.stroke();

    fillCircle(ctx, cx, cy + r * 0.04, r * 0.68, '#fbe6a2');
    fillCircle(ctx, cx, cy + r * 0.2, r * 0.5, '#f6d680');

    fillCircle(ctx, cx + r * 0.46, cy + r * 0.24, r * 0.26, '#f3c76c');
    strokeArc(
      ctx, cx + r * 0.47, cy + r * 0.26, r * 0.16,
      Math.PI * 0.15, Math.PI * 0.85, '#e0ad4f', r * 0.04,
    );

    fillCircle(ctx, cx - r * 0.2, cy - r * 0.08, r * 0.07, WALL_ART_INK);
    fillCircle(ctx, cx + r * 0.2, cy - r * 0.08, r * 0.07, WALL_ART_INK);
    fillCircle(ctx, cx - r * 0.17, cy - r * 0.12, r * 0.022, 'rgba(255, 255, 255, 0.95)');
    fillCircle(ctx, cx + r * 0.23, cy - r * 0.12, r * 0.022, 'rgba(255, 255, 255, 0.95)');

    ctx.fillStyle = '#f4a948';
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.3);
    ctx.lineTo(cx - r * 0.14, cy + r * 0.12);
    ctx.lineTo(cx + r * 0.14, cy + r * 0.12);
    ctx.closePath();
    ctx.fill();

    fillCircle(ctx, cx - r * 0.4, cy + r * 0.06, r * 0.1, WALL_ART_BLUSH);
    fillCircle(ctx, cx + r * 0.4, cy + r * 0.06, r * 0.1, WALL_ART_BLUSH);
  }

  /** ⑤ 파스텔 꽃 — 노란 꽃술 + 5장 파스텔 꽃잎 + 작은 연두 잎사귀 */
  _drawArtFlower(ctx, cx, cy, r) {
    ctx.strokeStyle = '#9ecf95';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.24);
    ctx.lineTo(cx, cy + r * 0.96);
    ctx.stroke();

    // 잎사귀: scale/ellipse 없이 작은 연두 원 두 개와 잎맥으로 표현한다
    fillCircle(ctx, cx + r * 0.18, cy + r * 0.66, r * 0.11, '#b6dda6');
    fillCircle(ctx, cx + r * 0.31, cy + r * 0.75, r * 0.095, '#a9d69a');
    ctx.strokeStyle = '#8ec27f';
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.06, cy + r * 0.61);
    ctx.lineTo(cx + r * 0.36, cy + r * 0.79);
    ctx.stroke();

    const petalColors = ['#f7c6d8', '#eed2f2', '#ffd6bc', '#f7c6d8', '#eed2f2'];
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
      const px = cx + Math.cos(angle) * r * 0.46;
      const py = cy + Math.sin(angle) * r * 0.46;
      fillCircle(ctx, px, py, r * 0.34, petalColors[i]);
    }

    fillCircle(ctx, cx, cy, r * 0.36, '#fbe08a');
    fillCircle(ctx, cx - r * 0.09, cy - r * 0.18, r * 0.026, '#e0b84f');
    fillCircle(ctx, cx + r * 0.11, cy - r * 0.16, r * 0.022, '#e0b84f');

    fillCircle(ctx, cx - r * 0.13, cy + r * 0.01, r * 0.035, WALL_ART_INK);
    fillCircle(ctx, cx + r * 0.13, cy + r * 0.01, r * 0.035, WALL_ART_INK);
    strokeArc(
      ctx, cx, cy + r * 0.08, r * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, r * 0.035,
    );
  }

  /** ⑥ 꼬마기차 — 레일 위 증기기관차 + 연기 + 바퀴 (가로 블록용) */
  _drawArtTrain(ctx, cx, cy, rx, ry) {
    const wheelY = cy + ry * 0.6;

    // 레일
    ctx.strokeStyle = '#c8a07a';
    ctx.lineWidth = Math.max(0.8, ry * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.98, wheelY + ry * 0.26);
    ctx.lineTo(cx + rx * 0.98, wheelY + ry * 0.26);
    ctx.stroke();

    // 연기 3덩이
    fillCircle(ctx, cx + rx * 0.34, cy - ry * 0.8, ry * 0.16, 'rgba(243, 246, 250, 0.9)');
    fillCircle(ctx, cx + rx * 0.5, cy - ry * 0.94, ry * 0.12, 'rgba(243, 246, 250, 0.82)');
    fillCircle(ctx, cx + rx * 0.17, cy - ry * 0.92, ry * 0.1, 'rgba(243, 246, 250, 0.76)');

    // 굴뚝
    fillRoundBox(ctx, cx + rx * 0.24, cy - ry * 0.74, rx * 0.14, ry * 0.36, ry * 0.05, '#96b7c9');

    // 운전석 + 보일러 몸통
    fillRoundBox(ctx, cx - rx * 0.8, cy - ry * 0.5, rx * 1.5, ry * 0.94, ry * 0.3, '#f2a7b3');
    fillRoundBox(ctx, cx + rx * 0.1, cy - ry * 0.26, rx * 0.72, ry * 0.66, ry * 0.28, '#f6b98f');

    // 운전석 창 + 기관사 얼굴
    fillCircle(ctx, cx - rx * 0.46, cy - ry * 0.02, ry * 0.26, '#e2f2fb');
    fillCircle(ctx, cx - rx * 0.51, cy - ry * 0.06, ry * 0.05, WALL_ART_INK);
    fillCircle(ctx, cx - rx * 0.37, cy - ry * 0.06, ry * 0.05, WALL_ART_INK);
    strokeArc(
      ctx, cx - rx * 0.44, cy + ry * 0.04, ry * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, ry * 0.035,
    );

    // 보일러 앞면 얼굴 + 전조등
    fillCircle(ctx, cx + rx * 0.74, cy - ry * 0.02, ry * 0.1, '#ffe6a8');
    fillCircle(ctx, cx + rx * 0.48, cy - ry * 0.06, ry * 0.05, WALL_ART_INK);
    fillCircle(ctx, cx + rx * 0.64, cy - ry * 0.06, ry * 0.05, WALL_ART_INK);
    strokeArc(
      ctx, cx + rx * 0.56, cy + ry * 0.04, ry * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, ry * 0.035,
    );

    // 바퀴 3개
    for (const [wx, wr] of [[-0.54, 0.24], [-0.14, 0.18], [0.44, 0.24]]) {
      fillCircle(ctx, cx + rx * wx, wheelY, ry * wr, '#7d8ea0');
      fillCircle(ctx, cx + rx * wx, wheelY, ry * wr * 0.45, '#e8f0f7');
    }

    // 앞 배기 그릴
    fillPolygon(ctx, [
      [cx + rx * 0.78, cy + ry * 0.36],
      [cx + rx * 0.98, cy + ry * 0.44],
      [cx + rx * 0.98, cy + ry * 0.16],
    ], '#e0a95f');
  }

  /** ⑦ 꿈틀이 애벌레 — 물결 몸통 마디 + 더듬이 + 얼굴 (가로 블록용) */
  _drawArtWorm(ctx, cx, cy, rx, ry) {
    const segments = 6;
    const colors = ['#c9e8ad', '#a8dbb0', '#bfe3a8', '#cbeaae', '#b0dfa6', '#d5f0bc'];
    const headX = cx + rx * 0.88;
    const headY = cy - Math.sin(Math.PI * 2.2) * ry * 0.2;

    // 꼬리 → 머리 순으로 겹쳐 그려 마디가 이어지게 한다
    for (let i = segments - 1; i >= 0; i--) {
      const t = i / (segments - 1);
      const px = cx - rx * 0.9 + rx * 1.78 * t;
      const py = cy - Math.sin(t * Math.PI * 2.2) * ry * 0.2;
      const radius = ry * (0.22 + 0.1 * t);
      fillCircle(ctx, px, py, radius, colors[i]);
      fillCircle(ctx, px - radius * 0.28, py - radius * 0.34, radius * 0.3, 'rgba(255, 255, 255, 0.5)');
    }

    // 더듬이 2개
    ctx.strokeStyle = '#8fbf7a';
    ctx.lineWidth = Math.max(0.7, ry * 0.05);
    ctx.beginPath();
    ctx.moveTo(headX - ry * 0.12, headY - ry * 0.24);
    ctx.quadraticCurveTo(headX - ry * 0.34, headY - ry * 0.6, headX - ry * 0.16, headY - ry * 0.8);
    ctx.moveTo(headX + ry * 0.1, headY - ry * 0.26);
    ctx.quadraticCurveTo(headX + ry * 0.3, headY - ry * 0.62, headX + ry * 0.12, headY - ry * 0.84);
    ctx.stroke();
    fillCircle(ctx, headX - ry * 0.16, headY - ry * 0.8, ry * 0.07, '#f7a8b8');
    fillCircle(ctx, headX + ry * 0.12, headY - ry * 0.84, ry * 0.07, '#f7a8b8');

    // 얼굴 + 볼터치
    fillCircle(ctx, headX - ry * 0.1, headY - ry * 0.08, ry * 0.06, WALL_ART_INK);
    fillCircle(ctx, headX + ry * 0.13, headY - ry * 0.08, ry * 0.06, WALL_ART_INK);
    strokeArc(
      ctx, headX, headY + ry * 0.06, ry * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, ry * 0.04,
    );
    fillCircle(ctx, headX - ry * 0.3, headY + ry * 0.08, ry * 0.075, WALL_ART_BLUSH);
    fillCircle(ctx, headX + ry * 0.32, headY + ry * 0.08, ry * 0.075, WALL_ART_BLUSH);
  }

  /** ⑧ 붕붕 자동차 — 지붕/창문/바퀴 + 헤드라이트 눈 (가로 블록용) */
  _drawArtCar(ctx, cx, cy, rx, ry) {
    const wheelY = cy + ry * 0.5;

    // 도로
    ctx.strokeStyle = '#cbb59b';
    ctx.lineWidth = Math.max(0.8, ry * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.95, wheelY + ry * 0.34);
    ctx.lineTo(cx + rx * 0.95, wheelY + ry * 0.34);
    ctx.stroke();

    // 지붕(캐빈) + 차체
    fillPolygon(ctx, [
      [cx - rx * 0.34, cy - ry * 0.12],
      [cx - rx * 0.14, cy - ry * 0.62],
      [cx + rx * 0.2, cy - ry * 0.62],
      [cx + rx * 0.42, cy - ry * 0.12],
    ], '#a9d4f2');
    fillRoundBox(ctx, cx - rx * 0.92, cy - ry * 0.16, rx * 1.84, ry * 0.62, ry * 0.24, '#f6c7a1');

    // 창문 2장
    fillPolygon(ctx, [
      [cx - rx * 0.26, cy - ry * 0.2],
      [cx - rx * 0.1, cy - ry * 0.54],
      [cx - rx * 0.01, cy - ry * 0.54],
      [cx - rx * 0.01, cy - ry * 0.2],
    ], '#e3f4ff');
    fillPolygon(ctx, [
      [cx + rx * 0.05, cy - ry * 0.2],
      [cx + rx * 0.05, cy - ry * 0.54],
      [cx + rx * 0.16, cy - ry * 0.54],
      [cx + rx * 0.3, cy - ry * 0.2],
    ], '#e3f4ff');

    // 바퀴
    for (const wx of [-0.56, 0.56]) {
      fillCircle(ctx, cx + rx * wx, wheelY, ry * 0.26, '#6f8090');
      fillCircle(ctx, cx + rx * wx, wheelY, ry * 0.11, '#eef4fa');
    }

    // 헤드라이트 + 얼굴
    fillCircle(ctx, cx - rx * 0.82, cy + ry * 0.04, ry * 0.07, '#fff3c4');
    fillCircle(ctx, cx + rx * 0.82, cy + ry * 0.04, ry * 0.07, '#fff3c4');
    fillCircle(ctx, cx - rx * 0.06, cy + ry * 0.1, ry * 0.05, WALL_ART_INK);
    fillCircle(ctx, cx + rx * 0.14, cy + ry * 0.1, ry * 0.05, WALL_ART_INK);
    strokeArc(
      ctx, cx + rx * 0.04, cy + ry * 0.2, ry * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, ry * 0.035,
    );
    fillCircle(ctx, cx - rx * 0.24, cy + ry * 0.16, ry * 0.075, WALL_ART_BLUSH);
    fillCircle(ctx, cx + rx * 0.32, cy + ry * 0.16, ry * 0.075, WALL_ART_BLUSH);
  }

  /** ⑨ 우뚝 선 로켓 — 뾰족 노즈 + 창문 + 좌우 날개 + 불꽃 (세로 블록용) */
  _drawArtRocket(ctx, cx, cy, rx, ry) {
    const bodyW = rx * 0.7;
    const noseY = cy - ry * 0.74;
    const bodyTop = cy - ry * 0.5;
    const bodyBottom = cy + ry * 0.34;

    // 불꽃
    fillPolygon(ctx, [
      [cx - bodyW * 0.45, bodyBottom - ry * 0.02],
      [cx, cy + ry * 0.98],
      [cx + bodyW * 0.45, bodyBottom - ry * 0.02],
    ], '#f9b46b');
    fillPolygon(ctx, [
      [cx - bodyW * 0.24, bodyBottom - ry * 0.02],
      [cx, cy + ry * 0.76],
      [cx + bodyW * 0.24, bodyBottom - ry * 0.02],
    ], '#fde08a');

    // 좌우 날개
    fillPolygon(ctx, [
      [cx - bodyW * 0.46, cy + ry * 0.02],
      [cx - rx * 0.94, cy + ry * 0.36],
      [cx - bodyW * 0.46, bodyBottom],
    ], '#ef8fa4');
    fillPolygon(ctx, [
      [cx + bodyW * 0.46, cy + ry * 0.02],
      [cx + rx * 0.94, cy + ry * 0.36],
      [cx + bodyW * 0.46, bodyBottom],
    ], '#ef8fa4');

    // 몸통 + 노즈콘
    fillRoundBox(
      ctx, cx - bodyW / 2, bodyTop, bodyW,
      bodyBottom - bodyTop, bodyW * 0.34, '#cfe6f7',
    );
    fillPolygon(ctx, [
      [cx - bodyW / 2, bodyTop + bodyW * 0.14],
      [cx, noseY],
      [cx + bodyW / 2, bodyTop + bodyW * 0.14],
    ], '#f6a8b8');

    // 창문
    fillCircle(ctx, cx, cy - ry * 0.26, bodyW * 0.3, '#8fd0ef');
    fillCircle(ctx, cx, cy - ry * 0.26, bodyW * 0.2, '#dff4ff');

    // 얼굴 + 볼터치
    fillCircle(ctx, cx - bodyW * 0.16, cy + ry * 0.04, bodyW * 0.05, WALL_ART_INK);
    fillCircle(ctx, cx + bodyW * 0.16, cy + ry * 0.04, bodyW * 0.05, WALL_ART_INK);
    strokeArc(
      ctx, cx, cy + ry * 0.12, bodyW * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, bodyW * 0.04,
    );
    fillCircle(ctx, cx - bodyW * 0.3, cy + ry * 0.08, bodyW * 0.075, WALL_ART_BLUSH);
    fillCircle(ctx, cx + bodyW * 0.3, cy + ry * 0.08, bodyW * 0.075, WALL_ART_BLUSH);

    // 별가루
    fillCircle(ctx, cx - rx * 0.72, cy - ry * 0.62, rx * 0.06, '#cbe6ff');
    fillCircle(ctx, cx + rx * 0.74, cy - ry * 0.34, rx * 0.05, '#cbe6ff');
    fillCircle(ctx, cx + rx * 0.56, cy + ry * 0.66, rx * 0.055, '#ffd9e2');
  }

  /** ⑩ 롱다리 기린 — 긴 목 + 반점 + 오시콘 (세로 블록용) */
  _drawArtGiraffe(ctx, cx, cy, rx, ry) {
    const bodyW = rx * 1.5;
    const bodyY = cy + ry * 0.44;
    const legTop = bodyY + bodyW * 0.16;

    // 다리 4개
    ctx.strokeStyle = '#e0b06a';
    ctx.lineWidth = Math.max(1, rx * 0.13);
    for (const lx of [-0.34, -0.16, 0.12, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(cx + bodyW * lx, legTop);
      ctx.lineTo(cx + bodyW * lx, cy + ry * 0.94);
      ctx.stroke();
    }

    // 몸통
    fillRoundBox(
      ctx, cx - bodyW * 0.5, bodyY - bodyW * 0.28,
      bodyW, bodyW * 0.6, bodyW * 0.3, '#f2c983',
    );

    // 목
    const neckX = cx + bodyW * 0.08;
    fillRoundBox(
      ctx, neckX - rx * 0.2, cy - ry * 0.56,
      rx * 0.4, ry * 0.94, rx * 0.2, '#f6d79b',
    );

    // 머리 + 주둥이
    fillCircle(ctx, neckX + rx * 0.14, cy - ry * 0.64, rx * 0.3, '#f6d79b');
    fillCircle(ctx, neckX + rx * 0.4, cy - ry * 0.56, rx * 0.16, '#f9e3b4');

    // 오시콘(뿔) 2개
    ctx.strokeStyle = '#d99a52';
    ctx.lineWidth = Math.max(0.8, rx * 0.07);
    ctx.beginPath();
    ctx.moveTo(neckX + rx * 0.02, cy - ry * 0.86);
    ctx.lineTo(neckX, cy - ry * 0.96);
    ctx.moveTo(neckX + rx * 0.2, cy - ry * 0.88);
    ctx.lineTo(neckX + rx * 0.18, cy - ry * 0.98);
    ctx.stroke();
    fillCircle(ctx, neckX, cy - ry * 0.97, rx * 0.06, '#c9873f');
    fillCircle(ctx, neckX + rx * 0.18, cy - ry * 0.99, rx * 0.06, '#c9873f');

    // 반점
    fillCircle(ctx, cx - bodyW * 0.26, bodyY - bodyW * 0.1, bodyW * 0.1, '#e3a85f');
    fillCircle(ctx, cx - bodyW * 0.02, bodyY + bodyW * 0.06, bodyW * 0.09, '#e3a85f');
    fillCircle(ctx, cx + bodyW * 0.24, bodyY - bodyW * 0.08, bodyW * 0.085, '#e3a85f');
    fillCircle(ctx, neckX - rx * 0.06, cy - ry * 0.24, rx * 0.08, '#e3a85f');
    fillCircle(ctx, neckX - rx * 0.02, cy - ry * 0.02, rx * 0.075, '#e3a85f');

    // 얼굴
    fillCircle(ctx, neckX + rx * 0.22, cy - ry * 0.68, rx * 0.045, WALL_ART_INK);
    fillCircle(ctx, neckX + rx * 0.44, cy - ry * 0.6, rx * 0.03, WALL_ART_INK);
    fillCircle(ctx, neckX + rx * 0.04, cy - ry * 0.6, rx * 0.07, WALL_ART_BLUSH);
  }

  /** ⑪ 줄 달린 풍선 다발 — 위로 몰린 5개 풍선 + 매듭으로 모이는 줄 (세로 블록용) */
  _drawArtBalloons(ctx, cx, cy, rx, ry) {
    const knotX = cx + rx * 0.06;
    const knotY = cy + ry * 0.9;
    const balloons = [
      { dx: -0.34, dy: -0.3, r: 0.3, color: '#f7a8b8' },
      { dx: 0.26, dy: -0.42, r: 0.26, color: '#a9d4f2' },
      { dx: -0.06, dy: -0.7, r: 0.32, color: '#fbe08a' },
      { dx: 0.46, dy: -0.08, r: 0.22, color: '#bfe3cf' },
      { dx: -0.5, dy: -0.02, r: 0.24, color: '#e3c8f0' },
    ];

    // 줄을 먼저 그어 풍선 뒤로 지나가게 한다
    ctx.strokeStyle = 'rgba(140, 120, 100, 0.72)';
    ctx.lineWidth = Math.max(0.6, rx * 0.04);
    ctx.beginPath();
    for (const b of balloons) {
      ctx.moveTo(cx + rx * b.dx, cy + ry * b.dy + rx * b.r * 0.86);
      ctx.quadraticCurveTo(
        cx + rx * b.dx * 0.5, cy + ry * (b.dy + 0.6) + rx * b.r,
        knotX, knotY,
      );
    }
    ctx.stroke();

    // 풍선 + 광택
    for (const b of balloons) {
      const bx = cx + rx * b.dx;
      const by = cy + ry * b.dy;
      fillCircle(ctx, bx, by, rx * b.r, b.color);
      fillCircle(
        ctx, bx - rx * b.r * 0.32, by - rx * b.r * 0.34,
        rx * b.r * 0.22, 'rgba(255, 255, 255, 0.62)',
      );
    }

    // 매듭 + 리본
    fillCircle(ctx, knotX, knotY, rx * 0.1, '#f0c98a');
    fillPolygon(ctx, [
      [knotX, knotY + rx * 0.02],
      [knotX - rx * 0.22, knotY + rx * 0.3],
      [knotX + rx * 0.05, knotY + rx * 0.24],
    ], '#f7a8b8');

    // 가운데 큰 풍선 얼굴
    fillCircle(ctx, cx - rx * 0.13, cy - ry * 0.76, rx * 0.045, WALL_ART_INK);
    fillCircle(ctx, cx + rx * 0.04, cy - ry * 0.76, rx * 0.045, WALL_ART_INK);
    strokeArc(
      ctx, cx - rx * 0.05, cy - ry * 0.69, rx * 0.09,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, rx * 0.032,
    );
  }

  /** ⑫ 키 큰 꽃 — 긴 줄기 + 잎 2장 + 위쪽 꽃송이 (세로 블록용) */
  _drawArtTallFlower(ctx, cx, cy, rx, ry) {
    const bloom = Math.min(rx * 0.88, ry * 0.3);
    const bloomY = cy - ry * 0.44;

    // 줄기 (살짝 S 자)
    ctx.strokeStyle = '#8fc486';
    ctx.lineWidth = Math.max(1, bloom * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx, cy + ry * 0.96);
    ctx.quadraticCurveTo(cx - rx * 0.3, cy + ry * 0.26, cx, bloomY + bloom * 0.4);
    ctx.stroke();

    // 잎 2장
    fillPolygon(ctx, [
      [cx - rx * 0.04, cy + ry * 0.6],
      [cx - rx * 0.8, cy + ry * 0.34],
      [cx - rx * 0.2, cy + ry * 0.86],
    ], '#b6dda6');
    fillPolygon(ctx, [
      [cx + rx * 0.04, cy + ry * 0.36],
      [cx + rx * 0.78, cy + ry * 0.14],
      [cx + rx * 0.16, cy + ry * 0.6],
    ], '#a9d69a');

    // 꽃잎 6장 + 꽃술
    const petalColors = ['#f7c6d8', '#eed2f2', '#ffd6bc', '#f7c6d8', '#eed2f2', '#ffd6bc'];
    for (let i = 0; i < 6; i++) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
      fillCircle(
        ctx,
        cx + Math.cos(angle) * bloom * 0.44,
        bloomY + Math.sin(angle) * bloom * 0.44,
        bloom * 0.34, petalColors[i],
      );
    }
    fillCircle(ctx, cx, bloomY, bloom * 0.36, '#fbe08a');
    fillCircle(ctx, cx - bloom * 0.1, bloomY - bloom * 0.14, bloom * 0.03, '#e0b84f');
    fillCircle(ctx, cx + bloom * 0.12, bloomY - bloom * 0.1, bloom * 0.025, '#e0b84f');

    // 얼굴
    fillCircle(ctx, cx - bloom * 0.1, bloomY + bloom * 0.04, bloom * 0.04, WALL_ART_INK);
    fillCircle(ctx, cx + bloom * 0.11, bloomY + bloom * 0.04, bloom * 0.04, WALL_ART_INK);
    strokeArc(
      ctx, cx, bloomY + bloom * 0.12, bloom * 0.09,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, bloom * 0.032,
    );
  }

  /** ⑬ 웃는 햇님 — 8방향 광선 + 노란 얼굴 + 점눈/미소/볼터치 (정사각 블록용) */
  _drawArtSun(ctx, cx, cy, r) {
    // 광선 8개
    ctx.strokeStyle = '#f7c96b';
    ctx.lineWidth = Math.max(1, r * 0.09);
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Math.PI / 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r * 0.74, cy + Math.sin(angle) * r * 0.74);
      ctx.lineTo(cx + Math.cos(angle) * r * 0.98, cy + Math.sin(angle) * r * 0.98);
      ctx.stroke();
    }

    fillCircle(ctx, cx, cy, r * 0.68, '#f9c85f');
    fillCircle(ctx, cx, cy - r * 0.16, r * 0.44, '#fbe08a');

    fillCircle(ctx, cx - r * 0.22, cy - r * 0.04, r * 0.06, WALL_ART_INK);
    fillCircle(ctx, cx + r * 0.22, cy - r * 0.04, r * 0.06, WALL_ART_INK);
    fillCircle(ctx, cx - r * 0.2, cy - r * 0.09, r * 0.022, 'rgba(255, 255, 255, 0.95)');
    fillCircle(ctx, cx + r * 0.24, cy - r * 0.09, r * 0.022, 'rgba(255, 255, 255, 0.95)');
    strokeArc(
      ctx, cx, cy + r * 0.08, r * 0.14,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK, r * 0.045,
    );
    fillCircle(ctx, cx - r * 0.38, cy + r * 0.14, r * 0.1, WALL_ART_BLUSH);
    fillCircle(ctx, cx + r * 0.38, cy + r * 0.14, r * 0.1, WALL_ART_BLUSH);
  }

  /** ⑭ 종이배 — 두 장 돛 + 깃대 + 접힌 종이 몸통 + 물결 (정사각 블록용) */
  _drawArtBoat(ctx, cx, cy, rx, ry) {
    // 물결 2줄
    ctx.strokeStyle = 'rgba(150, 205, 235, 0.92)';
    ctx.lineWidth = Math.max(0.8, ry * 0.07);
    for (let i = 0; i < 2; i++) {
      const wy = cy + ry * (0.6 + i * 0.24);
      const amp = ry * 0.09;
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.92, wy);
      ctx.quadraticCurveTo(cx - rx * 0.5, wy - amp, cx - rx * 0.12, wy);
      ctx.quadraticCurveTo(cx + rx * 0.3, wy + amp, cx + rx * 0.92, wy);
      ctx.stroke();
    }

    // 돛 2장
    fillPolygon(ctx, [
      [cx - rx * 0.03, cy - ry * 0.86],
      [cx - rx * 0.03, cy + ry * 0.16],
      [cx - rx * 0.58, cy + ry * 0.16],
    ], '#fdf6e3');
    fillPolygon(ctx, [
      [cx + rx * 0.04, cy - ry * 0.72],
      [cx + rx * 0.04, cy + ry * 0.16],
      [cx + rx * 0.5, cy + ry * 0.16],
    ], '#fbe3a6');

    // 깃대
    ctx.strokeStyle = '#b98f63';
    ctx.lineWidth = Math.max(1, rx * 0.045);
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry * 0.92);
    ctx.lineTo(cx, cy + ry * 0.2);
    ctx.stroke();

    // 종이 몸통
    fillPolygon(ctx, [
      [cx - rx * 0.86, cy + ry * 0.14],
      [cx + rx * 0.86, cy + ry * 0.14],
      [cx + rx * 0.46, cy + ry * 0.48],
      [cx - rx * 0.46, cy + ry * 0.48],
    ], '#eaf6ff');
    fillPolygon(ctx, [
      [cx - rx * 0.7, cy + ry * 0.18],
      [cx + rx * 0.7, cy + ry * 0.18],
      [cx + rx * 0.44, cy + ry * 0.42],
      [cx - rx * 0.44, cy + ry * 0.42],
    ], '#cfe9f8');

    // 배 앞면 얼굴
    fillCircle(ctx, cx - rx * 0.16, cy + ry * 0.28, ry * 0.055, WALL_ART_INK);
    fillCircle(ctx, cx + rx * 0.16, cy + ry * 0.28, ry * 0.055, WALL_ART_INK);
    strokeArc(
      ctx, cx, cy + ry * 0.34, ry * 0.1,
      Math.PI * 0.15, Math.PI * 0.85, WALL_ART_INK_SOFT, ry * 0.035,
    );
    fillCircle(ctx, cx - rx * 0.36, cy + ry * 0.3, ry * 0.075, WALL_ART_BLUSH);
    fillCircle(ctx, cx + rx * 0.36, cy + ry * 0.3, ry * 0.075, WALL_ART_BLUSH);
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

        // 블록 덩어리의 바깥으로 노출된 볼록 모서리만 라운드한다.
        // - 왼쪽/오른쪽 타일이 벽이면 안쪽 계단 모서리이므로 그대로 각지게 남긴다.
        const roundLeft = !this._isWallTile(row, start - 1) ? WALL_CORNER_RADIUS : 0;
        const roundRight = !this._isWallTile(row, end + 1) ? WALL_CORNER_RADIUS : 0;

        const face = safeLinearGradient(ctx, 0, baseY, 0, bottomY, [
          [0, palette.frontTop],
          [0.55, palette.frontMid],
          [1, palette.frontBottom],
        ]) || palette.frontMid;

        // 앞벽 + 베벨 + 좌우 음영 + 1px 구분선을 모두 같은 라운드 실루엣으로 자른다.
        // → 레이어마다 모서리가 따로 놀지 않고 한 덩어리로 둥글게 마감된다.
        ctx.save?.();
        runBoxPath(ctx, runX, baseY, runW, WALL_DEPTH, roundLeft, roundRight);
        ctx.clip?.();

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

        ctx.restore?.();

        // ③ 앞벽 밑면 바로 아래로 짧게 떨어지는 드롭 섀도우
        //   - 앞벽 하단 라운드와 같은 반경으로 모서리를 다듬어 어긋남을 없앤다.
        const shadowRadius = Math.min(WALL_CORNER_RADIUS, WALL_SHADOW_DEPTH / 2);
        const shadow = safeLinearGradient(ctx, 0, bottomY, 0, bottomY + WALL_SHADOW_DEPTH, [
          [0, 'rgba(0, 0, 0, 0.5)'],
          [0.5, 'rgba(0, 0, 0, 0.2)'],
          [1, 'rgba(0, 0, 0, 0)'],
        ]) || 'rgba(0, 0, 0, 0.24)';

        ctx.fillStyle = shadow;
        shadowRunPath(
          ctx,
          runX,
          bottomY,
          runW,
          WALL_SHADOW_DEPTH,
          roundLeft > 0 ? shadowRadius : 0,
          roundRight > 0 ? shadowRadius : 0,
        );
        ctx.fill();
      },
    );
  }

  /** 벽 타일 여부 (범위 밖은 벽으로 취급하지 않는다) */
  _isWallTile(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS && this.map[row][col] === 1;
  }

  /** 맵 안쪽 좌표 여부 (맵 바깥 경계에는 스티치를 넣지 않는다) */
  _isInsideMap(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
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

  /**
   * 벽 Island 의 바깥으로 노출된 볼록 모서리만 둥글게 다듬는다.
   * - 타일마다 모서리를 깎으면 인접 타일 사이에 안쪽 틈새가 생기므로,
   *   위 + 옆이 동시에 뚫린 ㄱ자 모서리에서만 노치를 만든다.
   * - 노치는 바깥 바닥색으로 채워 윗면/톤 다운/광택/직선 림을 한 번에 정리하고,
   *   같은 반경의 파스텔 림 아크를 다시 그려 하이라이트가 끊기지 않게 한다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<object>} islands
   */
  _drawWallCorners(ctx, islands = this._getWallIslands()) {
    // shadowBlur 는 CTM 의 영향을 받지 않으므로 DPR 만큼 키워 논리 크기를 유지한다
    const blurScale = this.pixelRatio > 0 ? this.pixelRatio : 1;

    for (const island of islands) {
      const palette = island.palette || WALL_PALETTES[0];

      for (const { row, col } of island.tiles) {
        if (this._isWallTile(row - 1, col)) continue; // 위가 막혀 있으면 볼록 모서리가 아니다

        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        if (!this._isWallTile(row, col - 1)) {
          this._trimTopCorner(ctx, x, y, 'tl', row, col);
          this._strokeCornerRim(ctx, x, y, 'tl', palette, blurScale);
        }
        if (!this._isWallTile(row, col + 1)) {
          this._trimTopCorner(ctx, x + TILE_SIZE, y, 'tr', row, col);
          this._strokeCornerRim(ctx, x + TILE_SIZE, y, 'tr', palette, blurScale);
        }
      }
    }
  }

  /**
   * 윗면 바깥 볼록 모서리의 각진 부분을 바깥 바닥색으로 덮어 라운드 실루엣을 만든다.
   * - 인접 타일 겹침(0.6px)까지 함께 덮어 작은 사각 턱이 남지 않게 한다.
   * - fillRect 를 추가하지 않고 path fill 만 사용한다 (캐시 렌더 계약 유지).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x 모서리 x (타일 경계)
   * @param {number} y 모서리 y (타일 경계)
   * @param {'tl'|'tr'} corner
   * @param {number} row
   * @param {number} col
   */
  _trimTopCorner(ctx, x, y, corner, row, col) {
    const color = this._cornerFloorColor(row, col, corner);
    if (!color) return;

    const radius = WALL_CORNER_RADIUS;
    const bleed = WALL_SEAM_OVERLAP;
    const arcRadius = radius + bleed;

    ctx.fillStyle = color;
    ctx.beginPath();

    if (corner === 'tl') {
      const cx = x + radius;
      const cy = y + radius;
      ctx.moveTo(x - bleed, y - bleed);
      ctx.lineTo(cx, y - bleed);
      ctx.arc(cx, cy, arcRadius, -Math.PI / 2, Math.PI, true);
    } else {
      const cx = x - radius;
      const cy = y + radius;
      ctx.moveTo(x + bleed, y - bleed);
      ctx.lineTo(cx, y - bleed);
      ctx.arc(cx, cy, arcRadius, -Math.PI / 2, 0, false);
    }

    ctx.closePath();
    ctx.fill();
  }

  /** 둥글게 깎은 모서리를 따라 파스텔 림 아크를 다시 그린다 */
  _strokeCornerRim(ctx, x, y, corner, palette, blurScale = 1) {
    const radius = WALL_CORNER_RADIUS;

    ctx.save?.();
    ctx.lineCap = 'round';
    ctx.strokeStyle = palette.rim;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = palette.rimGlow;
    ctx.shadowBlur = Math.max(3, TILE_SIZE * 0.26) * blurScale;

    ctx.beginPath();
    if (corner === 'tl') {
      ctx.arc(x + radius, y + radius, radius, -Math.PI / 2, Math.PI, true);
    } else {
      ctx.arc(x - radius, y + radius, radius, -Math.PI / 2, 0, false);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore?.();
  }

  /**
   * 모서리 바깥(위/옆 타일)의 바닥색.
   * - 두 이웃이 같은 색이면 그 색을 그대로 쓰고, 다르면 체크 패턴 바닥색으로 폴백한다.
   * @param {number} row
   * @param {number} col
   * @param {'tl'|'tr'} corner
   * @returns {string|null}
   */
  _cornerFloorColor(row, col, corner) {
    const north = this._floorBaseColor(row - 1, col);
    const side = this._floorBaseColor(row, corner === 'tl' ? col - 1 : col + 1);
    if (north && side) return north === side ? north : this._plainFloorColor(row, col);
    return north || side || this._plainFloorColor(row, col);
  }

  /** 벽이 아닌 타일의 기본 바닥색 (빈 바닥/아이템 패드/침대/스폰) */
  _floorBaseColor(row, col) {
    if (!this._isInsideMap(row, col)) return null;

    const tile = this.map[row][col];
    if (tile === 1) return null;
    if (tile === 4) return COLORS.ITEM_SPOT;
    if (tile === 2 || tile === 3) return COLORS.FLOOR;
    return this._plainFloorColor(row, col);
  }

  /**
   * 체크 패턴 바닥색.
   * - 벽 타일 좌표로 호출하면 인접 바닥 타일과 같은 톤이 되도록 한 단계 반대 색을 돌려준다.
   */
  _plainFloorColor(row, col) {
    return (row + col) % 2 === 0 ? COLORS.FLOOR_ALT : COLORS.FLOOR;
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