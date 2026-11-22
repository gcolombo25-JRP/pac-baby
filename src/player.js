/**
 * Pac-Baby: 베이비(플레이어) 클래스
 */

import {
  COLS, TILE_SIZE, COLORS, TICK_RATE, INPUT_BUFFER_MS,
  STEALTH_COOLDOWN_MS,
  DIRECTIONS, isWalkableTile,
  PENALTY,
} from './constants.js';

/** 파워업(슈가 러시 / 황금 보행기) 잔상 트레일 설정 */
const TRAIL_SAMPLE_MS = 28;   // 잔상 샘플 간격 (더 촘촘하게 남겨 모바일에서도 끊기지 않게)
const TRAIL_LIFE_MS = 420;    // 잔상 하나가 사라지기까지 (0.42초 — 작은 화면에서도 충분히 보인다)
const TRAIL_MAX = 36;         // 동시에 유지하는 최대 잔상 수
const TRAIL_MIN_MOVE = 2;     // 이 거리(px) 이상 움직였을 때만 새 잔상

export default class Player {
  constructor(spawnPos) {
    this.row = spawnPos.row;
    this.col = spawnPos.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;

    // 렌더링 보간용 이전 타일 좌표
    this.prevRow = this.row;
    this.prevCol = this.col;

    this.direction = null;    // 현재 진행 방향
    this.nextDirection = null; // 다음 입력 방향
    this.nextDirectionTimer = 0; // 입력 버퍼 남은 시간 (조작 여유)
    this.walkable = null;     // 이동 가능 판정 오버라이드 (테스터 무벽 모드)
    this.score = 0;
    this.isMoving = false;

    // 소화 트랙 (아이템 → 트랩)
    this.digesting = [];      // { trapType, slowEffect, slowDuration, remaining, total }
    this.expelledTraps = [];  // 소화 완료로 배출된 트랩 (게임 루프가 가져간다)

    // 침대 스텔스 (6단계 부가 기능)
    this.stealthTimer = 0;      // 남은 스텔스 시간
    this.stealthTotal = 0;      // 이번 스텔스의 총 지속 시간 (게이지 표시 기준)
    this.stealthCooldown = 0;   // 재사용 대기 시간

    // 체포 연출: 잡힌 자리에서 굳어버린 상태 (이 동안 이동/입력 무시)
    this.stunTimer = 0;

    // 파워업 잔상 트레일 (슈가 러시 / 황금 보행기)
    this.trail = [];       // { x, y, life, maxLife, radius, color, alpha }
    this._trailAccum = 0;  // 다음 잔상 샘플까지 누적 시간(ms)
    this._trailTime = null; // 마지막 프레임 시간(dt 계산용)
  }

  /** 현재 스텔스 중인지 */
  get isStealthed() {
    return this.stealthTimer > 0;
  }

  /** 현재 체포 연출로 굳어 있는지 */
  get isStunned() {
    return this.stunTimer > 0;
  }

  /**
   * 체포 연출: 그 자리에 굳는다 (이동/방향 입력 정지)
   * @param {number} duration 굳어 있는 시간(ms)
   */
  stun(duration) {
    this.stunTimer = Math.max(0, duration);
    this.isMoving = false;
    this.direction = null;
    this.nextDirection = null;
    this.nextDirectionTimer = 0;
  }

  /**
   * 침대 은신: 스텔스 시작
   * @param {number} duration 지속 시간(ms)
   * @returns {boolean} 발동 성공 여부
   */
  activateStealth(duration) {
    if (this.stealthTimer > 0) return false;    // 이미 스텔스 중
    if (this.stealthCooldown > 0) return false; // 재사용 대기 중
    this.stealthTimer = duration;
    this.stealthTotal = duration;
    return true;
  }

  /**
   * 아이템(가짜 젖꼭지)로 스텔스를 부여한다.
   * - 이미 스텔스 중이면 더 긴 시간을 유지한다 (Math.max — 짧은 쪽으로 덮어쓰지 않음).
   * - 침대 스텔스와 달리 재사용 대기 시간 중에도 발동한다 (아이템 효과).
   * @param {number} duration 부여할 스텔스 시간(ms)
   * @returns {number} 적용 후 남은 스텔스 시간(ms)
   */
  applyStealth(duration) {
    const next = Math.max(0, Number(duration) || 0);
    if (next > this.stealthTimer) {
      this.stealthTimer = next;
      this.stealthTotal = next;
    }
    return this.stealthTimer;
  }

  /** 스텔스/쿨다운 타이머 진행 */
  _updateStealth(dt) {
    if (this.stealthTimer > 0) {
      this.stealthTimer -= dt;
      if (this.stealthTimer <= 0) {
        this.stealthTimer = 0;
        this.stealthTotal = 0;
        this.stealthCooldown = STEALTH_COOLDOWN_MS;
      }
      return;
    }

    if (this.stealthCooldown > 0) {
      this.stealthCooldown = Math.max(0, this.stealthCooldown - dt);
    }
  }

  /**
   * 아이템 섭취 시 소화 시작 (digestTime 후 트랩 배출)
   * @param {object} config ITEMS 의 아이템 설정
   */
  startDigestion(config) {
    this.digesting.push({
      trapType: config.trapType,
      slowEffect: config.slowEffect,
      slowDuration: config.slowDuration,
      remaining: config.digestTime,
      total: config.digestTime,
      itemName: config.name,
    });
  }

  /**
   * 소화된 트랩을 꺼내 간다 (게임 루프에서 호출)
   * @returns {Array<{trapType: string, slowEffect: number, slowDuration: number}>}
   */
  takeExpelledTraps() {
    const expelled = this.expelledTraps;
    this.expelledTraps = [];
    return expelled;
  }

  /** 소화 타이머 진행 → 끝난 항목은 배출 목록으로 이동 */
  _updateDigestion(dt) {
    for (let i = this.digesting.length - 1; i >= 0; i--) {
      const track = this.digesting[i];
      track.remaining -= dt;
      if (track.remaining > 0) continue;

      this.digesting.splice(i, 1);
      this.expelledTraps.push({
        trapType: track.trapType,
        slowEffect: track.slowEffect,
        slowDuration: track.slowDuration,
      });
    }
  }

  /** 입력 방향 설정 (타일 중앙에서만 전환 적용, 일정 시간 기억) */
  setDirection(dir) {
    if (!DIRECTIONS[dir]) return;
    if (this.nextDirection === dir) return; // 같은 방향 반복 입력은 타이머만 유지
    this.nextDirection = dir;
    this.nextDirectionTimer = INPUT_BUFFER_MS;
  }

  /**
   * 다음 타일 좌표 계산 (좌우 터널 통과 포함)
   * @param {string} dir
   * @returns {{row: number, col: number}}
   */
  _nextTile(dir) {
    const delta = DIRECTIONS[dir];
    let row = this.row + delta.row;
    let col = this.col + delta.col;

    // 좌우 끝은 연결된 터널 (row 14 처럼 양 끝이 뚫린 행)
    if (col < 0) col = COLS - 1;
    if (col >= COLS) col = 0;

    return { row, col };
  }

  /** 해당 방향으로 이동 가능한지 */
  _canMove(dir, map) {
    if (!DIRECTIONS[dir]) return false;
    const { row, col } = this._nextTile(dir);

    // 테스터 무벽 모드: 외부 판정을 우선 사용
    if (typeof this.walkable === 'function') return this.walkable(row, col);

    return isWalkableTile(map, row, col);
  }

  /**
   * tick 마다 호출 — 타일 단위 이동 처리
   * @param {number[][]} map
   * @param {number} dt tick 간격(ms) — 입력 버퍼 만료 판정
   */
  update(map, dt = TICK_RATE) {
    // 보간 기준점 저장
    this.prevRow = this.row;
    this.prevCol = this.col;

    // 체포 연출(굳은 상태) 중: 이동/입력은 멈추고 타이머만 흐른다
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      this._updateDigestion(dt);
      this._updateStealth(dt);
      this.isMoving = false;
      return;
    }

    // 소화 진행 (완료되면 트랩 배출 예약)
    this._updateDigestion(dt);

    // 스텔스/쿨다운 타이머
    this._updateStealth(dt);

    // 1) 대기 중인 방향: 지금 갈 수 있으면 즉시 전환, 아니면 버퍼 시간만큼 기다린다
    if (this.nextDirection) {
      if (this._canMove(this.nextDirection, map)) {
        this.direction = this.nextDirection;
        this.nextDirection = null;
        this.nextDirectionTimer = 0;
      } else {
        this.nextDirectionTimer -= dt;
        if (this.nextDirectionTimer <= 0) {
          this.nextDirection = null;
          this.nextDirectionTimer = 0;
        }
      }
    }

    // 2) 이동할 수 없으면 정지
    if (!this.direction || !this._canMove(this.direction, map)) {
      this.isMoving = false;
      return;
    }

    // 3) 한 타일 이동
    const { row, col } = this._nextTile(this.direction);
    this.row = row;
    this.col = col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.isMoving = true;
  }

  /**
   * 보간된 화면 중심 좌표 (조명/이펙트에서도 사용)
   * @param {number} alpha
   * @returns {{x: number, y: number}}
   */
  getRenderCenter(alpha = 1) {
    const t = Math.min(Math.max(alpha, 0), 1);

    // 터널 통과(타일 좌표가 1칸 이상 점프) 시에는 보간하지 않는다
    const drawCol = Math.abs(this.prevCol - this.col) <= 1
      ? this.prevCol + (this.col - this.prevCol) * t
      : this.col;
    const drawRow = Math.abs(this.prevRow - this.row) <= 1
      ? this.prevRow + (this.row - this.prevRow) * t
      : this.row;

    return {
      x: (drawCol + 0.5) * TILE_SIZE,
      y: (drawRow + 0.5) * TILE_SIZE,
    };
  }

  /** 바라보는 방향 벡터 (눈동자 시선용) */
  _lookVector() {
    const dir = this.direction || this.nextDirection;
    if (dir === 'LEFT') return { x: -1, y: 0 };
    if (dir === 'RIGHT') return { x: 1, y: 0 };
    if (dir === 'UP') return { x: 0, y: -1 };
    if (dir === 'DOWN') return { x: 0, y: 1 };
    return { x: 0, y: 0.55 }; // 정지: 살짝 아래(발끝)를 본다
  }

  /**
   * 파워업 잔상 트레일 갱신 — 게임 루프가 매 프레임(렌더 직전) 호출한다.
   * - 슈가 러시 / 황금 보행기 중에만 새 잔상을 남긴다.
   * - 파워업이 끝나도 남은 잔상은 수명을 다하며 자연스럽게 사라진다.
   * @param {number} timeMs 애니메이션 시간(ms)
   * @param {number} alpha tick 보간 계수 (0~1)
   * @param {{sugarRush?: boolean, goldenWalker?: boolean}} options 파워업 상태
   */
  updateTrail(timeMs, alpha = 1, options = {}) {
    // dt 계산: 시간 역행(리셋/랩)이나 탭 복귀 폭주는 안전하게 잘라낸다
    const previous = this._trailTime;
    this._trailTime = timeMs;
    let dt = previous == null ? 0 : timeMs - previous;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 100);

    // 수명 감소 + 만료 정리
    for (const ghost of this.trail) ghost.life -= dt;
    this.trail = this.trail.filter(ghost => ghost.life > 0);

    const sugarRush = options.sugarRush === true;
    const goldenWalker = options.goldenWalker === true;
    if (!sugarRush && !goldenWalker) {
      this._trailAccum = 0;
      return;
    }

    this._trailAccum += dt;
    if (this._trailAccum < TRAIL_SAMPLE_MS) return;
    this._trailAccum %= TRAIL_SAMPLE_MS;

    const center = this.getRenderCenter(alpha);
    const last = this.trail[this.trail.length - 1];
    if (last) {
      const dx = center.x - last.x;
      const dy = center.y - last.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < TRAIL_MIN_MOVE * TRAIL_MIN_MOVE) return; // 정지 중엔 잔상 없음
      // 터널 통과(맵 반대편 순간이동)처럼 크게 점프한 경우엔 선이 남지 않게 건너뛴다
      if (distSq > (TILE_SIZE * 6) * (TILE_SIZE * 6)) return;
    }

    const hue = (timeMs / 8) % 360;
    const ghost = {
      x: center.x,
      y: center.y,
      life: TRAIL_LIFE_MS,
      maxLife: TRAIL_LIFE_MS,
      radius: TILE_SIZE / 2 - 1,
      color: '#ffd54f',
      alpha: 0.62,
    };

    // 초기 투명도를 높여 작은 모바일 화면에서도 잔상이 또렷하게 보이게 한다
    if (goldenWalker && sugarRush) {
      ghost.color = `hsl(${hue}, 100%, 75%)`;
      ghost.alpha = 0.72;
    } else if (goldenWalker) {
      ghost.color = hue % 40 < 20 ? '#ffd54f' : '#fff8dc';
      ghost.alpha = 0.7;
    } else {
      ghost.color = `hsl(${hue}, 100%, 72%)`;
      ghost.alpha = 0.58;
    }

    this.trail.push(ghost);
    if (this.trail.length > TRAIL_MAX) {
      this.trail.splice(0, this.trail.length - TRAIL_MAX);
    }
  }

  /**
   * 잔상 트레일 렌더링 — 베이비 몸통보다 먼저 호출해 아래에 깔리게 한다.
   * @param {CanvasRenderingContext2D} ctx
   */
  renderTrail(ctx) {
    if (this.trail.length === 0) return;

    const supportsEllipse = typeof ctx.ellipse === 'function';
    ctx.save?.();

    // 오래된 잔상부터 그려 최신 잔상이 위에 오게 한다
    for (const ghost of this.trail) {
      const ratio = Math.max(0, Math.min(1, ghost.life / ghost.maxLife));
      // 초반에는 오래 유지하고 끝에서 부드럽게 사라진다 (이전 ratio² 보다 훨씬 또렷)
      const fade = ratio * (0.55 + 0.45 * ratio);
      const radius = ghost.radius * (0.62 + 0.38 * ratio);

      // 발광: 작은 화면에서도 잔상이 배경에 묻히지 않도록 색 번짐을 준다
      ctx.shadowColor = ghost.color;
      ctx.shadowBlur = 8 + 10 * ratio;
      ctx.globalAlpha = fade * ghost.alpha;
      ctx.fillStyle = ghost.color;
      ctx.beginPath();
      if (supportsEllipse) {
        ctx.ellipse(ghost.x, ghost.y, radius, radius * 0.92, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(ghost.x, ghost.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    ctx.restore?.();
  }

  /**
   * 캔버스에 베이비 렌더링
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} alpha 보간 계수 (0~1)
   * @param {number} timeMs 애니메이션 시간(ms) — 게임 루프가 넘겨준다
   * @param {{sugarRush?: boolean, goldenWalker?: boolean}} options 파워업 연출
   */
  render(ctx, alpha = 1, timeMs = 0, options = {}) {
    const t = Math.min(Math.max(alpha, 0), 1);
    const stealth = this.stealthTimer > 0;
    const sugarRush = options.sugarRush === true;
    const goldenWalker = options.goldenWalker === true;
    const scared = this.stunTimer > 0; // 체포 연출: 깜짝 놀라 굳은 표정

    // 파워업 색상: 황금 보행기 > 슈가 러시(무지개) > 기본
    let bodyColor = COLORS.BABY;
    let glowColor = 'rgba(255, 224, 130, 0.85)';
    if (goldenWalker && sugarRush) {
      bodyColor = `hsl(${(timeMs / 8) % 360}, 100%, 70%)`;
      glowColor = 'rgba(255, 215, 0, 0.95)';
    } else if (goldenWalker) {
      bodyColor = '#ffd54f';
      glowColor = 'rgba(255, 215, 0, 0.95)';
    } else if (sugarRush) {
      bodyColor = `hsl(${(timeMs / 8) % 360}, 95%, 68%)`;
      glowColor = 'rgba(244, 143, 177, 0.9)';
    }

    // 체포 연출: 핏기 없는 창백한 얼굴 + 붉은 경고 글로우
    if (scared) {
      bodyColor = '#d8c9a3';
      glowColor = 'rgba(239, 83, 80, 0.85)';
    }

    // 스텔스 중에는 반투명하게 그린다
    if (stealth) ctx.globalAlpha = 0.32;

    const center = this.getRenderCenter(t);
    const radius = TILE_SIZE / 2 - 2;

    // 이동 중: 통통 튀는 바운스 + 찌그러짐(Squash)
    const phase = Math.sin(timeMs / 72);
    const bounce = this.isMoving ? Math.abs(phase) * TILE_SIZE * 0.14 : 0;
    const squash = this.isMoving ? (1 - Math.abs(phase)) * 0.12 : 0;
    const breathe = 1 + Math.sin(timeMs / 520) * 0.02; // 숨쉬기

    const cx = center.x + (scared ? Math.sin(timeMs / 42) * 1.1 : 0); // 굳은 채 떨림
    const cy = center.y - bounce;
    const rx = radius * (1 + squash * 0.7);
    const ry = radius * (1 - squash * 0.4) * breathe;
    const supportsEllipse = typeof ctx.ellipse === 'function';

    // 바닥 그림자 (바운스 높이에 따라 옅어짐)
    if (supportsEllipse) {
      ctx.fillStyle = bounce > 0.1 ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.32)';
      ctx.beginPath();
      ctx.ellipse(center.x, center.y + radius * 0.8, radius * 0.78, radius * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 몸통 (파워업 시 무지개/황금, 평소엔 따뜻한 네온 글로우)
    ctx.save?.();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 12;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // 위쪽 광택
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.beginPath();
    ctx.arc(cx - rx * 0.32, cy - ry * 0.42, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // 슈가 러시: 알록달록 깜빡이는 링 + 색색의 반짝이
    if (sugarRush) {
      const hue = (timeMs / 6) % 360;
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3.5, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 5; i++) {
        const angle = timeMs / 240 + (Math.PI * 2 / 5) * i;
        ctx.fillStyle = `hsl(${(hue + i * 72) % 360}, 100%, 65%)`;
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(angle) * (radius + 6),
          cy + Math.sin(angle) * (radius + 6),
          1.6, 0, Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // 황금 보행기: 무적의 황금 링 + 왕관 별
    if (goldenWalker) {
      const ringPulse = Math.sin(timeMs / 180) * 1.2;

      ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4.5 + ringPulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 248, 220, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 7.5 + ringPulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#fff59d';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (Math.PI * 2 / 3) * i + timeMs / 500;
        const sx = cx + Math.cos(angle) * (radius + 9);
        const sy = cy + Math.sin(angle) * (radius + 9);
        ctx.beginPath();
        ctx.moveTo(sx - 2, sy);
        ctx.lineTo(sx + 2, sy);
        ctx.moveTo(sx, sy - 2);
        ctx.lineTo(sx, sy + 2);
        ctx.stroke();
      }
    }

    // 볼터치
    ctx.fillStyle = 'rgba(255, 171, 145, 0.55)';
    ctx.beginPath();
    ctx.arc(cx - 5.6, cy + 1.8, 1.7, 0, Math.PI * 2);
    ctx.arc(cx + 5.6, cy + 1.8, 1.7, 0, Math.PI * 2);
    ctx.fill();

    // 눈 (진행 방향을 바라보는 눈동자 + 주기적 깜빡임)
    // 체포 연출 중에는 눈을 크게 뜨고(휘둥그레) 깜빡이지 않는다
    const look = scared ? { x: 0, y: 0 } : this._lookVector();
    const eyeY = cy - 3.2;
    const blink = (timeMs % 3400) > 3260 ? 0.2 : 1;
    const eyeRx = scared ? 3.7 : 3.0;
    const eyeRy = scared ? 4.3 : 3.5 * blink;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (supportsEllipse) {
      ctx.ellipse(cx - 3.9, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 3.9, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx - 3.9, eyeY, eyeRx, 0, Math.PI * 2);
      ctx.arc(cx + 3.9, eyeY, eyeRx, 0, Math.PI * 2);
    }
    ctx.fill();

    // 눈동자 (방향에 따라 이동) — 굳은 표정이면 작게(겁먹은 눈)
    const pupilX = look.x * 1.25;
    const pupilY = look.y * 1.25;
    const pupilR = scared ? 1.2 : 1.6;
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(cx - 3.9 + pupilX, eyeY + pupilY, pupilR, 0, Math.PI * 2);
    ctx.arc(cx + 3.9 + pupilX, eyeY + pupilY, pupilR, 0, Math.PI * 2);
    ctx.fill();

    // 눈동자 반짝임
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(cx - 4.4 + pupilX, eyeY - 0.6 + pupilY, 0.62, 0, Math.PI * 2);
    ctx.arc(cx + 3.4 + pupilX, eyeY - 0.6 + pupilY, 0.62, 0, Math.PI * 2);
    ctx.fill();

    // 입: 평소엔 미소, 체포 연출 중에는 "Oh!" 하고 벌어진 입
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    if (scared) {
      ctx.fillStyle = '#4e342e';
      ctx.beginPath();
      ctx.arc(cx, cy + 3.1, 2.4, 0, Math.PI * 2);
      ctx.fill();

      // 식은땀 한 방울 — 얼어붙은 표정 강조
      ctx.fillStyle = 'rgba(129, 212, 250, 0.92)';
      ctx.beginPath();
      ctx.arc(
        cx + rx * 0.78,
        cy - ry * 0.86 + Math.sin(timeMs / 260) * 2.2,
        1.6, 0, Math.PI * 2,
      );
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy + 2.4, 3.8, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // 머리카락 한 가닥 (아호게)
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + 1.6, cy - ry + 1.2, 2.3, 0.15 * Math.PI, 1.35 * Math.PI);
    ctx.stroke();

    // 스텔스 중이면 반짝이는 테두리 표시
    if (stealth) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.stroke();

      // 숨겨진 느낌의 반짝이 점
      ctx.fillStyle = '#b3e5fc';
      for (let i = 0; i < 4; i++) {
        const angle = (Math.PI / 2) * i + timeMs / 900;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * (radius + 6), cy + Math.sin(angle) * (radius + 6), 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore?.();
    ctx.globalAlpha = 1; // 알파 복원 (restore 뒤에 해야 확실히 되돌아간다)
  }

  /**
   * 페널티 없이 초기 상태로 되돌린다 (라운드 시작 / 재도전용)
   * @param {{row: number, col: number}} spawnPos
   */
  reset(spawnPos) {
    this.row = spawnPos.row;
    this.col = spawnPos.col;
    this.x = this.col * TILE_SIZE;
    this.y = this.row * TILE_SIZE;
    this.prevRow = this.row;
    this.prevCol = this.col;
    this.isMoving = false;
    this.direction = null;
    this.nextDirection = null;
    this.nextDirectionTimer = 0;
    this.digesting = [];
    this.expelledTraps = [];
    this.stealthTimer = 0;
    this.stealthTotal = 0;
    this.stealthCooldown = 0;
    this.stunTimer = 0;
    this.trail = [];
    this._trailAccum = 0;
    this._trailTime = null;
  }

  /** 악당에게 잡혔을 때 */
  onCaught(spawnPos) {
    this.score += PENALTY.CAUGHT;
    this.reset(spawnPos);
  }
}