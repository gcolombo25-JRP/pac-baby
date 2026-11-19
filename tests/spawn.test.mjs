/**
 * Pac-Baby: 악당 랜덤 스폰 계획 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEnemySpawnPlan, isCenterSpawnZone } from '../src/enemy.js';
import { TILE_MAP } from '../src/constants.js';

/** 간단한 결정적 LCG (테스트 재현용) */
function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('악당은 중앙을 제외한 8개 구역의 바닥에서 2칸 이상 떨어져 스폰된다', () => {
  const rows = TILE_MAP.length;
  const cols = TILE_MAP[0].length;

  for (let seed = 1; seed <= 12; seed++) {
    const spawns = createEnemySpawnPlan(TILE_MAP, 6, seededRng(seed));
    assert.equal(spawns.length, 6, `seed ${seed}: 6마리 스폰`);
    assert.equal(
      new Set(spawns.map(pos => `${pos.row},${pos.col}`)).size,
      spawns.length,
      '스폰 타일 중복 금지',
    );

    for (const pos of spawns) {
      assert.equal(TILE_MAP[pos.row][pos.col], 0, '일반 바닥(0)만 사용');
      assert.equal(
        isCenterSpawnZone(pos.row, pos.col, rows, cols),
        false,
        '중앙(2행 2열) 구역 제외',
      );
    }

    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        const distance = Math.abs(spawns[i].row - spawns[j].row)
          + Math.abs(spawns[i].col - spawns[j].col);
        assert.ok(distance >= 2, `seed ${seed}: 스폰 간 거리 ${distance} >= 2`);
      }
    }
  }
});

test('스폰 계획은 요청한 수만큼 반환하고, 시드에 따라 달라진다', () => {
  const first = createEnemySpawnPlan(TILE_MAP, 4, seededRng(1));
  const second = createEnemySpawnPlan(TILE_MAP, 4, seededRng(2));

  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.notDeepEqual(first, second, '랜덤 스폰이 매번 고정되지 않는다');
});
