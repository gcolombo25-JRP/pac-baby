/**
 * Pac-Baby: Supabase 클라이언트 (지연 로딩 + 로컬 모드 폴백)
 *
 * - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없으면 null 을 반환한다.
 *   → 게임은 아무 기능 손실 없이 LOCAL 모드로 계속 동작한다.
 * - Node 테스트에서는 import.meta.env 가 없으므로 try/catch 로 안전하게 처리한다.
 * - anon key 는 공개되어도 되는 키다. 절대 service_role 키를 넣지 말 것.
 */

let clientPromise = null;

/** Vite 가 빌드 시 import.meta.env.VITE_* 를 정적으로 치환한다 (정확한 키 이름으로 접근) */
function readEnvConfig() {
  try {
    return {
      url: import.meta.env.VITE_SUPABASE_URL || '',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    };
  } catch (err) {
    return { url: '', anonKey: '' };
  }
}

/**
 * 빌드 시 env 주입이 빠진 경우(예: GitHub Pages 빌드에 secrets 누락)를 위한 런타임 대체값.
 * index.html 에서 아래 중 하나만 넣어도 모바일/정적 호스팅에서 리더보드가 동작한다.
 *   window.PACBABY_CONFIG = { supabaseUrl, supabaseAnonKey }
 *   <meta name="pacbaby-supabase-url" content="..."> / <meta name="pacbaby-supabase-anon-key" content="...">
 */
function readRuntimeConfig() {
  try {
    if (typeof window === 'undefined') return { url: '', anonKey: '' };
    const global = window.PACBABY_CONFIG || {};
    const meta = (name) => {
      try {
        return document?.querySelector?.(`meta[name="${name}"]`)?.content || '';
      } catch (err) {
        return '';
      }
    };
    return {
      url: global.supabaseUrl || global.url || meta('pacbaby-supabase-url'),
      anonKey: global.supabaseAnonKey || global.anonKey || meta('pacbaby-supabase-anon-key'),
    };
  } catch (err) {
    return { url: '', anonKey: '' };
  }
}

/** 깨진 URL/키가 들어오면 클라이언트를 만들지 않고 LOCAL 모드로 남긴다 */
function normalizeConfig(config = {}) {
  const url = String(config.url || '').trim();
  const anonKey = String(config.anonKey || '').trim();
  const validUrl = /^https?:\/\/[^\s]+$/i.test(url);
  return {
    url: validUrl ? url : '',
    anonKey: validUrl ? anonKey : '',
  };
}

/** Vite env → 런타임 설정 순서로 해석한다 (env 가 우선) */
export function getSupabaseConfig() {
  const env = readEnvConfig();
  const runtime = readRuntimeConfig();
  return normalizeConfig({
    url: env.url || runtime.url,
    anonKey: env.anonKey || runtime.anonKey,
  });
}

/** 원격 기능을 쓸 수 있는 설정인지 */
export function isRemoteConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

/**
 * Supabase 클라이언트 싱글턴 (없으면 null)
 * @returns {Promise<object|null>}
 */
export function getSupabaseClient() {
  if (!isRemoteConfigured()) return Promise.resolve(null);

  if (!clientPromise) {
    const { url, anonKey } = getSupabaseConfig();
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }))
      .catch((err) => {
        // 네트워크/번들 오류 시에도 게임은 LOCAL 모드로 계속 동작
        console.warn('[Pac-Baby] Supabase 초기화 실패:', err);
        return null;
      });
  }

  return clientPromise;
}

/** 테스트용: 캐시된 클라이언트 초기화 */
export function resetSupabaseClient() {
  clientPromise = null;
}

/** 터치 기기 여부로 PC/Mobile 판별 (서버에서 CHECK 제약으로 재검증) */
export function detectDeviceType() {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(pointer: coarse)').matches ? 'Mobile' : 'PC';
    }
  } catch (err) { /* 무시 */ }
  return 'PC';
}

/** navigator.language 의 지역 코드를 국가 힌트로 사용 (예: ko-KR → KR) */
export function detectCountryHint() {
  try {
    if (typeof navigator === 'undefined') return null;
    const match = String(navigator.language || '').match(/^[A-Za-z]{2,3}[-_]([A-Za-z]{2})$/);
    return match ? match[1].toUpperCase() : null;
  } catch (err) {
    return null;
  }
}
