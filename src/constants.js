/**
 * Pac-Baby: 공통 상수 및 맵 데이터
 */

// ===== 캔버스 & 타일 설정 =====
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 640;
export const COLS = 28;
export const ROWS = 28;
export const TILE_SIZE = CANVAS_WIDTH / COLS; // ≈ 22.86px

// ===== 색상 팔레트 =====
export const COLORS = {
  WALL:        '#1a1a2e',   // 벽 (어두운 네이비)
  WALL_TOP:    '#2c4270',   // 벽 상단 하이라이트 (입체감)
  WALL_EDGE:   '#3d5aa0',   // 벽 모서리 베벨
  FLOOR:       '#0f3460',   // 바닥 (진한 블루)
  FLOOR_ALT:   '#0d3057',   // 바닥 체크 패턴 (한 단계 어두운 블루)
  NEON:        '#4fc3f7',   // 네온 시안 (벽 글로우)
  NEON_CORE:   '#c9efff',   // 네온 코어 (밝은 심)
  SPAWN_BED:   '#e94560',   // 침대 스폰 (레드)
  STEALTH_BED: '#29b6f6',   // 스텔스 사용 중인 침대 (파랑)
  ENEMY_SPAWN: '#533483',   // 악당 스폰 (퍼플)
  ITEM_SPOT:   '#16213e',   // 아이템 위치 (약간 밝은 네이비)
  GRID_LINE:   '#1a1a3e',   // 그리드 선 (아주 미세)
  BABY:        '#ffe082',   // 베이비 (노랑)
  BABY_CHEEK:  '#ffab91',   // 베이비 볼터치 (코랄)
  ENEMY:       '#ef5350',   // 악당 (빨강)
  ENEMY_PATROL: '#ffa726',  // 경비 악당 (주황)
  ENEMY_FROZEN: '#64b5f6',  // 얼어붙은 악당 (파랑)
  ENEMY_SCARED: '#90caf9',  // 겁에 질린 악당 (연한 파랑)
  TEAR:        '#81d4fa',   // 눈물 (맑은 하늘색)
  GOLDEN:      '#ffd700',   // 황금 젖병 / 보행기 모드
  SUGAR:       '#f06292',   // 슈가 러시 (핑크)
};

// ===== 화질 / 조명 설정 =====
export const MAX_DEVICE_PIXEL_RATIO = 3;      // 레티나 스케일 상한 (성능 보호)
export const BABY_LIGHT_RADIUS_TILES = 3.6;   // 베이비 주변 조명 반경 (타일 단위)
export const BABY_LIGHT_FEATHER_TILES = 1.8;  // 조명 가장자리 번짐 (부드러운 감쇠)

// ===== 맵 데이터 (28x28) =====
/**
 * 레전드:
 *   0 = 빈 공간 (이동 가능)
 *   1 = 벽 (이동 불가)
 *   2 = 베이비 스폰 (침대)
 *   3 = 악당 스폰 (보모 대기실)
 *   4 = 아이템 스폰 위치
 */
export const TILE_MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,4,0,0,0,1,1,0,0,0,4,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,4,1,1,1,1,3,1,1,1,1,1,0,1,1,0,1,1,1,1,1,3,1,1,1,1,4,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,0,1],
  [1,0,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,0,1],
  [1,0,0,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,4,0,0,0,0,0,0,0,4,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,1,0,0,0,0,1,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,2,0,0,0,0,2,1,0,1,1,0,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,0,1,1,0,1,2,0,0,0,0,2,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,1,0,0,0,0,1,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,4,0,0,1,1,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,1,1,0,0,4,1],
  [1,1,1,0,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,0,1,1,1],
  [1,1,1,0,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,0,1,1,1],
  [1,0,0,0,0,0,0,1,1,4,0,0,0,1,1,0,0,4,0,1,1,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// ===== 게임 속도 =====
export const TICK_RATE = 140; // ms — 기본 논리 tick (속도 단계 미지정 시 사용)
export const BABY_SPEED = 1;  // 타일/틱

// ===== 속도 단계 (1 = 가장 느림, 10 = 가장 빠름) =====
// 악당은 어떤 단계에서도 베이비보다 느리다 (enemyTileMs >= babyTileMs × 1.75)
export const SPEED_LEVELS = [
  { level: 1,  babyTileMs: 220, enemyTileMs: 385 },
  { level: 2,  babyTileMs: 205, enemyTileMs: 360 },
  { level: 3,  babyTileMs: 190, enemyTileMs: 335 },
  { level: 4,  babyTileMs: 175, enemyTileMs: 310 },
  { level: 5,  babyTileMs: 160, enemyTileMs: 280 },
  { level: 6,  babyTileMs: 150, enemyTileMs: 265 },
  { level: 7,  babyTileMs: 140, enemyTileMs: 245 },
  { level: 8,  babyTileMs: 130, enemyTileMs: 230 },
  { level: 9,  babyTileMs: 120, enemyTileMs: 210 },
  { level: 10, babyTileMs: 110, enemyTileMs: 195 },
];
export const DEFAULT_SPEED_LEVEL = 1; // 테스트 편의를 위해 가장 느린 단계로 시작
export const ENEMY_SLOWDOWN_FACTOR = 1.75; // 악당 1타일 시간 = 베이비 × 이 값 (항상 느리게 보장)

// ===== 보모(악당) 이동 속도 =====
export const ENEMY_TILE_MS = 385;      // 보모 기본 1타일 이동 시간 (속도 단계가 지정되면 그 값 사용)
export const ENEMY_START_DELAY_MS = 900; // 게임 시작 시 보모가 잠에서 깨는 시간 (베이비가 도망칠 틈)
export const CHASE_ENEMY_COUNT = 2;     // 베이비를 쫓는 보모 수 (나머지는 경비/순찰)
export const RESPAWN_GRACE_MS = 1500;  // 체포 후 잠깐의 무적 시간
export const INPUT_BUFFER_MS = 1200;   // 방향을 미리 눌러도 기억하는 시간 (모바일 코너링 여유)
export const PATROL_SAFE_DISTANCE = 5; // 경비(순찰) 악당이 베이비에게서 유지하는 최소 거리(타일)

// ===== 터치 조작 보정 =====
export const TOUCH_TAP_MEMORY_MS = 260;   // 짧은 탭도 다음 tick 이 인식하도록 방향을 잠깐 기억
export const TOUCH_SWIPE_THRESHOLD = 24;  // 스와이프로 방향을 인식하는 최소 이동 거리(px)

// ===== 아이템 리스폰 =====
export const ITEM_RESPAWN_MS = 15000;  // 섭취 후 15초 뒤 임의의 장소에 다시 등장

// ===== 트랩 (5단계) =====
export const TRAP_LIFE_MS = 20000;     // 트랩이 바닥에 남아 있는 시간
export const TRAP_MAX_ACTIVE = 6;      // 동시에 존재할 수 있는 최대 트랩 수
export const TRAP_HIT_SCORE = 100;     // 악당이 트랩을 밟았을 때 획득 점수

// 트랩을 밟은 악당의 추가 얼림 시간 (기존 감속 효과는 그대로 유지)
export const TRAP_FREEZE_MS = {
  PEE: 3000,    // 소변: 3초
  VOMIT: 6000,  // 토사물: 6초
  POOP: 10000,  // 대변: 10초
};

// 트랩 색상 (렌더링/파티클 공용) — 노랑 / 연두 / 갈색
export const TRAP_COLORS = {
  PEE: '#fff176',   // 연노랑 (오줌)
  VOMIT: '#aed581', // 연두 (토사물)
  POOP: '#6d4c41',  // 갈색 (똥)
};

// ===== 스텔스 (6단계: 침대 은신) =====
export const STEALTH_DURATION_MS = 10000; // 침대에 들어가면 10초 스텔스
export const ENEMY_CONFUSE_MS = 5000;     // 악당이 목표를 잃고 순찰하는 시간
export const STEALTH_COOLDOWN_MS = 3000;  // 스텔스 종료 후 재사용 대기 시간

// ===== 게임 상태 UI (7단계) =====
export const READY_COUNTDOWN_MS = 3000; // 시작 전 준비(카운트다운) 시간
export const SCORE_POPUP_MS = 900;      // 점수 팝업이 떠 있는 시간

// ===== 목숨 / 라운드 / 하이스코어 (9단계) =====
export const PLAYER_LIVES = 3;              // 기본 목숨(하트)
export const ROUND_CLEAR_MODE = 'ITEMS';    // 'ITEMS' | 'SCORE' | 'BOTH'
export const ROUND_TARGET_SCORE = 2000;     // SCORE/BOTH 모드의 라운드 목표(증분)
export const ROUND_SPEED_STEP = 1;          // 라운드마다 속도 단계 += (최대 10)
export const HISCORE_KEY = 'pacbaby.hiscore'; // localStorage 키
export const HELP_SEEN_KEY = 'pacbaby.helpSeen'; // 사용 설명서 자동 표시 여부(localStorage)

// ===== 이동 방향 벡터 =====
export const DIRECTIONS = {
  UP:    { row: -1, col:  0 },
  DOWN:  { row:  1, col:  0 },
  LEFT:  { row:  0, col: -1 },
  RIGHT: { row:  0, col:  1 },
};

/**
 * 타일 이동 가능 여부 (벽(1)만 이동 불가, 0/2/3/4 는 이동 가능)
 * @param {number[][]} map
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
export function isWalkableTile(map, row, col) {
  if (row < 0 || row >= map.length) return false;
  if (col < 0 || col >= map[row].length) return false;
  return map[row][col] !== 1;
}

/**
 * 무작위 이동 가능 타일을 하나 고른다.
 * @param {number[][]} map
 * @param {() => number} rng 난수 함수 (테스트에서 주입 가능)
 * @param {Array<{row: number, col: number}>} avoid 제외할 타일 목록
 * @returns {{row: number, col: number} | null}
 */
export function randomWalkableTile(map, rng = Math.random, avoid = []) {
  const rows = map.length;
  const cols = map[0].length;

  for (let attempt = 0; attempt < 60; attempt++) {
    const row = Math.min(rows - 1, Math.floor(rng() * rows));
    const col = Math.min(cols - 1, Math.floor(rng() * cols));

    if (!isWalkableTile(map, row, col)) continue;
    if (avoid.some(p => p.row === row && p.col === col)) continue;
    return { row, col };
  }
  return null;
}

// ===== 특수 메커니즘: 슈가 러시 & 황금 젖병 =====
/** 캔디(🍬) 섭취 시 3초간 이동 속도 +50% + 몸이 알록달록 깜빡이는 부스터 */
export const SUGAR_RUSH = {
  duration: 3000,        // 3초
  speedMultiplier: 1.5,  // 이동 속도 50% 증가
  colors: ['#ff8a80', '#ffd54f', '#81c784', '#4fc3f7', '#ba68c8', '#fff176'],
};

/** 맵 중앙의 슈퍼 아이템 '황금 젖병' — 8초 보행기 모드 (무적 + 속도 증가) */
export const GOLDEN_BOTTLE = {
  name: '황금 젖병',
  symbol: '🍼',
  duration: 8000,          // 8초 보행기 모드
  speedMultiplier: 1.4,    // 이동 속도 증가
  knockScore: 300,         // 악당과 부딪히면 날려버리고 +300점
  color: '#ffd700',
  respawnMs: 20000,        // 다시 중앙에 나타나기까지 20초
};

/** 황금 젖병 스폰 — 28x28 맵의 정중앙 (터널 행의 한가운데) */
export const GOLDEN_SPAWN = { row: 14, col: 14 };

// ===== 아이템 속성 =====
export const ITEMS = {
  MILK: {
    name: '우유병',
    symbol: '🥛',
    score: 50,            // 섭취 점수
    digestTime: 5000,     // 5초
    trapType: 'PEE',
    slowEffect: 0.10,     // 10% 감속
    slowDuration: 10000,  // 10초
  },
  CANDY: {
    name: '캔디',
    symbol: '🍬',
    score: 70,
    digestTime: 7000,     // 7초
    trapType: 'VOMIT',
    slowEffect: 0.20,     // 20% 감속
    slowDuration: 10000,  // 10초
  },
  COOKIE: {
    name: '쿠키',
    symbol: '🍪',
    score: 100,
    digestTime: 10000,    // 10초
    trapType: 'POOP',
    slowEffect: 0.30,     // 30% 감속
    slowDuration: 10000,  // 10초
  },
  // 슈퍼 아이템: 소화/트랩 없음. 맵 중앙에서 20초마다 다시 나타난다.
  GOLDEN: {
    name: GOLDEN_BOTTLE.name,
    symbol: GOLDEN_BOTTLE.symbol,
    score: 0,
    digestTime: 0,
    trapType: null,
    slowEffect: 0,
    slowDuration: 0,
    super: true,
    respawnMs: GOLDEN_BOTTLE.respawnMs,
  },
};

// ===== 스킬 속성 =====
export const SKILL_CRY = {
  name: '울기',
  key: 'Space',
  cost: -100,
  freezeDuration: 3000,   // 3초
  cooldown: 3000,         // 연사 방지: 3초에 1회
};

// ===== 페널티 =====
export const PENALTY = {
  CAUGHT: -200,           // 악당 체포 시
};

// ===== 스폰 위치 찾기 헬퍼 =====
export function findSpawnTiles(map, tileValue) {
  const positions = [];
  for (let row = 0; row < map.length; row++) {
    for (let col = 0; col < map[row].length; col++) {
      if (map[row][col] === tileValue) {
        positions.push({ row, col });
      }
    }
  }
  return positions;
}

/** 베이비 스폰(침대) 위치를 찾는다 — 첫 번째 2 타일 */
export function getBabySpawn(map) {
  return findSpawnTiles(map, 2)[0] || null;
}

/** 악당 스폰 위치를 찾는다 */
export function getEnemySpawns(map) {
  return findSpawnTiles(map, 3);
}

/** 아이템 스폰 위치를 찾는다 */
export function getItemSpawns(map) {
  return findSpawnTiles(map, 4);
}