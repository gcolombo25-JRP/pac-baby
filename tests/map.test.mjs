/**
 * Pac-Baby: 맵 무결성 스모크 테스트
 *
 * 실행: npm test  (node --test tests/)
 *
 * 검증 항목
 *  1) 맵 크기가 COLS x ROWS 인지
 *  2) 값이 0~4 범위인지
 *  3) 베이비/악당/아이템 스폰 타일이 모두 존재하는지
 *  4) 베이비 스폰에서 모든 스폰 타일로 이동 가능한지 (BFS)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLS, ROWS, TILE_MAP, TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT,
  WALL_PALETTES,
  getBabySpawn, getEnemySpawns, getItemSpawns,
} from '../src/constants.js';
import MapRenderer from '../src/map.js';

/** 호출을 기록하는 최소 ctx 스텁 */
function createStubCtx() {
  const calls = [];
  return new Proxy({ calls }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { calls.push({ name: prop, args }); };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}

/** 이동 가능 여부 (map.js 의 isWalkable 과 동일 규칙: 벽(1)만 불가) */
function isWalkable(map, row, col) {
  if (row < 0 || row >= map.length) return false;
  if (col < 0 || col >= map[row].length) return false;
  return map[row][col] !== 1;
}

/** BFS 로 start 에서 도달 가능한 모든 타일 수집 */
function reachableFrom(map, start) {
  const seen = new Set();
  const queue = [start];
  seen.add(`${start.row},${start.col}`);

  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (queue.length > 0) {
    const { row, col } = queue.shift();
    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      const key = `${nr},${nc}`;
      if (seen.has(key)) continue;
      if (!isWalkable(map, nr, nc)) continue;
      seen.add(key);
      queue.push({ row: nr, col: nc });
    }
  }
  return seen;
}

test('맵은 ROWS x COLS 크기다', () => {
  assert.equal(TILE_MAP.length, ROWS, '행 수가 ROWS 와 다릅니다');
  TILE_MAP.forEach((row, index) => {
    assert.equal(row.length, COLS, `${index}행의 열 수가 COLS 와 다릅니다`);
  });
});

test('타일 값은 0~4 범위다', () => {
  TILE_MAP.forEach((row, r) => {
    row.forEach((tile, c) => {
      assert.ok(
        Number.isInteger(tile) && tile >= 0 && tile <= 4,
        `(${r}, ${c}) 타일 값이 유효하지 않습니다: ${tile}`,
      );
    });
  });
});

test('베이비/악당/아이템 스폰 타일이 존재한다', () => {
  assert.ok(getBabySpawn(TILE_MAP), '베이비 스폰(2) 타일이 없습니다');
  assert.ok(getEnemySpawns(TILE_MAP).length > 0, '악당 스폰(3) 타일이 없습니다');
  assert.ok(getItemSpawns(TILE_MAP).length > 0, '아이템 스폰(4) 타일이 없습니다');
});

test('베이비 스폰에서 모든 스폰 타일로 이동할 수 있다', () => {
  const start = getBabySpawn(TILE_MAP);
  const reachable = reachableFrom(TILE_MAP, start);

  const targets = [
    ...getEnemySpawns(TILE_MAP).map(pos => ({ ...pos, label: '악당 스폰' })),
    ...getItemSpawns(TILE_MAP).map(pos => ({ ...pos, label: '아이템 스폰' })),
  ];

  for (const target of targets) {
    assert.ok(
      reachable.has(`${target.row},${target.col}`),
      `${target.label} (${target.row}, ${target.col}) 에 도달할 수 없습니다`,
    );
  }
});

test('악당 스폰은 베이비 스폰에서 충분히 떨어져 있다', () => {
  const baby = getBabySpawn(TILE_MAP);
  const spawns = getEnemySpawns(TILE_MAP);

  assert.equal(spawns.length, 4, '악당은 4마리');

  for (const pos of spawns) {
    const distance = Math.abs(pos.row - baby.row) + Math.abs(pos.col - baby.col);
    assert.ok(
      distance >= 8,
      `악당 스폰 (${pos.row}, ${pos.col}) 이 베이비와 너무 가깝습니다 (거리 ${distance})`,
    );
  }
});

test('아이템 스폰은 12곳이다 (기존 4곳의 3배)', () => {
  const spawns = getItemSpawns(TILE_MAP);

  assert.equal(spawns.length, 12);
  assert.equal(
    new Set(spawns.map(p => `${p.row},${p.col}`)).size,
    spawns.length,
    '아이템 스폰 위치가 중복되면 안 된다',
  );
});

test('미로가 고립된 구역 없이 연결되어 있다', () => {
  const start = getBabySpawn(TILE_MAP);
  const reachable = reachableFrom(TILE_MAP, start);

  let walkable = 0;
  for (let r = 0; r < TILE_MAP.length; r++) {
    for (let c = 0; c < TILE_MAP[r].length; c++) {
      if (TILE_MAP[r][c] !== 1) walkable++;
    }
  }

  assert.equal(
    reachable.size, walkable,
    `도달 불가 타일이 ${walkable - reachable.size}개 있습니다`,
  );
});

test('브라우저 환경에서는 맵을 1회만 그려 캐시하고 매 프레임 blit 한다', () => {
  const cacheCtx = createStubCtx();
  const cacheCanvas = { width: 0, height: 0, getContext: () => cacheCtx };
  globalThis.document = { createElement: () => cacheCanvas };

  try {
    const map = new MapRenderer();
    const screenCtx = createStubCtx();

    map.render(screenCtx);
    map.render(screenCtx);

    const cacheRects = cacheCtx.calls.filter(c => c.name === 'fillRect').length;
    assert.equal(cacheRects, ROWS * COLS + 4, '타일은 캐시 생성 시 1회만 그린다');

    const blits = screenCtx.calls.filter(c => c.name === 'drawImage');
    assert.equal(blits.length, 2, '매 프레임 drawImage 로 blit 한다');
    assert.equal(blits[0].args[0], cacheCanvas);
  } finally {
    delete globalThis.document;
  }
});

test('레티나 배율에서는 맵 캐시도 고해상도로 만든다', () => {
  const cacheCtx = createStubCtx();
  const cacheCanvas = { width: 0, height: 0, getContext: () => cacheCtx };
  globalThis.document = { createElement: () => cacheCanvas };

  try {
    const map = new MapRenderer();
    map.setPixelRatio(2);
    map.render(createStubCtx());

    assert.equal(cacheCanvas.width, CANVAS_WIDTH * 2);
    assert.equal(cacheCanvas.height, CANVAS_HEIGHT * 2);
    assert.ok(
      cacheCtx.calls.some(c => c.name === 'setTransform' && c.args[0] === 2),
      '캐시 ctx 도 2배 변환으로 논리 좌표를 그린다',
    );
  } finally {
    delete globalThis.document;
  }
});

test('스텔스 침대는 캐시 위에 파란색으로 덧그린다', () => {
  const cacheCtx = createStubCtx();
  const cacheCanvas = { width: 0, height: 0, getContext: () => cacheCtx };
  globalThis.document = { createElement: () => cacheCanvas };

  try {
    const map = new MapRenderer();
    const screenCtx = createStubCtx();

    map.render(screenCtx);
    const before = screenCtx.calls.filter(c => c.name === 'fillRect').length;

    map.highlightBed = { row: 13, col: 11 };
    map.render(screenCtx);
    const after = screenCtx.calls.filter(c => c.name === 'fillRect').length;

    assert.equal(after - before, 2, '침대 1개(바닥+사각형)를 덧그린다');
  } finally {
    delete globalThis.document;
  }
});

test('연결된 벽 덩어리는 여러 파스텔 팔레트로 비대칭 배분된다', () => {
  const map = new MapRenderer();
  const islands = map._getWallIslands();

  assert.ok(islands.length >= 4, `벽 Island 가 충분히 나뉘어야 한다 (${islands.length})`);

  // 팔레트 필수 키 검증 (3D 입체 연출에 필요한 색상 세트)
  for (const palette of WALL_PALETTES) {
    for (const key of ['top', 'frontTop', 'frontMid', 'frontBottom', 'rim', 'seam', 'emboss']) {
      assert.ok(palette[key], `${palette.name} 팔레트에 ${key} 색이 필요합니다`);
    }
  }

  const usedColors = new Set(islands.map(island => island.palette.top));
  assert.ok(usedColors.size >= 4, `최소 4가지 파스텔이 섞여야 한다 (${usedColors.size})`);

  // 서로 맞닿은 Island 는 같은 색을 쓰지 않는다 → 벽 경계가 뭉개지지 않는다
  for (const island of islands) {
    for (const neighborId of island.neighbors) {
      assert.notEqual(
        islands[neighborId].palette.top,
        island.palette.top,
        `인접 Island ${island.id} / ${neighborId} 색이 같습니다`,
      );
    }
  }

  // 색이 한쪽으로 과도하게 몰리지 않는다 (조화로운 분배)
  const counts = new Map();
  for (const island of islands) {
    counts.set(island.palette.top, (counts.get(island.palette.top) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  assert.ok(
    maxCount <= Math.ceil(islands.length / 2),
    `한 팔레트가 과도하게 몰렸습니다 (${maxCount}/${islands.length})`,
  );
});

test('벽 윗면은 인접 타일과 0.6px 겹쳐 채워 구분선이 비치지 않는다', () => {
  const cacheCtx = createStubCtx();
  const cacheCanvas = { width: 0, height: 0, getContext: () => cacheCtx };
  globalThis.document = { createElement: () => cacheCanvas };

  try {
    const map = new MapRenderer();
    map.render(createStubCtx());

    const wallTiles = TILE_MAP.reduce(
      (sum, row) => sum + row.filter(tile => tile === 1).length,
      0,
    );
    const expanded = cacheCtx.calls.filter(
      call => call.name === 'fillRect'
        && call.args[2] > TILE_SIZE
        && call.args[3] > TILE_SIZE,
    );
    assert.equal(expanded.length, wallTiles, '모든 벽 타일이 겹침 채움으로 그려져야 한다');
    for (const call of expanded) {
      assert.ok(call.args[2] >= TILE_SIZE + 1, '가로로 0.5px 이상 겹친다');
      assert.ok(call.args[3] >= TILE_SIZE + 1, '세로로 0.5px 이상 겹친다');
    }
  } finally {
    delete globalThis.document;
  }
});

test('넓은 벽 블록에는 애기풍 엠보싱 도장을 save/restore 균형 속에 새긴다', () => {
  const map = new MapRenderer();
  const islands = map._getWallIslands();
  const stamps = islands.filter(island => island.stamp);

  assert.ok(stamps.length > 0, '2x2 이상 블록에 도장이 배정되어야 한다');
  assert.ok(
    new Set(stamps.map(island => island.stamp.symbol)).size >= 3,
    '구름/별/초승달/하트/곰돌이 중 여러 도장이 섞여야 한다',
  );

  const ctx = createStubCtx();
  assert.doesNotThrow(() => map._drawTiles(ctx));

  const nameCount = name => ctx.calls.filter(call => call.name === name).length;
  assert.equal(nameCount('save'), nameCount('restore'), 'save/restore 는 항상 균형을 이룬다');
  assert.equal(nameCount('bezierCurveTo'), 0, '최소 스텁에 없는 bezierCurveTo 를 쓰지 않는다');

  // 도장 경로 자체는 roundRect/ellipse 없이 arc/lineTo 만 사용한다 (최소 ctx 스텁 호환)
  const stampCtx = createStubCtx();
  assert.doesNotThrow(() => map._drawWallStamps(stampCtx, stamps));
  const stampCount = name => stampCtx.calls.filter(call => call.name === name).length;
  assert.equal(stampCount('roundRect'), 0, '도장은 roundRect 에 의존하지 않는다');
  assert.equal(stampCount('ellipse'), 0, '도장은 ellipse 에 의존하지 않는다');
  assert.equal(stampCount('bezierCurveTo'), 0, '도장은 bezierCurveTo 에 의존하지 않는다');
  assert.ok(stampCount('arc') > 0, '도장은 arc 기반 기본 경로로 그린다');
  assert.ok(stampCount('lineTo') > 0, '초승달/하트/별은 lineTo 경로를 쓴다');
  assert.equal(stampCount('save'), stampCount('restore'), '도장 save/restore 균형');
});
