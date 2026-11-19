/**
 * Pac-Baby: 봇(Bot) AI
 *
 * - 회피/아이템/황금 젖병 경로를 BFS 로 계산한다.
 * - 얼어붙은 악당은 위협에서 제외하고, 얼어붙은 타일은 안전하게 통과한다.
 * - 위협이 3타일 이내면 울기(Space) 사용을 판단한다.
 * - 황금 젖병이 있으면 최우선으로 향하고, 보행기 모드에서는 악당에게 돌진한다.
 */

import { isWalkableTile } from './constants.js';

/** 봇 판단 튜닝 값 */
export const BOT = {
  CRY_RADIUS_TILES: 2,       // 1~2타일 내 위협 + 도망 불가일 때만 울기
  ESCAPE_TRIGGER_TILES: 3,   // 이 거리 안의 위협이면 회피 경로 탐색
  ESCAPE_DEPTH: 8,           // 회피 경로를 내다보는 최대 타일 수
  GOLDEN_PURSUIT_RADIUS: 9,  // 황금 젖병을 추격할 최대 거리
  GOLDEN_PRIORITY_MARGIN: 2, // 일반 아이템보다 이만큼 가까울 때만 황금 우선
  POWER_ITEM_RADIUS: 8,      // 캔디/쿠키를 우선하는 근접 거리
  CANDY_BONUS: 3,            // 캔디 경로 비용 할인 (슈가 러시)
  COOKIE_BONUS: 2,           // 쿠키 경로 비용 할인 (고득점/트랩)
  SUGAR_RUSH_CANDY_BONUS: 1, // 이미 슈가 러시 중이면 캔디 우선순위를 낮춘다
};

const DIRS = [
  { name: 'UP', dr: -1, dc: 0 },
  { name: 'DOWN', dr: 1, dc: 0 },
  { name: 'LEFT', dr: 0, dc: -1 },
  { name: 'RIGHT', dr: 0, dc: 1 },
];

function tileKey(row, col) {
  return `${row},${col}`;
}

/** Game / 최소 테스트 오브젝트에서 이동용 2D 맵을 얻는다 */
function getMap(game) {
  if (!game) return null;
  if (game.navMap) return game.navMap;
  if (Array.isArray(game.map)) return game.map;
  if (game.map && Array.isArray(game.map.map)) return game.map.map;
  return null;
}

/** 좌우 터널을 고려해 인접 타일을 순회한다 */
function forEachNeighbor(map, row, col, fn) {
  const cols = map[0]?.length || 0;
  for (const dir of DIRS) {
    let nr = row + dir.dr;
    let nc = col + dir.dc;
    if (nc < 0) nc = cols - 1;
    else if (nc >= cols) nc = 0;

    if (!isWalkableTile(map, nr, nc)) continue;
    fn(nr, nc, dir.name);
  }
}

/** 인접한 두 타일로부터 방향을 구한다 (좌우 터널 포함) */
function directionTo(from, to) {
  if (!from || !to) return null;
  if (to.row === from.row - 1 && to.col === from.col) return 'UP';
  if (to.row === from.row + 1 && to.col === from.col) return 'DOWN';
  if (to.row === from.row) {
    if (from.col === 0 && to.col > 1) return 'LEFT';
    if (from.col > 1 && to.col === 0) return 'RIGHT';
    if (to.col === from.col - 1) return 'LEFT';
    if (to.col === from.col + 1) return 'RIGHT';
  }
  return null;
}

/**
 * BFS 로 시작 타일에서 각 타일까지의 거리와 첫 이동 칸을 계산한다.
 * @param {number[][]} map
 * @param {{row:number,col:number}} start
 * @param {{blocked?: Set<string>, maxDepth?: number}} [options]
 */
function bfsFrom(map, start, options = {}) {
  const rows = map.length;
  const cols = map[0]?.length || 0;
  const dist = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  const first = new Map();
  if (!start || !Number.isFinite(start.row) || !Number.isFinite(start.col)) {
    return { dist, first };
  }

  const blocked = options.blocked || null;
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : Infinity;

  dist[start.row][start.col] = 0;
  const queue = [{ row: start.row, col: start.col }];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const depth = dist[current.row][current.col];
    if (depth >= maxDepth) continue;

    forEachNeighbor(map, current.row, current.col, (nr, nc) => {
      if (blocked && blocked.has(tileKey(nr, nc))) return;
      if (dist[nr][nc] !== Infinity) return;

      dist[nr][nc] = depth + 1;
      const step = depth === 0
        ? { row: nr, col: nc }
        : first.get(tileKey(current.row, current.col));
      if (step) first.set(tileKey(nr, nc), step);
      queue.push({ row: nr, col: nc });
    });
  }

  return { dist, first };
}

/**
 * 악당 위치들로부터의 최단 거리 지도 (multi-source BFS).
 * 얼어붙은 악당은 호출부에서 제외한 뒤 넘긴다.
 */
function threatDistances(map, threats) {
  const rows = map.length;
  const cols = map[0]?.length || 0;
  const dist = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  if (!threats || threats.length === 0) return dist;

  const queue = [];
  for (const threat of threats) {
    if (!threat) continue;
    if (threat.row < 0 || threat.row >= rows) continue;
    if (threat.col < 0 || threat.col >= cols) continue;
    if (dist[threat.row][threat.col] !== 0) {
      dist[threat.row][threat.col] = 0;
      queue.push({ row: threat.row, col: threat.col });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const depth = dist[current.row][current.col];
    forEachNeighbor(map, current.row, current.col, (nr, nc) => {
      if (dist[nr][nc] !== Infinity) return;
      dist[nr][nc] = depth + 1;
      queue.push({ row: nr, col: nc });
    });
  }

  return dist;
}

function blockedTiles(threats) {
  const blocked = new Set();
  for (const threat of threats || []) {
    if (threat) blocked.add(tileKey(threat.row, threat.col));
  }
  return blocked;
}

function mobilityOf(map, row, col, blocked) {
  let count = 0;
  forEachNeighbor(map, row, col, (nr, nc) => {
    if (blocked && blocked.has(tileKey(nr, nc))) return;
    count += 1;
  });
  return count;
}

export default class BotBrain {
  constructor() {
    this.lastMode = 'IDLE';
    this.lastTarget = null;
  }

  /** 현재 위협적인 악당 (얼어붙은 악당/보행기 모드/스텔스 중에는 없음) */
  activeThreats(game) {
    if (!game) return [];
    if (game.goldenTimer > 0) return [];   // 보행기 모드: 무적 + 악당 도망
    if (game.player?.isStealthed) return [];
    return (game.enemies || []).filter(enemy => enemy && !enemy.isFrozen);
  }

  /**
   * 위기 시 울기 사용 여부.
   * - 근처 1~2타일 내 위협이 있고
   * - 실제로 안전한 도주 칸이 없을 때만 true.
   * 쿨다운/스텔스/보행기 모드에서는 사용하지 않는다.
   */
  shouldCry(game) {
    if (!game || game.state !== 'PLAYING') return false;
    if ((game.cryCooldown || 0) > 0) return false;
    if (!game.enemies || game.enemies.length === 0) return false;
    if (game.goldenTimer > 0) return false;
    if (game.player?.isStealthed) return false;
    if (game.tester?.flags?.invincible) return false;

    const map = getMap(game);
    if (!map || !game.player) return false;

    const threats = this.activeThreats(game);
    if (threats.length === 0) return false;

    const dist = threatDistances(map, threats);
    const d = dist[game.player.row]?.[game.player.col];
    if (!Number.isFinite(d) || d > BOT.CRY_RADIUS_TILES) return false;

    // 이미 같은 타일에 악당이 있으면 최우선 탈출
    if (d === 0) return true;

    // 한 칸이라도 위협에서 멀어지는 길이 있으면 울기를 아낀다.
    return !this._hasSafeEscape(map, game.player, threats, dist, d);
  }

  /** 현재 타일에서 위협 거리를 늘릴 수 있는 인접 칸이 있는지 */
  _hasSafeEscape(map, player, threats, threatDist, currentDist) {
    const blocked = blockedTiles(threats);
    let safe = false;

    forEachNeighbor(map, player.row, player.col, (nr, nc) => {
      if (safe || blocked.has(tileKey(nr, nc))) return;
      const nextDist = threatDist[nr]?.[nc];
      if (!Number.isFinite(nextDist) || nextDist > currentDist) safe = true;
    });

    return safe;
  }

  /** 가장 가까운 일반 아이템까지의 맨해튼 거리 (없으면 Infinity) */
  _nearestItemDistance(game, player) {
    let nearest = Infinity;
    for (const item of game.items || []) {
      if (!item || item.collected) continue;
      const d = Math.abs(item.row - player.row) + Math.abs(item.col - player.col);
      if (d < nearest) nearest = d;
    }
    return nearest;
  }

  /**
   * 이번 틱에 사용할 방향을 결정한다.
   * 우선순위: 회피 > 황금 젖병 > 일반 아이템
   * (보행기 모드 중에는 회피 대신 악당에게 돌진)
   * @param {object} game
   * @returns {string|null}
   */
  decide(game) {
    if (!game || !game.player) return null;
    const map = getMap(game);
    if (!map) return null;

    const player = game.player;
    const threats = this.activeThreats(game);

    // 1) 위협이 가까우면 안전한 경로로 회피
    if (threats.length > 0) {
      const threatDist = threatDistances(map, threats);
      const near = threatDist[player.row]?.[player.col];
      if (Number.isFinite(near) && near <= BOT.ESCAPE_TRIGGER_TILES) {
        const escape = this._escapeDirection(game, map, threats, threatDist);
        if (escape) {
          this.lastMode = 'ESCAPE';
          return escape;
        }
      }
    }

    // 2) 보행기 모드: 도망치지 않고 가장 가까운 악당에게 돌진
    if (game.goldenTimer > 0) {
      const charge = this._chargeDirection(game, map);
      if (charge) {
        this.lastMode = 'CHARGE';
        return charge;
      }
    }

    // 3) 황금 젖병은 주변에 아이템이 없거나, 충분히 가까울 때만 우선한다.
    if (game.goldenBottle && !game.goldenBottle.collected) {
      const goldenDist = Math.abs(game.goldenBottle.row - player.row)
        + Math.abs(game.goldenBottle.col - player.col);
      const nearestItemDist = this._nearestItemDistance(game, player);
      const itemExists = Number.isFinite(nearestItemDist);
      const canPursue = !itemExists
        || (goldenDist <= BOT.GOLDEN_PURSUIT_RADIUS
          && goldenDist <= nearestItemDist + BOT.GOLDEN_PRIORITY_MARGIN);

      if (canPursue) {
        const golden = this._directionToTarget(game, map, game.goldenBottle, threats);
        if (golden) {
          this.lastMode = 'GOLDEN';
          this.lastTarget = {
            row: game.goldenBottle.row,
            col: game.goldenBottle.col,
            type: 'GOLDEN',
          };
          return golden;
        }
      }
    }

    // 4) 일반 아이템 (캔디/쿠키는 근접 시 우선)
    const item = this._itemDirection(game, map, threats);
    this.lastMode = item ? 'ITEM' : 'IDLE';
    return item;
  }

  /** 위협에서 멀어지면서 막다른 길을 피하는 첫 칸 */
  _escapeDirection(game, map, threats, threatDist) {
    const player = game.player;
    const blocked = blockedTiles(threats);
    const { dist, first } = bfsFrom(map, player, {
      blocked,
      maxDepth: BOT.ESCAPE_DEPTH,
    });

    let best = null;
    let bestScore = -Infinity;

    for (let row = 0; row < map.length; row++) {
      for (let col = 0; col < (map[row]?.length || 0); col++) {
        const depth = dist[row][col];
        if (!Number.isFinite(depth) || depth === 0) continue;

        const rawSafety = threatDist[row]?.[col];
        const safety = Number.isFinite(rawSafety) ? rawSafety : 99;
        const mobility = mobilityOf(map, row, col, blocked);
        const deadEndPenalty = mobility === 0 ? 120 : 0;
        // 안전거리가 가장 중요하고, 막다른 길은 강하게 감점, 너무 멀리 도는 것은 약간 감점
        const score = safety * 100 + mobility * 6 - depth * 0.5 - deadEndPenalty;

        if (score > bestScore) {
          bestScore = score;
          best = { row, col, first: first.get(tileKey(row, col)) };
        }
      }
    }

    if (!best || !best.first) return null;
    return directionTo(player, best.first);
  }

  /** 보행기 모드: 가장 가까운 악당에게 돌진 */
  _chargeDirection(game, map) {
    const player = game.player;
    const enemies = (game.enemies || []).filter(Boolean);
    if (enemies.length === 0) return null;

    const { dist, first } = bfsFrom(map, player);
    let target = null;
    let targetDist = Infinity;

    for (const enemy of enemies) {
      if (enemy.row === player.row && enemy.col === player.col) continue;
      const d = dist[enemy.row]?.[enemy.col];
      if (!Number.isFinite(d)) continue;
      if (d < targetDist) {
        targetDist = d;
        target = enemy;
      }
    }

    if (!target) return null;
    const step = first.get(tileKey(target.row, target.col));
    if (!step) return null;

    this.lastTarget = { row: target.row, col: target.col, type: 'ENEMY' };
    return directionTo(player, step);
  }

  /** 황금 젖병/아이템 한 지점으로 향하는 첫 칸 (위협 타일은 우회) */
  _directionToTarget(game, map, target, threats) {
    const player = game.player;
    const blocked = blockedTiles(threats);
    // 목표 타일 위의 악당은 황금 젖병 획득과 동시에 처리될 수 있으므로 허용
    blocked.delete(tileKey(target.row, target.col));

    const { dist, first } = bfsFrom(map, player, { blocked });
    if (!Number.isFinite(dist[target.row]?.[target.col])) return null;

    const step = first.get(tileKey(target.row, target.col));
    if (!step) return null;
    return directionTo(player, step);
  }

  /** 캔디/쿠키 우선순위를 반영한 가장 가까운 아이템 */
  _itemDirection(game, map, threats) {
    const player = game.player;
    const blocked = blockedTiles(threats);
    const { dist, first } = bfsFrom(map, player, { blocked });

    let best = null;
    let bestScore = Infinity;
    let bestDist = Infinity;

    for (const item of game.items || []) {
      if (!item || item.collected) continue;

      const d = dist[item.row]?.[item.col];
      if (!Number.isFinite(d) || d === 0) continue;

      let bonus = 0;
      if (d <= BOT.POWER_ITEM_RADIUS) {
        if (item.type === 'CANDY') {
          bonus = game.sugarRushTimer > 0
            ? BOT.SUGAR_RUSH_CANDY_BONUS
            : BOT.CANDY_BONUS;
        } else if (item.type === 'COOKIE') {
          bonus = BOT.COOKIE_BONUS;
        }
      }

      const score = d - bonus;
      if (score < bestScore || (score === bestScore && d < bestDist)) {
        bestScore = score;
        bestDist = d;
        best = item;
      }
    }

    if (!best) return null;
    const step = first.get(tileKey(best.row, best.col));
    if (!step) return null;

    this.lastTarget = { row: best.row, col: best.col, type: best.type };
    return directionTo(player, step);
  }
}
