/**
 * Pac-Baby: 보모(악당) 클래스
 */

import {
  COLS, TILE_SIZE, COLORS, ENEMY_TILE_MS,
  PATROL_SAFE_DISTANCE, isWalkableTile, randomWalkableTile,
} from './constants.js';

/** 악당 행동 모드 */
export const ENEMY_MODE = {
  CHASE: 'CHASE',   // 베이비를 쫓는다
  PATROL: 'PATROL', // 경비: 미로를 돌아다닌다
  FLEE: 'FLEE',     // 황금 젖병 보행기 모드: 겁에 질려 도망친다
};

/**
 * 황금 보행기 넉백 연출: 맞은 지점에서 스폰 지점까지 포물선으로 날아가는 시간(ms).
 * - 논리 위치(row/col)는 즉시 스폰으로 복귀하지만, 이 연출이 끝날 때까지
 *   화면에서는 보모가 빙글빙글 돌며 아치를 그리며 날아간다.
 */
export const KNOCK_FLIGHT_MS = 650;

/** 비행 꼬리(별가루) 발사 간격(ms) — 매 프레임 쏘면 너무 많아진다 */
const KNOCK_TRAIL_INTERVAL_MS = 26;

/** 포물선 최고 높이(타일 단위, 거리에 따라 보간) */
const KNOCK_ARC_MIN_TILES = 1.2;
const KNOCK_ARC_MAX_TILES = 3.2;

/** 비행 총 회전량(바퀴 수) — 정점 전후로 빠르게 빙글빙글 돈다 */
const KNOCK_FLIGHT_SPINS = 2.6;

/** 포물선 정점에서의 몸집 확대 (원근감) — 1 + 0.4 = 1.4배 */
const KNOCK_APEX_SCALE = 0.4;

/** '#rrggbb' 두 색을 t(0~1) 비율로 섞는다 */
function mixHexColor(from, to, t) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const a = parse(from);
  const b = parse(to);
  const k = Math.min(1, Math.max(0, t));
  const mix = (index) => Math.round(a[index] + (b[index] - a[index]) * k);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** quadraticCurveTo 가 없는 최소 ctx 스텁에서는 직선으로 근사한다 */
function enemyCurve(ctx, cpx, cpy, x, y) {
  if (typeof ctx.quadraticCurveTo === 'function') ctx.quadraticCurveTo(cpx, cpy, x, y);
  else ctx.lineTo(x, y);
}

/** 탐색 시 사용할 4방향 오프셋 */
const NEIGHBOR_OFFSETS = [
  { row: -1, col: 0, dir: 'UP' },
  { row: 1, col: 0, dir: 'DOWN' },
  { row: 0, col: -1, dir: 'LEFT' },
  { row: 0, col: 1, dir: 'RIGHT' },
];

/**
 * BFS 로 시작 타일에서 목표 타일까지 가는 "첫 한 칸"을 찾는다.
 * @param {number[][]} map
 * @param {number} startRow
 * @param {number} startCol
 * @param {number} goalRow
 * @param {number} goalCol
 * @param {number} orderOffset 탐색 우선순위 회전값 (악당마다 다르게 → 한 곳에 겹치는 현상 완화)
 * @returns {{row: number, col: number} | null}
 */
export function findNextStep(map, startRow, startCol, goalRow, goalCol, orderOffset = 0) {
  if (startRow === goalRow && startCol === goalCol) return null;

  const visited = new Set([`${startRow},${startCol}`]);
  const queue = [{ row: startRow, col: startCol, firstRow: -1, firstCol: -1 }];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const offset = orderOffset % NEIGHBOR_OFFSETS.length;

    for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
      const delta = NEIGHBOR_OFFSETS[(i + offset) % NEIGHBOR_OFFSETS.length];

      let row = current.row + delta.row;
      let col = current.col + delta.col;

      // 좌우 터널 통과
      if (col < 0) col = COLS - 1;
      if (col >= COLS) col = 0;

      if (!isWalkableTile(map, row, col)) continue;

      const key = `${row},${col}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const firstRow = current.firstRow === -1 ? row : current.firstRow;
      const firstCol = current.firstCol === -1 ? col : current.firstCol;

      if (row === goalRow && col === goalCol) {
        return { row: firstRow, col: firstCol };
      }

      queue.push({ row, col, firstRow, firstCol });
    }
  }

  return null; // 도달 불가
}

/**
 * 3x3 구역으로 나눴을 때의 구역 크기.
 * 28타일 기준 10/10/8 로 나뉜다.
 */
function zoneSize(length) {
  return Math.ceil(length / 3);
}

/** 중앙(2행 2열) 구역인지 */
export function isCenterSpawnZone(row, col, rows, cols) {
  const rowSize = zoneSize(rows);
  const colSize = zoneSize(cols);
  return Math.floor(row / rowSize) === 1 && Math.floor(col / colSize) === 1;
}

/** Fisher-Yates 셔플 (rng 주입 가능) */
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * 악당 스폰 위치를 3x3 구역의 중앙을 제외한 8개 구역에서 고른다.
 * - 벽이 아닌 일반 바닥(0)만 사용
 * - 서로 같은 타일 금지 + 맨해튼 거리 2 이상
 * - 구역을 섞어 최대한 여러 구역에 분산
 *
 * @param {number[][]} map
 * @param {number} count
 * @param {() => number} rng
 * @returns {Array<{row: number, col: number}>}
 */
export function createEnemySpawnPlan(map, count, rng = Math.random) {
  const rows = map?.length || 0;
  const cols = map?.[0]?.length || 0;
  if (rows === 0 || cols === 0 || count <= 0) return [];

  const rowSize = zoneSize(rows);
  const colSize = zoneSize(cols);
  const zones = [];

  for (let zoneRow = 0; zoneRow < 3; zoneRow++) {
    for (let zoneCol = 0; zoneCol < 3; zoneCol++) {
      // 가운데(2행 2열) 구역 제외
      if (zoneRow === 1 && zoneCol === 1) continue;

      zones.push({
        rowStart: zoneRow * rowSize,
        rowEnd: Math.min(rows, (zoneRow + 1) * rowSize),
        colStart: zoneCol * colSize,
        colEnd: Math.min(cols, (zoneCol + 1) * colSize),
      });
    }
  }

  shuffle(zones, rng);

  const chosen = [];
  const isFloor = (row, col) => map[row][col] === 0;
  const farEnough = (row, col) => chosen.every(pos => (
    Math.abs(pos.row - row) + Math.abs(pos.col - col) >= 2
  ));

  const pickInZone = (zone) => {
    const candidates = [];
    for (let row = zone.rowStart; row < zone.rowEnd; row++) {
      for (let col = zone.colStart; col < zone.colEnd; col++) {
        if (!isFloor(row, col)) continue;
        if (!farEnough(row, col)) continue;
        candidates.push({ row, col });
      }
    }
    if (candidates.length === 0) return null;
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(rng() * candidates.length)));
    return candidates[index];
  };

  for (const zone of zones) {
    if (chosen.length >= count) break;
    const pick = pickInZone(zone);
    if (pick) chosen.push(pick);
  }

  // 구역 후보가 부족한 예외 상황: 중앙을 제외한 전체 바닥에서 보충
  if (chosen.length < count) {
    const fallback = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isCenterSpawnZone(row, col, rows, cols)) continue;
        if (!isFloor(row, col)) continue;
        if (!farEnough(row, col)) continue;
        fallback.push({ row, col });
      }
    }

    shuffle(fallback, rng);
    for (const pos of fallback) {
      if (chosen.length >= count) break;
      if (farEnough(pos.row, pos.col)) chosen.push(pos);
    }
  }

  // 맵이 매우 좁은 경우에도 요청 수만큼은 채우기 위해 마지막으로 중복만 피한다.
  if (chosen.length < count) {
    const remaining = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isCenterSpawnZone(row, col, rows, cols)) continue;
        if (!isFloor(row, col)) continue;
        if (chosen.some(pos => pos.row === row && pos.col === col)) continue;
        remaining.push({ row, col });
      }
    }
    shuffle(remaining, rng);
    for (const pos of remaining) {
      if (chosen.length >= count) break;
      chosen.push(pos);
    }
  }

  return chosen.slice(0, count);
}

/** 3x3 구역 인덱스 */
function zoneOf(row, col, rows, cols) {
  const rowSize = zoneSize(rows);
  const colSize = zoneSize(cols);
  return {
    row: Math.min(2, Math.max(0, Math.floor(row / rowSize))),
    col: Math.min(2, Math.max(0, Math.floor(col / colSize))),
  };
}

/**
 * 체포/황금 젖병 넉백 후 안전한 리스폰 타일을 고른다.
 * - 이전 위치의 3x3 구역(및 중앙 구역)은 제외
 * - 벽이 아닌 일반 바닥(0)만 사용
 * - 베이비와 최소 minBabyDistance(기본 4) 이상 떨어짐
 * - 다른 악당과 같은/인접 타일은 피함
 *
 * @param {number[][]} map
 * @param {object} [options]
 * @param {number} [options.fromRow] 이전(사망/넉백) 위치
 * @param {number} [options.fromCol]
 * @param {{row: number, col: number}} [options.baby]
 * @param {Array<{row: number, col: number}>} [options.avoid]
 * @param {() => number} [options.rng]
 * @param {number} [options.minBabyDistance]
 * @returns {{row: number, col: number} | null}
 */
export function findEnemyRespawnTile(map, options = {}) {
  const rows = map?.length || 0;
  const cols = map?.[0]?.length || 0;
  if (rows === 0 || cols === 0) return null;

  const {
    fromRow = null,
    fromCol = null,
    baby = null,
    avoid = [],
    rng = Math.random,
    minBabyDistance = 4,
  } = options;

  const rowSize = zoneSize(rows);
  const colSize = zoneSize(cols);
  const deathZone = Number.isFinite(fromRow) && Number.isFinite(fromCol)
    ? zoneOf(fromRow, fromCol, rows, cols)
    : null;

  const zones = [];
  for (let zoneRow = 0; zoneRow < 3; zoneRow++) {
    for (let zoneCol = 0; zoneCol < 3; zoneCol++) {
      // 중앙 구역과 이전(사망/넉백) 구역 제외
      if (zoneRow === 1 && zoneCol === 1) continue;
      if (deathZone && deathZone.row === zoneRow && deathZone.col === zoneCol) continue;

      zones.push({
        rowStart: zoneRow * rowSize,
        rowEnd: Math.min(rows, (zoneRow + 1) * rowSize),
        colStart: zoneCol * colSize,
        colEnd: Math.min(cols, (zoneCol + 1) * colSize),
      });
    }
  }

  const babyDistanceOk = (row, col) => {
    if (!baby || !Number.isFinite(baby.row) || !Number.isFinite(baby.col)) return true;
    return Math.abs(row - baby.row) + Math.abs(col - baby.col) >= minBabyDistance;
  };

  const avoidDistanceOk = (row, col) => avoid.every(pos => (
    !pos
    || !Number.isFinite(pos.row)
    || !Number.isFinite(pos.col)
    || Math.abs(row - pos.row) + Math.abs(col - pos.col) >= 2
  ));

  const collect = (checkBaby, checkAvoid) => {
    const candidates = [];
    for (const zone of zones) {
      for (let row = zone.rowStart; row < zone.rowEnd; row++) {
        for (let col = zone.colStart; col < zone.colEnd; col++) {
          if (map[row][col] !== 0) continue;
          if (checkBaby && !babyDistanceOk(row, col)) continue;
          if (checkAvoid && !avoidDistanceOk(row, col)) continue;
          candidates.push({ row, col });
        }
      }
    }
    return candidates;
  };

  // 베이비 거리와 다른 악당 회피를 우선하고, 맵이 좁을 때만 단계적으로 완화한다.
  let candidates = collect(true, true);
  if (candidates.length === 0) candidates = collect(true, false);
  if (candidates.length === 0) candidates = collect(false, false);
  if (candidates.length === 0) return null;

  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(rng() * candidates.length)));
  return candidates[index];
}

export default class Enemy {
  constructor(spawnPos, index = 0, startDelay = 0, mode = ENEMY_MODE.CHASE, rng = Math.random) {
    this.spawnRow = spawnPos.row;
    this.spawnCol = spawnPos.col;
    this.index = index;

    this.row = spawnPos.row;
    this.col = spawnPos.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.prevRow = this.row;
    this.prevCol = this.col;

    this.baseTileMs = ENEMY_TILE_MS; // 1타일 이동 시간
    this.moveAccum = 0;              // 이동 누적 시간 (보간에 사용)
    this.direction = null;           // 마지막 이동 방향

    this.startDelay = startDelay;    // 게임 시작 시 잠에서 깨는 시간
    this.wakeTimer = startDelay;

    this.mode = mode;                // CHASE | PATROL
    this.rng = rng;                  // 순찰 목표 선택용 난수 (테스트에서 주입 가능)
    this.guardTarget = null;         // 경비 모드의 순찰 목표 타일
    this.confuseTimer = 0;           // 목표를 잃은 남은 시간
    this.modeBeforeConfusion = null; // 목표를 잃기 전 모드 (복귀용)
    this.modeBeforeFlee = null;      // 도망 전 모드 (복귀용)
    this.fleeTimer = 0;              // 남은 도망 시간 (ms)

    this.isFrozen = false;   // 울기 스킬/트랩에 의해 정지
    this.frozenTimer = 0;
    this.frozenTotal = 0;    // 이번 얼림의 총 시간 (색 복귀 보간 기준)
    this.slowEffect = 0;     // 0.0 ~ 0.3 (트랩 감속)
    this.slowTimer = 0;
    this.pinned = false;     // 테스터: 악당 전체 정지
    this.movedThisTick = false; // 이번 틱에 이동했는지 (교차 통과 판정용)

    // 황금 보행기 넉백 비행 연출 (화면 전용 — 논리 위치와 분리)
    this.knockFlight = null;
  }

  /** 감속이 반영된 1타일 이동 시간 */
  getTileMs() {
    const factor = Math.max(0.1, 1 - this.slowEffect);
    return this.baseTileMs / factor;
  }

  /** 초당 이동 타일 수 (참고용) */
  getEffectiveSpeed() {
    if (this.isFrozen) return 0;
    return 1000 / this.getTileMs();
  }

  /** 황금 젖병 때문에 도망치는 중인지 */
  get isFleeing() {
    return this.mode === ENEMY_MODE.FLEE;
  }

  /** 모드별 원래 몸통 색 */
  getBaseColor() {
    if (this.mode === ENEMY_MODE.FLEE) return COLORS.ENEMY_SCARED;
    return this.mode === ENEMY_MODE.PATROL ? COLORS.ENEMY_PATROL : COLORS.ENEMY;
  }

  /**
   * 현재 몸통 색
   * - 얼음: 남은 시간 비율이 클수록 파랑, 줄어들수록 원래 색으로 서서히 복귀
   */
  getBodyColor() {
    const base = this.getBaseColor();
    if (!this.isFrozen) return base;

    const total = this.frozenTotal > 0 ? this.frozenTotal : 1;
    const progress = Math.min(1, Math.max(0, this.frozenTimer / total));
    return mixHexColor(base, COLORS.ENEMY_FROZEN, progress);
  }

  /** 렌더링 보간 계수 (0 ~ 1) */
  getMoveProgress() {
    if (this.isFrozen) return 0;
    const progress = this.moveAccum / this.getTileMs();
    if (progress < 0) return 0;
    if (progress > 1) return 1;
    return progress;
  }

  /**
   * 얼리기 (울기 스킬 / 트랩)
   * 이미 얼어 있으면 남은 시간이 더 길어지도록만 갱신한다 (짧아지지 않음).
   * @param {number} duration
   */
  freeze(duration) {
    const next = this.isFrozen ? Math.max(this.frozenTimer, duration) : duration;

    this.isFrozen = true;
    this.frozenTimer = next;
    this.frozenTotal = next; // 색 복귀 보간 기준

    // 얼린 위치에서 정확히 멈추도록 보간 기준점을 현재 타일로 맞춘다
    this.moveAccum = 0;
    this.prevRow = this.row;
    this.prevCol = this.col;
  }

  /**
   * 얼림 시간을 "더한다" (울기를 얼어 있는 악당에게 사용할 때 +3초 연장)
   * 얼어 있지 않으면 새로 얼린다.
   * @param {number} extraMs
   * @returns {number} 갱신된 남은 시간
   */
  extendFreeze(extraMs) {
    if (!this.isFrozen) {
      this.freeze(extraMs);
      return this.frozenTimer;
    }

    this.frozenTimer += extraMs;
    this.frozenTotal = this.frozenTimer; // 색 복귀 보간 기준도 새 기간으로
    return this.frozenTimer;
  }

  /** 트랩 감속 적용 */
  applySlow(effect, duration) {
    this.slowEffect = Math.min(this.slowEffect + effect, 0.3); // 최대 30%
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  /**
   * 황금 젖병 보행기 모드: 베이비가 무서워 도망친다.
   * @param {number} duration 도망 시간(ms)
   * @returns {boolean} 적용 여부
   */
  startFlee(duration) {
    if (this.mode !== ENEMY_MODE.FLEE) {
      this.modeBeforeFlee = this.mode;
    }
    this.mode = ENEMY_MODE.FLEE;
    this.fleeTimer = Math.max(this.fleeTimer, duration);
    this.confuseTimer = 0;
    this.modeBeforeConfusion = null;
    this.guardTarget = null;
    return true;
  }

  /** 도망 종료 → 원래 모드(추격/경비)로 복귀 */
  endFlee() {
    if (this.mode !== ENEMY_MODE.FLEE) {
      this.fleeTimer = 0;
      return false;
    }

    this.mode = this.modeBeforeFlee || ENEMY_MODE.CHASE;
    this.modeBeforeFlee = null;
    this.fleeTimer = 0;
    this.guardTarget = null;
    return true;
  }

  /**
   * 황금 보행기 넉백 연출 시작: 맞은 지점 → 현재(스폰) 지점까지 포물선 비행.
   * - 호출 전에 resetToSpawn() 으로 논리 위치를 이미 옮겨 둔 상태를 전제로 한다.
   * - 이 상태는 화면 연출 전용이라 row/col·충돌 판정에는 영향을 주지 않는다.
   * @param {number} fromRow 맞은 타일 행
   * @param {number} fromCol 맞은 타일 열
   * @param {number} [durationMs] 비행 시간 (기본 650ms)
   * @returns {object|null} 생성된 비행 상태
   */
  startKnockFlight(fromRow, fromCol, durationMs = KNOCK_FLIGHT_MS) {
    if (!Number.isFinite(fromRow) || !Number.isFinite(fromCol)) return null;

    const fromX = (fromCol + 0.5) * TILE_SIZE;
    const fromY = (fromRow + 0.5) * TILE_SIZE;
    const toX = (this.col + 0.5) * TILE_SIZE;
    const toY = (this.row + 0.5) * TILE_SIZE;

    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    const arcTiles = Math.max(
      KNOCK_ARC_MIN_TILES,
      Math.min(KNOCK_ARC_MAX_TILES, (distance / TILE_SIZE) * 0.55),
    );

    this.knockFlight = {
      fromX,
      fromY,
      toX,
      toY,
      elapsed: 0,
      duration: Math.max(160, Number.isFinite(durationMs) ? durationMs : KNOCK_FLIGHT_MS),
      arcHeight: TILE_SIZE * arcTiles,
      // 오른쪽으로 날아가면 시계 방향, 왼쪽이면 반시계 방향으로 빙글빙글
      spinTotal: (dx >= 0 ? 1 : -1) * Math.PI * 2 * KNOCK_FLIGHT_SPINS,
      trailAccum: 0,
    };

    return this.knockFlight;
  }

  /** 진행 중인 넉백 비행 연출 취소 (리스폰/라운드 초기화) */
  clearKnockFlight() {
    this.knockFlight = null;
  }

  /**
   * 비행 연출을 진행하고 현재 자세를 돌려준다 (렌더 전용).
   * @param {number} dt 프레임 경과(ms)
   * @returns {object|null} { x, y, rotation, scale, arc, progress, emitTrail, landed }
   */
  advanceKnockFlight(dt) {
    const flight = this.knockFlight;
    if (!flight) return null;

    const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
    flight.elapsed += step;
    flight.trailAccum += step;

    const emitTrail = flight.trailAccum >= KNOCK_TRAIL_INTERVAL_MS;
    if (emitTrail) flight.trailAccum = 0;

    const pose = this.getFlightPose();
    const landed = flight.elapsed >= flight.duration;

    if (pose) {
      pose.emitTrail = emitTrail;
      pose.landed = landed;
    }
    if (landed) this.knockFlight = null; // 착지하면 다음 프레임부터 정상 렌더

    return pose;
  }

  /**
   * 비행 궤적 위의 자세를 계산한다.
   * @param {number} [offset] 진행률 오프셋 (음수 = 과거 시점 → 잔상 고스트)
   * @returns {object|null}
   */
  getFlightPose(offset = 0) {
    const flight = this.knockFlight;
    if (!flight) return null;

    const raw = flight.elapsed / flight.duration + (Number.isFinite(offset) ? offset : 0);
    const t = Math.min(1, Math.max(0, raw));

    // X 는 등속, Y 는 포물선(정점에서 솟아올랐다가 착지)
    const groundX = flight.fromX + (flight.toX - flight.fromX) * t;
    const groundY = flight.fromY + (flight.toY - flight.fromY) * t;
    const arc = Math.sin(Math.PI * t); // 0 → 1 → 0
    const y = groundY - flight.arcHeight * arc;

    return {
      x: groundX,
      y,
      groundX,
      groundY,
      arc,
      progress: t,
      // 정점에서 1.4배까지 커졌다가 원래 크기로 돌아오는 원근감
      scale: 1 + KNOCK_APEX_SCALE * arc,
      rotation: flight.spinTotal * t * t, // 처음엔 천천히, 정점 부근에서 빠르게
      emitTrail: false,
      landed: false,
    };
  }

  /**
   * 베이비를 놓치고 잠시 경비(순찰) 모드로 변신한다.
   * duration 후에는 원래 모드(추격)로 복귀한다.
   * @param {number} duration 목표를 잃는 시간(ms)
   * @returns {boolean} 적용 여부 (경비 악당은 해당 없음)
   */
  loseTarget(duration) {
    if (this.mode !== ENEMY_MODE.CHASE) return false;

    this.modeBeforeConfusion = this.mode;
    this.mode = ENEMY_MODE.PATROL;
    this.confuseTimer = duration;
    this.guardTarget = null;
    this.moveAccum = 0;
    return true;
  }

  /**
   * 스폰 위치로 되돌린다 (체포 후 리셋).
   * options.map 이 주어지면 이전 위치/구역을 피한 안전한 랜덤 위치로 이동한다.
   */
  resetToSpawn(options = null) {
    if (options && options.map) {
      const next = findEnemyRespawnTile(options.map, {
        fromRow: this.row,
        fromCol: this.col,
        baby: options.baby,
        avoid: options.avoid,
        rng: options.rng || this.rng,
        minBabyDistance: options.minBabyDistance,
      });
      if (next) {
        this.spawnRow = next.row;
        this.spawnCol = next.col;
      }
    }

    this.row = this.spawnRow;
    this.col = this.spawnCol;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.prevRow = this.row;
    this.prevCol = this.col;
    this.moveAccum = 0;
    this.direction = null;
    this.knockFlight = null; // 이전 넉백 비행 연출은 리스폰과 함께 취소
    this.slowEffect = 0;
    this.slowTimer = 0;
    this.guardTarget = null;
    this.confuseTimer = 0;
    this.modeBeforeConfusion = null;
    // 도망 중이었다면 원래 모드로 되돌린다 (게임이 필요하면 다시 startFlee)
    if (this.mode === ENEMY_MODE.FLEE) this.mode = this.modeBeforeFlee || ENEMY_MODE.CHASE;
    this.modeBeforeFlee = null;
    this.fleeTimer = 0;
    // 체포 후에는 잠깐 멈칫하게 해서 연속 체포를 막는다
    this.wakeTimer = this.startDelay * 0.45;
  }

  /** tick 마다 호출 — 베이비를 향해 타일 단위로 추격 */
  update(dt, map, babyRow, babyCol) {
    this.movedThisTick = false;

    // 황금 젖병: 도망 타이머 진행 (얼음/기상 지연과 무관하게 흐른다)
    if (this.fleeTimer > 0) {
      this.fleeTimer = Math.max(0, this.fleeTimer - dt);
      if (this.fleeTimer === 0 && this.mode === ENEMY_MODE.FLEE) this.endFlee();
    }

    // 테스터: 강제 정지
    if (this.pinned) return;

    // 목표를 잃은 상태: 시간이 지나면 원래 모드로 복귀 (기상 지연과 무관하게 진행)
    if (this.confuseTimer > 0) {
      this.confuseTimer -= dt;
      if (this.confuseTimer <= 0) {
        this.confuseTimer = 0;
        this.mode = this.modeBeforeConfusion || ENEMY_MODE.CHASE;
        this.modeBeforeConfusion = null;
        this.guardTarget = null;
      }
    }

    // 얼음 해제 (기상 지연과 무관하게 진행 → 스킬 지속시간 3초 보장)
    if (this.isFrozen) {
      this.frozenTimer -= dt;
      if (this.frozenTimer <= 0) {
        this.isFrozen = false;
        this.frozenTimer = 0;
      }
      return; // 정지 중이면 이동 안 함
    }

    // 감속 타이머
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowEffect = 0;
        this.slowTimer = 0;
      }
    }

    // 시작 직후 기상 시간 (베이비가 도망칠 틈을 준다)
    if (this.wakeTimer > 0) {
      this.wakeTimer -= dt;
      return;
    }

    // 이동 누적 → 1타일 시간마다 한 칸씩 추격
    this.moveAccum += dt;

    let tileMs = this.getTileMs();
    while (this.moveAccum >= tileMs) {
      const stepped = this._stepToward(map, babyRow, babyCol);
      if (!stepped) {
        // 갈 곳이 없으면 제자리 (보간도 멈춘다)
        this.moveAccum = 0;
        this.prevRow = this.row;
        this.prevCol = this.col;
        break;
      }
      this.moveAccum -= tileMs;
      tileMs = this.getTileMs();
    }
  }

  /** 목표를 향해 한 칸 이동. 이동 성공 여부 반환 */
  _stepToward(map, babyRow, babyCol) {
    // 보행기 모드: 베이비에게서 도망친다
    if (this.mode === ENEMY_MODE.FLEE) {
      return this._stepFlee(map, babyRow, babyCol);
    }

    const goal = this.mode === ENEMY_MODE.CHASE
      ? { row: babyRow, col: babyCol }
      : this._currentGuardTarget(map, babyRow, babyCol);

    if (!goal) return false;

    const next = findNextStep(map, this.row, this.col, goal.row, goal.col, this.index);
    if (!next) return false;

    // 경비 모드는 베이비를 밟지 않는다 (추격처럼 보이지 않도록) → 새 목표를 잡는다
    if (this.mode === ENEMY_MODE.PATROL && next.row === babyRow && next.col === babyCol) {
      this.guardTarget = null;
      return false;
    }

    this.prevRow = this.row;
    this.prevCol = this.col;

    if (next.row < this.row) this.direction = 'UP';
    else if (next.row > this.row) this.direction = 'DOWN';
    else if (next.col < this.col) this.direction = 'LEFT';
    else if (next.col > this.col) this.direction = 'RIGHT';

    this.row = next.row;
    this.col = next.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.movedThisTick = true;
    return true;
  }

  /**
   * 도망 이동: 4방향 중 베이비와 가장 멀어지는 칸을 고른다.
   * - 되돌아가는 방향은 동률일 때만 선택 → 막다른 길에서 화들짝 되돌아온다.
   * @param {number[][]} map
   * @param {number} babyRow
   * @param {number} babyCol
   * @returns {boolean} 이동 성공 여부
   */
  _stepFlee(map, babyRow, babyCol) {
    const reverse = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' }[this.direction] || null;
    const options = [];

    for (const delta of NEIGHBOR_OFFSETS) {
      const row = this.row + delta.row;
      let col = this.col + delta.col;

      // 좌우 터널 통과
      if (col < 0) col = COLS - 1;
      if (col >= COLS) col = 0;

      if (!isWalkableTile(map, row, col)) continue;

      const distance = Math.abs(row - babyRow) + Math.abs(col - babyCol);
      options.push({
        row,
        col,
        dir: delta.dir,
        score: distance - (delta.dir === reverse ? 0.5 : 0),
      });
    }

    if (options.length === 0) return false;

    options.sort((a, b) => b.score - a.score);
    const pick = options[0];

    this.prevRow = this.row;
    this.prevCol = this.col;
    this.direction = pick.dir;
    this.row = pick.row;
    this.col = pick.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.movedThisTick = true;
    return true;
  }

  /** 경비 모드: 현재 순찰 목표 (도착/베이비 근접 시 새 목표를 고른다) */
  _currentGuardTarget(map, babyRow = -999, babyCol = -999) {
    const distanceToBaby = (tile) => Math.abs(tile.row - babyRow) + Math.abs(tile.col - babyCol);

    if (this.guardTarget && distanceToBaby(this.guardTarget) < PATROL_SAFE_DISTANCE) {
      this.guardTarget = null; // 베이비가 가까워지면 다른 곳으로 이동
    }
    if (!this.guardTarget) {
      this.guardTarget = this._pickGuardTarget(map, babyRow, babyCol);
    }
    if (this.guardTarget
      && this.row === this.guardTarget.row
      && this.col === this.guardTarget.col) {
      this.guardTarget = this._pickGuardTarget(map, babyRow, babyCol);
    }
    return this.guardTarget;
  }

  /**
   * 맵에서 순찰 목표 타일을 고른다.
   * 베이비와 PATROL_SAFE_DISTANCE 이상 떨어진 곳을 우선한다.
   */
  _pickGuardTarget(map, babyRow = -999, babyCol = -999) {
    // 1) 베이비와 충분히 떨어진 무작위 타일
    for (let attempt = 0; attempt < 60; attempt++) {
      const spot = randomWalkableTile(map, this.rng, [{ row: this.row, col: this.col }]);
      if (!spot) break;
      const distance = Math.abs(spot.row - babyRow) + Math.abs(spot.col - babyCol);
      if (distance >= PATROL_SAFE_DISTANCE) return spot;
    }

    // 2) 무작위로 못 찾으면 맵 전체에서 베이비와 가장 먼 타일을 고른다
    let best = null;
    let bestDistance = -1;
    for (let row = 0; row < map.length; row++) {
      for (let col = 0; col < map[row].length; col++) {
        if (!isWalkableTile(map, row, col)) continue;
        if (row === this.row && col === this.col) continue;
        const distance = Math.abs(row - babyRow) + Math.abs(col - babyCol);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = { row, col };
        }
      }
    }
    if (best) return best;

    // 3) 그래도 없으면 인접 타일
    for (const delta of NEIGHBOR_OFFSETS) {
      const row = this.row + delta.row;
      const col = this.col + delta.col;
      if (!isWalkableTile(map, row, col)) continue;
      if (row === babyRow && col === babyCol) continue;
      return { row, col };
    }
    return null;
  }

  /**
   * 넉백 비행 잔상(고스트): 현재 위치보다 살짝 뒤처진 궤적에 반투명 실루엣을 남긴다.
   * - 별가루 파티클과 함께 "시원하게 날아갔다"는 꼬리 효과를 만든다.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x: number, y: number, rotation: number, scale: number}} pose
   */
  _renderFlightGhosts(ctx, pose) {
    const radius = TILE_SIZE / 2 - 2;

    for (let i = 1; i <= 3; i++) {
      const ghost = this.getFlightPose(-i * 0.06);
      if (!ghost) continue;

      const alpha = 0.34 - (i - 1) * 0.1;
      ctx.save?.();
      ctx.globalAlpha = Math.max(0.08, alpha);
      ctx.translate(ghost.x, ghost.y);
      ctx.rotate(ghost.rotation);
      ctx.fillStyle = COLORS.ENEMY_SCARED;
      ctx.beginPath();
      ctx.arc(0, 0, radius * ghost.scale * (1 - i * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore?.();
    }

    // 정점에서 살짝 번쩍이는 골든 링 (날아가는 힘을 강조)
    if (pose && pose.arc > 0.2) {
      ctx.save?.();
      ctx.globalAlpha = Math.min(0.6, pose.arc * 0.7);
      ctx.strokeStyle = COLORS.GOLDEN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pose.x, pose.y, radius * pose.scale + 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore?.();
    }
  }

  /**
   * 악당(보모) 렌더링
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} timeMs 애니메이션 시간(ms)
   */
  render(ctx, timeMs = 0) {
    // 황금 보행기로 맞아 날아가는 중이면 논리 위치 대신 포물선 궤적 위에 그린다
    const flightPose = this.getFlightPose();
    const flying = !!flightPose;

    if (flying) this._renderFlightGhosts(ctx, flightPose);

    const progress = this.getMoveProgress();

    // 터널 통과(1칸 이상 점프) 시에는 보간하지 않는다
    const drawCol = Math.abs(this.prevCol - this.col) <= 1
      ? this.prevCol + (this.col - this.prevCol) * progress
      : this.col;
    const drawRow = Math.abs(this.prevRow - this.row) <= 1
      ? this.prevRow + (this.row - this.prevRow) * progress
      : this.row;

    const baseCx = flying ? flightPose.x : (drawCol + 0.5) * TILE_SIZE;
    const cy = flying ? flightPose.y : (drawRow + 0.5) * TILE_SIZE;
    const radius = TILE_SIZE / 2 - 2;
    const supportsEllipse = typeof ctx.ellipse === 'function';

    const frozen = this.isFrozen;
    const fleeing = !frozen && this.isFleeing;
    const slowed = !frozen && this.slowEffect > 0 && this.slowTimer > 0;
    const bob = frozen || flying ? 0 : Math.sin(timeMs / 260 + this.index * 1.7) * 0.6;
    // 겁에 질린 악당은 부들부들 떤다 (날아가는 중에는 이미 충분히 요란하다)
    const jitter = fleeing && !flying ? Math.sin(timeMs / 45 + this.index * 1.3) * 1.1 : 0;
    const cx = baseCx + jitter;

    // 감속 표시: 발밑에 보랏빛 링 조각 (공중에서는 생략)
    if (slowed && !flying) {
      ctx.strokeStyle = 'rgba(186, 104, 200, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const start = (Math.PI * 2 / 6) * i + timeMs / 900;
        ctx.arc(cx, cy + radius * 0.8, radius + 2.2, start, start + 0.42);
      }
      ctx.stroke();
    }

    if (flying) {
      // 날아오르는 높이만큼 작고 옅어지는 바닥 그림자 → 원근감 강조
      if (supportsEllipse) {
        const shadowScale = 1 - 0.45 * flightPose.arc;
        ctx.fillStyle = `rgba(0, 0, 0, ${0.3 - 0.16 * flightPose.arc})`;
        ctx.beginPath();
        ctx.ellipse(
          flightPose.groundX,
          flightPose.groundY + radius * 0.82,
          radius * 0.8 * shadowScale,
          radius * 0.3 * shadowScale,
          0, 0, Math.PI * 2,
        );
        ctx.fill();
      }

      // 몸 전체를 중심 기준으로 회전 + 확대 (빙글빙글 포물선 비행)
      ctx.save?.();
      ctx.translate(cx, cy);
      ctx.rotate(flightPose.rotation);
      ctx.scale(flightPose.scale, flightPose.scale);
      ctx.translate(-cx, -cy);
    } else if (supportsEllipse) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + radius * 0.82, radius * 0.8, radius * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 몸통 (얼음은 남은 시간에 따라 원래 색으로 복귀 + 냉기 글로우)
    ctx.save?.();
    ctx.shadowColor = frozen
      ? 'rgba(100, 181, 246, 0.95)'
      : fleeing
        ? 'rgba(129, 212, 250, 0.95)'
        : this.mode === ENEMY_MODE.PATROL
          ? 'rgba(255, 167, 38, 0.7)'
          : 'rgba(239, 83, 80, 0.7)';
    ctx.shadowBlur = frozen || fleeing ? 16 : 10;
    ctx.fillStyle = this.getBodyColor();
    ctx.beginPath();
    ctx.arc(cx, cy + bob, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // 밝은 파스텔 배경에서도 실루엣이 또렷하도록 얇은 외곽선
    ctx.strokeStyle = frozen ? 'rgba(18, 70, 110, 0.48)' : fleeing ? 'rgba(18, 70, 110, 0.42)' : 'rgba(70, 20, 26, 0.45)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy + bob, radius - 0.45, 0, Math.PI * 2);
    ctx.stroke();

    // 몸통 아래쪽 얇은 음영 — 도형이 납작해 보이지 않게
    ctx.strokeStyle = frozen || fleeing ? 'rgba(20, 60, 90, 0.28)' : 'rgba(92, 24, 30, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy + bob, radius - 0.4, 0.14 * Math.PI, 0.86 * Math.PI);
    ctx.stroke();

    const headCy = cy + bob;

    // 위쪽 광택
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.beginPath();
    ctx.arc(cx - radius * 0.32, headCy - radius * 0.38, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // ===== ① 깐깐한 올림머리(쪽진 머리) + 삐죽 머리핀/잔머리 =====
    // 정수리를 감싸는 진한 머리카락 띠
    ctx.strokeStyle = COLORS.ENEMY_HAIR;
    ctx.lineWidth = Math.max(2, radius * 0.30);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, headCy, radius * 0.84, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    // 정수리 위 동그란 올림머리
    const bunY = headCy - radius * 0.84;
    const bunR = radius * 0.34;
    ctx.fillStyle = COLORS.ENEMY_HAIR;
    ctx.strokeStyle = COLORS.ENEMY_HAIR_DARK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, bunY, bunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 올림머리 하이라이트
    ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.beginPath();
    ctx.arc(cx - bunR * 0.32, bunY - bunR * 0.34, bunR * 0.34, 0, Math.PI * 2);
    ctx.fill();

    // 삐죽 튀어나온 금색 머리핀
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.54, bunY - 0.4);
    ctx.lineTo(cx + radius * 0.66, bunY - 1.6);
    ctx.stroke();
    ctx.fillStyle = '#ffe9a3';
    ctx.beginPath();
    ctx.arc(cx + radius * 0.66, bunY - 1.6, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 삐죽삐죽 잔머리
    ctx.strokeStyle = COLORS.ENEMY_HAIR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + bunR * 0.3, bunY - bunR * 0.8);
    ctx.lineTo(cx + bunR * 1.1, bunY - bunR * 1.7);
    ctx.moveTo(cx - bunR * 0.2, bunY - bunR * 0.9);
    ctx.lineTo(cx - bunR * 0.9, bunY - bunR * 1.8);
    ctx.moveTo(cx + bunR * 0.9, bunY - bunR * 0.2);
    ctx.lineTo(cx + bunR * 1.7, bunY - bunR * 0.6);
    ctx.stroke();

    // ===== ② 빳빳한 앞치마 실루엣 =====
    const apronColor = frozen
      ? 'rgba(226, 246, 255, 0.95)'
      : fleeing
        ? 'rgba(238, 249, 255, 0.95)'
        : COLORS.ENEMY_APRON;
    const apronEdge = frozen
      ? 'rgba(60, 120, 160, 0.7)'
      : fleeing
        ? 'rgba(50, 110, 150, 0.66)'
        : COLORS.ENEMY_APRON_EDGE;

    const apronTop = headCy + radius * 0.46;
    const apronBottom = headCy + radius * 0.98;
    ctx.fillStyle = apronColor;
    ctx.strokeStyle = apronEdge;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.58, apronTop);
    ctx.lineTo(cx + radius * 0.58, apronTop);
    ctx.lineTo(cx + radius * 0.42, apronBottom - radius * 0.08);
    enemyCurve(ctx, cx + radius * 0.18, apronBottom, cx, apronBottom);
    enemyCurve(ctx, cx - radius * 0.18, apronBottom, cx - radius * 0.42, apronBottom - radius * 0.08);
    ctx.closePath?.();
    ctx.fill();
    ctx.stroke();

    // 어깨끈 2줄 — 앞치마가 빳빳하게 서 있는 느낌
    ctx.strokeStyle = apronEdge;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.54, apronTop);
    ctx.lineTo(cx - radius * 0.70, headCy + radius * 0.02);
    ctx.moveTo(cx + radius * 0.54, apronTop);
    ctx.lineTo(cx + radius * 0.70, headCy + radius * 0.02);
    ctx.stroke();

    // 앞치마 주머니
    ctx.strokeStyle = 'rgba(122, 72, 84, 0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.22, headCy + radius * 0.66);
    ctx.lineTo(cx - radius * 0.22, headCy + radius * 0.86);
    ctx.lineTo(cx + radius * 0.22, headCy + radius * 0.86);
    ctx.lineTo(cx + radius * 0.22, headCy + radius * 0.66);
    ctx.stroke();

    // ===== ③ 째려보는 눈 + V자 눈썹 =====
    let lookX = 0;
    let lookY = 0.4;
    if (this.direction === 'LEFT') { lookX = -1; lookY = 0; }
    else if (this.direction === 'RIGHT') { lookX = 1; lookY = 0; }
    else if (this.direction === 'UP') { lookX = 0; lookY = -1; }
    else if (this.direction === 'DOWN') { lookX = 0; lookY = 1; }

    const eyeY = headCy - radius * 0.22;
    const eyeRadius = fleeing ? 3.2 : 2.5;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 4, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(cx + 4, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    const pupilRadius = fleeing ? 1.15 : 1.25;
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(cx - 4 + lookX * 1.1, eyeY + lookY * 1.1, pupilRadius, 0, Math.PI * 2);
    ctx.arc(cx + 4 + lookX * 1.1, eyeY + lookY * 1.1, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    // 눈동자 반짝임
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(cx - 4.4 + lookX * 1.1, eyeY - 0.5 + lookY * 1.1, 0.5, 0, Math.PI * 2);
    ctx.arc(cx + 3.6 + lookX * 1.1, eyeY - 0.5 + lookY * 1.1, 0.5, 0, Math.PI * 2);
    ctx.fill();

    if (fleeing) {
      // 겁에 질린 눈썹 (바깥쪽이 올라간 모양)
      ctx.strokeStyle = '#0d47a1';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - 6.6, eyeY - 2.0);
      ctx.lineTo(cx - 2.2, eyeY - 3.9);
      ctx.moveTo(cx + 6.6, eyeY - 2.0);
      ctx.lineTo(cx + 2.2, eyeY - 3.9);
      ctx.stroke();

      // 겁먹은 동그란 입
      ctx.fillStyle = '#3e2723';
      ctx.beginPath();
      ctx.arc(cx, headCy + radius * 0.40, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // 식은땀 방울
      ctx.fillStyle = 'rgba(214, 244, 255, 0.95)';
      const sweatY = headCy - 1 + Math.sin(timeMs / 120 + this.index) * 2;
      ctx.beginPath();
      ctx.arc(cx - radius - 1.2, sweatY, 1.4, 0, Math.PI * 2);
      ctx.arc(cx + radius + 1.4, sweatY - 3, 1.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 째려보는 눈꺼풀 + 다크서클/눈가 주름
      ctx.strokeStyle = 'rgba(74, 16, 16, 0.62)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 6.4, eyeY - 1.1);
      ctx.lineTo(cx - 1.6, eyeY - 1.8);
      ctx.moveTo(cx + 6.4, eyeY - 1.1);
      ctx.lineTo(cx + 1.6, eyeY - 1.8);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(90, 48, 60, 0.35)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx - 4, eyeY + 2.1, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.arc(cx + 4, eyeY + 2.1, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      // 날카롭게 치켜올린 V자 눈썹
      ctx.strokeStyle = '#4a1010';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 7.0, eyeY - 4.4);
      ctx.lineTo(cx - 2.0, eyeY - 2.0);
      ctx.moveTo(cx + 7.0, eyeY - 4.4);
      ctx.lineTo(cx + 2.0, eyeY - 2.0);
      ctx.stroke();

      // 앙다문 지그재그(삐죽) 입
      ctx.strokeStyle = '#4a1010';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - 3.2, headCy + radius * 0.34);
      ctx.lineTo(cx - 1.6, headCy + radius * 0.42);
      ctx.lineTo(cx, headCy + radius * 0.34);
      ctx.lineTo(cx + 1.6, headCy + radius * 0.42);
      ctx.lineTo(cx + 3.2, headCy + radius * 0.34);
      ctx.stroke();
    }

    // 추격 상태: 관자놀이 근처에 작은 만화풍 짜증 핏줄(💢 형태 벡터)
    const chasing = !frozen && !fleeing && this.mode === ENEMY_MODE.CHASE;
    if (chasing) {
      const angerX = cx + radius * 0.78;
      const angerY = headCy - radius * 0.64;
      ctx.strokeStyle = COLORS.ENEMY_ANGER;
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const angle = Math.PI / 4 + (Math.PI / 2) * i;
        ctx.moveTo(angerX + Math.cos(angle) * 1.3, angerY + Math.sin(angle) * 1.3);
        ctx.lineTo(angerX + Math.cos(angle) * 3.3, angerY + Math.sin(angle) * 3.3);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(183, 28, 28, 0.8)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(angerX, angerY, 1.1, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 얼어붙은 상태: 서리 링 + 얼음 결정
    if (frozen) {
      // 올림머리 위 서리 캡
      ctx.strokeStyle = 'rgba(235, 250, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, bunY, bunR + 0.9, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(200, 235, 255, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy + bob, radius + 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(225, 245, 254, 0.95)';
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 / 5) * i + timeMs / 1500;
        const ox = cx + Math.cos(angle) * (radius + 3.6);
        const oy = cy + bob + Math.sin(angle) * (radius + 3.6);

        ctx.beginPath();
        ctx.moveTo(ox, oy - 2.4);
        ctx.lineTo(ox + 1.6, oy + 1.3);
        ctx.lineTo(ox - 1.6, oy + 1.3);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore?.();

    // 비행 변환(회전/확대) 원복
    if (flying) ctx.restore?.();
  }
}