/**
 * Pac-Baby: 시각 효과 (파티클 · 화면 플래시 · 카메라 셰이크)
 *
 * 외부 이미지 없이 Canvas 2D 코드만으로 그린다.
 * - sparkle : 아이템 섭취 시 노란 반짝이
 * - drop    : 트랩 배출 시 트랩 색 물방울 (퐁 튀는 연출)
 * - ice     : 울기 발동 시 얼음 파편
 */

import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants.js';

/** 파티클 종류별 기본 설정 */
const PARTICLE_PRESETS = {
  sparkle: { count: 10, speed: 90, spread: 40, gravity: 150, size: 2.6, life: 0.55 },
  drop: { count: 12, speed: 120, spread: -90, gravity: 420, size: 2.4, life: 0.6 },
  ice: { count: 9, speed: 70, spread: -20, gravity: 90, size: 2.2, life: 0.7 },
};

export default class Effects {
  constructor() {
    this.particles = [];
    this.flash = null;              // { color, alpha, life, maxLife }
    this.shakeTimer = 0;            // 남은 셰이크 시간(초)
    this.shakeDuration = 0;
    this.shakeIntensity = 0;        // 최대 진폭(px)
    this.offset = { x: 0, y: 0 };
    this.rng = Math.random;         // 테스트 주입용
  }

  /** 모든 효과 초기화 (라운드/재시작) */
  reset() {
    this.particles = [];
    this.flash = null;
    this.shakeTimer = 0;
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
    this.offset.x = 0;
    this.offset.y = 0;
  }

  /**
   * 파티클 생성 (공용)
   * @param {'sparkle'|'drop'|'ice'} kind
   * @param {number} row
   * @param {number} col
   * @param {string[]} colors
   * @param {number} count
   */
  _emit(kind, row, col, colors, count) {
    const preset = PARTICLE_PRESETS[kind];
    const total = count || preset.count;
    const cx = (col + 0.5) * TILE_SIZE;
    const cy = (row + 0.5) * TILE_SIZE;

    for (let i = 0; i < total; i++) {
      const angle = this.rng() * Math.PI * 2;
      const speed = preset.speed * (0.4 + this.rng());
      const life = preset.life * (0.7 + this.rng() * 0.6);

      this.particles.push({
        kind,
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + preset.spread,
        gravity: preset.gravity,
        size: preset.size * (0.7 + this.rng() * 0.8),
        color: colors[Math.floor(this.rng() * colors.length) % colors.length],
        life,
        maxLife: life,
      });
    }
    return total;
  }

  /** 아이템 섭취: 노란 반짝이 */
  burstSparkle(row, col, count) {
    return this._emit('sparkle', row, col, ['#ffe082', '#fff59d', '#ffd54f'], count);
  }

  /** 트랩 배출: 트랩 색 물방울 */
  burstDrops(row, col, color, count) {
    return this._emit('drop', row, col, [color], count);
  }

  /** 울기 발동: 얼음 파편 */
  burstIce(row, col, count) {
    return this._emit('ice', row, col, ['#64b5f6', '#bbdefb', '#e3f2fd'], count);
  }

  /**
   * 화면 전체 플래시
   * @param {string} color
   * @param {number} alpha 최대 불투명도 (0~1)
   * @param {number} duration 초
   */
  flashScreen(color = '#64b5f6', alpha = 0.35, duration = 0.3) {
    this.flash = { color, alpha, life: duration, maxLife: duration };
    return this.flash;
  }

  /**
   * 카메라 셰이크
   * @param {number} duration 초 (기본 0.2)
   * @param {number} intensity 최대 진폭 px
   */
  shake(duration = 0.2, intensity = 6) {
    this.shakeTimer = duration;
    this.shakeDuration = duration;
    this.shakeIntensity = intensity;
  }

  /** 현재 셰이크 오프셋 */
  getShakeOffset() {
    return this.offset;
  }

  /**
   * 프레임 업데이트 (초 단위 dt)
   * @param {number} dt
   */
  update(dt) {
    if (!(dt > 0)) return;

    // 파티클
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += particle.gravity * dt;
    }
    this.particles = this.particles.filter(particle => particle.life > 0);

    // 플래시
    if (this.flash) {
      this.flash.life -= dt;
      if (this.flash.life <= 0) this.flash = null;
    }

    // 셰이크
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const remain = this.shakeDuration > 0 ? this.shakeTimer / this.shakeDuration : 0;
      const amplitude = this.shakeIntensity * remain;

      if (amplitude > 0) {
        this.offset.x = (this.rng() * 2 - 1) * amplitude;
        this.offset.y = (this.rng() * 2 - 1) * amplitude;
      } else {
        this.offset.x = 0; // 진폭 0 이면 정확히 0 (-0 방지)
        this.offset.y = 0;
      }
    } else {
      this.offset.x = 0;
      this.offset.y = 0;
    }
  }

  /** 월드 좌표 파티클 렌더링 */
  renderParticles(ctx) {
    for (const particle of this.particles) {
      const alpha = Math.max(0, Math.min(1, particle.life / particle.maxLife));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;

      if (particle.kind === 'sparkle') {
        // 다이아몬드 모양 반짝이
        const s = particle.size * 1.6;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y - s);
        ctx.lineTo(particle.x + s * 0.6, particle.y);
        ctx.lineTo(particle.x, particle.y + s);
        ctx.lineTo(particle.x - s * 0.6, particle.y);
        ctx.closePath();
        ctx.fill();
      } else if (particle.kind === 'ice') {
        // 작은 얼음 조각
        ctx.fillRect(
          particle.x - particle.size / 2,
          particle.y - particle.size,
          particle.size,
          particle.size * 2,
        );
      } else {
        // 물방울
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 화면 전체 플래시 렌더링 (HUD 위) */
  renderFlash(ctx) {
    if (!this.flash) return;

    const ratio = this.flash.maxLife > 0
      ? Math.max(0, this.flash.life / this.flash.maxLife)
      : 0;

    ctx.globalAlpha = this.flash.alpha * ratio;
    ctx.fillStyle = this.flash.color;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.globalAlpha = 1;
  }
}
