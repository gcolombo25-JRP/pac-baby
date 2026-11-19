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
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
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

  /** 모드별 원래 몸통 색 */
  getBaseColor() {
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
    // 체포 후에는 잠깐 멈칫하게 해서 연속 체포를 막는다
    this.wakeTimer = this.startDelay * 0.45;
  }

  /** tick 마다 호출 — 베이비를 향해 타일 단위로 추격 */
  update(dt, map, babyRow, babyCol) {
    this.movedThisTick = false;

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

  render(ctx) {
    const progress = this.getMoveProgress();

    // 터널 통과(1칸 이상 점프) 시에는 보간하지 않는다
    const drawCol = Math.abs(this.prevCol - this.col) <= 1
      ? this.prevCol + (this.col - this.prevCol) * progress
      : this.col;
    const drawRow = Math.abs(this.prevRow - this.row) <= 1
      ? this.prevRow + (this.row - this.prevRow) * progress
      : this.row;

    const cx = (drawCol + 0.5) * TILE_SIZE;
    const cy = (drawRow + 0.5) * TILE_SIZE;
    const radius = TILE_SIZE / 2 - 2;

    // 몸통 (얼음은 남은 시간에 따라 원래 색으로 복귀)
    ctx.fillStyle = this.getBodyColor();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 눈 (화난 표정)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 3, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 3, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 3, 1.2, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 3, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 찡그린 입
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 3, 1.1 * Math.PI, 1.9 * Math.PI);
    ctx.stroke();
  }
}