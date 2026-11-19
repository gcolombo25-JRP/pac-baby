/**
 * Pac-Baby: 시각 효과(파티클/플래시/셰이크) 단위 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Effects from '../src/effects.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/constants.js';

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

test('아이템 반짝이는 노란 파티클을 만든다', () => {
  const fx = new Effects();
  fx.rng = () => 0.5;

  const count = fx.burstSparkle(1, 9);

  assert.equal(count, 10);
  assert.equal(fx.particles.length, 10);
  assert.ok(fx.particles.every(p => p.kind === 'sparkle'));
  assert.ok(fx.particles.every(p => ['#ffe082', '#fff59d', '#ffd54f'].includes(p.color)));
});

test('트랩 물방울은 지정한 트랩 색을 쓴다', () => {
  const fx = new Effects();
  fx.rng = () => 0.5;

  fx.burstDrops(2, 3, '#5d4037');

  assert.ok(fx.particles.length > 0);
  assert.ok(fx.particles.every(p => p.kind === 'drop' && p.color === '#5d4037'));
});

test('얼음 파티클은 푸른색 계열이다', () => {
  const fx = new Effects();
  fx.burstIce(0, 0);

  assert.ok(fx.particles.length > 0);
  assert.ok(fx.particles.every(p => p.kind === 'ice'));
  assert.ok(fx.particles.every(p => ['#64b5f6', '#bbdefb', '#e3f2fd'].includes(p.color)));
});

test('눈물 파티클은 하늘색 계열의 tear 종류다', () => {
  const fx = new Effects();
  const count = fx.burstTears(2, 3);

  assert.ok(count > 0);
  assert.equal(fx.particles.length, count);
  assert.ok(fx.particles.every(p => p.kind === 'tear'));
  assert.ok(
    fx.particles.every(p => ['#81d4fa', '#4fc3f7', '#b3e5fc', '#e1f5fe'].includes(p.color)),
  );
});

test('충격파 링은 시간이 지나면 퍼지고 사라진다', () => {
  const fx = new Effects();
  const ring = fx.shockwave(1, 2, '#9be7ff', 90, 0.5);

  assert.equal(fx.rings.length, 1);
  assert.equal(ring.maxRadius, 90);

  fx.update(0.2);
  assert.equal(fx.rings.length, 1);

  fx.update(0.4);
  assert.equal(fx.rings.length, 0);
});

test('파티클은 수명이 끝나면 사라진다', () => {
  const fx = new Effects();
  fx.burstSparkle(1, 1);
  assert.ok(fx.particles.length > 0);

  fx.update(2); // 충분히 긴 시간

  assert.equal(fx.particles.length, 0);
});

test('플래시는 시간에 따라 사라진다', () => {
  const fx = new Effects();
  fx.flashScreen('#64b5f6', 0.4, 0.3);

  assert.ok(fx.flash);
  assert.equal(fx.flash.alpha, 0.4);

  fx.update(0.15);
  assert.ok(fx.flash && fx.flash.life > 0);

  fx.update(0.2);
  assert.equal(fx.flash, null);
});

test('셰이크는 0.2초 동안 오프셋을 만들고 끝나면 0 이 된다', () => {
  const fx = new Effects();
  let seed = 0;
  fx.rng = () => { seed = (seed + 0.37) % 1; return seed; };

  fx.shake(0.2, 6);
  fx.update(0.05);

  assert.ok(fx.shakeTimer > 0);
  const offset = fx.getShakeOffset();
  assert.ok(Math.abs(offset.x) > 0 || Math.abs(offset.y) > 0, '오프셋이 생긴다');

  fx.update(0.3);
  assert.equal(fx.shakeTimer, 0);
  assert.deepEqual(fx.getShakeOffset(), { x: 0, y: 0 });
});

test('reset 은 모든 효과를 지운다', () => {
  const fx = new Effects();
  fx.burstSparkle(1, 1);
  fx.flashScreen();
  fx.shake();

  fx.reset();

  assert.equal(fx.particles.length, 0);
  assert.equal(fx.flash, null);
  assert.equal(fx.shakeTimer, 0);
  assert.deepEqual(fx.getShakeOffset(), { x: 0, y: 0 });
});

test('파티클/플래시 렌더링이 예외 없이 동작한다', () => {
  const fx = new Effects();
  fx.burstSparkle(1, 1);
  fx.burstDrops(2, 2, '#fff176');
  fx.burstIce(3, 3);
  fx.burstTears(4, 4);
  fx.shockwave(4, 4);
  fx.flashScreen('#64b5f6', 0.35, 0.3);

  const ctx = createStubCtx();
  assert.doesNotThrow(() => fx.renderShockwaves(ctx));
  assert.doesNotThrow(() => fx.renderParticles(ctx));
  assert.doesNotThrow(() => fx.renderFlash(ctx));

  const rects = ctx.calls.filter(call => call.name === 'fillRect');
  assert.ok(rects.length > 0);
  assert.deepEqual(
    rects[rects.length - 1].args,
    [0, 0, CANVAS_WIDTH, CANVAS_HEIGHT],
    '플래시는 화면 전체를 덮는다',
  );
});
