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

  /** 스폰 위치로 되돌린다 (체포 후 리셋) */
  resetToSpawn() {
    this.row = this.spawnRow;
    this.col = this.spawnCol;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.prevRow = this.row;
    this.prevCol = this.col;
    this.moveAccum = 0;
    this.direction = null;
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
   * 악당(보모) 렌더링
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} timeMs 애니메이션 시간(ms)
   */
  render(ctx, timeMs = 0) {
    const progress = this.getMoveProgress();

    // 터널 통과(1칸 이상 점프) 시에는 보간하지 않는다
    const drawCol = Math.abs(this.prevCol - this.col) <= 1
      ? this.prevCol + (this.col - this.prevCol) * progress
      : this.col;
    const drawRow = Math.abs(this.prevRow - this.row) <= 1
      ? this.prevRow + (this.row - this.prevRow) * progress
      : this.row;

    const baseCx = (drawCol + 0.5) * TILE_SIZE;
    const cy = (drawRow + 0.5) * TILE_SIZE;
    const radius = TILE_SIZE / 2 - 2;
    const supportsEllipse = typeof ctx.ellipse === 'function';

    const frozen = this.isFrozen;
    const fleeing = !frozen && this.isFleeing;
    const slowed = !frozen && this.slowEffect > 0 && this.slowTimer > 0;
    const bob = frozen ? 0 : Math.sin(timeMs / 260 + this.index * 1.7) * 0.6;
    // 겁에 질린 악당은 부들부들 떤다
    const jitter = fleeing ? Math.sin(timeMs / 45 + this.index * 1.3) * 1.1 : 0;
    const cx = baseCx + jitter;

    // 감속 표시: 발밑에 보랏빛 링 조각
    if (slowed) {
      ctx.strokeStyle = 'rgba(186, 104, 200, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const start = (Math.PI * 2 / 6) * i + timeMs / 900;
        ctx.arc(cx, cy + radius * 0.8, radius + 2.2, start, start + 0.42);
      }
      ctx.stroke();
    }

    // 그림자
    if (supportsEllipse) {
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
        : 'rgba(239, 83, 80, 0.7)';
    ctx.shadowBlur = frozen || fleeing ? 16 : 10;
    ctx.fillStyle = this.getBodyColor();
    ctx.beginPath();
    ctx.arc(cx, cy + bob, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // 위쪽 광택
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.beginPath();
    ctx.arc(cx - radius * 0.32, cy - radius * 0.38 + bob, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // 앞치마 (보모 느낌)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.28 + bob, radius * 0.7, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.fill();

    // 눈 (진행 방향을 노려본다)
    let lookX = 0;
    let lookY = 0.4;
    if (this.direction === 'LEFT') { lookX = -1; lookY = 0; }
    else if (this.direction === 'RIGHT') { lookX = 1; lookY = 0; }
    else if (this.direction === 'UP') { lookX = 0; lookY = -1; }
    else if (this.direction === 'DOWN') { lookX = 0; lookY = 1; }

    const eyeY = cy - 3 + bob;
    const eyeRadius = fleeing ? 3.15 : 2.6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 4, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(cx + 4, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    const pupilRadius = fleeing ? 1.1 : 1.35;
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(cx - 4 + lookX * 1.1, eyeY + lookY * 1.1, pupilRadius, 0, Math.PI * 2);
    ctx.arc(cx + 4 + lookX * 1.1, eyeY + lookY * 1.1, pupilRadius, 0, Math.PI * 2);
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
      ctx.arc(cx, cy + 5.2 + bob, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // 식은땀 방울
      ctx.fillStyle = 'rgba(214, 244, 255, 0.95)';
      const sweatY = cy - 1 + bob + Math.sin(timeMs / 120 + this.index) * 2;
      ctx.beginPath();
      ctx.arc(cx - radius - 1.2, sweatY, 1.4, 0, Math.PI * 2);
      ctx.arc(cx + radius + 1.4, sweatY - 3, 1.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 화난 눈썹
      ctx.strokeStyle = '#4a1010';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 6.4, eyeY - 3.6);
      ctx.lineTo(cx - 2.2, eyeY - 2.2);
      ctx.moveTo(cx + 6.4, eyeY - 3.6);
      ctx.lineTo(cx + 2.2, eyeY - 2.2);
      ctx.stroke();

      // 찡그린 입
      ctx.strokeStyle = '#4a1010';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy + 4.6 + bob, 3, 1.1 * Math.PI, 1.9 * Math.PI);
      ctx.stroke();
    }

    // 얼어붙은 상태: 서리 링 + 얼음 결정
    if (frozen) {
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
  }
}