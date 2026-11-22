/**
 * Pac-Baby: 아이템 & 트랩 클래스
 */

import {
  TILE_SIZE, COLORS, ITEMS, FAKE_PACIFIER,
  ITEM_RESPAWN_MS, TRAP_LIFE_MS, TRAP_COLORS, randomWalkableTile,
} from './constants.js';

/** 아이템 종류별 테두리 색 (접시 링/글로우) */
const ITEM_RING_COLORS = {
  MILK: '#90caf9',
  CANDY: '#f48fb1',
  COOKIE: '#ffcc80',
  GOLDEN: '#ffd700',
  PACIFIER: FAKE_PACIFIER.color,
};

/** 작은 4갈래 반짝이 (선 4개) */
function drawSparkle(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

/**
 * 공갈 젖꼭지(쪽쪽이)를 Canvas 2D 도형만으로 그린다.
 * - 실리콘 팁(위쪽 둥근 버튼) + 파스텔 방패판 + 고리 손잡이 + 외곽선
 * - OS 이모지/roundRect/ellipse 에 의존하지 않고 arc · quadraticCurveTo ·
 *   moveTo · lineTo 만 사용한다 (테스트 스텁 ctx 호환).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 중심 x
 * @param {number} cy 중심 y
 * @param {number} size 전체 크기(px)
 * @param {number} timeMs 애니메이션 시간(ms)
 */
function drawPacifier(ctx, cx, cy, size, timeMs) {
  const s = size;
  const tilt = Math.sin(timeMs / 430) * 0.08; // 살짝 흔들리는 장난감 느낌

  // 테스트용 최소 스텁 ctx 에 quadraticCurveTo 가 없으면 직선으로 근사한다.
  const curveTo = typeof ctx.quadraticCurveTo === 'function'
    ? (cpx, cpy, x, y) => ctx.quadraticCurveTo(cpx, cpy, x, y)
    : (cpx, cpy, x, y) => ctx.lineTo(x, y);

  const canTransform = typeof ctx.translate === 'function';
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();
  if (canTransform) {
    ctx.translate(cx, cy);
    if (typeof ctx.rotate === 'function') ctx.rotate(tilt);
    ctx.translate(-cx, -cy);
  }

  // ===== 고리 손잡이 (아래쪽) =====
  // 바깥 외곽선을 두껍게 깔고, 그 위에 밝은 링을 얹어 도넛 모양을 만든다.
  const ringY = cy + s * 0.38;
  const ringR = s * 0.24;
  ctx.strokeStyle = '#c96a99';
  ctx.lineWidth = Math.max(1, s * 0.15);
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#ffd9ea';
  ctx.lineWidth = Math.max(1, s * 0.075);
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // ===== 파스텔 방패판 =====
  const left = cx - s * 0.43;
  const right = cx + s * 0.43;
  const top = cy - s * 0.20;
  const bottom = cy + s * 0.26;
  const corner = s * 0.16;

  ctx.beginPath();
  ctx.moveTo(left + corner, top);
  ctx.lineTo(right - corner, top);
  curveTo(right, top, right, top + corner);
  ctx.lineTo(right, bottom - corner);
  curveTo(right, bottom, right - corner, bottom);
  ctx.lineTo(left + corner, bottom);
  curveTo(left, bottom, left, bottom - corner);
  ctx.lineTo(left, top + corner);
  curveTo(left, top, left + corner, top);
  ctx.closePath();

  ctx.fillStyle = '#ffd1e6';
  ctx.fill();
  ctx.strokeStyle = '#c96a99';
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.stroke();

  // 방패판 유광 하이라이트
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(cx - s * 0.18, cy - s * 0.08, s * 0.075, 0, Math.PI * 2);
  ctx.fill();

  // 방패판 가운데 작은 구멍 자국 (공기 구멍)
  ctx.fillStyle = 'rgba(201, 106, 153, 0.35)';
  ctx.beginPath();
  ctx.arc(cx + s * 0.20, cy + s * 0.10, s * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // ===== 실리콘 팁 (방패판 위쪽 돌출부) =====
  const baseY = top + s * 0.03;
  const tipY = cy - s * 0.62;

  ctx.beginPath();
  ctx.moveTo(cx - s * 0.15, baseY);
  curveTo(cx - s * 0.22, tipY + s * 0.12, cx - s * 0.11, tipY);
  curveTo(cx, tipY - s * 0.05, cx + s * 0.11, tipY);
  curveTo(cx + s * 0.22, tipY + s * 0.12, cx + s * 0.15, baseY);
  curveTo(cx, baseY + s * 0.07, cx - s * 0.15, baseY);
  ctx.closePath();

  ctx.fillStyle = '#fff7fb';
  ctx.fill();
  ctx.strokeStyle = '#c96a99';
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.stroke();

  // 팁 유광
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(cx - s * 0.05, tipY + s * 0.15, s * 0.035, 0, Math.PI * 2);
  ctx.fill();

  if (canSave) ctx.restore?.();
}
/** 아이콘 공통: quadraticCurveTo 가 없는 최소 스텁에서는 직선으로 근사 */
function iconCurve(ctx, cpx, cpy, x, y) {
  if (typeof ctx.quadraticCurveTo === 'function') ctx.quadraticCurveTo(cpx, cpy, x, y);
  else ctx.lineTo(x, y);
}

/**
 * 아이콘을 살짝 기울여 그린다 (장난감이 굴러가는 느낌).
 * transform 미지원 스텁에서는 아무 일도 하지 않으며, save/restore 는 항상 균형을 맞춘다.
 * @returns {() => void} 그리기 종료 후 호출할 복원 함수
 */
function tiltIcon(ctx, cx, cy, angle) {
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();
  if (typeof ctx.translate === 'function' && typeof ctx.rotate === 'function') {
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);
  }
  return () => { if (canSave) ctx.restore?.(); };
}

/**
 * 우유 유리병 — 진한 외곽선 + 흰 우유 + 유리 하이라이트 (Canvas 2D 벡터)
 */
export function drawMilkIcon(ctx, cx, cy, size, timeMs = 0) {
  const s = size;
  const restore = tiltIcon(ctx, cx, cy, -0.10 + Math.sin(timeMs / 950) * 0.035);

  const bw = s * 0.50;              // 병 몸통 너비
  const bh = s * 0.44;              // 병 몸통 높이
  const nw = s * 0.22;              // 목 너비
  const nh = s * 0.19;              // 목 높이
  const topY = cy - s * 0.48;       // 목 꼭대기
  const shoulderY = topY + nh;
  const bottomY = cy + bh * 0.60;

  // 병 실루엣
  ctx.beginPath();
  ctx.moveTo(cx - nw / 2, topY);
  ctx.lineTo(cx + nw / 2, topY);
  ctx.lineTo(cx + nw / 2, shoulderY);
  iconCurve(ctx, cx + nw / 2, shoulderY + s * 0.06, cx + bw / 2, shoulderY + s * 0.03);
  ctx.lineTo(cx + bw / 2, bottomY);
  iconCurve(ctx, cx + bw / 2, bottomY + s * 0.10, cx, bottomY + s * 0.10);
  iconCurve(ctx, cx - bw / 2, bottomY + s * 0.10, cx - bw / 2, bottomY);
  ctx.lineTo(cx - bw / 2, shoulderY + s * 0.03);
  iconCurve(ctx, cx - nw / 2, shoulderY + s * 0.06, cx - nw / 2, shoulderY);
  ctx.closePath?.();

  ctx.fillStyle = '#e9f7ff';
  ctx.fill();
  ctx.strokeStyle = '#1d4a60';
  ctx.lineWidth = Math.max(1, s * 0.085);
  ctx.stroke();

  // 우유 액체 (아래 2/3)
  const inX = s * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 + inX, cy - bh * 0.06);
  ctx.lineTo(cx + bw / 2 - inX, cy - bh * 0.06);
  ctx.lineTo(cx + bw / 2 - inX, bottomY);
  iconCurve(ctx, cx + bw / 2 - inX, bottomY + s * 0.09, cx, bottomY + s * 0.09);
  iconCurve(ctx, cx - bw / 2 + inX, bottomY + s * 0.09, cx - bw / 2 + inX, bottomY);
  ctx.closePath?.();
  ctx.fillStyle = '#fffdf5';
  ctx.fill();

  // 우유 표면
  ctx.strokeStyle = '#cfe9f6';
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 + inX + 1, cy - bh * 0.06);
  ctx.lineTo(cx + bw / 2 - inX - 1, cy - bh * 0.06);
  ctx.stroke();

  // 유리 하이라이트
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.32, shoulderY + s * 0.10);
  ctx.lineTo(cx - bw * 0.32, bottomY - s * 0.05);
  ctx.stroke();

  // 파스텔 캡
  const capW = nw + s * 0.12;
  const capH = s * 0.13;
  const capY = topY - capH + s * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx - capW / 2, capY);
  ctx.lineTo(cx + capW / 2, capY);
  ctx.lineTo(cx + capW / 2, capY + capH);
  ctx.lineTo(cx - capW / 2, capY + capH);
  ctx.closePath?.();
  ctx.fillStyle = '#7fd3f0';
  ctx.fill();
  ctx.strokeStyle = '#1d4a60';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(cx - capW * 0.22, capY + capH * 0.4, s * 0.035, 0, Math.PI * 2);
  ctx.fill();

  restore();
}



/**
 * 줄무늬 딸기 사탕 — 래퍼 트위스트 + 소용돌이 줄무늬 (Canvas 2D 벡터)
 */
export function drawCandyIcon(ctx, cx, cy, size, timeMs = 0) {
  const s = size;
  const restore = tiltIcon(ctx, cx, cy, Math.sin(timeMs / 720) * 0.12);

  const r = s * 0.30;
  const wrapX = s * 0.53;
  const wrapH = s * 0.15;

  // 양쪽 래퍼 트위스트
  const drawWrap = (dir) => {
    ctx.beginPath();
    ctx.moveTo(cx + dir * r * 0.86, cy);
    ctx.lineTo(cx + dir * wrapX, cy - wrapH);
    ctx.lineTo(cx + dir * wrapX, cy + wrapH);
    ctx.closePath?.();
    ctx.fillStyle = dir < 0 ? '#ffb3c8' : '#ffc2d2';
    ctx.fill();
    ctx.strokeStyle = '#8c2f4a';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.stroke();
  };
  drawWrap(-1);
  drawWrap(1);

  // 사탕 몸통
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5f8f';
  ctx.fill();
  ctx.strokeStyle = '#7d2342';
  ctx.lineWidth = Math.max(1, s * 0.085);
  ctx.stroke();

  // 소용돌이 줄무늬
  ctx.strokeStyle = '#ffe3ec';
  ctx.lineWidth = Math.max(1, s * 0.095);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.64, 0.35, 2.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.30, 2.9, 5.4);
  ctx.stroke();

  // 딸기 씨 포인트
  ctx.fillStyle = '#ffd166';
  const seeds = [[-0.34, 0.10], [0.16, -0.36], [0.30, 0.32]];
  for (const [dx, dy] of seeds) {
    ctx.beginPath();
    ctx.arc(cx + r * dx, cy + r * dy, Math.max(0.8, s * 0.032), 0, Math.PI * 2);
    ctx.fill();
  }

  // 유광 하이라이트
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.36, cy - r * 0.40, r * 0.17, 0, Math.PI * 2);
  ctx.fill();

  restore();
}

/**
 * 초코칩 쿠키 — 둥글둥글 스캘럽 가장자리 + 진한 초코칩 (Canvas 2D 벡터)
 */
export function drawCookieIcon(ctx, cx, cy, size, timeMs = 0) {
  const s = size;
  const restore = tiltIcon(ctx, cx, cy, Math.sin(timeMs / 880) * 0.06);

  const r = s * 0.32;

  // 스캘럽(울퉁불퉁) 가장자리
  ctx.fillStyle = '#d99a5b';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 / 10) * i + 0.18;
    ctx.arc(cx + Math.cos(angle) * r * 0.84, cy + Math.sin(angle) * r * 0.84, r * 0.24, 0, Math.PI * 2);
  }
  ctx.fill();

  // 쿠키 본체
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b3f1d';
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.stroke();

  // 구운 결 하이라이트
  ctx.strokeStyle = '#eab97d';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0.25, 2.4);
  ctx.stroke();

  // 초코칩
  const chips = [[-0.36, -0.22], [0.28, -0.34], [0.12, 0.20], [-0.20, 0.40], [0.46, 0.18]];
  for (const [dx, dy] of chips) {
    const chipX = cx + r * dx;
    const chipY = cy + r * dy;
    const chipR = Math.max(0.9, r * 0.16);
    ctx.fillStyle = '#4a2a16';
    ctx.beginPath();
    ctx.arc(chipX, chipY, chipR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.beginPath();
    ctx.arc(chipX - chipR * 0.3, chipY - chipR * 0.3, chipR * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  // 부스러기 하이라이트
  ctx.fillStyle = 'rgba(255, 240, 200, 0.72)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.52, cy - r * 0.48, Math.max(0.8, s * 0.035), 0, Math.PI * 2);
  ctx.fill();

  restore();
}

/**
 * 황금빛 기울어진 젖병 — 무적 보행기 슈퍼 아이템 (Canvas 2D 벡터)
 */
export function drawGoldenBottleIcon(ctx, cx, cy, size, timeMs = 0) {
  const s = size;
  const restore = tiltIcon(ctx, cx, cy, -0.26 + Math.sin(timeMs / 640) * 0.02);

  const bw = s * 0.46;
  const bh = s * 0.46;
  const topY = cy - s * 0.36;
  const bottomY = cy + bh * 0.62;

  // 실리콘 젖꼭지
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.10, topY);
  iconCurve(ctx, cx - s * 0.17, topY - s * 0.17, cx, topY - s * 0.21);
  iconCurve(ctx, cx + s * 0.17, topY - s * 0.17, cx + s * 0.10, topY);
  ctx.closePath?.();
  ctx.fillStyle = '#fff4c7';
  ctx.fill();
  ctx.strokeStyle = '#8a5a00';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.stroke();

  // 젖병 뚜껑 링
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.21, topY);
  ctx.lineTo(cx + s * 0.21, topY);
  ctx.lineTo(cx + s * 0.21, topY + s * 0.12);
  ctx.lineTo(cx - s * 0.21, topY + s * 0.12);
  ctx.closePath?.();
  ctx.fillStyle = '#f0b429';
  ctx.fill();
  ctx.strokeStyle = '#8a5a00';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.stroke();

  // 젖병 몸통
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2, topY + s * 0.12);
  ctx.lineTo(cx + bw / 2, topY + s * 0.12);
  ctx.lineTo(cx + bw / 2, bottomY);
  iconCurve(ctx, cx + bw / 2, bottomY + s * 0.10, cx, bottomY + s * 0.10);
  iconCurve(ctx, cx - bw / 2, bottomY + s * 0.10, cx - bw / 2, bottomY);
  ctx.closePath?.();
  ctx.fillStyle = '#ffd54f';
  ctx.fill();
  ctx.strokeStyle = '#8a5a00';
  ctx.lineWidth = Math.max(1, s * 0.085);
  ctx.stroke();

  // 황금 액체 (아래쪽 진한 골드)
  const inX = s * 0.055;
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 + inX, cy + bh * 0.02);
  ctx.lineTo(cx + bw / 2 - inX, cy + bh * 0.02);
  ctx.lineTo(cx + bw / 2 - inX, bottomY);
  iconCurve(ctx, cx + bw / 2 - inX, bottomY + s * 0.085, cx, bottomY + s * 0.085);
  iconCurve(ctx, cx - bw / 2 + inX, bottomY + s * 0.085, cx - bw / 2 + inX, bottomY);
  ctx.closePath?.();
  ctx.fillStyle = '#ffb300';
  ctx.fill();

  // 액체 표면 반짝임
  ctx.strokeStyle = '#fff1a8';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 + inX + 1, cy + bh * 0.02);
  ctx.lineTo(cx + bw / 2 - inX - 1, cy + bh * 0.02);
  ctx.stroke();

  // 눈금선
  ctx.strokeStyle = 'rgba(138, 90, 0, 0.75)';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx + bw * 0.12, cy + bh * 0.22);
  ctx.lineTo(cx + bw * 0.34, cy + bh * 0.22);
  ctx.moveTo(cx + bw * 0.12, cy + bh * 0.36);
  ctx.lineTo(cx + bw * 0.28, cy + bh * 0.36);
  ctx.stroke();

  // 유광 하이라이트
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.34, topY + s * 0.21);
  ctx.lineTo(cx - bw * 0.34, bottomY - s * 0.06);
  ctx.stroke();

  restore();
}

/**
 * 캔버스용 아이템 벡터 아이콘 디스패처.
 * OS 이모지(fillText) 대신 고대비 Canvas 2D 도형만 사용한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'MILK'|'CANDY'|'COOKIE'|'GOLDEN'|'PACIFIER'} type
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {number} timeMs
 */
export function drawItemIcon(ctx, type, cx, cy, size, timeMs = 0) {
  switch (type) {
    case 'MILK':
      drawMilkIcon(ctx, cx, cy, size, timeMs);
      break;
    case 'CANDY':
      drawCandyIcon(ctx, cx, cy, size, timeMs);
      break;
    case 'COOKIE':
      drawCookieIcon(ctx, cx, cy, size, timeMs);
      break;
    case 'GOLDEN':
      drawGoldenBottleIcon(ctx, cx, cy, size, timeMs);
      break;
    case 'PACIFIER':
      drawPacifier(ctx, cx, cy, size, timeMs);
      break;
    default:
      break;
  }
}

/**
 * HUD 목숨 하트 — Canvas 2D 벡터 (OS '♥/♡' 문자 대체).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {boolean} [filled]
 */
export function drawHeartIcon(ctx, cx, cy, size, filled = true) {
  const s = Math.max(2, size);
  const r = s * 0.5;
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();

  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.92);
  ctx.lineTo(cx - r * 0.93, cy);
  ctx.arc(cx - r * 0.44, cy - r * 0.24, r * 0.54, 2.72, 5.72);
  ctx.arc(cx + r * 0.44, cy - r * 0.24, r * 0.54, -2.58, 0.42);
  ctx.lineTo(cx, cy + r * 0.92);
  ctx.closePath();

  if (filled) {
    ctx.fillStyle = '#ef5350';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 205, 210, 0.85)';
    ctx.lineWidth = Math.max(0.6, s * 0.07);
    ctx.stroke();
    // 왼쪽 볼의 작은 유광 하이라이트
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.42, cy - r * 0.34, Math.max(0.6, s * 0.09), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(239, 83, 80, 0.55)';
    ctx.lineWidth = Math.max(0.8, s * 0.10);
    ctx.stroke();
  }

  if (canSave) ctx.restore();
}

/**
 * 체크 배지 — 'Score Cleared' 앞의 OS '✅' 대체.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {string} [color]
 */
export function drawCheckIcon(ctx, cx, cy, size, color = '#8bc34a') {
  const s = Math.max(2, size);
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(27, 70, 16, 0.85)';
  ctx.lineWidth = Math.max(0.6, s * 0.07);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.lineWidth = Math.max(1, s * 0.15);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.22, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.18);
  ctx.lineTo(cx + s * 0.24, cy - s * 0.17);
  ctx.stroke();

  if (canSave) ctx.restore();
}

/**
 * 얼림 상태 아이콘 — OS '❄' 대체. 6갈래 눈결정을 선으로 그린다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {string} [color]
 */
export function drawIceCrystalIcon(ctx, cx, cy, size, color = '#e3f2fd') {
  const s = Math.max(2, size);
  const radius = s * 0.46;
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const tipX = cx + Math.cos(angle) * radius;
    const tipY = cy + Math.sin(angle) * radius;
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);

    const branchBaseX = cx + Math.cos(angle) * radius * 0.62;
    const branchBaseY = cy + Math.sin(angle) * radius * 0.62;
    for (const delta of [-0.55, 0.55]) {
      ctx.moveTo(branchBaseX, branchBaseY);
      ctx.lineTo(
        branchBaseX + Math.cos(angle + delta) * radius * 0.34,
        branchBaseY + Math.sin(angle + delta) * radius * 0.34,
      );
    }
  }
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.7, s * 0.08), 0, Math.PI * 2);
  ctx.fill();

  if (canSave) ctx.restore();
}

/**
 * 사운드 On/Off 스피커 — OS '🔊/🔇' 대체.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {boolean} enabled
 */
export function drawSpeakerIcon(ctx, cx, cy, size, enabled = true) {
  const s = Math.max(2, size);
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();

  ctx.beginPath();
  ctx.moveTo(cx - s * 0.34, cy - s * 0.16);
  ctx.lineTo(cx - s * 0.16, cy - s * 0.16);
  ctx.lineTo(cx + s * 0.05, cy - s * 0.34);
  ctx.lineTo(cx + s * 0.05, cy + s * 0.34);
  ctx.lineTo(cx - s * 0.16, cy + s * 0.16);
  ctx.lineTo(cx - s * 0.34, cy + s * 0.16);
  ctx.closePath();
  ctx.fillStyle = enabled ? '#e0f7fa' : 'rgba(224, 247, 250, 0.55)';
  ctx.fill();
  ctx.strokeStyle = '#006064';
  ctx.lineWidth = Math.max(0.7, s * 0.07);
  ctx.stroke();

  if (enabled) {
    ctx.strokeStyle = '#80deea';
    ctx.lineWidth = Math.max(0.7, s * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx + s * 0.10, cy, s * 0.20, -0.7, 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 0.10, cy, s * 0.34, -0.7, 0.7);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.16, cy - s * 0.26);
    ctx.lineTo(cx + s * 0.42, cy + s * 0.26);
    ctx.stroke();
  }

  if (canSave) ctx.restore();
}

/**
 * 봇 모드 아이콘 — OS '🤖' 대체.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} size
 * @param {string} [color]
 */
export function drawRobotIcon(ctx, cx, cy, size, color = '#ffe082') {
  const s = Math.max(2, size);
  const canSave = typeof ctx.save === 'function';
  if (canSave) ctx.save();

  // 안테나
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.7, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.26);
  ctx.lineTo(cx, cy - s * 0.44);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.46, Math.max(0.7, s * 0.07), 0, Math.PI * 2);
  ctx.fill();

  // 옆 귀
  ctx.fillStyle = color;
  ctx.fillRect(cx - s * 0.44, cy - s * 0.06, s * 0.10, s * 0.18);
  ctx.fillRect(cx + s * 0.34, cy - s * 0.06, s * 0.10, s * 0.18);

  // 머리 (모서리를 살짝 깎은 사각형)
  const left = cx - s * 0.34;
  const right = cx + s * 0.34;
  const top = cy - s * 0.22;
  const bottom = cy + s * 0.30;
  const cut = s * 0.10;
  ctx.beginPath();
  ctx.moveTo(left + cut, top);
  ctx.lineTo(right - cut, top);
  ctx.lineTo(right, top + cut);
  ctx.lineTo(right, bottom - cut);
  ctx.lineTo(right - cut, bottom);
  ctx.lineTo(left + cut, bottom);
  ctx.lineTo(left, bottom - cut);
  ctx.lineTo(left, top + cut);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(94, 66, 0, 0.85)';
  ctx.lineWidth = Math.max(0.7, s * 0.06);
  ctx.stroke();

  // 눈
  ctx.fillStyle = '#3e2723';
  ctx.beginPath();
  ctx.arc(cx - s * 0.15, cy + s * 0.02, Math.max(0.7, s * 0.065), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * 0.15, cy + s * 0.02, Math.max(0.7, s * 0.065), 0, Math.PI * 2);
  ctx.fill();

  // 입
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = Math.max(0.6, s * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.10, cy + s * 0.16);
  ctx.lineTo(cx + s * 0.10, cy + s * 0.16);
  ctx.stroke();

  if (canSave) ctx.restore();
}

/**
 * 아이템 (맵에 놓여있는 상태)
 */
export class Item {
  /**
   * @param {number} row
   * @param {number} col
   * @param {'MILK'|'CANDY'|'COOKIE'|'GOLDEN'|'PACIFIER'} type
   * @param {{fixed?: boolean}} options fixed=true 면 리스폰도 처음 위치(황금 젖병)
   */
  constructor(row, col, type, options = {}) {
    this.row = row;
    this.col = col;
    this.x = col * TILE_SIZE;
    this.y = row * TILE_SIZE;
    this.type = type;        // 'MILK' | 'CANDY' | 'COOKIE' | 'GOLDEN' | 'PACIFIER'
    this.config = ITEMS[type];
    this.collected = false;
    this.respawnTimer = 0;   // 섭취 후 다시 나타나기까지 남은 시간(ms)

    this.homeRow = row;      // 고정 스폰 위치 (황금 젖병)
    this.homeCol = col;
    this.fixedSpawn = options.fixed === true;
  }

  /**
   * 아이템 섭취: 숨기고 리스폰을 예약한다.
   * (일반 15초 / 황금 젖병 20초 / 가짜 젖꼭지 30초)
   * @returns {number} 획득 점수 (이미 먹힌 상태면 0)
   */
  collect() {
    if (this.collected) return 0;
    this.collected = true;
    this.respawnTimer = this.config.respawnMs || ITEM_RESPAWN_MS;
    return this.config.score;
  }

  /**
   * 리스폰 타이머 진행 (수집된 아이템만 동작)
   * @param {number} dt 경과 시간(ms)
   * @param {number[][]} map
   * @param {() => number} rng
   * @param {Array<{row: number, col: number}>} avoid 베이비/악당이 있는 타일
   * @returns {boolean} 이번 호출로 다시 나타났는지
   */
  update(dt, map, rng = Math.random, avoid = []) {
    if (!this.collected) return false;

    this.respawnTimer -= dt;
    if (this.respawnTimer > 0) return false;

    // 황금 젖병은 항상 맵 중앙(원래 자리)으로 돌아온다
    const spot = this.fixedSpawn
      ? { row: this.homeRow, col: this.homeCol }
      : randomWalkableTile(map, rng, avoid);

    if (!spot) {
      this.respawnTimer = 1000; // 자리를 못 찾으면 1초 뒤 재시도
      return false;
    }

    this.row = spot.row;
    this.col = spot.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.collected = false;
    this.respawnTimer = 0;
    return true;
  }

  /**
   * 캔버스에 아이템 렌더링 (살짝 떠다니는 연출)
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} timeMs 애니메이션 시간(ms)
   * @param {{dark?: boolean}} [options] dark: 어둠 속 발광 연출
   */
  render(ctx, timeMs = 0, options = {}) {
    if (this.collected) return;

    const supportsEllipse = typeof ctx.ellipse === 'function';
    const isGolden = this.type === 'GOLDEN';
    const isPacifier = this.type === 'PACIFIER';
    const cx = this.x + TILE_SIZE / 2;
    const bob = Math.sin(timeMs / 320 + this.row * 0.7 + this.col * 1.1)
      * (isGolden ? 1.9 : isPacifier ? 1.6 : 1.3);
    const cy = this.y + TILE_SIZE / 2 + bob;
    const ring = ITEM_RING_COLORS[this.type] || '#ffe082';

    // 바닥 그림자
    if (supportsEllipse) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(cx, this.y + TILE_SIZE * 0.78, TILE_SIZE * 0.28, TILE_SIZE * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 어둠 속에서도 반짝이며 보이도록 발광 후광
    if (options.dark) {
      const pulse = 0.18 + Math.abs(Math.sin(timeMs / 360 + this.row * 0.8)) * 0.16;
      // 시인성 강화: 후광/테두리 링이 천천히 커졌다 작아지는 맥동(Pulse)
      const breath = 0.5 + 0.5 * Math.sin(timeMs / 300 + this.row * 0.8 + this.col * 0.6);
      const ringScale = 0.86 + breath * 0.28; // 0.86 ~ 1.14 배
      ctx.fillStyle = isGolden
        ? `rgba(255, 215, 0, ${pulse + 0.12})`
        : isPacifier
          ? `rgba(255, 190, 222, ${pulse + 0.08})`
          : `rgba(255, 236, 150, ${pulse})`;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.8 * ringScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isGolden
        ? 'rgba(255, 230, 120, 0.9)'
        : isPacifier
          ? 'rgba(255, 218, 238, 0.9)'
          : 'rgba(255, 248, 190, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.62 * ringScale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 황금 젖병: 커다란 황금 후광 + 회전하는 링
    if (isGolden) {
      const pulse = 0.16 + Math.abs(Math.sin(timeMs / 360)) * 0.2;
      ctx.fillStyle = `rgba(255, 215, 0, ${pulse})`;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 236, 130, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const start = timeMs / 480 + (Math.PI * 2 / 6) * i;
        ctx.arc(cx, cy, TILE_SIZE * 0.62, start, start + 0.5);
      }
      ctx.stroke();
    }

    // 접시 (아이보리 원판) — shadowBlur 대신 저비용 후광 원
    ctx.save?.();
    ctx.fillStyle = isGolden
      ? 'rgba(255, 226, 130, 0.5)'
      : isPacifier
        ? 'rgba(255, 228, 240, 0.34)'
        : 'rgba(255, 244, 196, 0.20)';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 + (isGolden ? 2 : 1), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isGolden ? '#fff8dc' : isPacifier ? '#fff3f8' : '#f7f3e3';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 - 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 접시 테두리 링
    ctx.strokeStyle = ring;
    ctx.lineWidth = isGolden ? 2 : 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();

    // OS 이모지 대신 Canvas 2D 벡터 아이콘으로 직접 그린다
    const iconSize = TILE_SIZE * (isGolden ? 0.86 : isPacifier ? 0.82 : 0.78);
    drawItemIcon(ctx, this.type, cx, cy + (isGolden ? 0.6 : 0.4), iconSize, timeMs);

    // 외곽 발광 링 — 어둠/모바일에서도 아이콘 윤곽이 또렷하게 보이도록
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = ring;
    ctx.lineWidth = isGolden ? 1.6 : 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE / 2 - 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 둘레를 도는 반짝이
    ctx.strokeStyle = isGolden
      ? 'rgba(255, 215, 0, 0.95)'
      : isPacifier
        ? 'rgba(255, 214, 234, 0.95)'
        : 'rgba(255, 248, 200, 0.9)';
    ctx.lineWidth = isGolden ? 1.3 : 1;
    const sparkleCount = isGolden ? 6 : isPacifier ? 4 : 3;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = timeMs / (isGolden ? 420 : isPacifier ? 520 : 620)
        + (Math.PI * 2 / sparkleCount) * i;
      drawSparkle(
        ctx,
        cx + Math.cos(angle) * (TILE_SIZE * (isGolden ? 0.56 : 0.44)),
        cy + Math.sin(angle) * (TILE_SIZE * (isGolden ? 0.46 : 0.36)),
        isGolden ? 2.4 : isPacifier ? 2 : 1.8,
      );
    }

    ctx.restore?.();
  }
}

/**
 * 트랩 (아이템 소화 후 자동 배출)
 */
export class Trap {
  constructor(row, col, trapType, slowEffect, slowDuration) {
    this.row = row;
    this.col = col;
    this.x = col * TILE_SIZE;
    this.y = row * TILE_SIZE;
    this.trapType = trapType;   // 'PEE' | 'VOMIT' | 'POOP'
    this.slowEffect = slowEffect;
    this.slowDuration = slowDuration;
    this.active = true;
    this.triggered = false;     // 악당이 이미 밟았는지
    this.lifeTimer = TRAP_LIFE_MS; // 바닥에 남아 있는 시간
    this.maxLife = TRAP_LIFE_MS;
  }

  /**
   * 트랩 수명 진행
   * @param {number} dt
   * @returns {boolean} 아직 유효한지
   */
  update(dt) {
    if (!this.active) return false;
    this.lifeTimer -= dt;
    if (this.lifeTimer <= 0) {
      this.lifeTimer = 0;
      this.active = false;
      return false;
    }
    return true;
  }

  /** 악당이 밟아서 소모됨 */
  consume() {
    this.active = false;
    this.triggered = true;
  }

  /**
   * 캔버스에 트랩 렌더링 (종류별 색 + 흔들리는 웅덩이)
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} timeMs 애니메이션 시간(ms)
   * @param {{dark?: boolean}} [options] dark: 어둠 속 발광 연출
   */
  render(ctx, timeMs = 0, options = {}) {
    if (!this.active) return;

    const supportsEllipse = typeof ctx.ellipse === 'function';
    const cx = this.x + TILE_SIZE / 2;
    const cy = this.y + TILE_SIZE / 2;
    const color = TRAP_COLORS[this.trapType] || TRAP_COLORS.VOMIT;

    // 수명이 얼마 남지 않으면 서서히 사라진다
    const fade = Math.max(0.25, Math.min(1, this.lifeTimer / 1600));
    const wobble = Math.sin(timeMs / 240 + this.row * 1.3 + this.col * 0.9);
    const rx = TILE_SIZE / 2 - 2 + wobble * 0.9;
    const ry = TILE_SIZE / 3 + Math.cos(timeMs / 260 + this.row) * 0.7;

    ctx.globalAlpha = fade;
    ctx.save?.();

    // 바닥 그림자
    if (supportsEllipse) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1.5, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 어둠 속에서도 트랩이 빛나 보이도록 색색의 발광 링
    if (options.dark) {
      // 시인성 강화: 웅덩이 테두리가 천천히 커졌다 작아지는 맥동(Pulse)
      const breath = 0.5 + 0.5 * Math.sin(timeMs / 300 + this.row * 1.1 + this.col * 0.7);
      const glowScale = 0.85 + breath * 0.3; // 0.85 ~ 1.15 배

      ctx.globalAlpha = fade * 0.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (supportsEllipse) {
        ctx.ellipse(cx, cy, (rx + 5) * glowScale, (ry + 5) * glowScale, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, (Math.min(rx, ry) + 4) * glowScale, 0, Math.PI * 2);
      }
      ctx.fill();

      ctx.globalAlpha = fade * 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (supportsEllipse) {
        ctx.ellipse(cx, cy, (rx + 6) * glowScale, (ry + 6) * glowScale, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, (Math.min(rx, ry) + 5) * glowScale, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.globalAlpha = fade;
    }

    // 바깥 후광 (shadowBlur 대신 저비용 반투명 타원)
    if (supportsEllipse) {
      ctx.globalAlpha = fade * 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 2.4, ry + 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade;
    }

    // 웅덩이 본체 (가장자리를 살짝 밝게 해 글로우 느낌)
    ctx.fillStyle = color;
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx, cy, Math.min(rx, ry), 0, Math.PI * 2);
    }
    ctx.fill();

    // 광택 하이라이트
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx - rx * 0.28, cy - ry * 0.32, rx * 0.32, ry * 0.28, -0.2, 0, Math.PI * 2);
    } else {
      ctx.arc(cx - rx * 0.28, cy - ry * 0.32, Math.min(rx, ry) * 0.28, 0, Math.PI * 2);
    }
    ctx.fill();

    // 보글보글 거품
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < 3; i++) {
      const angle = timeMs / 700 + (Math.PI * 2 / 3) * i;
      const bx = cx + Math.cos(angle) * rx * 0.55;
      const by = cy + Math.sin(angle) * ry * 0.55;
      ctx.beginPath();
      ctx.arc(bx, by, 0.9 + Math.abs(Math.sin(angle)) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 테두리 링
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx, cy, rx - 0.8, ry - 0.8, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx, cy, Math.min(rx, ry) - 0.8, 0, Math.PI * 2);
    }
    ctx.stroke();

    ctx.restore?.();
    ctx.globalAlpha = 1;
  }
}