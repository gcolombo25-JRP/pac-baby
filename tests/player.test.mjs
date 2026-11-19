/**
 * Pac-Baby: 베이비 이동 로직 단위 테스트
 *
 * 실행: npm test  (node --test tests/)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Player from '../src/player.js';
import {
  TILE_SIZE, TILE_MAP, PENALTY, ITEMS,
  STEALTH_DURATION_MS, STEALTH_COOLDOWN_MS,
  INPUT_BUFFER_MS, TICK_RATE,
  getBabySpawn,
} from '../src/constants.js';

const SPAWN = getBabySpawn(TILE_MAP);

/** 최소 CanvasRenderingContext2D 스텁 (호출 좌표 기록) */
function createStubCtx() {
  const arcs = [];
  return {
    arcs,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    beginPath() {},
    arc(x, y, r) { arcs.push({ x, y, r }); },
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
  };
}

test('베이비는 침대 스폰 타일에서 시작한다', () => {
  const player = new Player(SPAWN);

  assert.equal(player.row, SPAWN.row);
  assert.equal(player.col, SPAWN.col);
  assert.equal(player.x, SPAWN.col * TILE_SIZE);
  assert.equal(player.y, SPAWN.row * TILE_SIZE);
  assert.equal(player.prevRow, SPAWN.row);
  assert.equal(player.prevCol, SPAWN.col);
  assert.equal(player.score, 0);
});

test('벽 방향으로는 이동하지 않는다', () => {
  const player = new Player(SPAWN);
  assert.equal(TILE_MAP[SPAWN.row][SPAWN.col - 1], 1, '왼쪽이 벽이어야 하는 전제');

  player.setDirection('LEFT');
  player.update(TILE_MAP);

  assert.equal(player.col, SPAWN.col);
  assert.equal(player.row, SPAWN.row);
  assert.equal(player.isMoving, false);
  assert.equal(player.nextDirection, 'LEFT', '이동 불가 방향은 버퍼에 남는다');
});

test('이동 가능한 방향으로 한 타일씩 이동한다', () => {
  const player = new Player(SPAWN);

  player.setDirection('RIGHT');
  player.update(TILE_MAP);
  assert.equal(player.col, SPAWN.col + 1);
  assert.equal(player.row, SPAWN.row);
  assert.equal(player.x, (SPAWN.col + 1) * TILE_SIZE);
  assert.equal(player.prevCol, SPAWN.col);
  assert.equal(player.isMoving, true);

  player.update(TILE_MAP);
  assert.equal(player.col, SPAWN.col + 2, '입력이 유지되면 계속 이동한다');
});

test('이동 중 벽을 만나면 타일을 벗어나지 않는다', () => {
  const player = new Player(SPAWN);

  // 오른쪽으로 이동해 (row, col+1) 도착 → 그 위쪽은 이동 가능한지 먼저 확인
  player.setDirection('RIGHT');
  player.update(TILE_MAP);

  // 왼쪽으로 되돌아가려는 입력은 즉시 반영된다
  player.setDirection('LEFT');
  player.update(TILE_MAP);
  assert.equal(player.col, SPAWN.col);

  // 그 다음 계속 왼쪽은 벽 → 제자리
  player.update(TILE_MAP);
  assert.equal(player.col, SPAWN.col);
  assert.equal(player.isMoving, false);
});

test('좌우 터널을 통과하면 반대편 끝으로 이동한다', () => {
  const tunnelRow = 14;
  assert.equal(TILE_MAP[tunnelRow][0], 0, '터널 행의 양 끝은 뚫려 있어야 한다');
  assert.equal(TILE_MAP[tunnelRow][27], 0, '터널 행의 양 끝은 뚫려 있어야 한다');

  const leftPlayer = new Player({ row: tunnelRow, col: 0 });
  leftPlayer.setDirection('LEFT');
  leftPlayer.update(TILE_MAP);
  assert.equal(leftPlayer.col, 27);

  const rightPlayer = new Player({ row: tunnelRow, col: 27 });
  rightPlayer.setDirection('RIGHT');
  rightPlayer.update(TILE_MAP);
  assert.equal(rightPlayer.col, 0);
});

test('미리 눌러둔 방향은 이동 가능해지는 순간 적용된다 (입력 버퍼)', () => {
  // (5,9) 오른쪽으로 이동 중, 위쪽은 벽 → (5,12) 에서야 위로 갈 수 있다
  const player = new Player({ row: 5, col: 9 });
  player.direction = 'RIGHT';
  player.setDirection('UP');

  for (let i = 0; i < 4; i++) {
    player.update(TILE_MAP);
  }

  assert.equal(player.col, 12, '12열까지 이동');
  assert.equal(player.row, 4, '대기해 둔 UP 이 적용되어 위로 전환');
  assert.equal(player.direction, 'UP');
});

test('입력 버퍼 시간이 지나면 대기 방향이 사라진다', () => {
  const player = new Player(SPAWN);

  player.setDirection('LEFT'); // 왼쪽은 벽
  const ticks = Math.ceil(INPUT_BUFFER_MS / TICK_RATE) + 1;
  for (let i = 0; i < ticks; i++) {
    player.update(TILE_MAP);
  }

  assert.equal(player.col, SPAWN.col);
  assert.equal(player.nextDirection, null, '버퍼 시간이 지나면 입력이 사라진다');
});

test('아이템 섭취는 소화를 시작하고, 시간이 지나면 트랩이 배출된다', () => {
  const player = new Player(SPAWN);
  const config = ITEMS.MILK;

  player.startDigestion(config);
  assert.equal(player.digesting.length, 1);

  // 소화 시간 절반: 아직 배출되지 않음
  player.update(TILE_MAP, config.digestTime / 2);
  assert.equal(player.digesting.length, 1);
  assert.equal(player.takeExpelledTraps().length, 0);

  // 소화 완료
  player.update(TILE_MAP, config.digestTime / 2 + 1);
  const expelled = player.takeExpelledTraps();

  assert.equal(expelled.length, 1);
  assert.equal(expelled[0].trapType, 'PEE');
  assert.equal(expelled[0].slowEffect, 0.10);
  assert.equal(expelled[0].slowDuration, 10000);
  assert.equal(player.digesting.length, 0, '소화 트랙이 비워진다');

  // 꺼내 간 뒤에는 다시 비어 있다
  assert.equal(player.takeExpelledTraps().length, 0);
});

test('침대 스텔스: 발동 후 10초 지속, 종료 후 3초 재사용 대기', () => {
  const player = new Player(SPAWN);

  assert.equal(player.isStealthed, false);
  assert.equal(player.activateStealth(STEALTH_DURATION_MS), true);
  assert.equal(player.isStealthed, true);
  assert.equal(player.stealthTimer, STEALTH_DURATION_MS);
  assert.equal(player.activateStealth(STEALTH_DURATION_MS), false, '스텔스 중 재발동 불가');

  player.update(TILE_MAP, STEALTH_DURATION_MS); // 스텔스 종료
  assert.equal(player.isStealthed, false);
  assert.equal(player.stealthCooldown, STEALTH_COOLDOWN_MS);

  assert.equal(player.activateStealth(STEALTH_DURATION_MS), false, '쿨다운 중 발동 불가');

  player.update(TILE_MAP, STEALTH_COOLDOWN_MS); // 쿨다운 해제
  assert.equal(player.stealthCooldown, 0);
  assert.equal(player.activateStealth(STEALTH_DURATION_MS), true);
});

test('악당에게 잡히면 -200점 후 침대로 귀환한다', () => {
  const player = new Player(SPAWN);
  player.col += 1;
  player.x = player.col * TILE_SIZE;
  player.setDirection('RIGHT');
  player.direction = 'RIGHT';

  player.onCaught(SPAWN);

  assert.equal(player.score, PENALTY.CAUGHT);
  assert.equal(player.row, SPAWN.row);
  assert.equal(player.col, SPAWN.col);
  assert.equal(player.x, SPAWN.col * TILE_SIZE);
  assert.equal(player.prevCol, SPAWN.col);
  assert.equal(player.direction, null);
  assert.equal(player.isMoving, false);
});

test('렌더링은 tick 사이를 보간한다', () => {
  const player = new Player(SPAWN);
  const startCx = (SPAWN.col + 0.5) * TILE_SIZE;

  player.setDirection('RIGHT');
  player.update(TILE_MAP);

  const ctxStart = createStubCtx();
  player.render(ctxStart, 0);
  assert.deepEqual(ctxStart.arcs[0], {
    x: startCx, y: (SPAWN.row + 0.5) * TILE_SIZE, r: TILE_SIZE / 2 - 2,
  });

  const ctxEnd = createStubCtx();
  player.render(ctxEnd, 1);
  assert.deepEqual(ctxEnd.arcs[0], {
    x: (SPAWN.col + 1.5) * TILE_SIZE, y: (SPAWN.row + 0.5) * TILE_SIZE, r: TILE_SIZE / 2 - 2,
  });

  const ctxMid = createStubCtx();
  player.render(ctxMid, 0.5);
  assert.equal(ctxMid.arcs[0].x, (SPAWN.col + 1) * TILE_SIZE);
});
