/**
 * Pac-Baby: 애플리케이션 진입점
 *
 * Canvas를 초기화하고 게임을 시작한다.
 */

import Game from './game.js';
import InputManager from './input.js';
import SoundFX from './sound.js';
import TouchControls, { TouchSwipe } from './touch.js';
import HelpOverlay from './help.js';
import ProfileManager from './profile.js';
import ProfileStore from './profileStore.js';
import RegisterModal from './registerModal.js';
import LeaderboardModal from './leaderboardModal.js';
import { detectCountryHint } from './supabaseClient.js';
import { avatarEmoji } from './validation.js';
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

  // 키보드/화면 터치 → 자동 데모 즉시 종료
  // 게임 시작 전부터 등록해 초기 로딩 중의 터치도 활동으로 인정한다.
  const markUserActivity = (event) => {
    // 설명서 모달을 읽고 닫는 동작은 게임 플레이 입력으로 치지 않는다.
    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay && !helpOverlay.hidden) return;

    game.noteUserActivity();
  };
  window.addEventListener('keydown', markUserActivity, true);
  window.addEventListener('pointerdown', markUserActivity, true);

  // 브라우저 자동재생 정책: 첫 사용자 입력에서 오디오를 깨운다
  const unlockAudio = () => game.sound.unlock();
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  game.start();

  // ===== 레티나(고해상도) 대응 =====
  // 창 크기/모니터(DPR)가 바뀌면 캔버스 내부 해상도를 다시 맞춘다.
  const syncPixelRatio = () => game.refreshPixelRatio();
  window.addEventListener('resize', syncPixelRatio);
  window.addEventListener('orientationchange', syncPixelRatio);

  // 창을 다른 DPR 모니터로 옮겼을 때도 감지 (matchMedia resolution)
  if (typeof window.matchMedia === 'function') {
    const watchPixelRatio = () => {
      const dpr = window.devicePixelRatio || 1;
      const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
      const onChange = () => {
        syncPixelRatio();
        watchPixelRatio();
      };

      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', onChange, { once: true });
      }
    };
    watchPixelRatio();
  }

  // 모바일 터치 D-패드 (터치 기기에서 표시)
  const isTouchDevice = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if (isTouchDevice) document.body.classList.add('touch-active');

  const touchControls = new TouchControls(input);
  window.__TOUCH = touchControls;

  // 화면 스와이프/드래그로 방향 전환 (터치/펜 전용, 마우스는 무시)
  const touchSwipe = new TouchSwipe(input, canvas);
  window.__SWIPE = touchSwipe;

  // 사용 설명서(도움말): 첫 방문 시 자동 표시, H / F1 / ❔ 버튼으로 열고 닫기
  // (?no-help=1 로 자동 표시를 끌 수 있다 — 스크린샷/테스트용)
  const params = new URLSearchParams(window.location.search);
  const help = new HelpOverlay({ game, autoShow: !params.has('no-help') });
  window.__HELP = help;

  // ===== 글로벌 프로필 / 게스트 선행 플레이 =====
  // 닉네임 입력 없이 익명 세션으로 바로 시작하고, 조건을 만족하면 게임 오버 시 등록을 부드럽게 안내한다.
  const profile = new ProfileManager({
    store: new ProfileStore(),
    deviceType: isTouchDevice ? 'Mobile' : 'PC',
    countryHint: detectCountryHint(),
  });
  window.__PROFILE = profile;

  let registerModal = null;
  let leaderboardModal = null;

  // 모달을 열 때 도움말이 겹쳐 있으면 먼저 닫아 UI 차단 상태가 꼬이지 않게 한다.
  const blockGameForModal = () => {
    if (help.isOpen) help.close();
    game.setUiBlocked(true);
  };

  const updateProfileBadge = (snapshot) => {
    const badge = document.getElementById('profile-badge');
    const emoji = document.getElementById('profile-badge-emoji');
    const name = document.getElementById('profile-badge-name');

    if (emoji) emoji.textContent = avatarEmoji(snapshot.avatarEmojiId);
    if (name) name.textContent = snapshot.nickname || 'GUEST';
    if (badge) {
      badge.classList?.toggle?.('is-registered', !!snapshot.isRegistered);
      badge.title = snapshot.isRegistered ? '리더보드 보기' : '리더보드 · 기록 등록';
    }

    // 서버 최고점이 로컬(HUD)보다 높으면 표시용 하이스코어를 맞춘다.
    if (snapshot.highScore > game.hiScore) {
      game.hiScore = snapshot.highScore;
      try {
        window.localStorage.setItem(HISCORE_KEY, String(game.hiScore));
      } catch (err) { /* 저장 실패 무시 */ }
    }
  };
  profile.subscribe(updateProfileBadge);

  registerModal = new RegisterModal({
    profile,
    onOpen: blockGameForModal,
    onClose: () => {
      if (!leaderboardModal?.isOpen) game.setUiBlocked(false);
    },
    onRegistered: () => leaderboardModal?.refresh?.(),
  });

  leaderboardModal = new LeaderboardModal({
    profile,
    onOpen: blockGameForModal,
    onClose: () => {
      if (!registerModal?.isOpen) game.setUiBlocked(false);
    },
    onRegisterRequest: (summary) => registerModal.open(summary),
    isCovered: () => !!registerModal?.isOpen,
  });

  // 모달이 열린 동안 H/F1 로 도움말이 겹쳐 열리지 않게 한다.
  window.addEventListener('keydown', (event) => {
    if (!registerModal?.isOpen && !leaderboardModal?.isOpen) return;
    if (event.code === 'KeyH' || event.code === 'F1') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.__REGISTER = registerModal;
  window.__LEADERBOARD = leaderboardModal;

  // ===== 전역 [게임 종료] =====
  // 타이틀/플레이/일시정지/도움말/모달 어디서든 누르면
  // 메인 타이틀(READY 로비)로 완전 초기화되어 돌아간다.
  const exitButton = document.getElementById('exit-button');

  const handleExit = () => {
    // 열려 있는 모달을 먼저 닫아 UI 차단 상태가 남지 않게 한다.
    if (help.isOpen) help.close();
    if (registerModal?.isOpen) registerModal.close({ dismiss: false });
    if (leaderboardModal?.isOpen) leaderboardModal.close();
    game.resetToLobby();
  };

  exitButton?.addEventListener('click', handleExit);

  // 조건 충족 시 게임 오버에서 호출된다 (강제 가입 아님 — [나중에] 선택 가능)
  profile.onPrompt = (summary) => registerModal.open(summary);

  game.onRunStart = () => profile.beginRun();
  game.onRunEnd = (summary) => profile.handleRunEnd(summary);

  // 원격 초기화는 비동기. env 가 없거나 네트워크가 실패해도 LOCAL 모드로 게임은 계속된다.
  profile.init();
  profile.beginRun();

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