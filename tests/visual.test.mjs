/**
 * Pac-Baby: 상용화 비주얼 리디자인 검증 테스트
 *  - 아기방 테마 팔레트 (살구 피부 / 라벤더 놀이매트 / 민트 장난감 블록)
 *  - 모든 아이템이 OS 이모지(fillText) 없이 Canvas 2D 벡터로 그려지는지
 *  - 통통한 아기 실루엣(볼살 bulge)과 신경질적인 보모 표정(짜증 핏줄)
 *
 * 실행: node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Player from '../src/player.js';
import Enemy, { ENEMY_MODE } from '../src/enemy.js';
import { Item } from '../src/item.js';
import {
  COLORS, TILE_MAP, TILE_SIZE, getBabySpawn,
} from '../src/constants.js';

/**
 * 메서드 호출과 스타일 대입을 모두 기록하는 ctx 스텁.
 * - ellipse 는 의도적으로 숨겨 arc 폴백 경로를 검증한다 (테스트 스텁 호환성).
 */
function createRecordingCtx() {
  const calls = [];
  const target = { calls };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'ellipse') return undefined;
      if (prop in obj) return obj[prop];
      return (...args) => { calls.push({ name: prop, args }); };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      calls.push({ name: `set:${String(prop)}`, args: [value] });
      return true;
    },
  });
}

const stylesOf = (ctx, prop) => ctx.calls
  .filter(call => call.name === `set:${prop}`)
  .map(call => String(call.args[0]));

test('아기방 테마 팔레트: 살구 피부 + 라벤더 매트 + 민트 장난감 블록', () => {
  assert.equal(COLORS.BABY, '#ffd6ba', '아기 피부는 따뜻한 살구/복숭아 톤');
  assert.equal(COLORS.FLOOR, '#352f4d', '바닥은 라벤더/트와일라잇 매트');
  assert.equal(COLORS.FLOOR_ALT, '#3d3658');
  assert.equal(COLORS.WALL_TOP, '#6ec6b8', '벽 윗면은 파스텔 민트');
  assert.equal(COLORS.WALL_EDGE, '#b8f2e6', '벽 상단 림은 밝은 민트');
  assert.equal(COLORS.WALL, '#438a7e', '벽 앞면은 딥 민트');
  // 상태 구분용 기존 색은 유지 (게임 판독성)
  assert.equal(COLORS.ENEMY_PATROL, '#ffa726');
  assert.equal(COLORS.ENEMY_FROZEN, '#64b5f6');
});

test('모든 아이템은 OS 이모지 없이 Canvas 2D 벡터로 그린다', () => {
  const types = ['MILK', 'CANDY', 'COOKIE', 'GOLDEN', 'PACIFIER'];

  for (const type of types) {
    for (const dark of [false, true]) {
      const ctx = createRecordingCtx();
      const item = new Item(5, 9, type);

      assert.doesNotThrow(() => item.render(ctx, 1234, { dark }));
      assert.equal(
        ctx.calls.some(call => call.name === 'fillText'),
        false,
        `${type} 아이템이 fillText(OS 이모지)를 사용하면 안 된다`,
      );
      assert.ok(
        ctx.calls.some(call => call.name === 'arc'),
        `${type} 아이템은 Canvas 호(arc) 기반 벡터 도형을 그린다`,
      );
      assert.ok(
        ctx.calls.some(call => call.name === 'moveTo' || call.name === 'lineTo'),
        `${type} 아이템은 직선/곡선 경로로 외곽선을 만든다`,
      );
    }
  }
});

test('베이비는 통통한 볼살 bulge 를 가진 실루엣으로 그려진다', () => {
  const spawn = getBabySpawn(TILE_MAP);
  const player = new Player(spawn);
  const ctx = createRecordingCtx();

  assert.doesNotThrow(() => player.render(ctx, 0));

  const arcs = ctx.calls.filter(call => call.name === 'arc');
  const cx = (spawn.col + 0.5) * TILE_SIZE;
  const cy = (spawn.row + 0.5) * TILE_SIZE;

  // 첫 호는 몸통 기준 원 (기존 렌더 계약 유지)
  assert.deepEqual(arcs[0].args.slice(0, 3), [cx, cy, TILE_SIZE / 2 - 2]);
  // 좌우 볼살 bulge 가 몸통보다 아래쪽에 붙는다
  assert.ok(arcs.length >= 3, '볼살/기저귀/손발 등 여러 도형을 그린다');
  assert.ok(arcs[1].args[1] > cy && arcs[2].args[1] > cy, '볼살은 볼 아래쪽으로 퍼진다');
  assert.ok(stylesOf(ctx, 'fillStyle').includes(COLORS.BABY), '살구 피부톤으로 채운다');
});

test('보모는 추격 상태에서 짜증 핏줄(💢 벡터)과 앞치마를 그린다', () => {
  const chase = new Enemy({ row: 5, col: 9 }, 0, 0, ENEMY_MODE.CHASE);
  const ctx = createRecordingCtx();

  assert.doesNotThrow(() => chase.render(ctx, 777));

  assert.equal(
    ctx.calls.some(call => call.name === 'fillText'),
    false,
    '보모도 OS 이모지를 쓰지 않는다',
  );
  assert.ok(stylesOf(ctx, 'fillStyle').includes(COLORS.ENEMY), '추격 보모는 빨강/코랄 몸통');
  assert.ok(stylesOf(ctx, 'fillStyle').includes(COLORS.ENEMY_APRON), '빳빳한 앞치마');
  assert.ok(stylesOf(ctx, 'strokeStyle').includes(COLORS.ENEMY_ANGER), '짜증 핏줄 포인트');

  // 순찰 / 도망(FLEE) / 얼음(FROZEN) 상태도 예외 없이 렌더링된다
  const patrol = new Enemy({ row: 5, col: 9 }, 1, 0, ENEMY_MODE.PATROL);
  assert.doesNotThrow(() => patrol.render(createRecordingCtx(), 0));

  const flee = new Enemy({ row: 5, col: 9 }, 2, 0, ENEMY_MODE.CHASE);
  flee.startFlee(3000);
  assert.doesNotThrow(() => flee.render(createRecordingCtx(), 0));
  assert.equal(flee.isFleeing, true);

  const frozen = new Enemy({ row: 5, col: 9 }, 3, 0, ENEMY_MODE.CHASE);
  frozen.freeze(3000);
  assert.doesNotThrow(() => frozen.render(createRecordingCtx(), 0));
});
