/**
 * Pac-Baby: 실제 음성·폴리(Foley) 효과음 매니페스트.
 *
 * - 모든 오디오 경로는 Vite 가 정적으로 분석해 콘텐츠 해시와 함께 번들링할 수 있도록
 *   명시적 리터럴 `new URL('./assets/sounds/<name>.mp3', import.meta.url).href` 를 사용한다.
 * - Node 단위 테스트 환경에서도 ES 모듈 문법 오류가 나지 않는다.
 * - `channel: 'voice'` 인 클립은 동일 캐릭터(베이비)의 목소리가 겹쳐 뭉개지지 않도록
 *   새 음성이 시작될 때 이전 음성을 부드럽게 정리한다.
 */

export const SOUND_MANIFEST = Object.freeze({
  // ===== 아이템 먹기 (Foley + 베이비 음성) =====
  eat_milk: {
    url: new URL('./assets/sounds/eat_milk.mp3', import.meta.url).href,
    volume: 0.95,
    rateJitter: 0.04,
    channel: 'foley',
  },
  eat_milk_followup: {
    url: new URL('./assets/sounds/eat_milk_followup.mp3', import.meta.url).href,
    volume: 0.92,
    rateJitter: 0.03,
    channel: 'voice',
  },
  eat_candy: {
    url: new URL('./assets/sounds/eat_candy.mp3', import.meta.url).href,
    volume: 0.95,
    rateJitter: 0.05,
    channel: 'foley',
  },
  eat_candy_followup: {
    url: new URL('./assets/sounds/eat_candy_followup.mp3', import.meta.url).href,
    volume: 0.92,
    rateJitter: 0.03,
    channel: 'voice',
  },
  eat_cookie: {
    url: new URL('./assets/sounds/eat_cookie.mp3', import.meta.url).href,
    volume: 0.96,
    rateJitter: 0.05,
    channel: 'foley',
  },
  eat_cookie_followup: {
    url: new URL('./assets/sounds/eat_cookie_followup.mp3', import.meta.url).href,
    volume: 0.92,
    rateJitter: 0.03,
    channel: 'voice',
  },
  eat_pacifier: {
    url: new URL('./assets/sounds/eat_pacifier.mp3', import.meta.url).href,
    volume: 0.95,
    rateJitter: 0.04,
    channel: 'foley',
  },
  eat_pacifier_followup: {
    url: new URL('./assets/sounds/eat_pacifier_followup.mp3', import.meta.url).href,
    volume: 0.88,
    rateJitter: 0.02,
    channel: 'voice',
  },
  eat_golden_followup: {
    url: new URL('./assets/sounds/eat_golden_followup.mp3', import.meta.url).href,
    volume: 0.98,
    rateJitter: 0.02,
    channel: 'voice',
  },

  // ===== 아이템 배출 (트랩: 리얼 실음 + 베이비 음성) =====
  trap_pee: {
    url: new URL('./assets/sounds/trap_pee.mp3', import.meta.url).href,
    volume: 0.96,
    rateJitter: 0.04,
    channel: 'voice',
  },
  trap_vomit: {
    url: new URL('./assets/sounds/trap_vomit.mp3', import.meta.url).href,
    volume: 0.98,
    rateJitter: 0.04,
    channel: 'voice',
  },
  trap_poop: {
    url: new URL('./assets/sounds/trap_poop.mp3', import.meta.url).href,
    volume: 1.0,
    rateJitter: 0.05,
    channel: 'voice',
  },

  // ===== 베이비 행위 효과음 (발걸음 · 울기 · 은신 · 체포 · 트랩 적중) =====
  step_normal_a: {
    url: new URL('./assets/sounds/step_normal_a.mp3', import.meta.url).href,
    volume: 0.42,
    rateJitter: 0.06,
    channel: 'step',
  },
  step_normal_b: {
    url: new URL('./assets/sounds/step_normal_b.mp3', import.meta.url).href,
    volume: 0.42,
    rateJitter: 0.06,
    channel: 'step',
  },
  step_sugar: {
    url: new URL('./assets/sounds/step_sugar.mp3', import.meta.url).href,
    volume: 0.48,
    rateJitter: 0.07,
    channel: 'step',
  },
  step_walker: {
    url: new URL('./assets/sounds/step_walker.mp3', import.meta.url).href,
    volume: 0.5,
    rateJitter: 0.06,
    channel: 'step',
  },
  baby_cry: {
    url: new URL('./assets/sounds/baby_cry.mp3', import.meta.url).href,
    volume: 1.0,
    rateJitter: 0.03,
    channel: 'voice',
  },
  fx_ice_freeze: {
    url: new URL('./assets/sounds/fx_ice_freeze.mp3', import.meta.url).href,
    volume: 0.85,
    rateJitter: 0.04,
    channel: 'foley',
  },
  baby_stealth: {
    url: new URL('./assets/sounds/baby_stealth.mp3', import.meta.url).href,
    volume: 0.9,
    rateJitter: 0.02,
    channel: 'voice',
  },
  baby_ohno: {
    url: new URL('./assets/sounds/baby_ohno.mp3', import.meta.url).href,
    volume: 1.0,
    rateJitter: 0.02,
    channel: 'voice',
  },
  baby_caught: {
    url: new URL('./assets/sounds/baby_caught.mp3', import.meta.url).href,
    volume: 0.96,
    rateJitter: 0.03,
    channel: 'voice',
  },
  trap_hit: {
    url: new URL('./assets/sounds/trap_hit.mp3', import.meta.url).href,
    volume: 0.95,
    rateJitter: 0.05,
    channel: 'foley',
  },
});

export const SOUND_KEYS = Object.freeze(Object.keys(SOUND_MANIFEST));
