/**
 * Pac-Baby: 공용 인라인 SVG 아이콘 세트
 *
 * - OS 이모지(🍼 🏆 🤖 …)는 기기/브라우저마다 모양과 크기가 달라 UI 가 흔들린다.
 *   여기서는 24x24 viewBox 의 자체 벡터 아이콘 문자열만 만들어 반환한다.
 * - DOM API(createElementNS 등)를 쓰지 않고 항상 문자열을 반환하므로,
 *   단위 테스트의 가짜 DOM 에서도 `element.innerHTML = svgString` 만으로 안전하다.
 * - Supabase `avatar_emoji_id`(1~12) 숫자 구조는 그대로 유지하고,
 *   렌더링만 이 파일의 아바타 SVG 로 치환한다.
 */

const AVATAR_NAMES = {
  1: '아기 얼굴',
  2: '우유컵',
  3: '사탕',
  4: '쿠키',
  5: '황금 젖병',
  6: '쪽쪽이',
  7: '곰돌이',
  8: '병아리',
  9: '구름',
  10: '별',
  11: '왕관',
  12: '하트',
};

/** 아바타 ID 목록 (1~12) */
export const AVATAR_IDS = Object.keys(AVATAR_NAMES).map(Number);

/** 아바타 ID → 한국어 이름 (aria-label/툴팁용) */
export function avatarName(id) {
  return AVATAR_NAMES[Number(id)] || AVATAR_NAMES[1];
}

// ===== 아바타 12종 (1~12) =====
const BABY_FACE = ''
  + '<circle cx="12" cy="13.3" r="7.7" fill="#ffd6ba"/>'
  + '<path d="M4.6 12.1c0-4.2 3.2-7.4 7.4-7.4s7.4 3.2 7.4 7.4c-1.6-1.6-3.9-2.5-7.4-2.5s-5.8.9-7.4 2.5z" fill="#b5763f"/>'
  + '<circle cx="12" cy="4.8" r="1.5" fill="#b5763f"/>'
  + '<circle cx="9.4" cy="13.2" r="1.05" fill="#3b2a3f"/>'
  + '<circle cx="14.6" cy="13.2" r="1.05" fill="#3b2a3f"/>'
  + '<circle cx="9.7" cy="12.9" r=".34" fill="#f4fffb"/>'
  + '<circle cx="14.9" cy="12.9" r=".34" fill="#f4fffb"/>'
  + '<circle cx="7.4" cy="15.7" r="1.5" fill="#ff9e8a" opacity=".8"/>'
  + '<circle cx="16.6" cy="15.7" r="1.5" fill="#ff9e8a" opacity=".8"/>'
  + '<path d="M10 16.7c.6.8 1.2 1.2 2 1.2s1.4-.4 2-1.2" fill="none" stroke="#b5763f" stroke-width="1.2" stroke-linecap="round"/>';

const MILK_CUP = ''
  + '<rect x="10.1" y="2.4" width="3.8" height="2.2" rx="1.1" fill="#ffd6ba"/>'
  + '<rect x="9.2" y="4.4" width="5.6" height="1.9" rx=".95" fill="#29b6f6"/>'
  + '<path d="M9.1 6.9h5.8a2 2 0 0 1 2 2v9.6a2.4 2.4 0 0 1-2.4 2.4H9.5a2.4 2.4 0 0 1-2.4-2.4V8.9a2 2 0 0 1 2-2z" fill="#e3f7ff"/>'
  + '<path d="M7.1 11.6h9.8v6.9a2.4 2.4 0 0 1-2.4 2.4H9.5a2.4 2.4 0 0 1-2.4-2.4z" fill="#fff8f0"/>'
  + '<path d="M9.2 13.8h5.6M9.2 16.2h5.6" stroke="#bfe9df" stroke-width="1" stroke-linecap="round"/>';

const CANDY = ''
  + '<path d="M6.6 9.4 2.9 7.5l.7 4.5-.7 4.5 3.7-1.9z" fill="#f8bbd0"/>'
  + '<path d="M17.4 9.4l3.7-1.9-.7 4.5.7 4.5-3.7-1.9z" fill="#f8bbd0"/>'
  + '<circle cx="12" cy="12" r="5" fill="#f06292"/>'
  + '<path d="M12.7 8.2a3.9 3.9 0 1 0 0 7.6" fill="none" stroke="#ffd9e4" stroke-width="1.4" stroke-linecap="round"/>';

const COOKIE = ''
  + '<circle cx="12" cy="12" r="8.2" fill="#c98b4b"/>'
  + '<circle cx="12" cy="12" r="7.4" fill="none" stroke="#e0b177" stroke-width="1.1"/>'
  + '<circle cx="9" cy="9.4" r="1.3" fill="#5d3a1a"/>'
  + '<circle cx="15" cy="10.2" r="1.15" fill="#5d3a1a"/>'
  + '<circle cx="11.4" cy="14.4" r="1.35" fill="#5d3a1a"/>'
  + '<circle cx="15.6" cy="15.4" r="1" fill="#5d3a1a"/>'
  + '<circle cx="7.6" cy="13.6" r=".9" fill="#5d3a1a"/>';

const GOLDEN_BOTTLE = ''
  + '<rect x="10.1" y="2.4" width="3.8" height="2.2" rx="1.1" fill="#ffe082"/>'
  + '<rect x="9.2" y="4.4" width="5.6" height="1.9" rx=".95" fill="#ffb300"/>'
  + '<path d="M9.1 6.9h5.8a2 2 0 0 1 2 2v9.6a2.4 2.4 0 0 1-2.4 2.4H9.5a2.4 2.4 0 0 1-2.4-2.4V8.9a2 2 0 0 1 2-2z" fill="#ffe082"/>'
  + '<path d="M7.1 11.6h9.8v6.9a2.4 2.4 0 0 1-2.4 2.4H9.5a2.4 2.4 0 0 1-2.4-2.4z" fill="#ffd700"/>'
  + '<path d="M9.2 13.8h5.6M9.2 16.2h5.6" stroke="#fff3c4" stroke-width="1" stroke-linecap="round"/>'
  + '<path d="M18.6 2.6l.75 1.6 1.6.75-1.6.75-.75 1.6-.75-1.6-1.6-.75 1.6-.75z" fill="#fff3c4"/>';

const PACIFIER = ''
  + '<circle cx="12" cy="8" r="3.6" fill="none" stroke="#29b6f6" stroke-width="2.2"/>'
  + '<path d="M7.4 10.6h9.2a1 1 0 0 1 1 1v.6a2.6 2.6 0 0 1-2.6 2.6H9a2.6 2.6 0 0 1-2.6-2.6v-.6a1 1 0 0 1 1-1z" fill="#b8f2e6"/>'
  + '<path d="M9.6 15.4h4.8v1.6a2.4 2.4 0 0 1-4.8 0z" fill="#ffe082"/>'
  + '<circle cx="12" cy="8" r="1.1" fill="#29b6f6"/>';

const TEDDY_BEAR = ''
  + '<circle cx="6.4" cy="6.6" r="2.6" fill="#b5763f"/>'
  + '<circle cx="17.6" cy="6.6" r="2.6" fill="#b5763f"/>'
  + '<circle cx="6.4" cy="6.6" r="1.3" fill="#ffd6ba"/>'
  + '<circle cx="17.6" cy="6.6" r="1.3" fill="#ffd6ba"/>'
  + '<circle cx="12" cy="13" r="7.4" fill="#c98b4b"/>'
  + '<ellipse cx="12" cy="15.6" rx="3.6" ry="2.8" fill="#ffd6ba"/>'
  + '<circle cx="9.4" cy="11.8" r="1.05" fill="#3b2a3f"/>'
  + '<circle cx="14.6" cy="11.8" r="1.05" fill="#3b2a3f"/>'
  + '<ellipse cx="12" cy="14.6" rx="1.1" ry=".8" fill="#3b2a3f"/>'
  + '<path d="M12 15.4v1M10.4 16.6c.5.5 1 .7 1.6.7s1.1-.2 1.6-.7" fill="none" stroke="#3b2a3f" stroke-width=".9" stroke-linecap="round"/>';

const CHICK = ''
  + '<circle cx="12" cy="13" r="7.4" fill="#ffe082"/>'
  + '<path d="M12 5.8c-.4-1.4.2-2.6 1.4-3.2-.2 1.2 0 2 .8 2.6z" fill="#ffb300"/>'
  + '<circle cx="9.4" cy="11.4" r="1.05" fill="#3b2a3f"/>'
  + '<circle cx="14.6" cy="11.4" r="1.05" fill="#3b2a3f"/>'
  + '<path d="M10.2 14.2h3.6L12 16.8z" fill="#ffa726"/>'
  + '<ellipse cx="5.4" cy="14.4" rx="1.6" ry="2.3" fill="#ffd54f"/>'
  + '<ellipse cx="18.6" cy="14.4" rx="1.6" ry="2.3" fill="#ffd54f"/>'
  + '<circle cx="7.4" cy="13.6" r="1.2" fill="#ff9e8a" opacity=".75"/>'
  + '<circle cx="16.6" cy="13.6" r="1.2" fill="#ff9e8a" opacity=".75"/>';

const CLOUD = ''
  + '<path d="M7.2 18a4.1 4.1 0 0 1-.5-8.2 5.4 5.4 0 0 1 10.3-1.2A3.9 3.9 0 0 1 17 18z" fill="#e3f7ff"/>'
  + '<path d="M7.6 10.6a4.2 4.2 0 0 1 3.2-1.6" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" opacity=".95"/>'
  + '<circle cx="9.6" cy="14.4" r=".9" fill="#b8f2e6"/>'
  + '<circle cx="14.4" cy="14.6" r=".9" fill="#b8f2e6"/>';

const STAR = ''
  + '<path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.3l6.1-.9z" fill="#ffe082"/>'
  + '<path d="M12 6.4l1.3 2.7 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="#fff3c4"/>';

const CROWN = ''
  + '<path d="M3.4 18.6 2.2 7.8l5.2 3.3L12 4.8l4.6 6.3 5.2-3.3-1.2 10.8z" fill="#ffd54f"/>'
  + '<rect x="3.4" y="17.4" width="17.2" height="2.6" rx="1.3" fill="#ffb300"/>'
  + '<circle cx="12" cy="13" r="1.35" fill="#f06292"/>'
  + '<circle cx="6.9" cy="14.4" r="1" fill="#29b6f6"/>'
  + '<circle cx="17.1" cy="14.4" r="1" fill="#8bc34a"/>';

const HEART = ''
  + '<path d="M12 20.4 4.6 13a4.4 4.4 0 0 1 6.2-6.2L12 8l1.2-1.2A4.4 4.4 0 0 1 19.4 13z" fill="#f06292"/>'
  + '<path d="M16.4 9.2a2.4 2.4 0 0 0-1.6-.6" fill="none" stroke="#ffd9e4" stroke-width="1.2" stroke-linecap="round"/>';

const AVATAR_BODIES = {
  1: BABY_FACE,
  2: MILK_CUP,
  3: CANDY,
  4: COOKIE,
  5: GOLDEN_BOTTLE,
  6: PACIFIER,
  7: TEDDY_BEAR,
  8: CHICK,
  9: CLOUD,
  10: STAR,
  11: CROWN,
  12: HEART,
};


// ===== 아이템/UI 아이콘 =====
const ICON_BODIES = {
  // 아이템 (도움말 표/설명에서 사용)
  bottle: MILK_CUP,
  milk: MILK_CUP,
  candy: CANDY,
  cookie: COOKIE,
  goldenBottle: GOLDEN_BOTTLE,
  pacifier: PACIFIER,

  // 침대/눈물
  bed: ''
    + '<rect x="2.4" y="11" width="19.2" height="6.4" rx="1.6" fill="#bfe9df"/>'
    + '<rect x="3.8" y="8.4" width="7" height="3.4" rx="1.4" fill="#fff8f0"/>'
    + '<path d="M12.4 8.6h7.8a1.6 1.6 0 0 1 1.6 1.6v1.2h-9.4z" fill="#ff9e8a"/>'
    + '<rect x="3.2" y="17.2" width="1.8" height="3.2" rx=".9" fill="#b5763f"/>'
    + '<rect x="19" y="17.2" width="1.8" height="3.2" rx=".9" fill="#b5763f"/>',
  tear: ''
    + '<path d="M12 3.2c2.7 3.5 4.5 6.4 4.5 8.8a4.5 4.5 0 0 1-9 0c0-2.4 1.8-5.3 4.5-8.8z" fill="#81d4fa"/>'
    + '<path d="M10 12.6a1.9 1.9 0 0 0 1.9 1.9" fill="none" stroke="#e1f5fe" stroke-width="1.1" stroke-linecap="round"/>',

  // 사운드
  soundOn: ''
    + '<path d="M4 9.6h3.2L12 5.8v12.4l-4.8-3.8H4z" fill="#9fdcff"/>'
    + '<path d="M15.2 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4" fill="none" stroke="#29b6f6" stroke-width="1.6" stroke-linecap="round"/>',
  soundOff: ''
    + '<path d="M4 9.6h3.2L12 5.8v12.4l-4.8-3.8H4z" fill="#9fdcff"/>'
    + '<path d="M15.4 9.6l4.6 4.8M20 9.6l-4.6 4.8" fill="none" stroke="#ef5350" stroke-width="1.8" stroke-linecap="round"/>',

  // 봇/트로피
  bot: ''
    + '<rect x="3.4" y="6.6" width="17.2" height="12.4" rx="3.2" fill="#9fdcff"/>'
    + '<path d="M12 3v3.4" stroke="#29b6f6" stroke-width="1.6" stroke-linecap="round"/>'
    + '<circle cx="12" cy="2.6" r="1.3" fill="#ffd54f"/>'
    + '<circle cx="9" cy="12" r="1.5" fill="#0b2545"/>'
    + '<circle cx="15" cy="12" r="1.5" fill="#0b2545"/>'
    + '<path d="M9.2 15.4h5.6" stroke="#0b2545" stroke-width="1.4" stroke-linecap="round"/>'
    + '<rect x="1.2" y="10.4" width="1.8" height="4.6" rx=".9" fill="#29b6f6"/>'
    + '<rect x="21" y="10.4" width="1.8" height="4.6" rx=".9" fill="#29b6f6"/>',
  trophy: ''
    + '<path d="M7 4h10v4.6a5 5 0 0 1-10 0z" fill="#ffd54f"/>'
    + '<path d="M7 5.4H4.4v1.4A3.2 3.2 0 0 0 7.6 10M17 5.4h2.6v1.4A3.2 3.2 0 0 1 16.4 10" fill="none" stroke="#ffb300" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M10.6 13.4h2.8v3.2h-2.8z" fill="#ffb300"/>'
    + '<rect x="7.6" y="16.4" width="8.8" height="2.4" rx="1.2" fill="#c98b4b"/>'
    + '<rect x="6.4" y="18.6" width="11.2" height="1.8" rx=".9" fill="#a86d33"/>',

  // 컨트롤
  help: ''
    + '<circle cx="12" cy="12" r="9" fill="#29b6f6"/>'
    + '<path d="M9.6 9.4a2.6 2.6 0 1 1 3.9 2.3c-.9.5-1.4 1.1-1.4 2.1" fill="none" stroke="#f4fffb" stroke-width="1.9" stroke-linecap="round"/>'
    + '<circle cx="12" cy="17" r="1.2" fill="#f4fffb"/>',
  close: ''
    + '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  power: ''
    + '<path d="M12 3.4v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
    + '<path d="M7.2 6.4a8 8 0 1 0 9.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  pause: ''
    + '<rect x="6.6" y="5.2" width="4" height="13.6" rx="1.4" fill="currentColor"/>'
    + '<rect x="13.4" y="5.2" width="4" height="13.6" rx="1.4" fill="currentColor"/>',
  restart: ''
    + '<path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
    + '<path d="M19.6 3.6v4.4h-4.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M8 4.6v14.8l12-7.4z" fill="currentColor"/>',
  stop: '<rect x="5.6" y="5.6" width="12.8" height="12.8" rx="2.4" fill="currentColor"/>',

  // 도움말 섹션
  target: ''
    + '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#ef5350" stroke-width="1.8"/>'
    + '<circle cx="12" cy="12" r="4.8" fill="none" stroke="#ffd54f" stroke-width="1.8"/>'
    + '<circle cx="12" cy="12" r="1.7" fill="#ef5350"/>',
  gamepad: ''
    + '<rect x="2" y="7.4" width="20" height="9.6" rx="4.4" fill="#29b6f6"/>'
    + '<path d="M7.2 10.4v3.6M5.4 12.2h3.6" stroke="#f4fffb" stroke-width="1.6" stroke-linecap="round"/>'
    + '<circle cx="16.2" cy="11.2" r="1.2" fill="#ffd54f"/>'
    + '<circle cx="18.4" cy="13.6" r="1.2" fill="#ff9e8a"/>',
  phone: ''
    + '<rect x="6.6" y="2.6" width="10.8" height="18.8" rx="2.6" fill="#9fdcff"/>'
    + '<rect x="8.2" y="5" width="7.6" height="11.6" rx="1.2" fill="#0b2545"/>'
    + '<circle cx="12" cy="18.6" r="1.1" fill="#0b2545"/>',
  tip: ''
    + '<path d="M12 2.8a6.2 6.2 0 0 0-3.6 11.3c.6.4 1 1 1 1.7v.4h5.2v-.4c0-.7.4-1.3 1-1.7A6.2 6.2 0 0 0 12 2.8z" fill="#ffe082"/>'
    + '<rect x="9.4" y="17.4" width="5.2" height="1.6" rx=".8" fill="#c98b4b"/>'
    + '<rect x="10" y="19.4" width="4" height="1.6" rx=".8" fill="#a86d33"/>',
  flame: ''
    + '<path d="M12 3c3.2 3.6 5.4 6.3 5.4 9.6a5.4 5.4 0 0 1-10.8 0C6.6 9.3 8.8 6.6 12 3z" fill="#ff8f00"/>'
    + '<path d="M12 11.4c1.4 1.6 2.3 2.8 2.3 4.2a2.3 2.3 0 0 1-4.6 0c0-1.4.9-2.6 2.3-4.2z" fill="#ffe082"/>',
};

/** 사용 가능한 UI 아이콘 이름 목록 */
export const UI_ICON_NAMES = Object.keys(ICON_BODIES);

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSvg(body, options = {}) {
  const extra = options.className ? ` ${String(options.className).trim()}` : '';
  const label = options.label ? String(options.label) : '';
  const a11y = label
    ? ` role="img" aria-label="${escapeAttribute(label)}"`
    : ' aria-hidden="true" focusable="false"';
  return `<svg class="ui-icon${extra}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"${a11y}>${body}</svg>`;
}

/**
 * 아바타 ID(1~12)에 매핑된 인라인 SVG 문자열을 반환한다.
 * @param {number|string} id 1~12
 * @param {{ className?: string, label?: string }} [options]
 */
export function avatarSvg(id, options = {}) {
  const key = Number(id);
  const body = AVATAR_BODIES[key] || AVATAR_BODIES[1];
  const extra = String(options.className || '')
    .trim()
    .split(/\s+/)
    .filter(name => name && name !== 'ui-avatar');
  return renderSvg(body, { ...options, className: ['ui-avatar', ...extra].join(' ') });
}

/**
 * 이름이 지정된 UI 아이콘 SVG 문자열. 없는 이름이면 ''.
 * @param {string} name
 * @param {{ className?: string, label?: string }} [options]
 */
export function uiIcon(name, options = {}) {
  const body = ICON_BODIES[name];
  if (!body) return '';
  return renderSvg(body, options);
}

/**
 * 국가 코드 → 미니 텍스트 배지 (OS 국기 이모지 폰트에 의존하지 않음).
 * 알 수 없는 값은 '·'.
 */
export function countryBadge(code) {
  const value = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) {
    return '<span class="lb-country-none" aria-hidden="true">·</span>';
  }
  return `<span class="lb-flag" title="${value}" aria-label="${value}">${value}</span>`;
}
