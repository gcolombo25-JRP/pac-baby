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
import ProfileManager, { describeSubmissionReason } from './profile.js';
import ProfileStore from './profileStore.js';
import RegisterModal from './registerModal.js';
import LeaderboardModal from './leaderboardModal.js';
import { showToast } from './toast.js';
import { detectCountryHint, isRemoteConfigured } from './supabaseClient.js';
import { avatarSvg } from './uiIcons.js';
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
    // 등록/리더보드 모달이 게임을 막고 있는 동안의 조작도 게임 입력이 아니다.
    if (game.helpOpen) return;

    // UI 버튼(데모 실행/게임 종료/프로필/모달 등)의 포인터 조작은 제외한다.
    // D-패드의 방향/울기 버튼은 게임 조작 입력이므로 그대로 통과시킨다.
    if (event?.type === 'pointerdown') {
      const button = event.target?.closest?.('button');
      if (button) {
        const code = button.dataset?.key || button.getAttribute?.('data-key');
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
          return;
        }
      }
    }

    game.noteUserActivity();
  };
  window.addEventListener('keydown', markUserActivity, true);
  window.addEventListener('pointerdown', markUserActivity, true);

  // 메인 화면 [데모 실행]: 접속 중 언제든 새 데모 판을 시작한다.
  // (데모는 서버 런 시작/점수 제출/하이스코어와 완전히 분리된다)
  const demoButton = document.getElementById('demo-button');
  demoButton?.addEventListener('click', () => {
    demoButton.blur?.(); // 버튼 포커스로 Space/Enter 가 게임 입력을 가로채지 않게
    game.startDemo();
  });

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

  const touchControls = new TouchControls(input, null, sound);
  window.__TOUCH = touchControls;

  // D-패드와 UI 버튼(도움말/리더보드/종료/모달 등)의 클릭음은
  // TouchControls 가 pointerdown 에서 직접 재생한다 (중복 리스너 없음).

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

  // ===== 최상단 기록 줄 (내 최고 / 전체 1위) =====
  // - #game-header 의 2칸 배지에만 표시하고, 캔버스 내부 HUD 는 그대로 둔다.
  // - 전체 1위 조회가 실패/오프라인이면 '-' 로 두고 게임을 절대 막지 않는다.
  const topRecordEls = {
    mineScore: document.getElementById('my-best-score'),
    mineRound: document.getElementById('my-best-round'),
    topScore: document.getElementById('top-score'),
    topRound: document.getElementById('top-round'),
  };

  const formatRecordScore = (value) => {
    if (value === null || value === undefined) return '-';
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(0, number).toLocaleString('ko-KR') : '-';
  };

  const formatRecordRound = (value) => {
    if (value === null || value === undefined) return '-';
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? `R${number}` : '-';
  };

  const renderTopRecords = (snapshot) => {
    const current = snapshot || profile.getSnapshot();
    if (topRecordEls.mineScore) topRecordEls.mineScore.textContent = formatRecordScore(current.highScore);
    if (topRecordEls.mineRound) topRecordEls.mineRound.textContent = formatRecordRound(current.maxRound);
    if (topRecordEls.topScore) topRecordEls.topScore.textContent = formatRecordScore(current.topScore);
    if (topRecordEls.topRound) topRecordEls.topRound.textContent = formatRecordRound(current.topRound);
  };

  // 여러 경로(초기화/점수 갱신/리더보드 열기)에서 호출돼도 요청은 1번만 나가게 한다.
  let topRecordsPromise = null;
  const refreshTopRecords = () => {
    if (topRecordsPromise) return topRecordsPromise;
    topRecordsPromise = profile.loadLeaderboard()
      .then((snapshot) => { renderTopRecords(snapshot); return snapshot; })
      .catch(() => null)
      .finally(() => { topRecordsPromise = null; });
    return topRecordsPromise;
  };

  let lastBestScore = null;

  const updateProfileBadge = (snapshot) => {
    const badge = document.getElementById('profile-badge');
    const emoji = document.getElementById('profile-badge-emoji');
    const name = document.getElementById('profile-badge-name');

    // OS 이모지 대신 avatar_emoji_id(1~12) 자체 SVG 아이콘
    if (emoji) emoji.innerHTML = avatarSvg(snapshot.avatarEmojiId, { className: 'ui-avatar' });
    if (name) name.textContent = snapshot.nickname || 'GUEST';
    if (badge) {
      badge.classList?.toggle?.('is-registered', !!snapshot.isRegistered);
      badge.title = snapshot.isRegistered ? '리더보드 보기' : '리더보드 · 기록 등록';
    }

    // 서버 최고점이 로컬(HUD)보다 높으면 표시용 하이스코어를 맞춘다.
    // 단, 데모 중에는 localStorage 하이스코어를 저장하지 않는다 (데모/매뉴얼 완전 격리).
    if (snapshot.highScore > game.hiScore) {
      game.hiScore = snapshot.highScore;
      if (!game.demoMode) {
        try {
          window.localStorage.setItem(HISCORE_KEY, String(game.hiScore));
        } catch (err) { /* 저장 실패 무시 */ }
      }
    }

    renderTopRecords(snapshot);

    // 내 최고점이 올라가면(서버 병합/점수 제출) 전체 1위도 조용히 새로 고친다.
    const bestScore = Math.max(0, Math.floor(Number(snapshot?.highScore) || 0));
    if (lastBestScore === null) {
      lastBestScore = bestScore;
    } else if (bestScore > lastBestScore) {
      lastBestScore = bestScore;
      refreshTopRecords();
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
  // [게임 종료]는 READY 로비로 곧바로 되돌리지 않고 실제 종료 상태(EXITED)로 멈춘 뒤
  // 전용 종료 화면(#exit-overlay)만 남긴다. 다시 하려면 종료 화면의 [다시 시작]을 누른다.
  const exitButton = document.getElementById('exit-button');
  const exitOverlay = document.getElementById('exit-overlay');
  const exitCard = document.getElementById('exit-card');
  const exitRestartButton = document.getElementById('exit-restart');
  const exitCloseWindowButton = document.getElementById('exit-close-window');
  const exitNote = document.getElementById('exit-note');

  const showExitOverlay = () => {
    document.body.classList.add('game-exited');
    if (exitNote) exitNote.textContent = '';
    if (!exitOverlay) return;
    exitOverlay.hidden = false;
    exitOverlay.removeAttribute?.('hidden');
    exitOverlay.setAttribute?.('aria-hidden', 'false');
    exitCard?.focus?.();
  };

  const hideExitOverlay = () => {
    document.body.classList.remove('game-exited');
    if (!exitOverlay) return;
    exitOverlay.setAttribute?.('aria-hidden', 'true');
    exitOverlay.hidden = true;
    exitOverlay.setAttribute?.('hidden', '');
  };

  const handleExit = () => {
    // 열려 있는 모달을 먼저 닫아 UI 차단 상태가 남지 않게 한다.
    if (help.isOpen) help.close();
    if (registerModal?.isOpen) registerModal.close({ dismiss: false });
    if (leaderboardModal?.isOpen) leaderboardModal.close();

    // 유효한 매뉴얼 런이면 점수를 제출하고 루프·BGM 을 정지한 뒤 EXITED 로 멈춘다.
    game.exitGame();
    showExitOverlay();
  };

  const handleExitRestart = () => {
    hideExitOverlay();
    game.resetToLobby(); // READY 로비로 초기화 + 루프 재가동
    window.__GAME = game;
  };

  const handleExitCloseWindow = () => {
    // 브라우저 보안상 스크립트로 연 창이 아니면 닫히지 않는다 → 안내 문구로 대체
    try {
      window.close();
    } catch (err) { /* 무시 */ }

    window.setTimeout(() => {
      if (exitNote) exitNote.textContent = '브라우저 탭이나 앱을 직접 닫아 주세요';
    }, 80);
  };

  exitButton?.addEventListener('click', handleExit);
  exitRestartButton?.addEventListener('click', handleExitRestart);
  exitCloseWindowButton?.addEventListener('click', handleExitCloseWindow);

  // 조건 충족 시 게임 오버에서 호출된다 (강제 가입 아님 — [나중에] 선택 가능)
  profile.onPrompt = (summary) => registerModal.open(summary);

  // 조용한 실패 방지: 서버 반영에 실패/거절되면 이유를 화면에 알린다.
  // - 데모/봇(ASSISTED_RUN)과 env 미설정 LOCAL 모드는 의도된 동작이라 알리지 않는다.
  const notifySubmissionFailure = (summary, result) => {
    if (!result || result.accepted) return;
    if (!summary || summary.assisted) return;
    if (Math.max(0, Math.floor(Number(summary.score) || 0)) <= 0) return;
    if (result.reason === 'ASSISTED_RUN') return;
    if (result.reason === 'REMOTE_DISABLED' && !isRemoteConfigured()) return;

    const reason = describeSubmissionReason(result.reason);
    showToast(
      result.pending
        ? `기록을 임시 보관했어요 — ${reason}. 다음 접속 때 다시 제출합니다.`
        : `기록이 리더보드에 반영되지 않았어요 — ${reason}`,
      { duration: 3600 },
    );
  };

  game.onRunStart = () => profile.beginRun();
  game.onRunEnd = async (summary) => {
    const result = await profile.handleRunEnd(summary);
    try { notifySubmissionFailure(summary, result); } catch (err) { /* 안내 실패는 무시 */ }
    return result;
  };

  // 원격 초기화는 비동기. env 가 없거나 네트워크가 실패해도 LOCAL 모드로 게임은 계속된다.
  const profileInit = profile.init();
  profile.beginRun();

  // 원격 초기화 완료 후 백그라운드로 '전체 1위'를 1회 가볍게 조회한다.
  // (기존 30초 캐시를 활용하며, 실패해도 표시만 '-' 로 두고 게임은 그대로 진행)
  profileInit
    .then(() => {
      lastBestScore = Math.max(
        lastBestScore ?? 0,
        Math.floor(Number(profile.getSnapshot().highScore) || 0),
      );
      refreshTopRecords();
    })
    .catch(() => { /* LOCAL/오프라인: '-' 유지 */ });

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

  // 페이지를 떠날 때 오디오 장치 정리 + 미제출 정식 런 보류 저장
  window.addEventListener('pagehide', () => {
    // pagehide 시점에 아직 서버에 제출되지 않은 정식 매뉴얼 런은
    // 다음 접속(init)에서 1회 재제출할 수 있게 ProfileStore 에 남긴다.
    try {
      profile.capturePendingRun(game.getRunSummary(), { ended: !!game.runEnded });
    } catch (err) { /* 무시 */ }
    sound.destroy();
  });

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