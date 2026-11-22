/**
 * Pac-Baby: 공통 상수 및 맵 데이터
 */

// ===== 캔버스 & 타일 설정 =====
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 640;
export const COLS = 28;
export const ROWS = 28;
export const TILE_SIZE = CANVAS_WIDTH / COLS; // ≈ 22.86px

// ===== 색상 팔레트 (아기방 / 유아 놀이방 테마) =====
export const COLORS = {
  // 장난감 블록 2.5D 벽 — 파스텔 민트 윗면 + 우드 톤 앞벽
  WALL:        '#438a7e',   // 벽 앞면 (딥 민트 — 장난감 블록 측면)
  WALL_TOP:    '#6ec6b8',   // 벽 윗면 (파스텔 민트)
  WALL_EDGE:   '#b8f2e6',   // 벽 상단 림 (밝은 민트 하이라이트)
  // 포근한 라벤더/트와일라잇 놀이매트 바닥
  FLOOR:       '#352f4d',   // 바닥 (라벤더 트와일라잇)
  FLOOR_ALT:   '#3d3658',   // 바닥 체크 패턴 (한 단계 밝은 라벤더)
  NEON:        '#b8f2e6',   // 따뜻한 민트 하이라이트 (벽 글로우)
  NEON_CORE:   '#f4fffb',   // 하이라이트 코어 (거의 흰색)
  SPAWN_BED:   '#e94560',   // 침대 스폰 (레드)
  STEALTH_BED: '#29b6f6',   // 스텔스 사용 중인 침대 (파랑)
  ENEMY_SPAWN: '#533483',   // 악당 스폰 (퍼플)
  ITEM_SPOT:   '#3f3757',   // 아이템 위치 (라벤더 위 살짝 밝은 매트)
  GRID_LINE:   '#2d2842',   // 그리드 선 (아주 미세)
  // 통통한 아기 — 살구/복숭아 피부톤
  BABY:        '#ffd6ba',   // 아기 피부 (따뜻한 살구/복숭아)
  BABY_SHADE:  '#f0bb98',   // 아기 피부 음영 (볼살/손발 테두리)
  BABY_CHEEK:  '#ff9e8a',   // 베이비 볼터치 (큼직한 코랄)
  BABY_HAIR:   '#b5763f',   // 아호게 머리카락 (부드러운 밤색)
  BABY_BIB:    '#bfe9df',   // 턱받이 (파스텔 민트)
  BABY_DIAPER: '#fff8f0',   // 기저귀 (아이보리)
  // 깐깐한 보모
  ENEMY:       '#ef5350',   // 추격 보모 (빨강/코랄)
  ENEMY_PATROL: '#ffa726',  // 순찰 보모 (주황/머스타드)
  ENEMY_FROZEN: '#64b5f6',  // 얼어붙은 보모 (파랑)
  ENEMY_SCARED: '#90caf9',  // 겁에 질린 보모 (연한 파랑 — FLEE)
  ENEMY_HAIR:  '#3b2a3f',   // 쪽진 올림머리 (진한 자주빛 밤색)
  ENEMY_HAIR_DARK: '#241a29', // 올림머리 외곽선
  ENEMY_APRON: '#f7f1e6',   // 빳빳한 앞치마 (아이보리)
  ENEMY_APRON_EDGE: 'rgba(122, 72, 84, 0.72)', // 앞치마 외곽선
  ENEMY_ANGER: '#b71c1c',   // 짜증 핏줄(💢 형태 벡터) 포인트
  TEAR:        '#81d4fa',   // 눈물 (맑은 하늘색)
  GOLDEN:      '#ffd700',   // 황금 젖병 / 보행기 모드
  SUGAR:       '#f06292',   // 슈가 러시 (핑크)
};

/**
 * 벽 블록(장난감 교구) 파스텔 팔레트.
 * - 연결된 벽 덩어리(Island)마다 색을 비대칭으로 배분해 아기방 스펀지/원목 교구처럼 보이게 한다.
 * - 모든 팔레트는 비슷한 명도(지각 밝기)를 유지해 어두운 라벤더 바닥 위에서
 *   "벽 = 밝은 블록 / 바닥 = 어두운 매트" 판독성이 흔들리지 않는다.
 * - top: 윗면 / front*: 정면 돌출면(아래로 갈수록 어두움) / rim*: 상단·좌측 하이라이트
 *   seam: 앞벽 모서리 구분선 / sheen*: 윗면 빛 번짐 / emboss*: 블록 표면 도장(양각·음각)
 */
export const WALL_PALETTES = [
  {
    name: 'mint',
    top: '#6ec6b8',
    frontTop: '#4f9e90',
    frontMid: '#438a7e',
    frontBottom: '#38756b',
    rim: 'rgba(232, 255, 250, 0.95)',
    rimSoft: 'rgba(184, 242, 230, 0.58)',
    rimGlow: 'rgba(184, 242, 230, 0.55)',
    rimRight: 'rgba(120, 190, 175, 0.52)',
    rimRightGlow: 'rgba(32, 86, 78, 0.4)',
    seam: 'rgba(24, 58, 52, 0.8)',
    bevel: 'rgba(184, 242, 230, 0.7)',
    sheen: [
      ['0', 'rgba(214, 255, 246, 0.3)'],
      ['0.35', 'rgba(184, 242, 230, 0.12)'],
      ['1', 'rgba(184, 242, 230, 0)'],
    ],
    emboss: 'rgba(244, 255, 252, 0.94)',
    embossDark: 'rgba(10, 46, 39, 0.42)',
    embossEdge: 'rgba(255, 255, 255, 0.92)',
  },
  {
    name: 'butter',
    top: '#f0d98f',
    frontTop: '#d8bd6b',
    frontMid: '#c7a95a',
    frontBottom: '#b0914a',
    rim: 'rgba(255, 249, 220, 0.95)',
    rimSoft: 'rgba(255, 235, 165, 0.58)',
    rimGlow: 'rgba(255, 224, 130, 0.5)',
    rimRight: 'rgba(190, 158, 80, 0.52)',
    rimRightGlow: 'rgba(90, 70, 20, 0.4)',
    seam: 'rgba(92, 72, 24, 0.75)',
    bevel: 'rgba(255, 239, 180, 0.7)',
    sheen: [
      ['0', 'rgba(255, 252, 230, 0.32)'],
      ['0.35', 'rgba(255, 235, 165, 0.13)'],
      ['1', 'rgba(255, 235, 165, 0)'],
    ],
    emboss: 'rgba(255, 254, 238, 0.94)',
    embossDark: 'rgba(88, 62, 10, 0.42)',
    embossEdge: 'rgba(255, 255, 255, 0.92)',
  },
  {
    name: 'sky',
    top: '#8fc9e8',
    frontTop: '#6da9cd',
    frontMid: '#5c96ba',
    frontBottom: '#4d82a5',
    rim: 'rgba(226, 246, 255, 0.95)',
    rimSoft: 'rgba(174, 219, 245, 0.58)',
    rimGlow: 'rgba(144, 202, 249, 0.5)',
    rimRight: 'rgba(100, 150, 180, 0.52)',
    rimRightGlow: 'rgba(24, 60, 88, 0.4)',
    seam: 'rgba(28, 62, 88, 0.75)',
    bevel: 'rgba(214, 240, 255, 0.72)',
    sheen: [
      ['0', 'rgba(238, 250, 255, 0.34)'],
      ['0.35', 'rgba(174, 219, 245, 0.14)'],
      ['1', 'rgba(174, 219, 245, 0)'],
    ],
    emboss: 'rgba(246, 253, 255, 0.94)',
    embossDark: 'rgba(12, 44, 72, 0.42)',
    embossEdge: 'rgba(255, 255, 255, 0.92)',
  },
  {
    name: 'peach',
    top: '#f0b6a2',
    frontTop: '#d5977f',
    frontMid: '#c4856e',
    frontBottom: '#ad715c',
    rim: 'rgba(255, 235, 226, 0.95)',
    rimSoft: 'rgba(255, 205, 185, 0.58)',
    rimGlow: 'rgba(244, 170, 140, 0.5)',
    rimRight: 'rgba(180, 120, 100, 0.52)',
    rimRightGlow: 'rgba(90, 40, 30, 0.4)',
    seam: 'rgba(90, 48, 36, 0.75)',
    bevel: 'rgba(255, 214, 198, 0.72)',
    sheen: [
      ['0', 'rgba(255, 242, 236, 0.34)'],
      ['0.35', 'rgba(255, 205, 185, 0.14)'],
      ['1', 'rgba(255, 205, 185, 0)'],
    ],
    emboss: 'rgba(255, 248, 244, 0.94)',
    embossDark: 'rgba(92, 38, 26, 0.42)',
    embossEdge: 'rgba(255, 255, 255, 0.92)',
  },
];

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

// ===== 고라운드 난이도: 추가 악당 스폰 =====
// 기존 4개 스폰 타일은 그대로 두고, 5번째/6번째 악당은 대기실 바로 옆 복도에서 시작한다.
export const EXTRA_ENEMY_SPAWNS = {
  CHASE: { row: 4, col: 6 },   // 4라운드: 추격 보모 +1
  PATROL: { row: 22, col: 21 }, // 5라운드: 순찰 보모 +1
};

// ===== 고라운드 난이도: 철창문 =====
export const GATE_OPEN_MS = 3000;   // 열려 있는 시간
export const GATE_CLOSED_MS = 3000; // 닫혀 있는 시간
export const GATE_WARN_MS = 700;    // 닫힘/열림 직전 경고 깜빡임 구간
export const GATE_MAX = 4;          // 최대 철창문 수
// 6라운드에 1개, 이후 2라운드마다 1개씩 추가된다.
export const GATE_POSITIONS = [
  { row: 9, col: 12 },
  { row: 9, col: 15 },
  { row: 18, col: 9 },
  { row: 18, col: 18 },
];

// ===== 고라운드 난이도: 시야 제한 =====
export const VISION_START_ROUND = 8;  // 8라운드부터 어둠 시작
export const VISION_START_TILES = 8;  // 8라운드 시야 반경(타일)
export const VISION_MIN_TILES = 3;    // 최소 시야 반경(타일)
// 어둠 속 근접 경고: 시야 반경 + 이 여유 안으로 보모가 들어오면 심장박동이 시작된다
export const DARK_HEARTBEAT_WARN_TILES = 1.5;

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
export const DEMO_IDLE_MS = 5000;       // 무입력 시 데모 플레이 자동 시작 시간

// ===== 체포 연출 (Oh! No~) =====
/** 잡힌 순간 베이비가 굳어 "Oh! No~" 를 듣는 시간 (이후 목숨 차감/게임 오버) */
export const CAUGHT_STUN_MS = 2400;

// ===== 라운드 시작 타이틀 =====
/** READY 카운트다운과 함께 네온으로 표시되는 라운드별 플레이버 문구 */
export const ROUND_TITLES = [
  '베이비 탈출 ^^',                 // 1
  '조금 빠르게~',                   // 2
  '더 빨리 !',                      // 3
  '추적 보모 한 명 더 왔다 *',       // 4
  '순찰 보모도 한명 더 왔네 **',     // 5
  '길이 막히기도 해 @',             // 6
  '정전인가 !!!',                   // 7
  '깜깜해~ 손 잡아줘',              // 8 (시야 제한 시작)
  '새벽 수유 타임',                 // 9
  '울음소리도 안 들려',             // 10
  '보모들이 미쳐 날뛰어',           // 11
  '갈수록 태산이다',                // 12
];

/**
 * 라운드 번호에 맞는 타이틀 문구를 돌려준다.
 * @param {number} round 1부터 시작하는 라운드
 * @returns {string}
 */
export function getRoundTitle(round) {
  const value = Number.isFinite(round) ? Math.floor(round) : 1;
  if (value < 1) return ROUND_TITLES[0];
  return ROUND_TITLES[value - 1] || `ROUND ${value} — 끝없는 밤`;
}

// ===== 목숨 / 라운드 / 하이스코어 (9단계) =====
export const PLAYER_LIVES = 3;              // 기본 목숨(하트)
export const ROUND_CLEAR_MODE = 'ITEMS';    // 'ITEMS' | 'SCORE' | 'BOTH'
export const ROUND_TARGET_SCORE = 2000;     // SCORE/BOTH 모드의 라운드 목표(증분)
export const ROUND_SPEED_STEP = 1;          // 라운드마다 속도 단계 += (최대 10)
export const HISCORE_KEY = 'pacbaby.hiscore'; // localStorage 키
export const HELP_SEEN_KEY = 'pacbaby.helpSeen'; // 사용 설명서 자동 표시 여부(localStorage)

// ===== 글로벌 프로필 / 리더보드 (게스트 선행 플레이) =====
/** 등록 시 선택할 수 있는 개인 이모지. id 는 배열 인덱스 + 1 (DB: 1~12) */
export const AVATAR_EMOJIS = [
  '🍼', '👶', '🧸', '🍭', '🦄', '🐣',
  '🌟', '🍪', '🎈', '🧦', '🚼', '🥛',
];

/** localStorage 키 모음 (게스트 프로필 미러/팝업 스누즈/리더보드 캐시) */
export const PROFILE_STORAGE_KEYS = {
  PROFILE: 'pacbaby.profile',
  PROMPT: 'pacbaby.registerPrompt',
  LEADERBOARD: 'pacbaby.leaderboardCache',
  // 오프라인/일시 오류로 제출하지 못한 런 (다음 접속에서 1회 재제출)
  PENDING_RUN: 'pacbaby.pendingSubmission',
};

/** 닉네임 규칙 — DB CHECK 제약(users_nickname_format)과 반드시 동일하게 유지한다 */
export const NICKNAME_RULE = {
  minLength: 2,
  maxLength: 12,
  pattern: /^[A-Za-z0-9가-힣_]{2,12}$/,
};

/** 게스트 → 등록 유도 조건 (OR). 하나라도 만족하면 게임 오버 시 부드럽게 안내한다. */
export const REGISTER_PROMPT_RULE = {
  minAccessCount: 3,     // 접속(세션) 3회 이상
  minHighScore: 500,     // 최고 점수 500점 이상
  minRound: 2,           // 2라운드 이상 도달
  dismissCooldownRuns: 3, // "나중에" 선택 시 3번의 게임 오버 동안 다시 묻지 않음
};

/**
 * 점수 검증 규칙 — Supabase RPC(pacbaby_score_cap / pacbaby_min_duration)와 동일한 값.
 * 클라이언트에서는 사전 안내/테스트용으로만 사용하고, 최종 판정은 서버가 한다.
 */
export const SCORE_RULES = {
  scoreBase: 400,          // 기본 여유 점수
  scorePerRound: 5000,     // 라운드당 상한 (이론 최대 ~4200)
  minBaseSeconds: 3,       // 최소 플레이 시간 기본값
  minSecondsPerRound: 10,  // 라운드당 최소 플레이 시간
  maxRound: 99,
  maxScore: 1000000,
  minScore: -100000, // 울기/체포 페널티로 음수가 될 수 있다
};

export const LEADERBOARD_CACHE_MS = 30000; // 리더보드 캐시 유효 시간
export const LEADERBOARD_LIMIT = 50;       // 한 번에 가져올 순위 수

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

/**
 * 가짜 젖꼭지(쪽쪽이) 전용 랜덤 스폰 타일.
 * - 벽(1)뿐 아니라 침대(2)/보모 대기실(3)도 후보에서 제외한다.
 * - avoid 목록(기존 아이템·플레이어/보모 인접 타일 등)도 함께 피한다.
 * - 후보를 모두 모은 뒤 난수로 하나를 고르므로 실패 재시도 없이 균등하게 분포한다.
 * @param {number[][]} map
 * @param {() => number} rng 난수 함수 (테스트에서 주입 가능)
 * @param {Array<{row: number, col: number}>} avoid 제외할 타일 목록
 * @returns {{row: number, col: number} | null}
 */
export function randomPacifierTile(map, rng = Math.random, avoid = []) {
  const blocked = new Set(avoid.map(p => `${p.row},${p.col}`));
  const candidates = [];

  for (let row = 0; row < map.length; row++) {
    for (let col = 0; col < map[row].length; col++) {
      const tile = map[row][col];
      if (tile === 1 || tile === 2 || tile === 3) continue;
      if (blocked.has(`${row},${col}`)) continue;
      candidates.push({ row, col });
    }
  }

  if (candidates.length === 0) return null;

  const roll = Number(rng());
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * candidates.length)),
  );
  return candidates[index];
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

// ===== 특수 아이템: 가짜 젖꼭지(쪽쪽이) =====
/**
 * 라운드 중 최대 1개만 존재하는 랜덤 특수 아이템.
 * - 라운드 클리어 필수 아이템(12개)에는 포함되지 않는다.
 * - 아기가 먹으면 5초 스텔스, 보모가 먼저 찾으면 치워버린다.
 */
export const FAKE_PACIFIER = {
  name: '쪽쪽이',
  score: 100,                    // 소량 점수 (라운드 상한 캡은 _addScore 가 지킨다)
  stealthDuration: 5000,         // 5초 스텔스
  respawnMs: 30000,              // 아기 획득 후 30초 쿨타임
  enemyClearDelayMs: 1500,       // 보모가 치운 뒤 1.5초 후 다른 빈 타일에 재등장
  minSpawnDistanceTiles: 2,      // 플레이어/보모와 최소 2타일(체비셰프) 이상 떨어진 곳
  color: '#f8bbd0',              // 파스텔 핑크 (방패판/링)
};

// ===== 아이템 속성 =====
// symbol 은 레거시 데이터 호환용으로만 남겨 둔다.
// 캔버스 렌더링은 OS 이모지 대신 item.js 의 Canvas 2D 벡터 아이콘(drawItemIcon)을 쓴다.
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
  // 특수 아이템: 가짜 젖꼭지(쪽쪽이). 클리어 카운트/소화/트랩 없음.
  // symbol 은 비워 두고 item.js 에서 Canvas 2D 도형으로 직접 그린다.
  PACIFIER: {
    name: FAKE_PACIFIER.name,
    symbol: '',
    score: FAKE_PACIFIER.score,
    digestTime: 0,
    trapType: null,
    slowEffect: 0,
    slowDuration: 0,
    super: true,
    respawnMs: FAKE_PACIFIER.respawnMs,
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