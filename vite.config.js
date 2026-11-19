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

export default defineConfig({
  root: '.',
  // 상대 경로로 빌드: GitHub Pages 서브패스 / Vercel 루트 / 로컬 preview 모두 대응
  base: './',
  plugins: [buildVersionPlugin()],
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