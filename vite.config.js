import { defineConfig } from 'vite';

/**
 * 빌드마다 고유한 version.json 을 dist 에 생성한다.
 * index.html 의 인라인 스크립트가 이 파일을 no-store 로 확인해
 * 카카오톡 인앱 브라우저의 강한 캐시를 우회(자동 새로고침)한다.
 */
function buildVersionPlugin() {
  return {
    name: 'pacbaby-build-version',
    apply: 'build',
    generateBundle() {
      const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      });
    },
  };
}

/**
 * 홈 화면 아이콘용 인라인 SVG (public/ 폴더 없이 데이터 URI 로 매니페스트에 넣는다).
 * 캔버스 게임의 베이비 얼굴을 단순화한 512x512 아이콘.
 */
const PWA_ICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
  '<rect width="512" height="512" rx="104" fill="#04060f"/>',
  '<circle cx="256" cy="296" r="150" fill="#ffd6ba"/>',
  '<path d="M96 274c0-88 72-160 160-160s160 72 160 160c-34-34-84-52-160-52s-126 18-160 52z" fill="#b5763f"/>',
  '<circle cx="256" cy="104" r="30" fill="#b5763f"/>',
  '<circle cx="200" cy="294" r="20" fill="#3b2a3f"/>',
  '<circle cx="312" cy="294" r="20" fill="#3b2a3f"/>',
  '<circle cx="158" cy="342" r="28" fill="#ff9e8a" opacity=".8"/>',
  '<circle cx="354" cy="342" r="28" fill="#ff9e8a" opacity=".8"/>',
  '<path d="M216 356c10 16 24 24 40 24s30-8 40-24" fill="none" stroke="#b5763f" stroke-width="18" stroke-linecap="round"/>',
  '</svg>',
].join('');

/**
 * PWA 매니페스트(manifest.webmanifest)를 dev 서버와 빌드 산출물 양쪽에 제공한다.
 * - 홈 화면에서 실행하면 display: standalone → 브라우저 메뉴 없이 전체화면으로 시작
 * - public/ 폴더를 만들지 않고 buildVersionPlugin 과 같은 플러그인 패턴을 유지한다
 */
function pwaManifestPlugin() {
  const manifest = {
    name: 'Hungry Baby Rush',
    short_name: 'BabyRush',
    description: '팩맨 오마주 탑다운 미로 추격 게임',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#04060f',
    theme_color: '#04060f',
    orientation: 'any',
    icons: [
      {
        src: `data:image/svg+xml,${encodeURIComponent(PWA_ICON_SVG)}`,
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };

  const source = JSON.stringify(manifest, null, 2);

  return {
    name: 'pacbaby-pwa-manifest',
    // dev 서버: /manifest.webmanifest 를 메모리에서 바로 응답한다
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (path !== '/manifest.webmanifest') {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(source);
      });
    },
    // build: dist/manifest.webmanifest 로 방출한다
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source,
      });
    },
  };
}

export default defineConfig({
  root: '.',
  // 상대 경로로 빌드: GitHub Pages 서브패스 / Vercel 루트 / 로컬 preview 모두 대응
  base: './',
  plugins: [buildVersionPlugin(), pwaManifestPlugin()],
  // 정적 자산 폴더는 사용하지 않는다
  server: {
    port: 3000,
    strictPort: true, // 포트가 점유되면 조용히 3001 로 넘어가지 않고 실패한다
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 배포마다 반드시 새 파일을 받도록 모든 산출물에 콘텐츠 해시를 붙인다
    assetsInlineLimit: 0, // 인라인 없이 항상 별도 해시 파일로 방출
    cssCodeSplit: true,
    sourcemap: false,
    manifest: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  preview: { port: 4173, open: true },
});