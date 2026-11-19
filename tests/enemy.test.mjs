/**
 * Pac-Baby: 보모(악당) AI 단위 테스트
 *
 * 실행: npm test  (node --test tests/)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Enemy, { findNextStep, ENEMY_MODE } from '../src/enemy.js';
import {
  TILE_MAP, ENEMY_TILE_MS, PATROL_SAFE_DISTANCE, ENEMY_CONFUSE_MS, isWalkableTile,
  COLORS, getBabySpawn, getEnemySpawns,
} from '../src/constants.js';

const BABY = getBabySpawn(TILE_MAP);

test('findNextStep 는 벽을 피해 목표로 향하는 인접 칸을 돌려준다', () => {
  const start = { row: 12, col: 13 };
  const goal = { row: 5, col: 13 };

  const step = findNextStep(TILE_MAP, start.row, start.col, goal.row, goal.col, 0);

  assert.ok(step, '경로가 있어야 한다');
  assert.ok(isWalkableTile(TILE_MAP, step.row, step.col), '벽으로 이동하면 안 된다');
  assert.equal(
    Math.abs(step.row - start.row) + Math.abs(step.col - start.col), 1,
    '첫 칸은 현재 타일과 인접해야 한다',
  );
});

test('findNextStep 는 이미 목표 지점이면 null 을 돌려준다', () => {
  const step = findNextStep(TILE_MAP, 12, 13, 12, 13, 0);
  assert.equal(step, null);
});

test('findNextStep 는 도달할 수 없는 목표면 null 을 돌려준다', () => {
  // 벽 타일(1)을 목표로 지정
  const step = findNextStep(TILE_MAP, 13, 12, 0, 0, 0);
  assert.equal(step, null);
});

test('보모는 베이비에게 다가간다', () => {
  const enemy = new Enemy({ row: 12, col: 13 }, 0);
  const before = Math.abs(enemy.row - BABY.row) + Math.abs(enemy.col - BABY.col);

  for (let i = 0; i < 6; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  }

  const after = Math.abs(enemy.row - BABY.row) + Math.abs(enemy.col - BABY.col);
  assert.ok(after < before, `거리가 줄어야 한다 (${before} → ${after})`);
  assert.ok(isWalkableTile(TILE_MAP, enemy.row, enemy.col));
});

test('시작 지연 시간 동안은 움직이지 않는다', () => {
  const enemy = new Enemy({ row: 12, col: 13 }, 0, ENEMY_TILE_MS * 3);
  const start = { row: enemy.row, col: enemy.col };

  enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  assert.deepEqual({ row: enemy.row, col: enemy.col }, start, '지연 시간에는 제자리');

  for (let i = 0; i < 3; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  }
  assert.notDeepEqual({ row: enemy.row, col: enemy.col }, start, '지연 시간이 지나면 움직인다');
});

test('보모는 대기실을 벗어나 미로를 따라 이동한다', () => {
  const enemy = new Enemy({ row: 12, col: 13 }, 0);

  for (let i = 0; i < 40; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, 5, 5);
    assert.ok(
      isWalkableTile(TILE_MAP, enemy.row, enemy.col),
      `${i}번째 이동 후 벽에 들어갔다: (${enemy.row}, ${enemy.col})`,
    );
  }

  assert.ok(enemy.row < 12, '대기실(12행) 밖으로 나와야 한다');
});

test('경비 모드 보모는 베이비 대신 먼 곳을 순찰 목표로 삼는다', () => {
  const baby = { row: 13, col: 11 };
  // 난수를 0.5 로 고정 → (14,14) 는 베이비와 너무 가까워 다른(먼) 목표를 골라야 한다
  const enemy = new Enemy({ row: 3, col: 6 }, 2, 0, ENEMY_MODE.PATROL, () => 0.5);
  const start = { row: enemy.row, col: enemy.col };

  enemy.update(ENEMY_TILE_MS, TILE_MAP, baby.row, baby.col);

  assert.ok(enemy.guardTarget, '순찰 목표가 지정되어야 한다');

  const targetDistance = Math.abs(enemy.guardTarget.row - baby.row)
    + Math.abs(enemy.guardTarget.col - baby.col);
  assert.ok(
    targetDistance >= PATROL_SAFE_DISTANCE,
    `경비 목표가 베이비와 너무 가깝다 (거리 ${targetDistance})`,
  );

  for (let i = 0; i < 8; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, baby.row, baby.col);
    assert.ok(
      isWalkableTile(TILE_MAP, enemy.row, enemy.col),
      `${i}번째 순찰 후 벽에 들어갔다: (${enemy.row}, ${enemy.col})`,
    );
  }

  assert.notDeepEqual({ row: enemy.row, col: enemy.col }, start, '순찰로 이동해야 한다');
  assert.equal(enemy.mode, ENEMY_MODE.PATROL);
});

test('추격 모드는 순찰 목표를 만들지 않고 베이비에게 다가간다', () => {
  const baby = { row: 13, col: 11 };
  const chase = new Enemy({ row: 3, col: 6 }, 0, 0, ENEMY_MODE.CHASE, () => 0.5);
  const patrol = new Enemy({ row: 3, col: 6 }, 2, 0, ENEMY_MODE.PATROL, () => 0.5);

  const chaseBefore = Math.abs(chase.row - baby.row) + Math.abs(chase.col - baby.col);

  chase.update(ENEMY_TILE_MS, TILE_MAP, baby.row, baby.col);
  patrol.update(ENEMY_TILE_MS, TILE_MAP, baby.row, baby.col);

  assert.equal(chase.guardTarget, null, '추격 모드는 순찰 목표를 만들지 않는다');
  assert.ok(patrol.guardTarget, '경비 모드는 순찰 목표를 만든다');

  const chaseAfter = Math.abs(chase.row - baby.row) + Math.abs(chase.col - baby.col);
  assert.ok(chaseAfter < chaseBefore, `추격 모드는 가까워져야 한다 (${chaseBefore} → ${chaseAfter})`);
});

test('목표를 잃은 악당은 5초간 경비 후 추격으로 복귀한다', () => {
  const enemy = new Enemy({ row: 3, col: 6 }, 0, 0, ENEMY_MODE.CHASE, () => 0.5);

  assert.equal(enemy.loseTarget(ENEMY_CONFUSE_MS), true);
  assert.equal(enemy.mode, ENEMY_MODE.PATROL, '순찰 모드로 변신');
  assert.equal(enemy.confuseTimer, ENEMY_CONFUSE_MS);

  for (let i = 0; i < 10; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, 13, 11);
  }
  assert.equal(enemy.mode, ENEMY_MODE.PATROL, '아직 경비 모드');

  for (let i = 0; i < 20; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, 13, 11);
  }
  assert.equal(enemy.mode, ENEMY_MODE.CHASE, '5초 뒤 추격 복귀');

  // 경비 악당은 목표 상실의 영향을 받지 않는다
  const patrol = new Enemy({ row: 3, col: 6 }, 2, 0, ENEMY_MODE.PATROL, () => 0.5);
  assert.equal(patrol.loseTarget(ENEMY_CONFUSE_MS), false);
  assert.equal(patrol.mode, ENEMY_MODE.PATROL);
});

test('얼어붙은 보모는 움직이지 않고, 시간이 지나면 풀린다', () => {
  const enemy = new Enemy({ row: 12, col: 13 }, 0);
  const start = { row: enemy.row, col: enemy.col };

  enemy.freeze(ENEMY_TILE_MS * 2);
  enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  assert.equal(enemy.isFrozen, true);
  assert.deepEqual({ row: enemy.row, col: enemy.col }, start, '얼어 있는 동안은 제자리');

  enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  assert.equal(enemy.isFrozen, false, '2틱 뒤 얼음이 풀린다');

  enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  assert.notDeepEqual({ row: enemy.row, col: enemy.col }, start, '풀린 뒤에는 다시 움직인다');
});

test('트랩 감속은 1타일 이동 시간을 늘린다', () => {
  const enemy = new Enemy({ row: 12, col: 13 }, 0);
  const normal = enemy.getTileMs();

  enemy.applySlow(0.3, 10000);

  assert.ok(enemy.getTileMs() > normal, '감속되면 타일당 시간이 길어져야 한다');
  assert.equal(enemy.slowEffect, 0.3);
});

test('resetToSpawn 은 스폰 타일과 타이머를 초기화한다', () => {
  const spawn = getEnemySpawns(TILE_MAP)[0];
  const enemy = new Enemy(spawn, 0);

  for (let i = 0; i < 5; i++) {
    enemy.update(ENEMY_TILE_MS, TILE_MAP, BABY.row, BABY.col);
  }
  enemy.applySlow(0.2, 10000);
  enemy.resetToSpawn();

  assert.equal(enemy.row, spawn.row);
  assert.equal(enemy.col, spawn.col);
  assert.equal(enemy.prevRow, spawn.row);
  assert.equal(enemy.prevCol, spawn.col);
  assert.equal(enemy.moveAccum, 0);
  assert.equal(enemy.slowEffect, 0);
});

test('보간 계수는 0~1 범위다', () => {
  const enemy = new Enemy({ row: 12, col: 13 }, 0);
  assert.equal(enemy.getMoveProgress(), 0);

  enemy.update(ENEMY_TILE_MS / 2, TILE_MAP, BABY.row, BABY.col);
  const progress = enemy.getMoveProgress();
  assert.ok(progress > 0 && progress <= 1, `progress=${progress}`);
});

test('얼음 색상은 남은 시간에 따라 원래 색으로 돌아온다', () => {
  const patrol = new Enemy({ row: 3, col: 6 }, 2, 0, ENEMY_MODE.PATROL, () => 0.5);
  assert.equal(patrol.getBodyColor(), COLORS.ENEMY_PATROL, '얼지 않았을 때는 원래 색');

  patrol.freeze(10000);
  assert.equal(patrol.getBodyColor(), 'rgb(100, 181, 246)', '막 얼었을 때는 파랑');

  patrol.frozenTimer = 5000;
  const mid = patrol.getBodyColor().match(/\d+/g).map(Number);
  assert.ok(mid[0] > 100 && mid[0] < 255, `빨강이 중간값 (${mid[0]})`);
  assert.ok(mid[2] > 38 && mid[2] < 246, `파랑이 중간값 (${mid[2]})`);

  patrol.frozenTimer = 1;
  const almost = patrol.getBodyColor().match(/\d+/g).map(Number);
  assert.ok(almost[0] >= 250, '해제 직전에는 원래 색에 가깝다');
});

test('이미 얼어 있으면 더 긴 시간으로만 갱신된다', () => {
  const enemy = new Enemy({ row: 3, col: 6 }, 0);

  enemy.freeze(3000);
  assert.equal(enemy.frozenTimer, 3000);

  enemy.freeze(10000);
  assert.equal(enemy.frozenTimer, 10000, '긴 시간으로 연장');

  enemy.freeze(3000);
  assert.equal(enemy.frozenTimer, 10000, '짧은 시간으로 줄지 않는다');
  assert.equal(enemy.frozenTotal, 10000);
});

test('extendFreeze 는 얼림 시간을 더한다', () => {
  const enemy = new Enemy({ row: 3, col: 6 }, 0);

  enemy.extendFreeze(3000);
  assert.equal(enemy.isFrozen, true, '얼지 않았으면 새로 얼림');
  assert.equal(enemy.frozenTimer, 3000);

  enemy.extendFreeze(3000);
  assert.equal(enemy.frozenTimer, 6000, '이미 얼었으면 더한다');
  assert.equal(enemy.frozenTotal, 6000, '색 보간 기준도 갱신');
});
