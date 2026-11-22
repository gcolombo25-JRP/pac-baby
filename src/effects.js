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
  sparkle: { count: 10, speed: 90, spread: 40, gravity: 150, size: 2.8, life: 0.55 },
  drop: { count: 14, speed: 135, spread: -110, gravity: 460, size: 3.0, life: 0.7 },
  ice: { count: 12, speed: 85, spread: -30, gravity: 110, size: 2.4, life: 0.8 },
  tear: { count: 9, speed: 120, spread: -90, gravity: 520, size: 2.3, life: 0.95 },
};

/** 눈물 파티클 색 */
const TEAR_COLORS = ['#81d4fa', '#4fc3f7', '#b3e5fc', '#e1f5fe'];

/** 일반 이동 발자국/먼지 흔적 설정 (아이템을 먹기 전부터 이동감을 준다) */
const FOOTSTEP_LIFE = 0.5;   // 0.5초 내외로 사라진다
const FOOTSTEP_BASE = '#ffe2b8'; // 바닥(진한 블루) 위에서도 보이는 따뜻한 크림색

export default class Effects {
  constructor() {
    this.particles = [];
    this.rings = [];                // { x, y, radius, maxRadius, color, life, maxLife, width }
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
    this.rings = [];
    this.flash = null;
    this.shakeTimer = 0;
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
    this.offset.x = 0;
    this.offset.y = 0;
  }

  /**
   * 파티클 생성 (공용)
   * @param {'sparkle'|'drop'|'ice'|'tear'} kind
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
        rotation: this.rng() * Math.PI * 2,
        spin: (this.rng() * 2 - 1) * 8,
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

  /** 울기 발동: 눈물 파티클 (푸른 물방울) */
  burstTears(row, col, count) {
    return this._emit('tear', row, col, TEAR_COLORS, count);
  }

  /**
   * 황금 보행기 넉백 비행 꼬리 — 날아가는 보모 뒤로 별가루가 흩날린다.
   * 파티클 좌표는 타일이 아닌 월드 픽셀 좌표를 받는다 (비행 궤적이 연속적이므로).
   * @param {number} x 월드 좌표(px)
   * @param {number} y 월드 좌표(px)
   * @param {{colors?: string[], count?: number}} [options]
   * @returns {number} 생성된 별 파티클 수
   */
  flightTrail(x, y, options = {}) {
    const baseX = Number.isFinite(x) ? x : 0;
    const baseY = Number.isFinite(y) ? y : 0;
    const colors = options.colors || ['#ffe082', '#fff59d', '#ffd54f', '#ffffff'];
    const count = options.count || 2;

    for (let i = 0; i < count; i++) {
      const angle = this.rng() * Math.PI * 2;
      const speed = 16 + this.rng() * 34;
      const life = 0.26 + this.rng() * 0.24;

      this.particles.push({
        kind: 'star',
        x: baseX + (this.rng() * 2 - 1) * 4.5,
        y: baseY + (this.rng() * 2 - 1) * 4.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6 - 14, // 살짝 위로 떠오르며 흩어진다
        gravity: 90,
        size: 2.1 + this.rng() * 2.3,
        color: colors[Math.floor(this.rng() * colors.length) % colors.length],
        rotation: this.rng() * Math.PI * 2,
        spin: (this.rng() * 2 - 1) * 11,
        life,
        maxLife: life,
      });
    }

    return count;
  }

  /**
   * 일반 이동 발자국/먼지 흔적 — 베이비가 지나간 타일 중앙에 작은 먼지가 폴폴 남는다.
   * - 아이템/파워업 없이도 이동감을 즉시 느낄 수 있게 0.5초 내외로 사라진다.
   * @param {number} x 월드 좌표(px)
   * @param {number} y 월드 좌표(px)
   * @param {{color?: string, boost?: boolean}} [options] boost = 파워업 중이면 조금 더 크고 밝게
   * @returns {number} 생성된 먼지 파티클 수
   */
  footstep(x, y, options = {}) {
    const baseX = Number.isFinite(x) ? x : 0;
    const baseY = Number.isFinite(y) ? y : 0;
    const color = options.color || FOOTSTEP_BASE;
    const boost = options.boost === true;
    const count = boost ? 4 : 3;

    for (let i = 0; i < count; i++) {
      const angle = this.rng() * Math.PI * 2;
      const speed = (boost ? 32 : 22) * (0.35 + this.rng());
      const life = FOOTSTEP_LIFE * (0.8 + this.rng() * 0.4);

      this.particles.push({
        kind: 'dust',
        x: baseX + (this.rng() * 2 - 1) * 3.2,
        y: baseY + (this.rng() * 2 - 1) * 1.8 + 4, // 발밑(살짝 아래)에서 피어오른다
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.45 - 6,
        gravity: 26,
        size: (boost ? 3.2 : 2.7) * (0.75 + this.rng() * 0.7),
        color,
        rotation: 0,
        spin: 0,
        life,
        maxLife: life,
      });
    }

    return count;
  }

  /**
   * 충격파 링 (울기 사용 시 퍼져 나가는 푸른 파동)
   * @param {number} row
   * @param {number} col
   * @param {string} color
   * @param {number} maxRadius px
   * @param {number} duration 초
   * @returns {object} 생성된 링
   */
  shockwave(row, col, color = '#8fd8ff', maxRadius = TILE_SIZE * 3, duration = 0.5) {
    const ring = {
      x: (col + 0.5) * TILE_SIZE,
      y: (row + 0.5) * TILE_SIZE,
      maxRadius,
      color,
      life: duration,
      maxLife: duration,
      width: 3,
    };
    this.rings.push(ring);
    return ring;
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
      particle.rotation += particle.spin * dt;
    }
    this.particles = this.particles.filter(particle => particle.life > 0);

    // 충격파 링
    for (const ring of this.rings) ring.life -= dt;
    this.rings = this.rings.filter(ring => ring.life > 0);

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

  /** 충격파 링 렌더링 (월드 좌표) */
  renderShockwaves(ctx) {
    if (this.rings.length === 0) return;

    for (const ring of this.rings) {
      const progress = ring.maxLife > 0 ? 1 - Math.max(0, ring.life) / ring.maxLife : 1;
      const eased = 1 - Math.pow(1 - progress, 2); // ease-out
      const radius = Math.max(1, ring.maxRadius * eased);

      ctx.save?.();
      ctx.globalAlpha = Math.max(0, 1 - progress) * 0.9;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(0.6, ring.width * (1 - progress * 0.7));
      ctx.shadowColor = ring.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.restore?.();
      ctx.globalAlpha = 1;
    }
  }

  /** 월드 좌표 파티클 렌더링 */
  renderParticles(ctx) {
    for (const particle of this.particles) {
      const alpha = Math.max(0, Math.min(1, particle.life / particle.maxLife));
      const size = particle.size * (0.6 + alpha * 0.6); // 끝으로 갈수록 작아진다
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;

      if (particle.kind === 'sparkle') {
        // 다이아몬드 모양 반짝이 + 십자 광택
        const s = size * 1.7;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y - s);
        ctx.lineTo(particle.x + s * 0.6, particle.y);
        ctx.lineTo(particle.x, particle.y + s);
        ctx.lineTo(particle.x - s * 0.6, particle.y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(particle.x - s * 0.9, particle.y);
        ctx.lineTo(particle.x + s * 0.9, particle.y);
        ctx.moveTo(particle.x, particle.y - s * 0.9);
        ctx.lineTo(particle.x, particle.y + s * 0.9);
        ctx.stroke();
      } else if (particle.kind === 'star') {
        // 5꼭지 별가루 (넉백 비행 꼬리) — 회전하며 반짝인다
        const s = size * 1.55;
        ctx.save?.();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? s : s * 0.45;
          const angle = (Math.PI / 5) * i - Math.PI / 2;
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore?.();
      } else if (particle.kind === 'ice') {
        // 회전하는 얼음 결정 (마름모)
        ctx.save?.();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.beginPath();
        ctx.moveTo(0, -size * 1.6);
        ctx.lineTo(size * 0.85, 0);
        ctx.lineTo(0, size * 1.6);
        ctx.lineTo(-size * 0.85, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore?.();
      } else if (particle.kind === 'dust') {
        // 발자국 먼지: 시간이 지나며 조금 퍼지고 옅어진다 (작은 화면에서도 보이게 발광)
        const grow = 1 + (1 - alpha) * 0.9;
        ctx.save?.();
        ctx.shadowColor = particle.color;
        ctx.shadowBlur = 7;
        ctx.globalAlpha = alpha * 0.7;
        if (typeof ctx.ellipse === 'function') {
          ctx.beginPath();
          ctx.ellipse(
            particle.x, particle.y,
            size * grow, size * grow * 0.62, 0, 0, Math.PI * 2,
          );
        } else {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, size * grow, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.restore?.();
        ctx.globalAlpha = 1;
      } else if (particle.kind === 'tear') {
        // 눈물 물방울 (세로로 긴 타원 + 하이라이트)
        if (typeof ctx.ellipse === 'function') {
          ctx.beginPath();
          ctx.ellipse(particle.x, particle.y, size * 0.72, size * 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.beginPath();
          ctx.ellipse(
            particle.x - size * 0.25, particle.y - size * 0.45,
            size * 0.22, size * 0.4, 0, 0, Math.PI * 2,
          );
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 트랩 물방울 (둥근 물방울 + 반짝임)
        if (typeof ctx.ellipse === 'function') {
          ctx.beginPath();
          ctx.ellipse(particle.x, particle.y, size, size * 1.18, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.beginPath();
        ctx.arc(particle.x - size * 0.3, particle.y - size * 0.35, size * 0.28, 0, Math.PI * 2);
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
