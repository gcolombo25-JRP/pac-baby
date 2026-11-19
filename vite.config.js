import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // 상대 경로로 빌드: GitHub Pages 서브패스 / Vercel 루트 / 로컬 preview 모두 대응
  base: './',
  // 정적 자산 폴더는 사용하지 않는다
  server: {
    port: 3000,
    strictPort: true, // 포트가 점유되면 조용히 3001 로 넘어가지 않고 실패한다
    open: true,
  },
  build: {
    outDir: 'dist',
  },
  preview: { port: 4173, open: true },
});