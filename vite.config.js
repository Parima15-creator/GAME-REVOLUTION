import { defineConfig } from 'vite';

export default defineConfig({
  base: '/GAME-REVOLUTION/',
  build: {
    rollupOptions: {
      external: ['@mediapipe/pose'],
    },
  },
  optimizeDeps: {
    include: ['three'],
  },
});
