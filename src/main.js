/**
 * Pac-Baby: 애플리케이션 진입점
 *
 * Canvas를 초기화하고 게임을 시작한다.
 */

import Game from './game.js';
import InputManager from './input.js';
import SoundFX from './sound.js';
import TouchControls from './touch.js';
import { HISCORE_KEY } from './constants.js';

function init() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) {
    console.error('Canvas 요소를 찾을 수 없습니다.');
    return;
  }

  // 입력 매니저 생성
  const input = new InputManager();

  // ?reset-hi=1 : 저장된 하이스코어 초기화
  if (new URLSearchParams(window.location.search).has('reset-hi')) {
    try {
      window.localStorage.removeItem(HISCORE_KEY);
    } catch (err) { /* 접근 차단 환경 무시 */ }
  }

  // 사운드는 앱 전체에서 1개만 사용 (재시작해도 AudioContext 누적 없음)
  const sound = new SoundFX();
  let game = new Game(canvas, input, { sound });

  // 브라우저 자동재생 정책: 첫 사용자 입력에서 오디오를 깨운다
  const unlockAudio = () => game.sound.unlock();
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  game.start();

  // 모바일 터치 D-패드 (터치 기기에서 표시)
  const isTouchDevice = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if (isTouchDevice) document.body.classList.add('touch-active');

  const touchControls = new TouchControls(input);
  window.__TOUCH = touchControls;

  // ===== 테스터 모드 (F2 또는 ?test=1 로 지연 로딩) =====
  const restart = () => {
    // 같은 인스턴스를 초기화해 오디오/테스터 연결을 유지한다
    game.resetAll();
    window.__GAME = game;
    return game;
  };

  // 탭 숨김/최소화 시 자동 일시정지
  document.addEventListener('visibilitychange', () => {
    game.handleVisibilityChange(document.hidden);
  });

  // 페이지를 떠날 때 오디오 장치 정리
  window.addEventListener('pagehide', () => sound.destroy());

  let tester = null;
  let testerLoading = null;

  const openTester = (open = true) => {
    // F2 연타 등으로 두 번 로딩되어 패널이 중복 생성되는 것을 방지
    if (!testerLoading) {
      testerLoading = import('./tester.js').then(({ default: Tester }) => {
        tester = new Tester({ game, input, restart, open });
        window.__TESTER = tester;
        return tester;
      });
    }

    return testerLoading.then(instance => {
      if (open) instance.show();
      return instance;
    });
  };

  window.addEventListener('keydown', (event) => {
    if (event.code === 'F2' && !event.shiftKey) {
      event.preventDefault();
      openTester(true);
    }
  });

  if (new URLSearchParams(window.location.search).has('test')) {
    openTester(true);
  }

  // 글로벌 디버그 노출 (개발 중 편의)
  window.__GAME = game;
  window.__INPUT = input;
  window.__OPEN_TESTER = openTester;
}

// DOM 로드 완료 후 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}