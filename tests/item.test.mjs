/**
 * Pac-Baby: 아이템 섭취/리스폰 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Item } from '../src/item.js';
import {
  TILE_MAP, TILE_SIZE, ITEMS, ITEM_RESPAWN_MS,
  isWalkableTile, getItemSpawns,
} from '../src/constants.js';

const SPOT = getItemSpawns(TILE_MAP)[0];

test('아이템을 먹으면 점수를 돌려주고 사라진다', () => {
  const item = new Item(SPOT.row, SPOT.col, 'MILK');

  assert.equal(item.collected, false);
  assert.equal(item.config.score, ITEMS.MILK.score);

  const gained = item.collect();
  assert.equal(gained, ITEMS.MILK.score);
  assert.equal(item.collected, true);
  assert.equal(item.respawnTimer, ITEM_RESPAWN_MS);

  // 이미 먹은 아이템은 점수를 주지 않는다
  assert.equal(item.collect(), 0);
});

test('아이템은 15초 뒤 임의의 이동 가능 타일에 다시 나타난다', () => {
  const item = new Item(SPOT.row, SPOT.col, 'CANDY');
  item.collect();

  // 15초 직전에는 아직 사라진 상태
  item.update(ITEM_RESPAWN_MS - 1, TILE_MAP, () => 0.5);
  assert.equal(item.collected, true, '15초 전에는 다시 나타나지 않는다');

  const respawned = item.update(1, TILE_MAP, () => 0.5);
  assert.equal(respawned, true);
  assert.equal(item.collected, false);
  assert.ok(isWalkableTile(TILE_MAP, item.row, item.col), '이동 가능한 타일에 나타나야 한다');
  assert.equal(item.x, item.col * TILE_SIZE);
  assert.equal(item.y, item.row * TILE_SIZE);
});

test('리스폰 위치는 베이비/악당이 있는 타일을 피한다', () => {
  const item = new Item(SPOT.row, SPOT.col, 'COOKIE');
  item.collect();

  // 난수를 0.5 로 고정 → (14,14) 만 후보인데 그 자리를 피하면 60회 모두 실패
  const blocked = [{ row: 14, col: 14 }];
  const respawned = item.update(ITEM_RESPAWN_MS, TILE_MAP, () => 0.5, blocked);

  assert.equal(respawned, false);
  assert.equal(item.collected, true, '자리가 없으면 사라진 상태를 유지한다');
  assert.equal(item.respawnTimer, 1000, '1초 뒤 재시도하도록 예약한다');
});
